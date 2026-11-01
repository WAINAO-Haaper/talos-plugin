# Local media recognition adapter

`src/module-commands/media-recognition.ts` supplies a read-only adapter for the
existing `media.ocr` and `media.transcribe` module actions. It does not add a
view, create Markdown, install a model, access a provider credential, or send
the media to a network service. The caller displays `result.text` in the
existing result area and may use the existing note creation flow only after a
separate user decision.

## Wiring

Construct `LocalMediaRecognition` with the desktop Vault's absolute base path.
Pass only a validated Vault-relative `path` from the existing module form to
`recognize(actionId, path, signal)`. `unavailable(actionId)` returns an honest
reason to disable an action before execution; it is asynchronous because it
checks configured executables and the model file. Recheck when preparing the
action and propagate its error rather than reporting an empty recognition as a
success.

On macOS, `media.ocr` invokes fixed Swift code using the system Vision API.
It accepts PNG, JPEG, GIF, TIFF and HEIC with matching file signatures. The
action is unavailable on other platforms. Vision produced `TALOS 4268` from a
synthetic PNG in the opt-in native test on 2026-09-28.

`media.transcribe` requires three explicit local paths: a compatible
`whisper.cpp` `whisper-cli`, a local fixed model, and FFmpeg. The adapter
converts WAV, AIFF, MP3, M4A, MP4, MOV or WebM to mono 16 kHz PCM, then invokes
the configured CLI with fixed arguments and reads its text output. Video must
contain an audio stream. The host used for development had FFmpeg but no
Whisper CLI or model; semantic transcription remains untested there. The test
fixture proves only the argument and output-file protocol. Live voice uses the
separate Qwen Realtime session; the retired Sherpa browser ASR path is not part
of this adapter.

### macOS Speech authorization boundary

Apple's [Speech authorization API](https://developer.apple.com/documentation/speech/sfspeechrecognizer/requestauthorization(_:))
requires the responsible app's `Info.plist` to contain
`NSSpeechRecognitionUsageDescription`; without it, requesting permission
crashes the process. The installed Obsidian app inspected on 2026-09-28 had a
microphone usage description but no Speech Recognition usage description. A
Swift child process had no such metadata. Even a temporary signed helper with
the description was terminated by macOS TCC when launched as a child of the
current host; the crash report identified the responsible host as missing the
usage description. No prompt appeared and no media was read in that check.

Consequently this candidate does not invoke macOS Speech or offer a permission
button for it. There is currently **no safe in-plugin click that triggers the
Speech authorization prompt**. A user can inspect System Settings → Privacy &
Security → Speech Recognition, but cannot make this plugin's child-process
route valid merely by toggling a setting. A future packaged, independently
identified helper would need its own usage description, authorization and
on-device support verified in the actual Obsidian host before it could replace
the explicit Whisper CLI route. Apple's
[on-device property](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)
also requires `supportsOnDeviceRecognition`; permission alone would not prove
audio stays local.

Both actions copy an input only after Vault-relative, realpath, symlink,
regular-file and size checks. The private temporary copy is deleted after the
process completes or fails. Child processes receive fixed argument arrays with
no shell; FFmpeg receives only `file,pipe` protocols. OCR inputs are capped at
20 MiB, audio/video inputs at 50 MiB, and transcription processes at most the
first 30 minutes. An `AbortSignal` cancels a running child. The result is
untrusted extracted text and should be checked against the original media.
