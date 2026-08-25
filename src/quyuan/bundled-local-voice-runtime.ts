import type {
	LocalAsrModelPackage,
	LocalVadRuntime,
	LocalVoiceModelPackage,
} from "./local-voice-supply-chain";

import {
	assertPinnedVoiceModelManifest,
} from "./local-voice-supply-chain";
import {
	createSherpaLocalAsrRuntime,
	type LocalVoiceAssetReader,
} from "./sherpa-local-asr-runtime";

const MODEL_REPOSITORY =
	"https://huggingface.co/csukuangfj/k2fsa-zipformer-bilingual-zh-en-t";
const MODEL_REVISION = "e2382758de9a0219b4efe682b95af30b399db3b8";
const MODEL_NOTICE =
	"k2fsa Zipformer bilingual zh-en model; Apache-2.0; fixed Hugging Face revision e2382758.";

export const BUNDLED_LOCAL_ASR_MANIFESTS = Object.freeze([
	assertPinnedVoiceModelManifest({
		protocolVersion: 1,
		id: "k2fsa-zipformer-zh-en-encoder-int8-chunk-32",
		version: MODEL_REVISION,
		fileName: "encoder-epoch-99-avg-1.int8.onnx",
		sha256: "db6f51551762e40e549166fe041ea3e45464370b595e9ad23f06478ec3794fbb",
		downloadUrl: `${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/exp/32/encoder-epoch-99-avg-1.int8.onnx`,
		licenseId: "Apache-2.0",
		notice: MODEL_NOTICE,
	}),
	assertPinnedVoiceModelManifest({
		protocolVersion: 1,
		id: "k2fsa-zipformer-zh-en-decoder-fp32-chunk-32",
		version: MODEL_REVISION,
		fileName: "decoder-epoch-99-avg-1.onnx",
		sha256: "89be509a83175261695bdef5fd1c7b9ab1129a663d1284e7ba9f8507b21e0906",
		downloadUrl: `${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/exp/32/decoder-epoch-99-avg-1.onnx`,
		licenseId: "Apache-2.0",
		notice: MODEL_NOTICE,
	}),
	assertPinnedVoiceModelManifest({
		protocolVersion: 1,
		id: "k2fsa-zipformer-zh-en-joiner-int8-chunk-32",
		version: MODEL_REVISION,
		fileName: "joiner-epoch-99-avg-1.int8.onnx",
		sha256: "bdda356d6f9b8c2d7cee9ee0e26075fa537490f7fd06520be408d287073667b9",
		downloadUrl: `${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/exp/32/joiner-epoch-99-avg-1.int8.onnx`,
		licenseId: "Apache-2.0",
		notice: MODEL_NOTICE,
	}),
	assertPinnedVoiceModelManifest({
		protocolVersion: 1,
		id: "k2fsa-zipformer-zh-en-tokens",
		version: MODEL_REVISION,
		fileName: "tokens.txt",
		sha256: "a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3",
		downloadUrl: `${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/data/lang_char_bpe/tokens.txt`,
		licenseId: "Apache-2.0",
		notice: MODEL_NOTICE,
	}),
]);

export function createBundledLocalAsrPackage(
	readAsset: LocalVoiceAssetReader
): LocalAsrModelPackage {
	return {
		manifests: BUNDLED_LOCAL_ASR_MANIFESTS,
		runtime: createSherpaLocalAsrRuntime(readAsset),
		readBundledModelBytes: (manifest) => readAsset(manifest.fileName),
	};
}

// Silero stays fail-closed until its independently reviewed runtime/model is
// supplied; ASR availability must never weaken the VAD supply-chain boundary.
export const BUNDLED_SILERO_VAD_PACKAGE: LocalVoiceModelPackage<LocalVadRuntime> | null = null;

export const LOCAL_VOICE_RUNTIME_BOUNDARY = Object.freeze({
	protocolVersion: 1,
	runtimeDelivery: "build-time-static",
	dynamicRemoteJavaScript: false,
	modelIntegrity: "sha256-required",
	asrRuntime: "sherpa-onnx-browser-wasm@1.13.6",
	asrModelRevision: MODEL_REVISION,
});

