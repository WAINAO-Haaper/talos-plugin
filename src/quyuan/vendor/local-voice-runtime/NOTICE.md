# TALOS local ASR runtime notice

The TALOS local ASR integration uses a fixed, browser-only Sherpa-ONNX WebAssembly
runtime in a dedicated Web Worker. Runtime JavaScript is embedded at build time;
WASM and model files are read only from the plugin's `voice-runtime/` directory,
verified before microphone acquisition, and never downloaded by the runtime.

## Runtime

- Project: sherpa-onnx
- Version: 1.13.6
- Browser snapshot revision: `7c59b5225b857366f0a8c0cc1783ace8e9f193ac`
- Upstream release revision: `1cb484af`
- License: Apache-2.0
- Embedded ONNX Runtime: 1.27.1, MIT
- Browser glue SHA-256: `864bd45b63586a752c2d26a02dfb3e40d4f2e15839aa85b7e84af0ccc1b5619e`
- ASR wrapper SHA-256: `d51ae8e8b756ee5e53423ffada0c9702973f154f561aca7984fe0b12f4060178`
- WASM SHA-256: `49d1a11fb0c582b93e2b5bcd4fdfacb9b50614c1d4f3edc8648b20bcebb99cd0`

The two JavaScript snapshots are unmodified upstream files. TALOS adds its own
worker driver around them; it bypasses the upstream demo data package and mounts
only the independently verified files listed in `asset-manifest.json`.

## Model

- Project: `csukuangfj/k2fsa-zipformer-bilingual-zh-en-t`
- Revision: `e2382758de9a0219b4efe682b95af30b399db3b8`
- Variant: streaming transducer, chunk 32, int8 encoder/joiner with FP32 decoder
- License declared by the model repository: Apache-2.0
- Integrity: every ONNX/tokens file has an exact byte count and SHA-256 in
  `asset-manifest.json`; a single mismatch prevents the Worker from starting.

The model card says the model was trained on tens of thousands of hours of an
internal dataset. Apache-2.0 covers the published artifact, but that limited data
provenance disclosure must be reviewed independently before commercial release.

## Included license texts

- `LICENSE-SHERPA-ONNX-APACHE-2.0.txt`
- `LICENSE-ONNXRUNTIME-MIT.txt`

No runtime JavaScript, WASM, model, audio, transcript, or telemetry is fetched
from a CDN or remote service during recognition.
