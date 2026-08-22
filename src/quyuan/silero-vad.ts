import { requestUrl } from "obsidian";

import type { TalosSettings } from "../settings";

// ============================================================
// 屈原 · Silero VAD v5（神经网络语音活动检测）
//   用「这一小段音频里有没有人声」的概率替代纯响度阈值：风扇、键盘、音乐
//   这类持续噪音响度可以很高但不是人声，小声/远距离说话响度很低但是人声，
//   响度阈值两头都判错，模型判定两头都对。
//
//   Silero VAD 是独立开源模型（MIT），模型本体约 2.3 MB，与本地 Whisper
//   （约 140 MB）差两个数量级。onnxruntime-web 与模型权重一律运行时从 CDN
//   取，CDN 由设置拼出运行时字符串 → esbuild 不静态打包，main.js 不变大。
//
//   健壮性同 local-asr.ts 已踩过的坑：拉库/拉模型各自超时；加载失败不缓存
//   rejected promise（否则一次失败永久失败）；任何一环挂了都必须能回落到
//   原响度判定，绝不允许静默失效变成「面板无声挂起」。
// ============================================================

// onnxruntime-web 的 dist 目录（注意结尾斜杠）：ESM 与 .wasm 都从这里取，
// 从同一目录加载才能让 wasmPaths 自洽。
const DEFAULT_ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
// Silero VAD v5 ONNX 权重（@ricky0123/vad-web 分发的同一份文件）
const DEFAULT_MODEL_URL =
	"https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.24/dist/silero_vad_v5.onnx";

const ORT_LOAD_TIMEOUT_MS = 30000;
const MODEL_LOAD_TIMEOUT_MS = 45000;
const INFER_TIMEOUT_MS = 5000;

// v5 固定窗口：16k 下 512 样本（32ms），另需前一窗口尾部 64 样本作为上下文
export const SILERO_WINDOW = 512;
const SILERO_CONTEXT = 64;
export const SILERO_SAMPLE_RATE = 16000;
// 迟滞双阈值：起说要更确定，续说更宽容（与 vad-web 默认值一致）
export const SPEECH_START_PROB = 0.5;
export const SPEECH_KEEP_PROB = 0.35;

interface OrtTensorLike {
	data: ArrayLike<number>;
}

interface OrtTensorCtor {
	new (type: string, data: unknown, dims?: number[]): OrtTensorLike;
}

interface OrtSession {
	inputNames: string[];
	outputNames: string[];
	run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensorLike>>;
	release?: () => Promise<void>;
}

interface OrtModule {
	Tensor: OrtTensorCtor;
	InferenceSession: {
		create: (model: Uint8Array, options?: Record<string, unknown>) => Promise<OrtSession>;
	};
	env: { wasm: { wasmPaths?: string; numThreads?: number; proxy?: boolean } };
}

// 与 local-asr.ts 同款超时包装：超时按「无响应」reject，不让 UI 无声挂起
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

export class SileroVad {
	private settings: TalosSettings;
	private ort: OrtModule | null = null;
	private session: OrtSession | null = null;
	private loading: Promise<void> | null = null;
	private state: OrtTensorLike | null = null;
	private srTensor: OrtTensorLike | null = null;
	private context = new Float32Array(SILERO_CONTEXT);

	constructor(settings: TalosSettings) {
		this.settings = settings;
	}

	isReady(): boolean {
		return this.session !== null;
	}

	// 幂等：重复调用共用同一次加载；失败不缓存，网络恢复后可再试
	async load(): Promise<void> {
		if (this.session) return;
		if (!this.loading) this.loading = this.doLoad();
		try {
			await this.loading;
		} catch (error) {
			this.loading = null;
			throw error;
		}
	}

	private async doLoad(): Promise<void> {
		const cdn = this.settings.quyuanVadCdn?.trim() || DEFAULT_ORT_CDN;
		const base = cdn.endsWith("/") ? cdn : `${cdn}/`;
		const modelUrl = this.settings.quyuanVadModel?.trim() || DEFAULT_MODEL_URL;
		const entry = `${base}ort.wasm.min.mjs`;

		// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：VAD 运行时加载起点，排查「断句失灵」必需，保留
		console.info(`[TALOS 屈原] Silero VAD：从 ${entry} 加载 onnxruntime-web…`);
		let mod: OrtModule;
		try {
			// eslint-disable-next-line no-unsanitized/method -- 运行时从可信 CDN（默认 jsDelivr，可设置覆盖）动态加载 onnxruntime-web，不打进 bundle
			mod = (await withTimeout(import(entry), ORT_LOAD_TIMEOUT_MS, "加载 VAD 运行时失败")) as OrtModule;
		} catch (error) {
			throw new Error(
				`拉取 VAD 运行时失败（${entry}）：${error instanceof Error ? error.message : String(error)}`
			);
		}

		// WASM/CPU 单线程：VAD 模型极小，够快；且不依赖 SharedArrayBuffer
		// （Obsidian 未开启跨源隔离，多线程会直接失败）。
		mod.env.wasm.wasmPaths = base;
		mod.env.wasm.numThreads = 1;
		mod.env.wasm.proxy = false;

		let weights: Uint8Array;
		try {
			// requestUrl 走 Obsidian 主进程，不受渲染进程 CORS 限制
			const res = await withTimeout(
				requestUrl({ url: modelUrl, method: "GET" }),
				MODEL_LOAD_TIMEOUT_MS,
				"下载 VAD 模型失败"
			);
			if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
			weights = new Uint8Array(res.arrayBuffer);
		} catch (error) {
			throw new Error(
				`下载 VAD 模型失败（${modelUrl}）：${error instanceof Error ? error.message : String(error)}`
			);
		}

		const session = await mod.InferenceSession.create(weights, {
			executionProviders: ["wasm"],
			graphOptimizationLevel: "all",
		});
		this.ort = mod;
		this.session = session;
		this.resetState();
		// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：VAD 就绪标记，排查「断句失灵」必需，保留
		console.info(
			`[TALOS 屈原] Silero VAD 就绪（WASM，${(weights.length / 1024).toFixed(0)} KB，${session.inputNames.join("/")}）`
		);
	}

	// 每轮收音结束/麦克风重启时清状态：模型是有记忆的，跨轮残留会带偏判定
	resetState(): void {
		const ort = this.ort;
		if (!ort) return;
		this.state = new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
		this.srTensor = new ort.Tensor("int64", new BigInt64Array([BigInt(SILERO_SAMPLE_RATE)]), [1]);
		this.context = new Float32Array(SILERO_CONTEXT);
	}

	// 输入一个 512 样本窗口，返回人声概率 0..1
	async process(window: Float32Array): Promise<number> {
		const ort = this.ort;
		const session = this.session;
		if (!ort || !session || !this.state || !this.srTensor) {
			throw new Error("Silero VAD 尚未就绪");
		}
		const withContext = new Float32Array(SILERO_CONTEXT + window.length);
		withContext.set(this.context, 0);
		withContext.set(window, SILERO_CONTEXT);
		const feeds: Record<string, unknown> = {
			input: new ort.Tensor("float32", withContext, [1, withContext.length]),
			state: this.state,
			sr: this.srTensor,
		};
		const out = await withTimeout(session.run(feeds), INFER_TIMEOUT_MS, "VAD 推理超时");
		const probName = session.outputNames.find((n) => n !== "stateN") ?? session.outputNames[0];
		const stateName = session.outputNames.includes("stateN") ? "stateN" : session.outputNames[1];
		const nextState = stateName ? out[stateName] : undefined;
		if (nextState) this.state = nextState;
		this.context = window.slice(window.length - SILERO_CONTEXT);
		const prob = probName ? Number(out[probName]?.data?.[0] ?? 0) : 0;
		return Number.isFinite(prob) ? prob : 0;
	}

	dispose(): void {
		const session = this.session;
		this.session = null;
		this.loading = null;
		this.state = null;
		this.srTensor = null;
		try {
			void session?.release?.();
		} catch {
			/* noop */
		}
	}
}
