import type { TalosSettings } from "../settings";

// ============================================================
// 屈原 · 本地语音 I/O
//   TTS：只使用系统 speechSynthesis，不连接网络服务或读取 Provider 凭据。
//   STT：旧 WebSpeech 入口保留为失败关闭兼容桩；实际识别只走语音页 LocalAsr。
// ============================================================

type SpeakState = "idle" | "speaking" | "error";

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

export class StreamTts {
	private buf = "";
	private utterers: SpeechSynthesisUtterance[] = [];
	private keepAlive: number | null = null;
	private gen = 0;

	constructor(
		private readonly settings: TalosSettings,
		private readonly onState: (state: SpeakState, text?: string) => void,
		private readonly onLevel: ((level: number) => void) | null = null
	) {}

	feed(delta: string): void {
		this.buf += delta;
		this.drain(false);
	}

	flush(): void {
		this.drain(true);
	}

	private drain(final: boolean): void {
		const sentences: string[] = [];
		let rest = this.buf;
		const sentencePattern = /[^。！？!?；;\n]*[。！？!?；;\n]/g;
		let match: RegExpExecArray | null;
		let lastIndex = 0;
		while ((match = sentencePattern.exec(this.buf)) !== null) {
			const segment = match[0].trim();
			if (segment) sentences.push(segment);
			lastIndex = sentencePattern.lastIndex;
		}
		rest = this.buf.slice(lastIndex);
		if (!final && rest.length > 28) {
			sentences.push(rest.trim());
			rest = "";
		}
		this.buf = final ? "" : rest;
		if (final && rest.trim()) sentences.push(rest.trim());
		for (const sentence of sentences) {
			const spoken = normalizeForSpeech(sentence);
			if (spoken) this.speakSystem(spoken);
		}
	}

	private speakSystem(text: string): void {
		const synth = window.speechSynthesis;
		if (!synth) {
			this.onState("error", "系统语音不可用");
			return;
		}
		const myGen = this.gen;
		const lang = this.settings.voiceLang || "zh-CN";
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = lang;
		utterance.rate = this.settings.ttsRate || 1;
		utterance.pitch = this.settings.ttsPitch || 1;
		const wantedVoice = this.settings.ttsVoice.trim();
		const voices = synth.getVoices();
		const voice =
			(wantedVoice && voices.find((candidate) => candidate.name === wantedVoice)) ||
			voices.find((candidate) =>
				candidate.lang?.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2))
			) ||
			null;
		if (voice) utterance.voice = voice;
		utterance.onstart = () => {
			if (myGen !== this.gen) return;
			this.onState("speaking", text);
			this.startKeepAlive();
			this.onLevel?.(0.6);
		};
		utterance.onend = () => {
			if (myGen !== this.gen) return;
			this.utterers = this.utterers.filter((candidate) => candidate !== utterance);
			if (this.utterers.length === 0 && !synth.speaking) {
				this.stopKeepAlive();
				this.onLevel?.(0);
				this.onState("idle");
			}
		};
		utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
			if (myGen !== this.gen) return;
			const code = event.error || "unknown";
			if (code === "interrupted" || code === "canceled") return;
			this.onState("error", code);
		};
		this.utterers.push(utterance);
		synth.speak(utterance);
		try {
			synth.resume();
		} catch {
			// Some engines do not expose a resumable state.
		}
	}

	private startKeepAlive(): void {
		this.stopKeepAlive();
		this.keepAlive = window.setInterval(() => {
			const synth = window.speechSynthesis;
			if (!synth?.speaking) return;
			try {
				synth.resume();
			} catch {
				// Keep system speech best-effort without widening the I/O boundary.
			}
		}, 8000);
	}

	private stopKeepAlive(): void {
		if (this.keepAlive === null) return;
		window.clearInterval(this.keepAlive);
		this.keepAlive = null;
	}

	stop(): void {
		this.gen += 1;
		this.buf = "";
		this.utterers = [];
		this.stopKeepAlive();
		try {
			window.speechSynthesis?.cancel();
		} catch {
			// Cancellation is best-effort during teardown.
		}
		this.onLevel?.(0);
		this.onState("idle");
	}
}

export class MicStt {
	private readonly onStateChange: (
		listening: boolean,
		error?: string
	) => void;

	constructor(
		_settings: TalosSettings,
		handlers: {
			onInterim: (text: string) => void;
			onFinal: (text: string) => void;
			onStateChange: (listening: boolean, error?: string) => void;
		}
	) {
		this.onStateChange = handlers.onStateChange;
	}

	static available(): boolean {
		return false;
	}

	isListening(): boolean {
		return false;
	}

	toggle(): void {
		this.start();
	}

	start(): void {
		this.onStateChange(
			false,
			"安全策略已禁用 WebSpeech 网络识别；请在语音页使用本地 ASR"
		);
	}

	stop(): void {
		this.onStateChange(false);
	}

	dispose(): void {}
}
