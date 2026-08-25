// Local ASR/VAD supply-chain boundary.
//
// JavaScript/WASM runtimes must be linked into the plugin at build time. Model
// bytes may come from the bundle, a verified cache, or (only after explicit
// consent) the exact HTTPS URL in a pinned manifest. Every source is verified
// before a runtime can see the bytes.

export const LOCAL_VOICE_ASSET_PROTOCOL_VERSION = 1 as const;

export const ALLOWED_LOCAL_VOICE_MODEL_HOSTS = Object.freeze([
	"cdn.jsdelivr.net",
	"huggingface.co",
]);

export interface PinnedVoiceModelManifest {
	protocolVersion: typeof LOCAL_VOICE_ASSET_PROTOCOL_VERSION;
	id: string;
	version: string;
	fileName: string;
	sha256: string;
	downloadUrl: string;
	licenseId: string;
	notice: string;
}

export type VoiceModelAssetSource = "bundled" | "cache" | "network";

export interface VoiceModelAssetInputs {
	bundledBytes?: Uint8Array | null;
	readCachedBytes?: (() => Promise<Uint8Array | null>) | null;
	fetchNetworkBytes?: ((url: string) => Promise<Uint8Array>) | null;
	networkConsent: boolean;
}

export interface VerifiedVoiceModelAsset {
	bytes: Uint8Array;
	manifest: Readonly<PinnedVoiceModelManifest>;
	source: VoiceModelAssetSource;
}

export interface LocalAsrTranscriber {
	(
		audio: Float32Array,
		options: Readonly<{
			sampleRate: number;
			streamId: string;
			phase: "partial" | "final";
		}>
	): Promise<{ text?: string }>;
	dispose?: () => void | Promise<void>;
}

export interface LocalAsrRuntime {
	protocolVersion: typeof LOCAL_VOICE_ASSET_PROTOCOL_VERSION;
	runtimeId: string;
	runtimeVersion: string;
	createTranscriber(
		modelBytesByFileName: ReadonlyMap<string, Uint8Array>,
		options: Readonly<{ device: "wasm" }>
	): Promise<LocalAsrTranscriber>;
}

export interface LocalAsrModelPackage {
	manifests: readonly Readonly<PinnedVoiceModelManifest>[];
	runtime: LocalAsrRuntime;
	readBundledModelBytes?: (
		manifest: Readonly<PinnedVoiceModelManifest>
	) => Promise<Uint8Array | null>;
	readCachedModelBytes?: (
		manifest: Readonly<PinnedVoiceModelManifest>
	) => Promise<Uint8Array | null>;
	fetchNetworkModelBytes?: (
		manifest: Readonly<PinnedVoiceModelManifest>
	) => Promise<Uint8Array>;
}

export interface LocalVadTensorLike {
	data: ArrayLike<number>;
}

export interface LocalVadTensorCtor {
	new (type: string, data: unknown, dims?: number[]): LocalVadTensorLike;
}

export interface LocalVadSession {
	inputNames: string[];
	outputNames: string[];
	run(feeds: Record<string, unknown>): Promise<Record<string, LocalVadTensorLike>>;
	release?: () => Promise<void>;
}

export interface LocalVadRuntime {
	protocolVersion: typeof LOCAL_VOICE_ASSET_PROTOCOL_VERSION;
	runtimeId: string;
	runtimeVersion: string;
	Tensor: LocalVadTensorCtor;
	createSession(
		modelBytes: Uint8Array,
		options: Readonly<{
			executionProviders: readonly ["wasm"];
			graphOptimizationLevel: "all";
		}>
	): Promise<LocalVadSession>;
}

export interface LocalVoiceModelPackage<Runtime> {
	manifest: Readonly<PinnedVoiceModelManifest>;
	runtime: Runtime;
	bundledModelBytes?: Uint8Array | null;
	readCachedModelBytes?: (() => Promise<Uint8Array | null>) | null;
	fetchNetworkModelBytes?: ((url: string) => Promise<Uint8Array>) | null;
}

function assertPinnedText(value: string, label: string): void {
	const normalized = value.trim();
	if (!normalized || /^(latest|main|master|head)$/i.test(normalized)) {
		throw new Error(`${label} 必须是固定值，不能使用浮动版本`);
	}
}

export function assertPinnedVoiceModelManifest(
	manifest: PinnedVoiceModelManifest
): Readonly<PinnedVoiceModelManifest> {
	if (manifest.protocolVersion !== LOCAL_VOICE_ASSET_PROTOCOL_VERSION) {
		throw new Error("本地语音模型清单协议版本不受支持");
	}
	assertPinnedText(manifest.id, "模型 ID");
	assertPinnedText(manifest.version, "模型版本");
	assertPinnedText(manifest.licenseId, "模型许可证");
	if (!manifest.notice.trim()) throw new Error("模型清单缺少 NOTICE 声明");
	if (
		!manifest.fileName ||
		manifest.fileName.includes("/") ||
		manifest.fileName.includes("\\") ||
		manifest.fileName === "." ||
		manifest.fileName === ".."
	) {
		throw new Error("模型文件名必须是固定的单一文件名");
	}
	if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) {
		throw new Error("模型清单必须包含小写十六进制 SHA-256");
	}

	let url: URL;
	try {
		url = new URL(manifest.downloadUrl);
	} catch {
		throw new Error("模型下载地址不是合法 URL");
	}
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!ALLOWED_LOCAL_VOICE_MODEL_HOSTS.includes(url.hostname)
	) {
		throw new Error("模型下载地址不在固定 HTTPS 允许域名内");
	}
	if (!url.pathname.endsWith(`/${manifest.fileName}`)) {
		throw new Error("模型下载地址与固定文件名不一致");
	}

	return Object.freeze({ ...manifest });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const input = bytes.slice().buffer;
	const digest = await crypto.subtle.digest("SHA-256", input);
	return Array.from(new Uint8Array(digest), (value) =>
		value.toString(16).padStart(2, "0")
	).join("");
}

async function verifyBytes(
	manifest: Readonly<PinnedVoiceModelManifest>,
	bytes: Uint8Array,
	source: VoiceModelAssetSource
): Promise<VerifiedVoiceModelAsset> {
	const actual = await sha256Hex(bytes);
	if (actual !== manifest.sha256) {
		throw new Error(
			`本地语音模型 SHA-256 校验失败（${manifest.id}@${manifest.version}，来源 ${source}）`
		);
	}
	return { bytes, manifest, source };
}

export async function loadVerifiedVoiceModelAsset(
	inputManifest: PinnedVoiceModelManifest,
	inputs: VoiceModelAssetInputs
): Promise<VerifiedVoiceModelAsset> {
	const manifest = assertPinnedVoiceModelManifest(inputManifest);
	if (inputs.bundledBytes) {
		return verifyBytes(manifest, inputs.bundledBytes, "bundled");
	}
	if (inputs.readCachedBytes) {
		const cached = await inputs.readCachedBytes();
		if (cached) return verifyBytes(manifest, cached, "cache");
	}
	if (!inputs.networkConsent) {
		throw new Error("首次获取固定本地语音模型尚未获得明确联网同意");
	}
	if (!inputs.fetchNetworkBytes) {
		throw new Error("当前构建未包含本地语音模型获取器或离线模型资产");
	}
	const bytes = await inputs.fetchNetworkBytes(manifest.downloadUrl);
	return verifyBytes(manifest, bytes, "network");
}
