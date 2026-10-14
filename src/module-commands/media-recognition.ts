import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validateVaultRelativePath } from "./data-format";

export type MediaRecognitionAction = "media.ocr" | "media.transcribe";

export interface MediaRecognitionOptions {
	/** Absolute path to the current desktop Vault, never a note supplied path. */
	vaultRoot: string;
	/** Optional, explicitly selected local whisper.cpp executable and model. */
	whisperCli?: string;
	whisperModel?: string;
	/** Required for audio/video conversion when whisper.cpp is selected. */
	ffmpegCli?: string;
}

export interface MediaRecognitionResult {
	actionId: MediaRecognitionAction;
	path: string;
	text: string;
	engine: "macos-vision" | "whisper.cpp";
	warnings: string[];
}

const IMAGE_LIMIT = 20 * 1024 * 1024;
const MEDIA_LIMIT = 50 * 1024 * 1024;
const WAV_LIMIT = 64 * 1024 * 1024;
const TEXT_LIMIT = 1024 * 1024;
const EXEC_ENV = Object.freeze({
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
	LANG: "en_US.UTF-8",
	TMPDIR: tmpdir(),
});

// The source is fixed in the plugin bundle; no user text or Vault path is
// interpolated into Swift code. Vision processes only the private staged copy.
const VISION_SWIFT = [
	"import Foundation",
	"import Vision",
	"import ImageIO",
	"struct Payload: Encodable { let text: String }",
	"guard CommandLine.arguments.count == 2 else { exit(2) }",
	"let url = URL(fileURLWithPath: CommandLine.arguments[1])",
	"guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),",
	"      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(3) }",
	"let request = VNRecognizeTextRequest()",
	"request.recognitionLevel = .accurate",
	"request.usesLanguageCorrection = true",
	"request.automaticallyDetectsLanguage = true",
	"do {",
	"  try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])",
	"  let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: \"\\n\")",
	"  let data = try JSONEncoder().encode(Payload(text: text))",
	"  guard let output = String(data: data, encoding: .utf8) else { exit(4) }",
	"  print(output)",
	"} catch { exit(5) }",
].join("\n");

function cancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("媒体识别已取消");
}

function inside(root: string, path: string): boolean {
	const rest = relative(root, path);
	return rest !== "" && rest !== ".." && !rest.startsWith(".." + sep) && !isAbsolute(rest);
}

async function executable(path: string | undefined, label: string): Promise<string> {
	if (!path || !isAbsolute(path)) throw new Error(label + "未配置为绝对可执行文件路径");
	try {
		const target = await realpath(path);
		const info = await stat(target);
		if (!info.isFile() || (info.mode & 0o111) === 0) throw new Error("not executable");
		return target;
	} catch {
		throw new Error(label + "不可用；请在本机安装并配置有效路径");
	}
}

async function model(path: string | undefined): Promise<string> {
	if (!path || !isAbsolute(path)) throw new Error("请配置本机 whisper.cpp 固定模型的绝对路径");
	try {
		const target = await realpath(path);
		const info = await stat(target);
		if (!info.isFile() || info.size === 0) throw new Error("invalid model");
		return target;
	} catch {
		throw new Error("本机 whisper.cpp 模型文件不存在或无法读取");
	}
}

function mediaType(path: string, bytes: Uint8Array, action: MediaRecognitionAction): string {
	const extension = basename(path).split(".").pop()?.toLowerCase() ?? "";
	const ascii = (start: number, length: number): string =>
		Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
	if (action === "media.ocr") {
		if (extension === "png" && bytes.length >= 8 && ascii(1, 3) === "PNG") return "png";
		if (["jpg", "jpeg"].includes(extension) && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
		if (extension === "gif" && ascii(0, 4) === "GIF8") return "gif";
		if (["tif", "tiff"].includes(extension) && (ascii(0, 4) === "II*\u0000" || ascii(0, 4) === "MM\u0000*")) return "tiff";
		if (["heic", "heif"].includes(extension) && ascii(4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|mif1)$/u.test(ascii(8, 4))) return "heic";
		throw new Error("图片格式不受支持或文件签名与扩展名不符（PNG、JPEG、GIF、TIFF、HEIC）");
	}
	if (extension === "wav" && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
	if (["aif", "aiff"].includes(extension) && ascii(0, 4) === "FORM" && ["AIFF", "AIFC"].includes(ascii(8, 4))) return "aiff";
	if (extension === "mp3" && (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))) return "mp3";
	if (["m4a", "mp4", "mov"].includes(extension) && ascii(4, 4) === "ftyp") return "mov";
	if (extension === "webm" && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "matroska";
	throw new Error("音视频格式不受支持或文件签名与扩展名不符（WAV、AIFF、MP3、M4A、MP4、MOV、WebM）");
}

/** Read a stable, bounded copy only after lexical, realpath and symlink checks. */
export async function readVaultMediaBytes(root: string, rawPath: string, maximum: number): Promise<Uint8Array> {
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MEDIA_LIMIT) throw new Error("媒体读取上限无效");
	const path = validateVaultRelativePath(rawPath);
	if (!isAbsolute(root)) throw new Error("Vault 根目录必须是绝对路径");
	const realRoot = await realpath(root).catch(() => { throw new Error("Vault 根目录不可读取"); });
	const target = resolve(realRoot, path);
	if (!inside(realRoot, target)) throw new Error("媒体文件不在当前 Vault 内");
	let current = realRoot;
	for (const segment of path.split("/")) {
		current = join(current, segment);
		const info = await lstat(current).catch(() => { throw new Error("媒体文件无法读取"); });
		if (info.isSymbolicLink()) throw new Error("媒体路径含符号链接，已拒绝读取");
	}
	const realTarget = await realpath(target).catch(() => { throw new Error("媒体文件无法读取"); });
	if (!inside(realRoot, realTarget)) throw new Error("媒体文件真实路径越过当前 Vault");
	const pathInfo = await lstat(target).catch(() => { throw new Error("媒体文件无法读取"); });
	const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => { throw new Error("媒体文件无法读取"); });
	try {
		const before = await handle.stat();
		if (before.dev !== pathInfo.dev || before.ino !== pathInfo.ino) throw new Error("读取期间媒体路径发生变化");
		if (!before.isFile() || before.size === 0 || before.size > maximum) throw new Error("媒体文件为空或超过本地识别大小限制");
		const bytes = Buffer.alloc(before.size);
		let offset = 0;
		while (offset < bytes.length) {
			const read = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (read.bytesRead === 0) throw new Error("读取期间媒体文件发生变化");
			offset += read.bytesRead;
		}
		const after = await handle.stat();
		const finalPathInfo = await lstat(target).catch(() => { throw new Error("读取期间媒体路径发生变化"); });
		if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino
			|| finalPathInfo.ino !== before.ino || finalPathInfo.dev !== before.dev) {
			throw new Error("读取期间媒体文件发生变化");
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

async function command(commandPath: string, args: string[], signal: AbortSignal | undefined, timeout: number, label: string): Promise<string> {
	cancelled(signal);
	return new Promise<string>((resolve, reject) => {
		execFile(commandPath, args, {
			env: EXEC_ENV, encoding: "utf8", windowsHide: true,
			maxBuffer: TEXT_LIMIT, timeout, killSignal: "SIGTERM", signal,
		}, (error, stdout) => {
			if (signal?.aborted) reject(new Error("媒体识别已取消"));
			else if (error) reject(new Error(label + ("killed" in error && error.killed ? "超时或输出过大" : "执行失败")));
			else resolve(stdout);
		});
	});
}

/** Offline, read-only desktop adapter. It never writes a Vault note. */
export class LocalMediaRecognition {
	constructor(private readonly options: MediaRecognitionOptions) {}

	async unavailable(actionId: MediaRecognitionAction): Promise<string | null> {
		try {
			if (actionId === "media.ocr") {
				if (process.platform !== "darwin") return "本机 Vision OCR 仅在 macOS 桌面端可用";
				await executable("/usr/bin/swift", "macOS Swift/Vision");
			} else {
				await executable(this.options.whisperCli, "whisper.cpp CLI");
				await model(this.options.whisperModel);
				await executable(this.options.ffmpegCli, "FFmpeg");
			}
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : "本机识别引擎不可用";
		}
	}

	async recognize(actionId: MediaRecognitionAction, rawPath: string, signal?: AbortSignal): Promise<MediaRecognitionResult> {
		cancelled(signal);
		const unavailable = await this.unavailable(actionId);
		if (unavailable) throw new Error(unavailable);
		const bytes = await readVaultMediaBytes(this.options.vaultRoot, rawPath, actionId === "media.ocr" ? IMAGE_LIMIT : MEDIA_LIMIT);
		const format = mediaType(rawPath, bytes, actionId);
		cancelled(signal);
		const directory = await mkdtemp(join(tmpdir(), "talos-media-"));
		try {
			await chmod(directory, 0o700);
			const input = join(directory, "source." + basename(rawPath).split(".").pop()?.toLowerCase());
			await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
			let text: string;
			if (actionId === "media.ocr") {
				const stdout = await command("/usr/bin/swift", ["-module-cache-path", join(directory, "swift-cache"), "-e", VISION_SWIFT, input], signal, 120_000, "本机 OCR ");
				let payload: unknown;
				try { payload = JSON.parse(stdout); } catch { throw new Error("本机 OCR 返回无效结果"); }
				if (!payload || typeof payload !== "object" || !("text" in payload) || typeof payload.text !== "string") throw new Error("本机 OCR 返回无效结果");
				text = payload.text.trim();
			} else {
				const wav = join(directory, "audio.wav");
				const ffmpeg = await executable(this.options.ffmpegCli, "FFmpeg");
				await command(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file,pipe", "-f", format, "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-t", "1800", "-f", "wav", wav], signal, 180_000, "本机音频转换 ");
				if ((await stat(wav)).size > WAV_LIMIT) throw new Error("音频转换结果超过64 MiB，请缩短素材");
				const transcriptBase = join(directory, "transcript");
				const whisper = await executable(this.options.whisperCli, "whisper.cpp CLI");
				const modelPath = await model(this.options.whisperModel);
				await command(whisper, ["-m", modelPath, "-f", wav, "-l", "auto", "-otxt", "-of", transcriptBase], signal, 600_000, "本机转录 ");
				const output = await stat(transcriptBase + ".txt");
				if (!output.isFile() || output.size > TEXT_LIMIT) throw new Error("本机转录结果无效或过大");
				text = (await readFile(transcriptBase + ".txt", "utf8")).trim();
			}
			cancelled(signal);
			return {
				actionId, path: validateVaultRelativePath(rawPath), text,
				engine: actionId === "media.ocr" ? "macos-vision" : "whisper.cpp",
				warnings: text ? (actionId === "media.transcribe" ? ["音视频仅处理前30分钟；请核对识别文字与原件。"] : ["请核对识别文字与原图。"] ) : ["引擎运行完成，但未识别出文字。"],
			};
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}
