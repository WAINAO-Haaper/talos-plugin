import { Notice, requestUrl } from "obsidian";
import type { TalosSettings } from "../settings";

// ============================================================
// 屈原 · 语音 I/O
//   TTS：流式分句朗读（边收增量边开口），引擎 system / edgetts / elevenlabs / aliyun
//   STT：麦克风转写，WebSpeech 默认（Obsidian Chromium 原生）
// ============================================================

type SpeakState = "idle" | "speaking" | "error";

// ---------- Edge TTS（微软 Edge 朗读 · 免费中文 · 无需 key）----------
// 走在线 WebSocket，鉴权用 URL 里的 Sec-MS-GEC token（无需自定义请求头，浏览器可直连）。
const EDGE_TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

async function edgeSecToken(): Promise<string> {
	// Windows 文件时间（100ns 间隔），向下取整到 5 分钟；用 BigInt 防精度丢失
	const WIN_EPOCH = 11644473600n;
	let ticks = BigInt(Math.floor(Date.now() / 1000)) + WIN_EPOCH;
	ticks = ticks - (ticks % 300n);
	ticks = ticks * 10000000n;
	const data = new TextEncoder().encode(`${ticks.toString()}${EDGE_TRUSTED_TOKEN}`);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// TTS 只接收可自然朗读的文本。即使模型偶发输出 Markdown，也不把符号、链接或
// 代码围栏念给用户；展示层仍保留原始内容，不受这里影响。
export function normalizeForSpeech(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " 代码内容 ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+[.)、]\s+/gm, "")
		.replace(/[`*_~>|]/g, "")
		.replace(/https?:\/\/\S+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------- TTS（流式分句） ----------
export class StreamTts {
	private settings: TalosSettings;
	private onState: (s: SpeakState, text?: string) => void;
	private onLevel: ((level: number) => void) | null;

	private buf = ""; // 增量缓冲，凑满一句再播
	private utterers: SpeechSynthesisUtterance[] = [];
	private keepAlive: number | null = null;
	private audioQueue: string[] = []; // API 引擎：待播句子（文本）
	private audio: HTMLAudioElement | null = null;
	private playing = false;
	private gen = 0; // 代际令牌：stop() 自增，作废在途播放循环/挂起的 await
	private analyser: AnalyserNode | null = null;
	private audioCtx: AudioContext | null = null;
	private audioSource: MediaElementAudioSourceNode | null = null;
	private levelTimer: number | null = null;

	constructor(settings: TalosSettings, onState: (s: SpeakState, text?: string) => void, onLevel?: ((level: number) => void)) {
		this.settings = settings;
		this.onState = onState;
		this.onLevel = onLevel ?? null;
	}

	private usingApi(): boolean {
		const s = this.settings;
		return (
			s.ttsEngine === "edgetts" ||
			(s.ttsEngine === "elevenlabs" && !!s.elevenLabsApiKey.trim()) ||
			(s.ttsEngine === "aliyun" && !!s.aliyunApiKey.trim())
		);
	}

	// 流式增量进来：抽出完整句子就播，半句留在 buf
	feed(delta: string): void {
		this.buf += delta;
		this.drain(false);
	}

	// 一轮结束：把残句也播掉
	flush(): void {
		this.drain(true);
	}

	private drain(final: boolean): void {
		const sentences: string[] = [];
		let rest = this.buf;
		const re = /[^。！？!?；;\n]*[。！？!?；;\n]/g;
		let m: RegExpExecArray | null;
		let lastIdx = 0;
		while ((m = re.exec(this.buf)) !== null) {
			const seg = m[0].trim();
			if (seg) sentences.push(seg);
			lastIdx = re.lastIndex;
		}
		rest = this.buf.slice(lastIdx);
		// 句子太长（无标点）也强制切，避免迟迟不开口
		if (!final && rest.length > 28) {
			sentences.push(rest.trim());
			rest = "";
		}
		this.buf = final ? "" : rest;
		if (final && rest.trim()) sentences.push(rest.trim());
		for (const s of sentences) if (s) this.enqueue(s);
	}

	private enqueue(sentence: string): void {
		const spoken = normalizeForSpeech(sentence);
		if (!spoken) return;
		if (this.usingApi()) {
			this.audioQueue.push(spoken);
			void this.pumpAudio();
		} else {
			this.speakSystem(spoken);
		}
	}

	// ---- 系统语音：分句直接排进 speechSynthesis 队列 ----
	private speakSystem(text: string): void {
		const synth = window.speechSynthesis;
		if (!synth) return;
		const lang = this.settings.voiceLang || "zh-CN";
		const u = new SpeechSynthesisUtterance(text);
		u.lang = lang;
		u.rate = this.settings.ttsRate || 1;
		u.pitch = this.settings.ttsPitch || 1;
		const want = this.settings.ttsVoice.trim();
		const voices = synth.getVoices();
		const v =
			(want && voices.find((x) => x.name === want)) ||
			voices.find((x) => x.lang?.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2))) ||
			null;
		if (v) u.voice = v;
		u.onstart = () => {
			this.onState("speaking", text);
			this.startKeepAlive();
			// 系统语音无法精确取样，用模拟值驱动粒子
			if (this.onLevel) this.onLevel(0.6);
		};
		u.onend = () => {
			this.utterers = this.utterers.filter((x) => x !== u);
			if (this.utterers.length === 0 && !synth.speaking) {
				this.stopKeepAlive();
				if (this.onLevel) this.onLevel(0);
				this.onState("idle");
			}
		};
		u.onerror = (e: SpeechSynthesisErrorEvent) => {
			const code = e.error || "unknown";
			if (code === "interrupted" || code === "canceled") return;
			this.onState("error", code);
		};
		this.utterers.push(u);
		synth.speak(u);
		try { synth.resume(); } catch { /* noop */ }
	}

	private startKeepAlive(): void {
		this.stopKeepAlive();
		this.keepAlive = window.setInterval(() => {
			const s = window.speechSynthesis;
			if (s && s.speaking) { try { s.resume(); } catch { /* noop */ } }
		}, 8000);
	}

	private stopKeepAlive(): void {
		if (this.keepAlive != null) { window.clearInterval(this.keepAlive); this.keepAlive = null; }
	}

	// ---- API 语音：顺序播放队列 ----
	private async pumpAudio(): Promise<void> {
		if (this.playing) return;
		this.playing = true;
		const myGen = this.gen;
		try {
			while (this.audioQueue.length > 0 && myGen === this.gen) {
				const text = this.audioQueue.shift() as string;
				try {
					const src = await this.synthApi(text);
					if (myGen !== this.gen) {
						if (src.startsWith("blob:")) URL.revokeObjectURL(src);
						break;
					}
					await this.playUrl(src, myGen);
				} catch (e) {
					if (myGen !== this.gen) break;
					const msg = e instanceof Error ? e.message : String(e);
					this.onState("error", msg);
					new Notice(`屈原朗读失败：${msg}`);
				}
			}
		} finally {
			// 仅当仍是当前代际才复位，避免冲掉 stop() 后新启动的播放
			if (myGen === this.gen) {
				this.playing = false;
				this.onState("idle");
			}
		}
	}

	private async synthApi(text: string): Promise<string> {
		if (this.settings.ttsEngine === "edgetts") {
			return await this.synthEdge(text);
		}
		if (this.settings.ttsEngine === "elevenlabs") {
			const key = this.settings.elevenLabsApiKey.trim();
			const voice = this.settings.elevenLabsVoiceId.trim() || "onwK4e9ZLuTAKqWW03F9";
			const model = this.settings.elevenLabsModel.trim() || "eleven_turbo_v2_5";
			const res = await requestUrl({
				url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
				method: "POST",
				headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
				body: JSON.stringify({
					text,
					model_id: model,
					voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
				}),
				throw: false,
			});
			if (res.status !== 200) throw new Error(`ElevenLabs ${res.status}`);
			const blob = new Blob([res.arrayBuffer], { type: "audio/mpeg" });
			return URL.createObjectURL(blob);
		}
		// 阿里云
		const key = this.settings.aliyunApiKey.trim();
		const voice = this.settings.aliyunVoice.trim() || "Andre";
		const model = this.settings.aliyunModel.trim() || "qwen3-tts-flash";
		const res = await requestUrl({
			url: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({ model, input: { text, voice, language_type: "Chinese" } }),
			throw: false,
		});
		if (res.status !== 200) throw new Error(`阿里云 ${res.status}`);
		const url = (res.json as { output?: { audio?: { url?: string } } })?.output?.audio?.url;
		if (!url) throw new Error("阿里云无音频 URL");
		return url;
	}

	// Edge 朗读语速：ttsRate(0.5–2) → SSML 百分比（1.0→+0%，1.5→+50%）
	private edgeRate(): string {
		const pct = Math.round(((this.settings.ttsRate || 1) - 1) * 100);
		return `${pct >= 0 ? "+" : ""}${pct}%`;
	}

	// Edge TTS：每句开一条 WebSocket，收齐 mp3 音频帧 → blob URL（交 playUrl 播放）
	private async synthEdge(text: string): Promise<string> {
		const voice = this.settings.edgeTtsVoice?.trim() || "zh-CN-XiaoxiaoNeural";
		const rate = this.edgeRate();
		const token = await edgeSecToken();
		const url = `${EDGE_WSS}?TrustedClientToken=${EDGE_TRUSTED_TOKEN}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=1-130.0.2849.68`;
		return new Promise<string>((resolve, reject) => {
			const ws = new WebSocket(url);
			ws.binaryType = "arraybuffer";
			const chunks: Uint8Array[] = [];
			const reqId = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, "");
			let settled = false;
			const fail = (e: unknown): void => {
				if (settled) return;
				settled = true;
				try { ws.close(); } catch { /* noop */ }
				reject(e instanceof Error ? e : new Error(String(e)));
			};
			const timer = window.setTimeout(() => fail(new Error("Edge TTS 超时")), 15000);
			ws.onopen = (): void => {
				const ts = new Date().toString();
				ws.send(
					`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
						`{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
				);
				const ssml =
					`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
					`<voice name='${voice}'><prosody rate='${rate}' pitch='+0Hz'>${escapeXml(text)}</prosody></voice></speak>`;
				ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}\r\nPath:ssml\r\n\r\n${ssml}`);
			};
			ws.onmessage = (ev: MessageEvent): void => {
				if (typeof ev.data === "string") {
					if (ev.data.includes("Path:turn.end")) {
						window.clearTimeout(timer);
						if (settled) return;
						settled = true;
						try { ws.close(); } catch { /* noop */ }
						if (chunks.length === 0) {
							reject(new Error("Edge TTS 无音频返回"));
							return;
						}
						resolve(URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "audio/mpeg" })));
					}
					return;
				}
				const buf = new Uint8Array(ev.data as ArrayBuffer);
				const headerLen = ((buf[0] ?? 0) << 8) | (buf[1] ?? 0);
				const audio = buf.subarray(2 + headerLen);
				if (audio.length) chunks.push(audio);
			};
			ws.onerror = (): void => fail(new Error("Edge TTS WebSocket 错误"));
			ws.onclose = (): void => {
				window.clearTimeout(timer);
				if (!settled) fail(new Error("Edge TTS 连接关闭"));
			};
		});
	}

	private playUrl(src: string, gen: number): Promise<void> {
		return new Promise<void>((resolve) => {
			const audio = new Audio(src);
			// API 引擎的语速：用播放速率实现（ttsRate 同系统引擎），保持音高不失真
			const rate = this.settings.ttsRate || 1;
			audio.playbackRate = Math.min(4, Math.max(0.25, rate));
			(audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
			this.audio = audio;
			let done = false;
			const finish = (): void => {
				if (done) return;
				done = true;
				this.detachAnalyser();
				if (src.startsWith("blob:")) URL.revokeObjectURL(src);
				if (this.audio === audio) this.audio = null;
				resolve();
			};
			audio.onplay = () => {
				if (gen === this.gen) this.onState("speaking");
				// 播放成功后才接分析器，避免 createMediaElementSource 在 play 前阻断音频
				this.attachAnalyser(audio, gen);
			};
			audio.onended = finish;
			audio.onerror = finish;
			audio.onpause = finish; // stop()/打断时 pause 触发 → 解除挂起的 await
			void audio.play().catch(() => finish());
		});
	}

	/**
	 * 用 AudioContext + AnalyserNode 监听播放音量，驱动粒子系统。
	 * 仅 API 引擎可用（系统 speechSynthesis 无法接入 Web Audio 分析）。
	 * 安全降级：任何环节失败都静默放弃分析，绝不阻塞播放。
	 */
	private attachAnalyser(audio: HTMLAudioElement, gen: number): void {
		if (!this.onLevel) return;
		try {
			const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			if (!Ctx) return;
			const ctx = new Ctx();
			// 自动播放策略可能让 context 处于 suspended，先 resume
			if (ctx.state === "suspended") void ctx.resume().catch(() => {});
			const source = ctx.createMediaElementSource(audio);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			// 关键：source → analyser → destination，确保声音仍能播出
			source.connect(analyser);
			analyser.connect(ctx.destination);
			this.audioCtx = ctx;
			this.audioSource = source;
			this.analyser = analyser;
			const buf = new Uint8Array(analyser.frequencyBinCount);
			const sample = (): void => {
				if (gen !== this.gen || !this.analyser) return;
				this.analyser.getByteFrequencyData(buf);
				let sum = 0;
				for (let i = 0; i < buf.length; i++) sum += buf[i] ?? 0;
				const avg = sum / buf.length / 255;
				this.onLevel?.(Math.min(1, avg * 2.2));
				this.levelTimer = window.requestAnimationFrame(sample);
			};
			this.levelTimer = window.requestAnimationFrame(sample);
		} catch {
			// AudioContext 创建失败、跨域 tainted media 或 CSP 拦截——
			// 静默降级：放弃音量分析，音频仍正常播放（未挂载到 AudioContext 链路）
			this.cleanupAnalyserState();
		}
	}

	private cleanupAnalyserState(): void {
		this.analyser = null;
		this.audioSource = null;
		this.audioCtx = null;
	}

	private detachAnalyser(): void {
		if (this.levelTimer !== null) {
			window.cancelAnimationFrame(this.levelTimer);
			this.levelTimer = null;
		}
		this.analyser = null;
		this.audioSource = null;
		if (this.audioCtx) {
			try { void this.audioCtx.close(); } catch { /* noop */ }
			this.audioCtx = null;
		}
		if (this.onLevel) this.onLevel(0);
	}

	stop(): void {
		this.gen++; // 作废在途播放循环与挂起的 playUrl await
		this.buf = "";
		this.audioQueue = [];
		this.playing = false;
		this.utterers = [];
		this.stopKeepAlive();
		this.detachAnalyser();
		if (this.audio) {
			const a = this.audio;
			this.audio = null;
			try { a.pause(); } catch { /* noop */ } // 触发 onpause→finish，解除旧 await
		}
		try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
		this.onState("idle");
	}
}

// ---------- STT（WebSpeech 麦克风转写） ----------
type SpeechRecognitionLike = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	start(): void;
	stop(): void;
	abort(): void;
	onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
	onerror: ((ev: { error: string }) => void) | null;
	onend: (() => void) | null;
};

export class MicStt {
	private settings: TalosSettings;
	private rec: SpeechRecognitionLike | null = null;
	private listening = false;
	private onInterim: (text: string) => void;
	private onFinal: (text: string) => void;
	private onStateChange: (listening: boolean, err?: string) => void;

	constructor(
		settings: TalosSettings,
		handlers: {
			onInterim: (text: string) => void;
			onFinal: (text: string) => void;
			onStateChange: (listening: boolean, err?: string) => void;
		}
	) {
		this.settings = settings;
		this.onInterim = handlers.onInterim;
		this.onFinal = handlers.onFinal;
		this.onStateChange = handlers.onStateChange;
	}

	static available(): boolean {
		const w = window as unknown as Record<string, unknown>;
		return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
	}

	isListening(): boolean {
		return this.listening;
	}

	toggle(): void {
		if (this.listening) this.stop();
		else this.start();
	}

	start(): void {
		if (this.listening) return;
		const w = window as unknown as Record<string, unknown>;
		const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
			| (new () => SpeechRecognitionLike)
			| undefined;
		if (!Ctor) {
			this.onStateChange(false, "此环境无语音识别（WebSpeech 不可用）");
			return;
		}
		const rec = new Ctor();
		rec.lang = this.settings.jarvisSttLang || "zh-CN";
		rec.continuous = false;
		rec.interimResults = true;
		rec.onresult = (ev) => {
			let interim = "";
			let final = "";
			for (let i = ev.resultIndex; i < ev.results.length; i++) {
				const r = ev.results[i];
				if (!r) continue;
				const txt = r[0]?.transcript ?? "";
				if (r.isFinal) final += txt;
				else interim += txt;
			}
			if (interim) this.onInterim(interim);
			if (final) this.onFinal(final);
		};
		rec.onerror = (ev) => {
			this.listening = false;
			this.onStateChange(false, ev.error);
		};
		rec.onend = () => {
			this.listening = false;
			this.onStateChange(false);
		};
		this.rec = rec;
		this.listening = true;
		this.onStateChange(true);
		try { rec.start(); } catch { /* noop */ }
	}

	stop(): void {
		if (!this.rec) return;
		try { this.rec.stop(); } catch { /* noop */ }
		this.listening = false;
		this.onStateChange(false);
	}

	dispose(): void {
		if (this.rec) { try { this.rec.abort(); } catch { /* noop */ } this.rec = null; }
		this.listening = false;
	}
}
