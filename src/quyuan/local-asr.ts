import { VadMic } from "./vad-mic";

// ============================================================
// 屈原 · 本地语音识别（transformers.js · Whisper · 永久免费/离线）
//   继承 VadMic，仅实现转写：运行时从 CDN 动态加载 transformers.js（不进包），
//   首次调用建立 ASR pipeline（优先 WebGPU，失败回退 WASM），对 16k 单声道
//   Float32 直接转写。模型/CDN 可在设置覆盖；首次需联网下模型，之后缓存离线。
//   CDN 由设置拼出（运行时字符串）→ esbuild 不静态打包该动态 import。
// ============================================================

const DEFAULT_CDN = "https://esm.sh/@huggingface/transformers@3.0.2";
const DEFAULT_MODEL = "Xenova/whisper-base";

type Transcriber = (
	audio: Float32Array,
	options?: Record<string, unknown>
) => Promise<{ text?: string }>;

interface TransformersModule {
	pipeline: (
		task: string,
		model: string,
		options?: Record<string, unknown>
	) => Promise<Transcriber>;
}

export class LocalAsr extends VadMic {
	private transcriber: Transcriber | null = null;
	private loading: Promise<Transcriber> | null = null;

	protected preflight(): string | null {
		return null; // 无需 key；模型首次转写时按需加载
	}

	private async ensureTranscriber(): Promise<Transcriber> {
		if (this.transcriber) return this.transcriber;
		if (!this.loading) this.loading = this.load();
		this.transcriber = await this.loading;
		return this.transcriber;
	}

	private async load(): Promise<Transcriber> {
		const cdn = this.settings.quyuanLocalAsrCdn?.trim() || DEFAULT_CDN;
		const model = this.settings.quyuanLocalAsrModel?.trim() || DEFAULT_MODEL;
		// eslint-disable-next-line no-unsanitized/method -- 运行时从可信 CDN（默认 esm.sh，可设置覆盖）动态加载 transformers.js，不打进 bundle
		const mod = (await import(cdn)) as TransformersModule;
		try {
			return await mod.pipeline("automatic-speech-recognition", model, { device: "webgpu" });
		} catch {
			// WebGPU 不可用 → 回退 WASM
			return await mod.pipeline("automatic-speech-recognition", model);
		}
	}

	protected async transcribe(samples: Float32Array): Promise<string> {
		const transcriber = await this.ensureTranscriber();
		const options: Record<string, unknown> = { task: "transcribe", chunk_length_s: 30 };
		if ((this.settings.jarvisSttLang || "zh-CN").toLowerCase().startsWith("zh")) {
			options.language = "chinese";
		}
		const out = await transcriber(samples, options);
		return (out?.text ?? "").trim();
	}
}
