import type { TalosSettings } from "../settings";

// ============================================================
// 屈原 · 麦克风 + 能量 VAD 基类（云端/本地识别共用）
//   持续监听 + 自动断句 + 屈原说话时高阈值打断；子类只实现 transcribe()。
//   AudioWorklet 取 16k 单声道帧 → 主线程算 RMS → 状态机
//   listening(候命) → capturing(在说，含 pre-roll 防截头) → 静音 SILENCE_MS
//   则结束一段 → 交子类转写。开启 AEC/降噪减回授。
// ============================================================

// VAD 阈值（16k；AudioWorklet 渲染量子 128 样本 ≈ 8ms/帧）
const START_RMS = 0.03;
const KEEP_RMS = 0.015;
const START_FRAMES = 4;
const SILENCE_MS = 550;
const MIN_SPEECH_MS = 500;
const MIN_PEAK_RMS = 0.045;
const PRE_ROLL = 12;
const BARGE_RMS = 0.09;
const BARGE_FRAMES = 75;
const BARGE_GUARD_MS = 600;

export interface VadMicHandlers {
	onListeningChange: (on: boolean) => void;
	onState: (state: "listening" | "capturing" | "transcribing") => void;
	onLevel?: (level: number) => void;
	onSpeechStart: () => void;
	onText: (text: string) => void;
	onError: (message: string) => void;
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
	protected sampleRate = 16000;

	private capturing = false;
	private voicedFrames = 0;
	private silenceMs = 0;
	private frameMs = 8;
	private peakRms = 0;
	private bargeFrames = 0;
	private busy = false;
	private bargeEnabled = false;
	private busySince = 0;
	private captured: Float32Array[] = [];
	private preRoll: Float32Array[] = [];

	constructor(settings: TalosSettings, handlers: VadMicHandlers) {
		this.settings = settings;
		this.h = handlers;
	}

	// 子类：开始前的就绪检查（返回错误文案或 null）
	protected abstract preflight(): string | null;
	// 子类：把一段 16k 单声道 Float32 转成文字
	protected abstract transcribe(samples: Float32Array, sampleRate: number): Promise<string>;

	isOn(): boolean {
		return this.on;
	}

	async toggle(): Promise<void> {
		if (this.on) this.stop();
		else await this.start();
	}

	async start(): Promise<void> {
		if (this.on) return;
		const err = this.preflight();
		if (err) {
			this.h.onError(err);
			return;
		}
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
		} catch (error) {
			this.h.onError(`麦克风不可用：${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const Ctor =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		this.ctx = new Ctor({ sampleRate: 16000 });
		this.sampleRate = this.ctx.sampleRate;
		const url = URL.createObjectURL(new Blob([PCM_WORKLET_SRC], { type: "application/javascript" }));
		try {
			await this.ctx.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		this.resetVad();
		this.source = this.ctx.createMediaStreamSource(this.stream);
		this.node = new AudioWorkletNode(this.ctx, "tq-pcm");
		this.node.port.onmessage = (ev: MessageEvent<ArrayBuffer>): void => {
			this.onFrame(new Float32Array(ev.data));
		};
		this.source.connect(this.node);
		this.node.connect(this.ctx.destination);
		this.on = true;
		this.h.onListeningChange(true);
		this.h.onState("listening");
	}

	stop(): void {
		this.on = false;
		this.teardownNodes();
		this.cleanupAudio();
		this.resetVad();
		this.h.onListeningChange(false);
	}

	setBusy(busy: boolean, allowBargeIn = busy): void {
		const bargeEnabled = busy && allowBargeIn;
		if (this.busy === busy && this.bargeEnabled === bargeEnabled) return;
		this.busy = busy;
		this.bargeEnabled = bargeEnabled;
		this.busySince = busy ? performance.now() : 0;
		this.bargeFrames = 0;
		if (busy && this.capturing) {
			this.capturing = false;
			this.captured = [];
			this.preRoll = [];
			this.voicedFrames = 0;
		}
	}

	private resetVad(): void {
		this.capturing = false;
		this.voicedFrames = 0;
		this.silenceMs = 0;
		this.peakRms = 0;
		this.bargeFrames = 0;
		this.busy = false;
		this.bargeEnabled = false;
		this.busySince = 0;
		this.captured = [];
		this.preRoll = [];
	}

	private onFrame(frame: Float32Array): void {
		this.frameMs = (frame.length / this.sampleRate) * 1000 || 8;
		const rms = this.rmsOf(frame);
		this.h.onLevel?.(Math.min(1, rms / 0.12));

		if (this.busy) {
			if (!this.bargeEnabled || performance.now() - this.busySince < BARGE_GUARD_MS) {
				this.bargeFrames = 0;
				return;
			}
			if (rms > BARGE_RMS) {
				this.bargeFrames++;
				if (this.bargeFrames >= BARGE_FRAMES) {
					this.busy = false;
					this.bargeFrames = 0;
					this.h.onSpeechStart();
				}
			} else {
				this.bargeFrames = 0;
			}
			return;
		}

		if (!this.capturing) {
			this.preRoll.push(frame);
			if (this.preRoll.length > PRE_ROLL) this.preRoll.shift();
			if (rms > START_RMS) {
				this.voicedFrames++;
				if (this.voicedFrames >= START_FRAMES) {
					this.capturing = true;
					this.silenceMs = 0;
					this.peakRms = rms;
					this.captured = this.preRoll.slice();
					this.preRoll = [];
					this.h.onState("capturing");
				}
			} else {
				this.voicedFrames = 0;
			}
			return;
		}
		this.captured.push(frame);
		if (rms > this.peakRms) this.peakRms = rms;
		if (rms < KEEP_RMS) {
			this.silenceMs += this.frameMs;
			if (this.silenceMs >= SILENCE_MS) this.endUtterance();
		} else {
			this.silenceMs = 0;
		}
	}

	private endUtterance(): void {
		const frames = this.captured;
		const peak = this.peakRms;
		this.capturing = false;
		this.voicedFrames = 0;
		this.silenceMs = 0;
		this.peakRms = 0;
		this.captured = [];
		this.preRoll = [];
		const total = frames.reduce((n, c) => n + c.length, 0);
		const ms = (total / this.sampleRate) * 1000;
		if (ms < MIN_SPEECH_MS || peak < MIN_PEAK_RMS) {
			this.h.onState("listening");
			return;
		}
		this.h.onState("transcribing");
		const samples = this.mergeFrames(frames, total);
		this.transcribe(samples, this.sampleRate)
			.then((text) => {
				if (this.on && text) this.h.onText(text);
			})
			.catch((error: unknown) => {
				this.h.onError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (this.on) this.h.onState("listening");
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

	private cleanupAudio(): void {
		try { void this.ctx?.close(); } catch { /* noop */ }
		this.ctx = null;
		this.node = null;
		this.source = null;
		this.stream = null;
	}

	dispose(): void {
		this.stop();
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
