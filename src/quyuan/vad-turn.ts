// ============================================================
// 屈原 · 语音轮次状态机（纯逻辑，无 DOM / 无 Obsidian 依赖）
//   从 vad-mic.ts 拆出：这样它既能被 VadMic 用，也能在 Node 沙盘里
//   重放帧序列做断言，不受音频与平台 API 牵连。
// ============================================================

// 时长/帧数阈值（16k；AudioWorklet 渲染量子 128 样本 ≈ 8ms/帧）
export const START_FRAMES = 4;
export const SILENCE_MS = 550;
export const MIN_SPEECH_MS = 500;
export const MIN_PEAK_RMS = 0.045;
export const PRE_ROLL = 12;
// 软结束（softEnd）后仍可重开的窗口：静音满 SILENCE_MS 只是「疑似说完」，
// 再等 REOPEN_MS 才定案，用户中途想词的停顿不会被切成两句。
const REOPEN_MS = 700;
// 重开窗口内的续说门槛：已经说过话，低于 START_FRAMES 即可接回
const CONTINUATION_FRAMES = 2;
// 短段合并窗口：不达标的段先挂起，等一等下一段，两段拼起来再判
const MERGE_MS = 350;
// 打断句放宽的时长门槛：朗读中喊「停」「对」只有两三百毫秒，不能按噪音丢
const BUSY_SHORT_MIN_SPEECH_MS = 220;
// 屈原刚说完的这段时间里用户多半在短答（「好」「继续」「对」），同样放宽时长门槛。
// 只覆盖回答刚结束的窗口，待机期仍按严格门槛，避免噪音白烧一次转写。
const REPLY_SHORT_MS = 3000;
// 软结束时保留的尾部静音：既裁掉多余静音（whisper 易在纯静音上幻听），又不切掉字尾
const TAIL_KEEP_MS = 80;

// ============================================================
// 轮次状态机：idle → capturing → softEnded →（续说回 capturing / 过期定案）
//   与「这一帧算不算人声」的判定来源解耦——调用方传入 startVoiced/keepVoiced，
//   现在由 RMS 阈值给出，后续换成 Silero VAD 概率时本文件此段无需改动。
//   窗口计时一律用帧时长累加，不用 setTimeout：麦克风开着时帧是连续到达的，
//   帧驱动既可在无 DOM 的沙盘里确定性重放，也不存在计时器泄漏。
// ============================================================
export type VadTurnPhase = "idle" | "capturing" | "softEnded";

export interface VadTurnFrame {
	frame: Float32Array;
	rms: number;
	frameMs: number;
	startVoiced: boolean;
	keepVoiced: boolean;
}

export interface VadTurnHandlers {
	onState: (state: "listening" | "capturing") => void;
	onCommit: (frames: Float32Array[], peak: number, durationMs: number, turnId: number) => void;
}

interface PendingShort {
	frames: Float32Array[];
	peak: number;
	ageMs: number;
	relaxed: boolean;
}

export class VadTurnMachine {
	private h: VadTurnHandlers;
	private sampleRate: number;
	private phase: VadTurnPhase = "idle";
	private captured: Float32Array[] = [];
	private preRoll: Float32Array[] = [];
	private voicedFrames = 0;
	private silenceMs = 0;
	private reopenMs = 0;
	private peakRms = 0;
	private lastVoicedIndex = -1;
	private frameMs = 8;
	// 本轮是否按放宽的短段门槛判定（打断句 / 屈原刚说完的短答窗口）
	private relaxed = false;
	private graceMs = 0;
	private pending: PendingShort | null = null;
	// 峰值响度闸：响度判定时用它兜底滤噪；换成 Silero 判定后必须关掉，
	// 否则「小声说话」会被峰值闸重新滤掉——那正是本次要修的漏判之一。
	private peakGate = true;
	// 轮次序号：流式转写用它认「这段中途结果还属于当前这一轮吗」
	private turnId = 0;

	constructor(handlers: VadTurnHandlers, sampleRate = 16000) {
		this.h = handlers;
		this.sampleRate = sampleRate;
	}

	setSampleRate(rate: number): void {
		if (rate > 0) this.sampleRate = rate;
	}

	setPeakGate(enabled: boolean): void {
		this.peakGate = enabled;
	}

	getPhase(): VadTurnPhase {
		return this.phase;
	}

	getTurnId(): number {
		return this.turnId;
	}

	/**
	 * 取当前轮次已累积的音频（收音中或软结束中），供流式转写用。
	 * 返回的是内部数组的浅拷贝引用，调用方只读不改。
	 */
	peekCaptured(): { frames: Float32Array[]; turnId: number } | null {
		if (this.phase === "idle" || this.captured.length === 0) return null;
		return { frames: this.captured.slice(), turnId: this.turnId };
	}

	reset(): void {
		this.phase = "idle";
		this.captured = [];
		this.preRoll = [];
		this.voicedFrames = 0;
		this.silenceMs = 0;
		this.reopenMs = 0;
		this.peakRms = 0;
		this.lastVoicedIndex = -1;
		this.relaxed = false;
		this.graceMs = 0;
		this.pending = null;
	}

	// 屈原刚说完：开一段短答窗口，这期间的短促指令按放宽门槛收下
	openShortWindow(ms = REPLY_SHORT_MS): void {
		this.graceMs = ms;
	}

	// agent 转入忙碌：已软结束的轮次立即定案（不得再重开追加），
	// 收音中的半句与挂起的短段一律丢弃——半句指令送进 agent 是有副作用的。
	onBusy(): void {
		if (this.phase === "softEnded") this.commit(true);
		this.reset();
	}

	// 打断成功：把打断窗口里的滚动缓冲接过来，直接转入收音
	beginFromBarge(preRollFrames: Float32Array[], rms: number): void {
		this.reset();
		this.captured = preRollFrames.slice();
		this.preRoll = [];
		this.phase = "capturing";
		this.turnId++;
		this.peakRms = rms;
		this.lastVoicedIndex = this.captured.length - 1;
		this.relaxed = true;
		this.h.onState("capturing");
	}

	push(input: VadTurnFrame): void {
		const { frame, rms, frameMs, startVoiced, keepVoiced } = input;
		if (frameMs > 0) this.frameMs = frameMs;
		if (this.graceMs > 0) this.graceMs = Math.max(0, this.graceMs - this.frameMs);

		if (this.phase === "capturing") {
			this.captured.push(frame);
			if (rms > this.peakRms) this.peakRms = rms;
			if (keepVoiced) {
				this.lastVoicedIndex = this.captured.length - 1;
				this.silenceMs = 0;
			} else {
				this.silenceMs += this.frameMs;
				if (this.silenceMs >= SILENCE_MS) this.softEnd();
			}
			return;
		}

		this.preRoll.push(frame);
		const rollLimit = this.phase === "softEnded" ? PRE_ROLL + CONTINUATION_FRAMES : PRE_ROLL;
		if (this.preRoll.length > rollLimit) this.preRoll.shift();

		if (startVoiced) {
			this.voicedFrames++;
			const need = this.phase === "softEnded" ? CONTINUATION_FRAMES : START_FRAMES;
			if (this.voicedFrames >= need) {
				this.beginCapture(rms);
				return;
			}
		} else {
			this.voicedFrames = 0;
		}
		this.ageWindows();
	}

	private beginCapture(rms: number): void {
		const lead = this.preRoll.slice(-rollLead(this.phase));
		// 续说接回的是同一轮，轮次序号不变；全新一轮才递增
		if (this.phase !== "softEnded") this.turnId++;
		if (this.phase === "softEnded") {
			// 续说：接回原 captured，前一轮不定案
			this.captured = this.captured.concat(lead);
		} else if (this.pending) {
			// 短段合并：把挂起的那段接在前面，两段一起重新判定
			this.captured = this.pending.frames.concat(lead);
			this.peakRms = Math.max(this.peakRms, this.pending.peak);
			this.relaxed = this.relaxed || this.pending.relaxed;
			this.pending = null;
		} else {
			this.captured = lead;
		}
		if (this.graceMs > 0) this.relaxed = true;
		this.preRoll = [];
		this.phase = "capturing";
		this.silenceMs = 0;
		this.reopenMs = 0;
		this.voicedFrames = 0;
		this.lastVoicedIndex = this.captured.length - 1;
		if (rms > this.peakRms) this.peakRms = rms;
		this.h.onState("capturing");
	}

	// 疑似说完：不清空 captured，只裁掉多余尾静音，进入可重开窗口
	private softEnd(): void {
		const tail = Math.ceil(TAIL_KEEP_MS / Math.max(1, this.frameMs));
		const keep = Math.min(this.captured.length, Math.max(0, this.lastVoicedIndex + 1) + tail);
		this.captured.length = keep;
		this.phase = "softEnded";
		this.reopenMs = 0;
		this.silenceMs = 0;
		this.voicedFrames = 0;
		this.preRoll = [];
		this.h.onState("listening");
	}

	private ageWindows(): void {
		if (this.pending) {
			this.pending.ageMs += this.frameMs;
			if (this.pending.ageMs >= MERGE_MS) this.pending = null;
		}
		if (this.phase === "softEnded") {
			this.reopenMs += this.frameMs;
			if (this.reopenMs >= REOPEN_MS) this.commit(false);
		}
	}

	// 定案：窗口过期（final=false）或被忙碌强制（final=true）
	private commit(final: boolean): void {
		const frames = this.captured;
		const peak = this.peakRms;
		const relaxed = this.relaxed;
		const turnId = this.turnId;
		this.captured = [];
		this.peakRms = 0;
		this.phase = "idle";
		this.silenceMs = 0;
		this.reopenMs = 0;
		this.voicedFrames = 0;
		this.lastVoicedIndex = -1;
		this.relaxed = false;

		const durationMs = this.durationOf(frames);
		const minMs = relaxed ? BUSY_SHORT_MIN_SPEECH_MS : MIN_SPEECH_MS;
		if (durationMs < minMs || (this.peakGate && peak < MIN_PEAK_RMS)) {
			// 不达标不再直接丢：挂起等一个合并窗口，下一段接上来就一起重判
			this.pending = final ? null : { frames, peak, ageMs: 0, relaxed };
			this.h.onState("listening");
			return;
		}
		this.h.onCommit(frames, peak, durationMs, turnId);
	}

	private durationOf(frames: Float32Array[]): number {
		const total = frames.reduce((n, c) => n + c.length, 0);
		return (total / this.sampleRate) * 1000;
	}
}

function rollLead(phase: VadTurnPhase): number {
	return phase === "softEnded" ? PRE_ROLL + CONTINUATION_FRAMES : PRE_ROLL;
}
