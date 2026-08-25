import type { TalosSettings } from "../settings";
import { BUNDLED_SILERO_VAD_PACKAGE } from "./bundled-local-voice-runtime";
import {
	LOCAL_VOICE_ASSET_PROTOCOL_VERSION,
	loadVerifiedVoiceModelAsset,
	type LocalVadRuntime,
	type LocalVadSession,
	type LocalVadTensorLike,
	type LocalVoiceModelPackage,
} from "./local-voice-supply-chain";

// ============================================================
// 屈原 · Silero VAD v5
//   ONNX JavaScript/WASM 运行时只能随插件构建静态提供。模型资产必须来自
//   固定清单，并在创建 session 前通过 SHA-256；不存在经审计资产时失败关闭，
//   由 VadMic 明确回退到响度判定。
// ============================================================

const INFER_TIMEOUT_MS = 5000;
export const SILERO_WINDOW = 512;
const SILERO_CONTEXT = 64;
export const SILERO_SAMPLE_RATE = 16000;
export const SPEECH_START_PROB = 0.5;
export const SPEECH_KEEP_PROB = 0.35;
export const SILERO_RUNTIME_MISSING =
	"当前构建未包含经审计的本地 VAD 运行时和固定模型；已禁止从 CDN 执行远程 JavaScript";

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

function assertRuntime(runtime: LocalVadRuntime): void {
	if (
		runtime.protocolVersion !== LOCAL_VOICE_ASSET_PROTOCOL_VERSION ||
		!runtime.runtimeId.trim() ||
		!runtime.runtimeVersion.trim() ||
		/^(latest|main|master|head)$/i.test(runtime.runtimeVersion.trim())
	) {
		throw new Error("本地 VAD 运行时未使用受支持的固定版本");
	}
}

export class SileroVad {
	private runtime: LocalVadRuntime | null = null;
	private session: LocalVadSession | null = null;
	private loading: Promise<void> | null = null;
	private loadGeneration = 0;
	private stateGeneration = 0;
	private state: LocalVadTensorLike | null = null;
	private srTensor: LocalVadTensorLike | null = null;
	private context = new Float32Array(SILERO_CONTEXT);

	constructor(
		private readonly settings: TalosSettings,
		private readonly modelPackage: LocalVoiceModelPackage<LocalVadRuntime> | null =
			BUNDLED_SILERO_VAD_PACKAGE
	) {}

	isReady(): boolean {
		return this.session !== null;
	}

	async load(): Promise<void> {
		if (this.session) return;
		if (!this.loading) {
			const generation = ++this.loadGeneration;
			const task = this.doLoad(generation);
			this.loading = task;
			const clear = (): void => {
				if (this.loading === task) this.loading = null;
			};
			void task.then(clear, clear);
		}
		await this.loading;
	}

	private async doLoad(generation: number): Promise<void> {
		const modelPackage = this.modelPackage;
		if (!modelPackage) throw new Error(SILERO_RUNTIME_MISSING);
		assertRuntime(modelPackage.runtime);
		const asset = await loadVerifiedVoiceModelAsset(modelPackage.manifest, {
			bundledBytes: modelPackage.bundledModelBytes,
			readCachedBytes: modelPackage.readCachedModelBytes,
			fetchNetworkBytes: modelPackage.fetchNetworkModelBytes,
			networkConsent: this.settings.quyuanVadNetworkConsent === true,
		});
		if (generation !== this.loadGeneration) {
			throw new Error("VAD 加载已取消");
		}
		const session = await modelPackage.runtime.createSession(asset.bytes, {
			executionProviders: ["wasm"],
			graphOptimizationLevel: "all",
		});
		if (generation !== this.loadGeneration) {
			try {
				await session.release?.();
			} catch {
				/* noop */
			}
			throw new Error("VAD 加载已取消");
		}
		this.runtime = modelPackage.runtime;
		this.session = session;
		this.resetState();
		// eslint-disable-next-line obsidianmd/rule-custom-message -- 只记录固定版本与校验后来源，不记录音频
		console.info(
			`[TALOS 屈原] Silero VAD 就绪（${modelPackage.runtime.runtimeId}@${modelPackage.runtime.runtimeVersion}，模型 ${asset.manifest.id}@${asset.manifest.version}，来源 ${asset.source}）`
		);
	}

	resetState(): void {
		++this.stateGeneration;
		const runtime = this.runtime;
		if (!runtime) return;
		this.state = new runtime.Tensor(
			"float32",
			new Float32Array(2 * 1 * 128),
			[2, 1, 128]
		);
		this.srTensor = new runtime.Tensor(
			"int64",
			new BigInt64Array([BigInt(SILERO_SAMPLE_RATE)]),
			[1]
		);
		this.context = new Float32Array(SILERO_CONTEXT);
	}

	async process(window: Float32Array): Promise<number> {
		const generation = this.loadGeneration;
		const stateGeneration = this.stateGeneration;
		const runtime = this.runtime;
		const session = this.session;
		const state = this.state;
		const srTensor = this.srTensor;
		if (!runtime || !session || !state || !srTensor) {
			throw new Error("Silero VAD 尚未就绪");
		}
		const withContext = new Float32Array(SILERO_CONTEXT + window.length);
		withContext.set(this.context, 0);
		withContext.set(window, SILERO_CONTEXT);
		const feeds: Record<string, unknown> = {
			input: new runtime.Tensor("float32", withContext, [1, withContext.length]),
			state,
			sr: srTensor,
		};
		const out = await withTimeout(session.run(feeds), INFER_TIMEOUT_MS, "VAD 推理超时");
		if (
			generation !== this.loadGeneration ||
			stateGeneration !== this.stateGeneration ||
			session !== this.session
		) {
			throw new Error("VAD 推理结果已过期");
		}
		const probName = session.outputNames.find((name) => name !== "stateN") ?? session.outputNames[0];
		const stateName = session.outputNames.includes("stateN") ? "stateN" : session.outputNames[1];
		const nextState = stateName ? out[stateName] : undefined;
		if (nextState) this.state = nextState;
		this.context = window.slice(window.length - SILERO_CONTEXT);
		const prob = probName ? Number(out[probName]?.data?.[0] ?? 0) : 0;
		return Number.isFinite(prob) ? prob : 0;
	}

	dispose(): void {
		++this.loadGeneration;
		++this.stateGeneration;
		const session = this.session;
		this.session = null;
		this.loading = null;
		this.runtime = null;
		this.state = null;
		this.srTensor = null;
		try {
			void session?.release?.();
		} catch {
			/* noop */
		}
	}
}
