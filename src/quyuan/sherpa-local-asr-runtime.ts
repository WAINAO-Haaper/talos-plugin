import sherpaAsrSource from "./vendor/local-voice-runtime/sherpa-onnx-asr.vendor.txt";
import sherpaWasmSource from "./vendor/local-voice-runtime/sherpa-onnx-wasm-main-asr.vendor.txt";
import {
	LOCAL_VOICE_ASSET_PROTOCOL_VERSION,
	sha256Hex,
	type LocalAsrRuntime,
	type LocalAsrTranscriber,
} from "./local-voice-supply-chain";

export const SHERPA_ONNX_RUNTIME_VERSION = "1.13.6";
export const SHERPA_ONNX_RUNTIME_REVISION =
	"7c59b5225b857366f0a8c0cc1783ace8e9f193ac";
export const SHERPA_ONNX_WASM_FILE = "sherpa-onnx-wasm-main-asr.wasm";
export const SHERPA_ONNX_WASM_BYTES = 13_148_431;
export const SHERPA_ONNX_WASM_SHA256 =
	"49d1a11fb0c582b93e2b5bcd4fdfacb9b50614c1d4f3edc8648b20bcebb99cd0";

const WORKER_INIT_TIMEOUT_MS = 60_000;
const WORKER_REQUEST_TIMEOUT_MS = 60_000;

const MODEL_FILE_TARGETS = Object.freeze({
	"encoder-epoch-99-avg-1.int8.onnx": "encoder.onnx",
	"decoder-epoch-99-avg-1.onnx": "decoder.onnx",
	"joiner-epoch-99-avg-1.int8.onnx": "joiner.onnx",
	"tokens.txt": "tokens.txt",
} as const);

type SherpaModelFileName = keyof typeof MODEL_FILE_TARGETS;

export type LocalVoiceAssetReader = (
	fileName: string
) => Promise<Uint8Array | null>;

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

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

function workerPreamble(wasmUrl: string): string {
	return `
// Obsidian/Electron leaks a Node-like process object into browser Workers.
// Emscripten would otherwise use fs and treat the blob URL as a local path.
// Mask it only inside this dedicated Worker before vendor code executes.
try {
  Object.defineProperty(self, "process", { value: undefined, configurable: true });
} catch (_) {
  self.process = undefined;
}
var Module = {
  getPreloadedPackage: function() { return new ArrayBuffer(0); },
  locateFile: function(path) {
    return path.endsWith(".wasm") ? ${JSON.stringify(wasmUrl)} : path;
  },
  print: function() {},
  printErr: function(message) {
    self.postMessage({ type: "runtime-log", message: String(message) });
  },
  onAbort: function(reason) {
    self.postMessage({ type: "fatal", message: "WASM 已中止：" + String(reason) });
  },
  onRuntimeInitialized: function() {
    self.postMessage({ type: "runtime-ready" });
  }
};
`;
}

const SHERPA_WORKER_DRIVER = String.raw`
let talosRecognizer = null;
let talosStream = null;
let talosStreamId = "";
let talosProcessedSamples = 0;

function talosError(error) {
  return error && error.message ? String(error.message) : String(error);
}

function talosFreeStream() {
  if (talosStream) {
    talosStream.free();
    talosStream = null;
  }
  talosStreamId = "";
  talosProcessedSamples = 0;
}

function talosDrain() {
  while (talosRecognizer.isReady(talosStream)) {
    talosRecognizer.decode(talosStream);
  }
  const result = talosRecognizer.getResult(talosStream);
  return result && typeof result.text === "string" ? result.text : "";
}

function talosMount(targetName, buffer) {
  const path = "/" + targetName;
  try { Module.FS_unlink(path); } catch (_) {}
  Module.FS_createDataFile("/", targetName, new Uint8Array(buffer), true, true, true);
}

function talosCreateRecognizer() {
  return createOnlineRecognizer(Module, {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: "./encoder.onnx",
        decoder: "./decoder.onnx",
        joiner: "./joiner.onnx"
      },
      paraformer: { encoder: "", decoder: "" },
      zipformer2Ctc: { model: "" },
      nemoCtc: { model: "" },
      toneCtc: { model: "" },
      tokens: "./tokens.txt",
      numThreads: 1,
      provider: "cpu",
      debug: 0,
      modelType: "",
      modelingUnit: "cjkchar",
      bpeVocab: ""
    },
    decodingMethod: "greedy_search",
    maxActivePaths: 4,
    enableEndpoint: 0,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
    hotwordsFile: "",
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: { graph: "", maxActive: 3000 },
    ruleFsts: "",
    ruleFars: ""
  });
}

self.onmessage = function(event) {
  const message = event.data || {};
  try {
    if (message.type === "init-models") {
      for (const file of message.files || []) {
        talosMount(file.targetName, file.buffer);
      }
      talosRecognizer = talosCreateRecognizer();
      if (!talosRecognizer || !talosRecognizer.handle) {
        throw new Error("Sherpa 识别器创建失败");
      }
      self.postMessage({ type: "models-ready" });
      return;
    }
    if (message.type === "transcribe") {
      if (!talosRecognizer) throw new Error("Sherpa 识别器尚未就绪");
      const samples = new Float32Array(message.audio);
      if (!talosStream || talosStreamId !== message.streamId ||
          samples.length < talosProcessedSamples) {
        talosFreeStream();
        talosStream = talosRecognizer.createStream();
        talosStreamId = message.streamId;
      }
      const suffix = samples.subarray(talosProcessedSamples);
      if (suffix.length > 0) {
        talosStream.acceptWaveform(message.sampleRate, suffix);
        talosProcessedSamples = samples.length;
      }
      let text = talosDrain();
      if (message.phase === "final") {
        talosStream.acceptWaveform(16000, new Float32Array(16000));
        talosStream.inputFinished();
        text = talosDrain();
        talosFreeStream();
      }
      self.postMessage({ type: "result", id: message.id, text: text });
      return;
    }
    throw new Error("未知的本地 ASR Worker 消息");
  } catch (error) {
    self.postMessage({ type: "request-error", id: message.id, message: talosError(error) });
  }
};
`;

interface WorkerResponse {
	type?: string;
	id?: number;
	text?: string;
	message?: string;
}

class SherpaWorkerClient {
	private readonly runtimeReady = deferred<void>();
	private readonly modelsReady = deferred<void>();
	private readonly pending = new Map<
		number,
		{ resolve: (text: string) => void; reject: (error: Error) => void }
	>();
	private nextId = 1;
	private disposed = false;

	private constructor(
		private readonly worker: Worker,
		private readonly workerUrl: string,
		private readonly wasmUrl: string
	) {
		worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
			this.onMessage(event.data);
		};
		worker.onerror = (event: ErrorEvent): void => {
			this.failAll(new Error(event.message || "本地 ASR Worker 崩溃"));
		};
	}

	static async create(
		wasmBytes: Uint8Array,
		modelBytesByFileName: ReadonlyMap<string, Uint8Array>
	): Promise<SherpaWorkerClient> {
		const wasmUrl = URL.createObjectURL(new Blob([wasmBytes.slice().buffer], {
			type: "application/wasm",
		}));
		const source = [
			workerPreamble(wasmUrl),
			sherpaWasmSource,
			"\n",
			sherpaAsrSource,
			"\n",
			SHERPA_WORKER_DRIVER,
		].join("");
		const workerUrl = URL.createObjectURL(new Blob([source], {
			type: "application/javascript",
		}));
		const client = new SherpaWorkerClient(new Worker(workerUrl), workerUrl, wasmUrl);
		try {
			await withTimeout(
				client.runtimeReady.promise,
				WORKER_INIT_TIMEOUT_MS,
				"本地 ASR WASM 初始化超时"
			);
			URL.revokeObjectURL(client.wasmUrl);
			const files: Array<{ targetName: string; buffer: ArrayBuffer }> = [];
			for (const [fileName, targetName] of Object.entries(MODEL_FILE_TARGETS)) {
				const bytes = modelBytesByFileName.get(fileName);
				if (!bytes) throw new Error(`本地 ASR 缺少固定模型文件：${fileName}`);
				files.push({ targetName, buffer: bytes.slice().buffer });
			}
			client.worker.postMessage(
				{ type: "init-models", files },
				files.map((file) => file.buffer)
			);
			await withTimeout(
				client.modelsReady.promise,
				WORKER_INIT_TIMEOUT_MS,
				"本地 ASR 模型初始化超时"
			);
			URL.revokeObjectURL(client.workerUrl);
			return client;
		} catch (error) {
			client.dispose();
			throw error;
		}
	}

	private onMessage(message: WorkerResponse): void {
		if (message.type === "runtime-ready") {
			this.runtimeReady.resolve();
			return;
		}
		if (message.type === "models-ready") {
			this.modelsReady.resolve();
			return;
		}
		if (message.type === "runtime-log") {
			console.warn("[TALOS 屈原] 本地 ASR 运行时：", message.message ?? "");
			return;
		}
		if (message.type === "fatal") {
			this.failAll(new Error(message.message || "本地 ASR WASM 已中止"));
			return;
		}
		if (message.id === undefined) return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (message.type === "request-error") {
			pending.reject(new Error(message.message || "本地 ASR 推理失败"));
		} else if (message.type === "result") {
			pending.resolve(message.text ?? "");
		}
	}

	private failAll(error: Error): void {
		this.runtimeReady.reject(error);
		this.modelsReady.reject(error);
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	async transcribe(
		audio: Float32Array,
		options: Parameters<LocalAsrTranscriber>[1]
	): Promise<{ text: string }> {
		if (this.disposed) throw new Error("本地 ASR 运行时已释放");
		const id = this.nextId++;
		const result = deferred<string>();
		this.pending.set(id, result);
		const copied = audio.slice();
		this.worker.postMessage({
			type: "transcribe",
			id,
			audio: copied.buffer,
			sampleRate: options.sampleRate,
			streamId: options.streamId,
			phase: options.phase,
		}, [copied.buffer]);
		try {
			const text = await withTimeout(
				result.promise,
				WORKER_REQUEST_TIMEOUT_MS,
				"本地 ASR Worker 推理超时"
			);
			return { text };
		} finally {
			this.pending.delete(id);
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.failAll(new Error("本地 ASR 运行时已释放"));
		this.worker.terminate();
		URL.revokeObjectURL(this.workerUrl);
		URL.revokeObjectURL(this.wasmUrl);
	}
}

export function createSherpaLocalAsrRuntime(
	readAsset: LocalVoiceAssetReader
): LocalAsrRuntime {
	return {
		protocolVersion: LOCAL_VOICE_ASSET_PROTOCOL_VERSION,
		runtimeId: "sherpa-onnx-browser-wasm",
		runtimeVersion: SHERPA_ONNX_RUNTIME_VERSION,
		async createTranscriber(modelBytesByFileName): Promise<LocalAsrTranscriber> {
			const wasmBytes = await readAsset(SHERPA_ONNX_WASM_FILE);
			if (!wasmBytes) {
				throw new Error(`本地 ASR 缺少固定运行时文件：${SHERPA_ONNX_WASM_FILE}`);
			}
			if (wasmBytes.byteLength !== SHERPA_ONNX_WASM_BYTES) {
				throw new Error("本地 ASR WASM 字节数校验失败");
			}
			if (await sha256Hex(wasmBytes) !== SHERPA_ONNX_WASM_SHA256) {
				throw new Error("本地 ASR WASM SHA-256 校验失败");
			}
			for (const fileName of Object.keys(MODEL_FILE_TARGETS) as SherpaModelFileName[]) {
				if (!modelBytesByFileName.has(fileName)) {
					throw new Error(`本地 ASR 缺少固定模型文件：${fileName}`);
				}
			}
			const client = await SherpaWorkerClient.create(wasmBytes, modelBytesByFileName);
			const transcriber: LocalAsrTranscriber = (audio, options) =>
				client.transcribe(audio, options);
			transcriber.dispose = (): void => client.dispose();
			return transcriber;
		},
	};
}
