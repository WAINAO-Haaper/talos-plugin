import { readFileSync } from "node:fs";
import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { TalosSettings } from "../src/settings";
import {
	LOCAL_ASR_RUNTIME_MISSING,
	LocalAsr,
} from "../src/quyuan/local-asr";
import {
	assertPinnedVoiceModelManifest,
	loadVerifiedVoiceModelAsset,
	sha256Hex,
	type LocalAsrModelPackage,
	type LocalAsrRuntime,
	type LocalVadRuntime,
	type LocalVadSession,
	type LocalVadTensorLike,
	type LocalVoiceModelPackage,
	type PinnedVoiceModelManifest,
} from "../src/quyuan/local-voice-supply-chain";
import {
	SILERO_RUNTIME_MISSING,
	SILERO_WINDOW,
	SileroVad,
} from "../src/quyuan/silero-vad";
import type { VadMicHandlers } from "../src/quyuan/vad-mic";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

beforeAll(() => {
	vi.stubGlobal("window", {
		setTimeout: nodeSetTimeout,
		clearTimeout: nodeClearTimeout,
	});
});

afterAll(() => vi.unstubAllGlobals());

class Deferred<T> {
	readonly promise: Promise<T>;
	resolve!: (value: T) => void;
	reject!: (error: unknown) => void;

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

async function fixtureManifest(
	bytes: Uint8Array,
	overrides: Partial<PinnedVoiceModelManifest> = {}
): Promise<PinnedVoiceModelManifest> {
	return {
		protocolVersion: 1,
		id: "talos-voice-fixture",
		version: "1.2.3",
		fileName: "model.bin",
		sha256: await sha256Hex(bytes),
		downloadUrl:
			"https://cdn.jsdelivr.net/npm/talos-voice-fixture@1.2.3/model.bin",
		licenseId: "MIT",
		notice: "Fixture only; no production model is distributed.",
		...overrides,
	};
}

const settings = {
	jarvisSttLang: "zh-CN",
	quyuanLocalAsrNetworkConsent: false,
	quyuanVadNetworkConsent: false,
} as TalosSettings;

const micHandlers: VadMicHandlers = {
	onListeningChange: vi.fn(),
	onState: vi.fn(),
	onSpeechStart: vi.fn(),
	onText: vi.fn(),
	onPartial: vi.fn(),
	onError: vi.fn(),
};

class InspectableLocalAsr extends LocalAsr {
	preflightForTest(): Promise<string | null> {
		return this.preflight();
	}

	transcribeForTest(samples: Float32Array): Promise<string> {
		return this.transcribe(samples, 16000, {
			streamId: "fixture:1",
			phase: "final",
		});
	}
}

describe("local voice model manifest", () => {
	it("requires a pinned version, lowercase SHA-256, NOTICE, and an allowed HTTPS host", async () => {
		const bytes = new TextEncoder().encode("talos-model-fixture");
		const valid = await fixtureManifest(bytes);
		expect(assertPinnedVoiceModelManifest(valid)).toMatchObject({
			version: "1.2.3",
			sha256: valid.sha256,
		});

		expect(() => assertPinnedVoiceModelManifest({
			...valid,
			version: "latest",
		})).toThrow("浮动版本");
		expect(() => assertPinnedVoiceModelManifest({
			...valid,
			sha256: "not-a-hash",
		})).toThrow("SHA-256");
		expect(() => assertPinnedVoiceModelManifest({
			...valid,
			downloadUrl: "https://attacker.invalid/model.bin",
		})).toThrow("允许域名");
		expect(() => assertPinnedVoiceModelManifest({
			...valid,
			notice: "",
		})).toThrow("NOTICE");
	});

	it("prefers verified bundled/cache bytes without touching the network", async () => {
		const bytes = new TextEncoder().encode("offline-first");
		const manifest = await fixtureManifest(bytes);
		const readCachedBytes = vi.fn(async () => bytes);
		const fetchNetworkBytes = vi.fn(async () => bytes);

		const bundled = await loadVerifiedVoiceModelAsset(manifest, {
			bundledBytes: bytes,
			readCachedBytes,
			fetchNetworkBytes,
			networkConsent: false,
		});
		expect(bundled.source).toBe("bundled");
		expect(readCachedBytes).not.toHaveBeenCalled();
		expect(fetchNetworkBytes).not.toHaveBeenCalled();

		const cached = await loadVerifiedVoiceModelAsset(manifest, {
			readCachedBytes,
			fetchNetworkBytes,
			networkConsent: false,
		});
		expect(cached.source).toBe("cache");
		expect(fetchNetworkBytes).not.toHaveBeenCalled();
	});

	it("requires explicit consent and fetches only the exact pinned URL", async () => {
		const bytes = new TextEncoder().encode("network-fixture");
		const manifest = await fixtureManifest(bytes);
		const fetchNetworkBytes = vi.fn(async () => bytes);

		await expect(loadVerifiedVoiceModelAsset(manifest, {
			fetchNetworkBytes,
			networkConsent: false,
		})).rejects.toThrow("明确联网同意");
		expect(fetchNetworkBytes).not.toHaveBeenCalled();

		const loaded = await loadVerifiedVoiceModelAsset(manifest, {
			fetchNetworkBytes,
			networkConsent: true,
		});
		expect(loaded.source).toBe("network");
		expect(fetchNetworkBytes).toHaveBeenCalledOnce();
		expect(fetchNetworkBytes).toHaveBeenCalledWith(manifest.downloadUrl);
	});

	it("fails closed on a corrupted cache instead of silently redownloading", async () => {
		const bytes = new TextEncoder().encode("expected");
		const corrupt = new TextEncoder().encode("corrupt");
		const manifest = await fixtureManifest(bytes);
		const fetchNetworkBytes = vi.fn(async () => bytes);

		await expect(loadVerifiedVoiceModelAsset(manifest, {
			readCachedBytes: async () => corrupt,
			fetchNetworkBytes,
			networkConsent: true,
		})).rejects.toThrow("SHA-256 校验失败");
		expect(fetchNetworkBytes).not.toHaveBeenCalled();
	});
});

describe("local ASR runtime boundary", () => {
	it("fails before media acquisition when no audited runtime package is supplied", async () => {
		const asr = new InspectableLocalAsr(settings, micHandlers, null);
		await expect(asr.preflightForTest()).resolves.toBe(LOCAL_ASR_RUNTIME_MISSING);
	});

	it("does not expose any model file to the runtime until every hash passes", async () => {
		const encoder = new TextEncoder().encode("verified-encoder");
		const tokens = new TextEncoder().encode("verified-tokens");
		const manifests = [
			await fixtureManifest(encoder, {
				id: "fixture-encoder",
				fileName: "encoder.bin",
				downloadUrl: "https://cdn.jsdelivr.net/npm/talos-voice-fixture@1.2.3/encoder.bin",
			}),
			await fixtureManifest(tokens, {
				id: "fixture-tokens",
				fileName: "tokens.txt",
				downloadUrl: "https://cdn.jsdelivr.net/npm/talos-voice-fixture@1.2.3/tokens.txt",
			}),
		];
		const bundled = new Map<string, Uint8Array>([
			["encoder.bin", encoder],
			["tokens.txt", tokens],
		]);
		const createTranscriber = vi.fn(async () =>
			Object.assign(async () => ({ text: " 已验证 " }), { dispose: vi.fn() })
		);
		const runtime: LocalAsrRuntime = {
			protocolVersion: 1,
			runtimeId: "fixture-asr",
			runtimeVersion: "1.0.0",
			createTranscriber,
		};
		const goodPackage: LocalAsrModelPackage = {
			manifests,
			runtime,
			readBundledModelBytes: async (manifest) =>
				bundled.get(manifest.fileName) ?? null,
		};
		const asr = new InspectableLocalAsr(settings, micHandlers, goodPackage);

		await expect(asr.transcribeForTest(new Float32Array([0.1]))).resolves.toBe("已验证");
		expect(createTranscriber).toHaveBeenCalledOnce();
		const verified = createTranscriber.mock.calls[0]?.[0] as unknown as
			ReadonlyMap<string, Uint8Array> | undefined;
		expect(verified).toBeInstanceOf(Map);
		expect(verified?.get("encoder.bin")).toEqual(encoder);
		expect(verified?.get("tokens.txt")).toEqual(tokens);
		expect(createTranscriber.mock.calls[0]?.[1]).toEqual({ device: "wasm" });

		const badPackage: LocalAsrModelPackage = {
			...goodPackage,
			readBundledModelBytes: async (manifest) =>
				manifest.fileName === "tokens.txt"
					? new TextEncoder().encode("tampered")
					: bundled.get(manifest.fileName) ?? null,
		};
		const badAsr = new InspectableLocalAsr(settings, micHandlers, badPackage);
		createTranscriber.mockClear();
		await expect(badAsr.transcribeForTest(new Float32Array([0.1])))
			.rejects.toThrow("SHA-256 校验失败");
		expect(createTranscriber).not.toHaveBeenCalled();
	});

	it("releases a transcriber that finishes loading after the panel is disposed", async () => {
		const bytes = new TextEncoder().encode("late-asr");
		const manifest = await fixtureManifest(bytes);
		const delayed = new Deferred<Awaited<ReturnType<LocalAsrRuntime["createTranscriber"]>>>();
		const createTranscriber = vi.fn(() => delayed.promise);
		const asr = new InspectableLocalAsr(settings, micHandlers, {
			manifests: [manifest],
			runtime: {
				protocolVersion: 1,
				runtimeId: "fixture-asr",
				runtimeVersion: "1.0.0",
				createTranscriber,
			},
			readBundledModelBytes: async () => bytes,
		});
		const loading = asr.preflightForTest();
		await vi.waitFor(() => expect(createTranscriber).toHaveBeenCalledOnce());
		asr.dispose();
		const dispose = vi.fn();
		delayed.resolve(Object.assign(
			async () => ({ text: "late" }),
			{ dispose }
		));

		await expect(loading).resolves.toContain("初始化已取消");
		expect(dispose).toHaveBeenCalledOnce();
	});
});

class FixtureTensor implements LocalVadTensorLike {
	constructor(
		readonly type: string,
		readonly data: ArrayLike<number>,
		readonly dims?: number[]
	) {}
}

describe("local VAD runtime boundary", () => {
	it("fails closed when no audited static runtime package is present", async () => {
		const vad = new SileroVad(settings, null);
		await expect(vad.load()).rejects.toThrow(SILERO_RUNTIME_MISSING);
		expect(vad.isReady()).toBe(false);
	});

	it("releases a session that resolves after dispose instead of reviving it", async () => {
		const bytes = new TextEncoder().encode("verified-vad");
		const manifest = await fixtureManifest(bytes);
		const deferredSession = new Deferred<LocalVadSession>();
		const createSession = vi.fn(() => deferredSession.promise);
		const runtime: LocalVadRuntime = {
			protocolVersion: 1,
			runtimeId: "fixture-vad",
			runtimeVersion: "1.0.0",
			Tensor: FixtureTensor,
			createSession,
		};
		const modelPackage: LocalVoiceModelPackage<LocalVadRuntime> = {
			manifest,
			runtime,
			bundledModelBytes: bytes,
		};
		const vad = new SileroVad(settings, modelPackage);
		const loading = vad.load();
		await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());
		vad.dispose();
		const release = vi.fn(async () => undefined);
		deferredSession.resolve({
			inputNames: ["input", "state", "sr"],
			outputNames: ["output", "stateN"],
			run: vi.fn(async () => ({})),
			release,
		});

		await expect(loading).rejects.toThrow("加载已取消");
		expect(release).toHaveBeenCalledOnce();
		expect(vad.isReady()).toBe(false);
	});

	it("runs only after a verified model reaches the static runtime", async () => {
		const bytes = new TextEncoder().encode("vad-process");
		const manifest = await fixtureManifest(bytes);
		const session: LocalVadSession = {
			inputNames: ["input", "state", "sr"],
			outputNames: ["output", "stateN"],
			run: vi.fn(async () => ({
				output: new FixtureTensor("float32", new Float32Array([0.8])),
				stateN: new FixtureTensor("float32", new Float32Array(256)),
			})),
		};
		const createSession = vi.fn(async () => session);
		const runtime: LocalVadRuntime = {
			protocolVersion: 1,
			runtimeId: "fixture-vad",
			runtimeVersion: "1.0.0",
			Tensor: FixtureTensor,
			createSession,
		};
		const vad = new SileroVad(settings, {
			manifest,
			runtime,
			bundledModelBytes: bytes,
		});
		await vad.load();
		await expect(vad.process(new Float32Array(SILERO_WINDOW))).resolves.toBeCloseTo(0.8);
		expect(createSession).toHaveBeenCalledWith(bytes, {
			executionProviders: ["wasm"],
			graphOptimizationLevel: "all",
		});
		vad.dispose();
	});

	it("discards an inference result that resolves after VAD state reset", async () => {
		const bytes = new TextEncoder().encode("vad-stale-state");
		const manifest = await fixtureManifest(bytes);
		const deferred = new Deferred<Record<string, LocalVadTensorLike>>();
		const run = vi.fn(() => deferred.promise);
		const session: LocalVadSession = {
			inputNames: ["input", "state", "sr"],
			outputNames: ["output", "stateN"],
			run,
		};
		const vad = new SileroVad(settings, {
			manifest,
			runtime: {
				protocolVersion: 1,
				runtimeId: "fixture-vad",
				runtimeVersion: "1.0.0",
				Tensor: FixtureTensor,
				createSession: vi.fn(async () => session),
			},
			bundledModelBytes: bytes,
		});
		await vad.load();
		const processing = vad.process(new Float32Array(SILERO_WINDOW));
		await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
		vad.resetState();
		deferred.resolve({
			output: new FixtureTensor("float32", new Float32Array([0.9])),
			stateN: new FixtureTensor("float32", new Float32Array(256)),
		});

		await expect(processing).rejects.toThrow("推理结果已过期");
		vad.dispose();
	});

	it("uses a verified bundled VAD model without network consent", async () => {
		const bytes = new TextEncoder().encode("offline-vad");
		const manifest = await fixtureManifest(bytes);
		const createSession = vi.fn(async () => ({
			inputNames: ["input", "state", "sr"],
			outputNames: ["output", "stateN"],
			run: vi.fn(async () => ({})),
		}));
		const fetchNetworkModelBytes = vi.fn(async () => bytes);
		const vad = new SileroVad(
			{ ...settings, quyuanVadNetworkConsent: false },
			{
				manifest,
				runtime: {
					protocolVersion: 1,
					runtimeId: "fixture-vad",
					runtimeVersion: "1.0.0",
					Tensor: FixtureTensor,
					createSession,
				},
				bundledModelBytes: bytes,
				fetchNetworkModelBytes,
			}
		);

		await expect(vad.load()).resolves.toBeUndefined();
		expect(createSession).toHaveBeenCalledOnce();
		expect(fetchNetworkModelBytes).not.toHaveBeenCalled();
		vad.dispose();
	});
});

describe("static runtime and license contract", () => {
	it("contains no dynamic JavaScript loader or custom CDN consumption", () => {
		for (const relative of [
			"src/quyuan/local-asr.ts",
			"src/quyuan/sherpa-local-asr-runtime.ts",
			"src/quyuan/silero-vad.ts",
		]) {
			const source = readFileSync(`${projectRoot}${relative}`, "utf8");
			expect(source).not.toMatch(/\bimport\s*\(/);
			expect(source).not.toMatch(/\bfetch\s*\(/);
			expect(source).not.toContain("requestUrl");
			expect(source).not.toContain("quyuanLocalAsrCdn");
			expect(source).not.toContain("quyuanVadCdn");
		}
	});

	it("pins the static Sherpa runtime/model revisions and preserves their licenses", () => {
		const notice = readFileSync(
			`${projectRoot}src/quyuan/vendor/local-voice-runtime/NOTICE.md`,
			"utf8"
		);
		const projectNotice = readFileSync(`${projectRoot}THIRD-PARTY-NOTICES.md`, "utf8");
		const runtime = readFileSync(
			`${projectRoot}src/quyuan/sherpa-local-asr-runtime.ts`,
			"utf8"
		);
		expect(notice).toContain("Project: sherpa-onnx");
		expect(notice).toContain("Version: 1.13.6");
		expect(notice).toContain("e2382758de9a0219b4efe682b95af30b399db3b8");
		expect(notice).toContain("SHA-256");
		expect(notice).toContain("Apache-2.0");
		expect(notice).toContain("MIT");
		expect(runtime).toContain("49d1a11fb0c582b93e2b5bcd4fdfacb9b50614c1d4f3edc8648b20bcebb99cd0");
		expect(runtime).toContain('Object.defineProperty(self, "process"');
		expect(projectNotice).toContain("src/quyuan/vendor/local-voice-runtime/NOTICE.md");
	});
});
