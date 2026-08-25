import type { TalosSettings } from "../settings";
import {
	LOCAL_VOICE_ASSET_PROTOCOL_VERSION,
	loadVerifiedVoiceModelAsset,
	type LocalAsrModelPackage,
	type LocalAsrTranscriber,
} from "./local-voice-supply-chain";
import {
	VadMic,
	type VadMicHandlers,
	type VadTranscriptionContext,
} from "./vad-mic";

// ============================================================
// 屈原 · 本地语音识别
//   JavaScript/WASM 运行时必须随构建静态提供；禁止从 CDN 动态 import。
//   WASM 与每个模型文件都在交给 Worker 前通过固定 SHA-256；缺件即失败关闭。
// ============================================================

const TRANSCRIBE_TIMEOUT_MS = 60000;
export const LOCAL_ASR_RUNTIME_MISSING =
	"当前构建未包含经审计的本地 ASR 运行时和固定模型；请切回云端识别，或离线提供带版本、SHA-256 与 NOTICE 的运行时资产包";

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

export class SerializedInferenceQueue {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
		const operation = this.tail.then(task, task);
		// 调用方超时只结束等待；队列仍跟随底层推理，直到它真正结束后才放行下一项。
		this.tail = operation.catch(() => undefined);
		return withTimeout(operation, timeoutMs, label);
	}
}

export class LocalAsr extends VadMic {
	private transcriber: LocalAsrTranscriber | null = null;
	private loading: Promise<LocalAsrTranscriber> | null = null;
	private readonly inferenceQueue = new SerializedInferenceQueue();
	private readonly modelPackage: LocalAsrModelPackage | null;
	private runtimeGeneration = 0;

	constructor(
		settings: TalosSettings,
		handlers: VadMicHandlers,
		modelPackage: LocalAsrModelPackage | null = null
	) {
		super(settings, handlers);
		this.modelPackage = modelPackage;
	}

	protected async preflight(): Promise<string | null> {
		if (!this.modelPackage) return LOCAL_ASR_RUNTIME_MISSING;
		try {
			await this.ensureTranscriber();
			return null;
		} catch (error) {
			return `本地语音初始化失败：${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}

	// 本地推理不计费、不外传录音，可以边说边转；云端引擎保持默认 false。
	protected override supportsPartial(): boolean {
		return true;
	}

	// 流式 Worker 的 final 调用会补尾静音并 inputFinished，不能复用 partial。
	protected override requiresFinalTranscription(): boolean {
		return true;
	}

	private async ensureTranscriber(): Promise<LocalAsrTranscriber> {
		if (this.transcriber) return this.transcriber;
		const generation = this.runtimeGeneration;
		if (!this.loading) this.loading = this.load();
		try {
			const loaded = await this.loading;
			if (generation !== this.runtimeGeneration) {
				await loaded.dispose?.();
				throw new Error("本地 ASR 初始化已取消");
			}
			this.transcriber = loaded;
			this.loading = null;
			return loaded;
		} catch (error) {
			this.loading = null;
			throw error;
		}
	}

	private async load(): Promise<LocalAsrTranscriber> {
		const modelPackage = this.modelPackage;
		if (!modelPackage) throw new Error(LOCAL_ASR_RUNTIME_MISSING);
		if (
			modelPackage.runtime.protocolVersion !== LOCAL_VOICE_ASSET_PROTOCOL_VERSION ||
			!modelPackage.runtime.runtimeId.trim() ||
			!modelPackage.runtime.runtimeVersion.trim() ||
			/^(latest|main|master|head)$/i.test(modelPackage.runtime.runtimeVersion.trim())
		) {
			throw new Error("本地 ASR 运行时未使用受支持的固定版本");
		}
		if (modelPackage.manifests.length === 0) {
			throw new Error("本地 ASR 固定模型清单为空");
		}
		const assets = await Promise.all(modelPackage.manifests.map(async (manifest) => {
			const bundledBytes = modelPackage.readBundledModelBytes
				? await modelPackage.readBundledModelBytes(manifest)
				: null;
			return loadVerifiedVoiceModelAsset(manifest, {
				bundledBytes,
				readCachedBytes: modelPackage.readCachedModelBytes
					? () => modelPackage.readCachedModelBytes!(manifest)
					: null,
				fetchNetworkBytes: modelPackage.fetchNetworkModelBytes
					? (url) => {
						if (url !== manifest.downloadUrl) {
							throw new Error("本地 ASR 拒绝非清单下载地址");
						}
						return modelPackage.fetchNetworkModelBytes!(manifest);
					}
					: null,
				networkConsent: this.settings.quyuanLocalAsrNetworkConsent === true,
			});
		}));
		const modelBytes = new Map(
			assets.map((asset) => [asset.manifest.fileName, asset.bytes] as const)
		);
		const transcriber = await modelPackage.runtime.createTranscriber(modelBytes, {
			device: "wasm",
		});
		// eslint-disable-next-line obsidianmd/rule-custom-message -- 只记录固定版本与校验后来源，不记录语音内容
		console.info(
			`[TALOS 屈原] 本地 ASR 就绪（${modelPackage.runtime.runtimeId}@${modelPackage.runtime.runtimeVersion}，模型 revision ${assets[0]?.manifest.version}，${assets.length} 个文件，来源 ${[...new Set(assets.map((asset) => asset.source))].join("+")}）`
		);
		return transcriber;
	}

	protected async transcribe(
		samples: Float32Array,
		sampleRate: number,
		context: VadTranscriptionContext
	): Promise<string> {
		const transcriber = await this.ensureTranscriber();
		const out = await this.inferenceQueue.run(
			() => transcriber(samples, {
				sampleRate,
				streamId: context.streamId,
				phase: context.phase,
			}),
			TRANSCRIBE_TIMEOUT_MS,
			"语音转写超时"
		);
		return (out?.text ?? "").trim();
	}

	override dispose(): void {
		++this.runtimeGeneration;
		const transcriber = this.transcriber;
		this.transcriber = null;
		this.loading = null;
		super.dispose();
		void Promise.resolve(transcriber?.dispose?.()).catch((error: unknown) => {
			console.warn("[TALOS 屈原] 释放本地 ASR Worker 失败", error);
		});
	}
}
