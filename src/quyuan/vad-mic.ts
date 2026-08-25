import type { TalosSettings } from "../settings";
import {
	SILERO_SAMPLE_RATE,
	SILERO_WINDOW,
	SPEECH_KEEP_PROB,
	SPEECH_START_PROB,
	SileroVad,
} from "./silero-vad";
import { PRE_ROLL, VadTurnMachine } from "./vad-turn";

// ============================================================
// 屈原 · 麦克风 + 能量 VAD 基类（云端/本地识别共用）
//   持续监听 + 自动断句 + 屈原说话时高阈值打断；子类只实现 transcribe()。
//   AudioWorklet 取 16k 单声道帧 → 主线程算 RMS → 状态机
//   listening(候命) → capturing(在说，含 pre-roll 防截头) → 静音 SILENCE_MS
//   则结束一段 → 交子类转写。开启 AEC/降噪减回授。
// ============================================================

// 响度阈值（16k；AudioWorklet 渲染量子 128 样本 ≈ 8ms/帧）。
// Silero VAD 就绪后收音判定改用人声概率，这里只剩「未就绪/已回退」时的兜底
// 与打断判定——打断仍按响度，因为屈原自己的朗读在模型看来同样是人声。
const START_RMS = 0.03;
const KEEP_RMS = 0.015;
const BARGE_RMS = 0.05;
const BARGE_FRAMES = 40;
const BARGE_GUARD_MS = 500;
// 打断窗口内的滚动缓冲长度：覆盖触发打断的那段语音，让打断句本身也能被完整转写
const BARGE_PREROLL = PRE_ROLL + BARGE_FRAMES + 12;
// VAD 推理积压上限（每个窗口 32ms）：正常只会有 0-1 个，积压说明机器忙，丢旧保新
const VAD_QUEUE_MAX = 12;
// 流式转写：短于此不值得跑；两次之间至少要新增这么多音频
const PARTIAL_MIN_MS = 1200;
const PARTIAL_INTERVAL_MS = 700;
const MEDIA_ACQUIRE_TIMEOUT_MS = 15000;

export type VadMicLifecycleState =
	| "idle"
	| "starting"
	| "listening"
	| "stopping";

export interface VadMicHandlers {
	onListeningChange: (on: boolean) => void;
	onState: (state: "listening" | "capturing" | "transcribing") => void;
	onLevel?: (level: number) => void;
	onSpeechStart: () => void;
	onText: (text: string) => void;
	/** 流式转写的中途结果，仅供字幕展示：不定案、不唤醒、不发送 */
	onPartial?: (text: string) => void;
	onError: (message: string) => void;
}

export interface VadTranscriptionContext {
	streamId: string;
	phase: "partial" | "final";
}

const PCM_WORKLET_SRC = `
class TqPcm extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { const out = new Float32Array(ch); this.port.postMessage(out.buffer, [out.buffer]); }
    return true;
  }
}
registerProcessor('tq-pcm', TqPcm);
`;


export abstract class VadMic {
	protected settings: TalosSettings;
	protected h: VadMicHandlers;
	private stream: MediaStream | null = null;
	private ctx: AudioContext | null = null;
	private node: AudioWorkletNode | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private on = false;
	private lifecycleState: VadMicLifecycleState = "idle";
	private lifecycleGeneration = 0;
	private startPromise: Promise<void> | null = null;
	private stopPromise: Promise<void> | null = null;
	protected sampleRate = 16000;

	private frameMs = 8;
	private bargeFrames = 0;
	private busy = false;
	private bargeEnabled = false;
	private busySince = 0;
	// 打断窗口专用滚动缓冲；正常收音的 pre-roll 由 turn 自己维护
	private preRoll: Float32Array[] = [];
	private turn: VadTurnMachine;
	// Silero VAD：就绪前与失败后一律走原响度判定，链路永不中断
	private silero: SileroVad | null = null;
	private sileroLoading: Promise<void> | null = null;
	private sileroReady = false;
	private sileroFailed = false;
	private sileroNotified = false;
	private vadFill = new Float32Array(SILERO_WINDOW);
	private vadFilled = 0;
	private vadQueue: Float32Array[] = [];
	private vadRunning = false;
	private speechProb = 0;
	// 流式转写（仅本地引擎）：中途结果只喂字幕，定案仍以最终整段结果为准
	private partialInFlight = false;
	private partialRequestGeneration = 0;
	private partialTurn = -1;
	private partialMarkMs = 0;
	private lastPartial: { turnId: number; samples: number; text: string } | null = null;

	constructor(settings: TalosSettings, handlers: VadMicHandlers) {
		this.settings = settings;
		this.h = handlers;
		this.turn = new VadTurnMachine({
			onState: (state) => this.h.onState(state),
			onCommit: (frames, _peak, _durationMs, turnId) => this.commitUtterance(frames, turnId),
		});
	}

	// 子类：开始前的就绪检查（返回错误文案或 null）
	protected abstract preflight(): string | null | Promise<string | null>;
	// 子类：把一段 16k 单声道 Float32 转成文字
	protected abstract transcribe(
		samples: Float32Array,
		sampleRate: number,
		context: VadTranscriptionContext
	): Promise<string>;
	/**
	 * 子类：是否支持边说边转写。默认 false。
	 * 云端引擎必须保持 false——按次计费 + 每次都要上传一段真实环境录音，
	 * 「多跑几次」会同时放大账单与隐私暴露面。
	 */
	protected supportsPartial(): boolean {
		return false;
	}

	/** 流式引擎需要 final flush；非流式引擎可复用完全相同的 partial。 */
	protected requiresFinalTranscription(): boolean {
		return false;
	}

	isOn(): boolean {
		return this.on && this.lifecycleState === "listening";
	}

	getLifecycleState(): VadMicLifecycleState {
		return this.lifecycleState;
	}

	async toggle(): Promise<void> {
		if (this.lifecycleState === "listening" || this.lifecycleState === "starting") {
			await this.stop();
		}
		else await this.start();
	}

	async start(): Promise<void> {
		if (this.lifecycleState === "listening") return;
		if (this.lifecycleState === "starting" && this.startPromise) {
			return this.startPromise;
		}
		if (this.lifecycleState === "stopping" && this.stopPromise) {
			await this.stopPromise;
		}
		const generation = ++this.lifecycleGeneration;
		this.lifecycleState = "starting";
		const task = this.startGeneration(generation);
		this.startPromise = task;
		const clear = (): void => {
			if (this.startPromise === task) this.startPromise = null;
		};
		void task.then(clear, clear);
		return task;
	}

	private async startGeneration(generation: number): Promise<void> {
		const err = await this.preflight();
		if (generation !== this.lifecycleGeneration) return;
		if (err) {
			if (generation === this.lifecycleGeneration) {
				this.lifecycleState = "idle";
				this.h.onError(err);
			}
			return;
		}
		let acquired: MediaStream;
		try {
			acquired = await this.acquireMediaStream(generation);
			if (generation !== this.lifecycleGeneration) {
				this.stopStream(acquired);
				return;
			}
			this.stream = acquired;
		} catch (error) {
			if (generation !== this.lifecycleGeneration) return;
			this.lifecycleState = "idle";
			this.h.onError(`麦克风不可用：${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		try {
			const Ctor =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			this.ctx = new Ctor({ sampleRate: 16000 });
			this.sampleRate = this.ctx.sampleRate;
			this.turn.setSampleRate(this.sampleRate);
			const url = URL.createObjectURL(new Blob([PCM_WORKLET_SRC], { type: "application/javascript" }));
			try {
				await this.ctx.audioWorklet.addModule(url);
			} finally {
				URL.revokeObjectURL(url);
			}
			if (generation !== this.lifecycleGeneration) {
				this.teardownNodes();
				this.cleanupAudio();
				return;
			}
			this.resetVad();
			this.source = this.ctx.createMediaStreamSource(this.stream);
			this.node = new AudioWorkletNode(this.ctx, "tq-pcm");
			this.node.port.onmessage = (ev: MessageEvent<ArrayBuffer>): void => {
				if (
					generation === this.lifecycleGeneration &&
					this.lifecycleState === "listening"
				) {
					this.onFrame(new Float32Array(ev.data));
				}
			};
			this.source.connect(this.node);
			this.node.connect(this.ctx.destination);
		} catch (error) {
			this.teardownNodes();
			this.cleanupAudio();
			if (generation !== this.lifecycleGeneration) return;
			this.lifecycleState = "idle";
			this.h.onError(
				`语音链路初始化失败：${error instanceof Error ? error.message : String(error)}`
			);
			return;
		}
		if (generation !== this.lifecycleGeneration) {
			this.teardownNodes();
			this.cleanupAudio();
			return;
		}
		this.on = true;
		this.lifecycleState = "listening";
		this.initSilero(generation);
		this.h.onListeningChange(true);
		this.h.onState("listening");
	}

	private acquireMediaStream(generation: number): Promise<MediaStream> {
		const pending = navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
		let expired = false;
		pending.then((stream) => {
			if (expired || generation !== this.lifecycleGeneration) {
				this.stopStream(stream);
			}
		}).catch(() => {});
		return new Promise<MediaStream>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				expired = true;
				reject(new Error("申请麦克风权限超时"));
			}, MEDIA_ACQUIRE_TIMEOUT_MS);
			pending.then(
				(stream) => {
					window.clearTimeout(timer);
					resolve(stream);
				},
				(error: unknown) => {
					window.clearTimeout(timer);
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			);
		});
	}

	private initSilero(generation: number): void {
		if (this.sileroFailed) return;
		if (this.settings.quyuanVadEnabled === false) return;
		if (this.sampleRate !== SILERO_SAMPLE_RATE) {
			console.warn(
				`[TALOS 屈原] 采样率 ${this.sampleRate} 非 16k，Silero VAD 不启用，继续用响度判定`
			);
			return;
		}
		const vad = this.silero ?? new SileroVad(this.settings);
		this.silero = vad;
		if (this.sileroReady) {
			vad.resetState();
			this.turn.setPeakGate(false);
			return;
		}
		const loading = this.sileroLoading ?? vad.load();
		if (!this.sileroLoading) {
			this.sileroLoading = loading;
			const clear = (): void => {
				if (this.sileroLoading === loading) this.sileroLoading = null;
			};
			void loading.then(clear, clear);
		}
		loading.then(
			() => {
				if (
					this.silero !== vad ||
					generation !== this.lifecycleGeneration ||
					this.lifecycleState !== "listening"
				) return;
				this.sileroReady = true;
				this.sileroFailed = false;
				this.vadQueue = [];
				this.vadFilled = 0;
				this.speechProb = 0;
				// 判定改由模型给出，峰值响度闸必须让位，否则小声说话仍被滤掉
				this.turn.setPeakGate(false);
			},
			(error: unknown) => {
				if (
					this.silero !== vad ||
					generation !== this.lifecycleGeneration ||
					this.lifecycleState !== "listening"
				) return;
				this.fallbackToRms(
					error instanceof Error ? error.message : String(error),
					generation
				);
			}
		);
	}

	// 任何一环挂了都回到响度判定，并给一次性中文提示，绝不静默失效
	private fallbackToRms(reason: string, generation = this.lifecycleGeneration): void {
		if (generation !== this.lifecycleGeneration) return;
		this.sileroReady = false;
		this.sileroFailed = true;
		this.silero?.dispose();
		this.silero = null;
		this.vadQueue = [];
		this.vadFilled = 0;
		this.speechProb = 0;
		this.turn.setPeakGate(true);
		console.warn("[TALOS 屈原] Silero VAD 不可用，已回退响度判定：", reason);
		if (this.sileroNotified) return;
		this.sileroNotified = true;
		this.h.onError(`语音断句已回退到响度判定（Silero VAD 不可用）：${reason}`);
	}

	// 128 样本/帧攒成 512 样本窗口再推理；推理是异步的，串行排队保证模型状态连续
	private feedSilero(frame: Float32Array): void {
		let offset = 0;
		while (offset < frame.length) {
			const take = Math.min(SILERO_WINDOW - this.vadFilled, frame.length - offset);
			this.vadFill.set(frame.subarray(offset, offset + take), this.vadFilled);
			this.vadFilled += take;
			offset += take;
			if (this.vadFilled < SILERO_WINDOW) continue;
			this.vadQueue.push(this.vadFill.slice());
			this.vadFilled = 0;
			while (this.vadQueue.length > VAD_QUEUE_MAX) this.vadQueue.shift();
			void this.pumpSilero();
		}
	}

	private async pumpSilero(): Promise<void> {
		if (this.vadRunning) return;
		const generation = this.lifecycleGeneration;
		const activeVad = this.silero;
		this.vadRunning = true;
		try {
			for (;;) {
				const win = this.vadQueue.shift();
				if (!activeVad || !this.sileroReady || !win) break;
				const probability = await activeVad.process(win);
				if (
					generation !== this.lifecycleGeneration ||
					activeVad !== this.silero ||
					this.lifecycleState !== "listening"
				) return;
				this.speechProb = probability;
			}
		} catch (error) {
			if (
				generation === this.lifecycleGeneration &&
				activeVad === this.silero &&
				this.lifecycleState === "listening"
			) {
				this.fallbackToRms(
					error instanceof Error ? error.message : String(error),
					generation
				);
			}
		} finally {
			this.vadRunning = false;
		}
	}

	async stop(): Promise<void> {
		if (this.lifecycleState === "idle" && !this.startPromise) return;
		if (this.lifecycleState === "stopping" && this.stopPromise) {
			return this.stopPromise;
		}
		const generation = ++this.lifecycleGeneration;
		this.lifecycleState = "stopping";
		this.on = false;
		this.teardownNodes();
		this.cleanupAudio();
		this.resetVad();
		this.h.onListeningChange(false);
		const pendingStart = this.startPromise;
		const task = (async (): Promise<void> => {
			try {
				await pendingStart;
			} catch {
				/* start error has already been reported for its own generation */
			}
			this.teardownNodes();
			this.cleanupAudio();
			if (generation === this.lifecycleGeneration) {
				this.lifecycleState = "idle";
			}
		})();
		this.stopPromise = task;
		const clear = (): void => {
			if (this.stopPromise === task) this.stopPromise = null;
		};
		void task.then(clear, clear);
		return task;
	}

	setBusy(busy: boolean, allowBargeIn = busy): void {
		const bargeEnabled = busy && allowBargeIn;
		if (this.busy === busy && this.bargeEnabled === bargeEnabled) return;
		this.busy = busy;
		this.bargeEnabled = bargeEnabled;
		this.busySince = busy ? performance.now() : 0;
		this.bargeFrames = 0;
		this.preRoll = [];
		// 忙碌意味着这一轮已经交给 agent：软结束中的轮次立即定案，
		// 收音到一半的半句直接丢弃，不允许再重开追加。
		// 忙碌结束 = 屈原刚说完，随后一小段时间放宽短段门槛，接住「好」「继续」。
		if (busy) this.turn.onBusy();
		else this.turn.openShortWindow();
		// 忙碌期不喂 VAD（屈原自己的朗读会被判成人声），进出忙碌都清一次模型状态，
		// 否则跨越这段空档的残留记忆会带偏随后的判定。
		this.resetSileroStream();
		if (busy) this.resetPartial();
	}

	private resetPartial(): void {
		++this.partialRequestGeneration;
		this.partialInFlight = false;
		this.partialTurn = -1;
		this.partialMarkMs = 0;
		this.lastPartial = null;
	}

	private resetSileroStream(): void {
		this.vadQueue = [];
		this.vadFilled = 0;
		this.speechProb = 0;
		this.silero?.resetState();
	}

	private resetVad(): void {
		this.bargeFrames = 0;
		this.resetSileroStream();
		this.resetPartial();
		this.busy = false;
		this.bargeEnabled = false;
		this.busySince = 0;
		this.preRoll = [];
		this.turn.reset();
	}

	private onFrame(frame: Float32Array): void {
		this.frameMs = (frame.length / this.sampleRate) * 1000 || 8;
		const rms = this.rmsOf(frame);
		this.h.onLevel?.(Math.min(1, rms / 0.12));

		if (this.busy) {
			// 打断窗口内也维护滚动缓冲：用户开口打断后，随后的话语能被完整收进来
			this.preRoll.push(frame);
			if (this.preRoll.length > BARGE_PREROLL) this.preRoll.shift();
			if (!this.bargeEnabled || performance.now() - this.busySince < BARGE_GUARD_MS) {
				this.bargeFrames = 0;
				return;
			}
			// 阈值按「正常音量即可打断」标定（AEC 开启时扬声器回授残响远低于此值）
			if (rms > BARGE_RMS) {
				this.bargeFrames++;
				if (this.bargeFrames >= BARGE_FRAMES) {
					this.busy = false;
					this.bargeFrames = 0;
					this.h.onSpeechStart();
					// 打断成功后直接转入收音：打断句可以作为新指令转写，无需重说
					this.turn.beginFromBarge(this.preRoll, rms);
					this.preRoll = [];
				}
			} else {
				this.bargeFrames = 0;
			}
			return;
		}

		// 判定来源：Silero 就绪时用人声概率，否则退回响度阈值。
		// 轮次编排（软结束 / 可重开 / 短段合并）与判定来源无关，两条路径共用。
		if (this.sileroReady) this.feedSilero(frame);
		const byProb = this.sileroReady;
		this.turn.push({
			frame,
			rms,
			frameMs: this.frameMs,
			startVoiced: byProb ? this.speechProb >= SPEECH_START_PROB : rms > START_RMS,
			keepVoiced: byProb ? this.speechProb >= SPEECH_KEEP_PROB : rms >= KEEP_RMS,
		});
		if (this.supportsPartial()) this.maybePartial();
	}

	/**
	 * 边说边转写：对「本轮已累积的整段音频」重跑，用最新结果整体替换字幕
	 * （whisper 对重叠音频的输出不保证一致，增量字符串拼接会串味）。
	 * 软结束窗口里也跑一次——那段音频已经定型，结果能被 commit 直接复用，
	 * 于是重开窗口的等待被变成有用的转写时间。
	 */
	private maybePartial(): void {
		if (this.partialInFlight || !this.on) return;
		const snap = this.turn.peekCaptured();
		if (!snap) return;
		const total = snap.frames.reduce((n, c) => n + c.length, 0);
		const ms = (total / this.sampleRate) * 1000;
		if (ms < PARTIAL_MIN_MS) return;
		if (snap.turnId === this.partialTurn && ms - this.partialMarkMs < PARTIAL_INTERVAL_MS) return;
		this.partialTurn = snap.turnId;
		this.partialMarkMs = ms;
		this.partialInFlight = true;
		const requestGeneration = ++this.partialRequestGeneration;
		const lifecycleGeneration = this.lifecycleGeneration;
		const samples = this.mergeFrames(snap.frames, total);
		this.transcribe(samples, this.sampleRate, {
			streamId: `${lifecycleGeneration}:${snap.turnId}`,
			phase: "partial",
		})
			.then((text) => {
				if (lifecycleGeneration !== this.lifecycleGeneration) return;
				this.lastPartial = { turnId: snap.turnId, samples: total, text };
				const live = this.turn.peekCaptured();
				// 轮次已定案/被丢弃就别再刷字幕了，那是上一句的残影
				if (this.on && text && live?.turnId === snap.turnId) this.h.onPartial?.(text);
			})
			.catch((error: unknown) => {
				// 中途结果失败不打扰用户：最终整段转写会把真正的错误报出来
				console.warn("[TALOS 屈原] 流式转写失败（不影响最终结果）", error);
			})
			.finally(() => {
				if (requestGeneration === this.partialRequestGeneration) {
					this.partialInFlight = false;
				}
			});
	}

	private commitUtterance(frames: Float32Array[], turnId: number): void {
		const lifecycleGeneration = this.lifecycleGeneration;
		const total = frames.reduce((n, c) => n + c.length, 0);
		if (total === 0) return;
		// 软结束窗口里已把这段音频原样转写过（样本数完全一致）→ 直接用，
		// 省掉一次重复推理。只在完全相同的音频上复用，不做任何近似。
		const cached = this.lastPartial;
		this.lastPartial = null;
		if (
			!this.requiresFinalTranscription() &&
			cached && cached.turnId === turnId && cached.samples === total && cached.text
		) {
			this.h.onState("transcribing");
			window.setTimeout(() => {
				if (
					!this.on ||
					lifecycleGeneration !== this.lifecycleGeneration
				) return;
				this.h.onText(cached.text);
				this.h.onState("listening");
			}, 0);
			return;
		}
		this.h.onState("transcribing");
		const samples = this.mergeFrames(frames, total);
		this.transcribe(samples, this.sampleRate, {
			streamId: `${lifecycleGeneration}:${turnId}`,
			phase: "final",
		})
			.then((text) => {
				if (
					this.on &&
					text &&
					lifecycleGeneration === this.lifecycleGeneration
				) this.h.onText(text);
			})
			.catch((error: unknown) => {
				if (lifecycleGeneration === this.lifecycleGeneration) {
					this.h.onError(error instanceof Error ? error.message : String(error));
				}
			})
			.finally(() => {
				if (this.on && lifecycleGeneration === this.lifecycleGeneration) {
					this.h.onState("listening");
				}
			});
	}

	private mergeFrames(frames: Float32Array[], total: number): Float32Array {
		const out = new Float32Array(total);
		let off = 0;
		for (const c of frames) {
			out.set(c, off);
			off += c.length;
		}
		return out;
	}

	private rmsOf(frame: Float32Array): number {
		let sum = 0;
		for (let i = 0; i < frame.length; i++) {
			const v = frame[i] ?? 0;
			sum += v * v;
		}
		return Math.sqrt(sum / Math.max(1, frame.length));
	}

	private teardownNodes(): void {
		if (this.node) this.node.port.onmessage = null;
		try { this.node?.disconnect(); } catch { /* noop */ }
		try { this.source?.disconnect(); } catch { /* noop */ }
		try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
	}

	private stopStream(stream: MediaStream): void {
		try {
			stream.getTracks().forEach((track) => track.stop());
		} catch {
			/* noop */
		}
	}

	private cleanupAudio(): void {
		try { void this.ctx?.close(); } catch { /* noop */ }
		this.ctx = null;
		this.node = null;
		this.source = null;
		this.stream = null;
	}

	dispose(): void {
		void this.stop();
		// 会话内 stop/start 保留已加载的模型（避免重复下载），彻底销毁才释放
		this.silero?.dispose();
		this.silero = null;
		this.sileroLoading = null;
		this.sileroReady = false;
	}
}

// 共享：16k 单声道 Float32 → 16-bit PCM WAV → base64（云端引擎用）
export function encodeWavBase64(pcm: Float32Array, sampleRate: number): string | null {
	if (pcm.length === 0) return null;
	const buffer = new ArrayBuffer(44 + pcm.length * 2);
	const view = new DataView(buffer);
	const writeStr = (o: number, s: string): void => {
		for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
	};
	writeStr(0, "RIFF");
	view.setUint32(4, 36 + pcm.length * 2, true);
	writeStr(8, "WAVE");
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeStr(36, "data");
	view.setUint32(40, pcm.length * 2, true);
	let p = 44;
	for (let i = 0; i < pcm.length; i++) {
		const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
		view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		p += 2;
	}
	const bytes = new Uint8Array(buffer);
	let bin = "";
	const STEP = 0x8000;
	for (let i = 0; i < bytes.length; i += STEP) {
		bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
	}
	return btoa(bin);
}
