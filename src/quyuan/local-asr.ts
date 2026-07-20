import { VadMic } from "./vad-mic";

// ============================================================
// 屈原 · 本地语音识别（transformers.js · Whisper · 永久免费/离线）
//   继承 VadMic，仅实现转写：运行时从 CDN 动态加载 transformers.js（不进包），
//   首次调用建立 ASR pipeline（优先 WebGPU，失败回退 WASM），对 16k 单声道
//   Float32 直接转写。模型/CDN 可在设置覆盖；首次需联网下模型，之后缓存离线。
//   CDN 由设置拼出（运行时字符串）→ esbuild 不静态打包该动态 import。
//
//   健壮性：本地链路（拉库→下模型→WASM 初始化）任一环挂起都会让面板无声
//   停在 transcribing。故：CDN 加载与单段转写各加超时；模型下载走进度日志；
//   加载失败不缓存 rejected promise（否则一次失败永久失败）；失败给明确中文
//   报错（经 VadMic 的 onError 弹出），而非干转圈。
// ============================================================

const DEFAULT_CDN = "https://esm.sh/@huggingface/transformers@3.0.2";
const DEFAULT_MODEL = "Xenova/whisper-base";
const CDN_LOAD_TIMEOUT_MS = 30000; // 拉 transformers.js（不含下模型）
const TRANSCRIBE_TIMEOUT_MS = 60000; // 单段转写兜底（不含首次下模型）

type Transcriber = (
	audio: Float32Array,
	options?: Record<string, unknown>
) => Promise<{ text?: string }>;

interface ModelProgress {
	status?: string;
	file?: string;
	progress?: number;
}

interface TransformersModule {
	pipeline: (
		task: string,
		model: string,
		options?: Record<string, unknown>
	) => Promise<Transcriber>;
}

// 给任意 promise 套超时：超时按“无响应”reject，避免 UI 无声挂起
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(
			() => reject(new Error(`${label}（超过 ${Math.round(ms / 1000)} 秒无响应）`)),
			ms
		);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		);
	});
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
		try {
			this.transcriber = await this.loading;
			return this.transcriber;
		} catch (error) {
			// 别把 rejected promise 缓存住，否则第一次失败后即使网络恢复也永久失败
			this.loading = null;
			throw error;
		}
	}

	private async load(): Promise<Transcriber> {
		const cdn = this.settings.quyuanLocalAsrCdn?.trim() || DEFAULT_CDN;
		const model = this.settings.quyuanLocalAsrModel?.trim() || DEFAULT_MODEL;

		// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：本地识别库加载起点，排查「无声挂起」必需，保留
		console.info(`[TALOS 屈原] 本地 Whisper：从 ${cdn} 加载 transformers.js…`);
		let mod: TransformersModule;
		try {
			// eslint-disable-next-line no-unsanitized/method -- 运行时从可信 CDN（默认 esm.sh，可设置覆盖）动态加载 transformers.js，不打进 bundle
			mod = (await withTimeout(import(cdn), CDN_LOAD_TIMEOUT_MS, "加载语音识别库失败")) as TransformersModule;
		} catch (error) {
			throw new Error(
				`本地 Whisper 加载失败：无法从 CDN 拉取识别库（${cdn}）。` +
					`多为网络无法访问该 CDN。可在「设置 → 语音」改用国内可访问的镜像 CDN，或切回千问云端识别。` +
					`原始错误：${error instanceof Error ? error.message : String(error)}`
			);
		}

		// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：提示首次需联网下载模型，保留
		console.info(
			`[TALOS 屈原] 本地 Whisper：识别库就绪，准备模型 ${model}（首次需联网下载，可能较慢，进度见控制台）…`
		);
		const options: Record<string, unknown> = {
			dtype: "q8", // 量化权重：显著减小首次下载体积
			progress_callback: (p: ModelProgress): void => {
				if (p?.status === "progress" && typeof p.progress === "number") {
					// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：模型下载进度，排查下载卡死必需，保留
					console.info(`[TALOS 屈原] 模型下载 ${p.file ?? ""} ${p.progress.toFixed(1)}%`);
				} else if (p?.status === "done" && p.file) {
					// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：模型分片就绪，保留
					console.info(`[TALOS 屈原] 模型分片就绪 ${p.file}`);
				}
			},
		};

		// 关键：Whisper 在本机 WebGPU(onnxruntime-web) 后端上，推理期会 "Session mismatch"
		// 崩溃（pipeline 创建时不报错，崩在真正转写时，故无法靠 try/catch 回退）。稳定优先，
		// 直接用 WASM/CPU 后端；虽比 WebGPU 慢，但能稳定转写，不再唤不醒。
		try {
			const pipe = await mod.pipeline("automatic-speech-recognition", model, {
				...options,
				device: "wasm",
			});
			// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：WASM 后端就绪标记，排查「唤不醒」必需，保留
			console.info("[TALOS 屈原] 本地 Whisper 就绪（WASM）");
			return pipe;
		} catch (q8Error) {
			// 个别环境不支持 q8 量化 → 退回默认精度重试
			console.warn("[TALOS 屈原] q8 量化加载失败，退回默认精度", q8Error);
			const pipe = await mod.pipeline("automatic-speech-recognition", model, {
				progress_callback: options.progress_callback,
				device: "wasm",
			});
			// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：默认精度回退就绪标记，保留
			console.info("[TALOS 屈原] 本地 Whisper 就绪（WASM·默认精度）");
			return pipe;
		}
	}

	protected async transcribe(samples: Float32Array): Promise<string> {
		const transcriber = await this.ensureTranscriber();
		const options: Record<string, unknown> = { task: "transcribe", chunk_length_s: 30 };
		if ((this.settings.jarvisSttLang || "zh-CN").toLowerCase().startsWith("zh")) {
			options.language = "chinese";
		}
		// 只给转写调用套超时；首次下模型在 ensureTranscriber 内完成，不受此超时约束
		const out = await withTimeout(
			transcriber(samples, options),
			TRANSCRIBE_TIMEOUT_MS,
			"语音转写超时"
		);
		return (out?.text ?? "").trim();
	}
}
