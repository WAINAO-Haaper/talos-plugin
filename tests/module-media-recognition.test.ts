import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMediaRecognition, readVaultMediaBytes } from "../src/module-commands/media-recognition";

const tempRoots: string[] = [];

async function fixture(): Promise<{ root: string; vault: string }> {
	const root = await mkdtemp(join(tmpdir(), "talos-media-test-"));
	tempRoots.push(root);
	const vault = join(root, "vault");
	await mkdir(join(vault, "Assets"), { recursive: true });
	return { root, vault };
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("local media recognition boundary", () => {
	it("copies a bounded Vault file and refuses traversal, symlinks and oversized content", async () => {
		const { root, vault } = await fixture();
		await writeFile(join(vault, "Assets", "inside.png"), Buffer.from("trusted"));
		await writeFile(join(root, "outside.png"), Buffer.from("private"));
		await symlink(join(root, "outside.png"), join(vault, "Assets", "linked.png"));
		expect(await readVaultMediaBytes(vault, "Assets/inside.png", 8)).toEqual(Buffer.from("trusted"));
		await expect(readVaultMediaBytes(vault, "Assets/../outside.png", 8)).rejects.toThrow();
		await expect(readVaultMediaBytes(vault, "Assets/linked.png", 8)).rejects.toThrow(/符号链接/);
		await expect(readVaultMediaBytes(vault, "Assets/inside.png", 6)).rejects.toThrow(/大小限制/);
	});

	it("reports an unconfigured local transcriber without reading media or invoking a model", async () => {
		const { vault } = await fixture();
		const engine = new LocalMediaRecognition({ vaultRoot: vault });
		expect(await engine.unavailable("media.transcribe")).toMatch(/whisper.cpp CLI/);
		await expect(engine.recognize("media.transcribe", "Assets/no-file.wav")).rejects.toThrow(/whisper.cpp CLI/);
	});

	it("honors cancellation before inspecting the Vault", async () => {
		const { vault } = await fixture();
		const abort = new AbortController();
		abort.abort();
		await expect(new LocalMediaRecognition({ vaultRoot: vault }).recognize("media.ocr", "Assets/no-file.png", abort.signal)).rejects.toThrow(/已取消/);
	});

	it("uses fixed local CLI arguments and reads a staged transcript (protocol only)", async () => {
		const { root, vault } = await fixture();
		const wav = join(vault, "Assets", "fictional.wav");
		const header = Buffer.alloc(44);
		header.write("RIFF", 0); header.write("WAVE", 8);
		await writeFile(wav, header);
		const model = join(root, "fictional-model.bin");
		await writeFile(model, "model fixture");
		const ffmpeg = join(root, "fake-ffmpeg");
		const whisper = join(root, "fake-whisper");
		await writeFile(ffmpeg, "#!" + process.execPath + "\n" + [
			"const fs = require('node:fs');",
			"const args = process.argv.slice(2);",
			"const output = args.at(-1);",
			"fs.writeFileSync(" + JSON.stringify(join(root, "ffmpeg-args.json")) + ", JSON.stringify(args));",
			"fs.writeFileSync(output, Buffer.from('RIFF0000WAVE'));",
		].join("\n"));
		await writeFile(whisper, "#!" + process.execPath + "\n" + [
			"const fs = require('node:fs');",
			"const args = process.argv.slice(2);",
			"const prefix = args[args.indexOf('-of') + 1];",
			"fs.writeFileSync(" + JSON.stringify(join(root, "whisper-args.json")) + ", JSON.stringify(args));",
			"fs.writeFileSync(prefix + '.txt', 'fixture protocol only');",
		].join("\n"));
		await chmod(ffmpeg, 0o700); await chmod(whisper, 0o700);
		const result = await new LocalMediaRecognition({ vaultRoot: vault, whisperCli: whisper, whisperModel: model, ffmpegCli: ffmpeg })
			.recognize("media.transcribe", "Assets/fictional.wav");
		expect(result.engine).toBe("whisper.cpp");
		expect(result.text).toBe("fixture protocol only");
		expect(result.warnings.join(" ")).toMatch(/前30分钟/);
		const ffmpegArgs = JSON.parse(await readFile(join(root, "ffmpeg-args.json"), "utf8")) as string[];
		const whisperArgs = JSON.parse(await readFile(join(root, "whisper-args.json"), "utf8")) as string[];
		expect(ffmpegArgs.slice(0, 5)).toEqual(["-nostdin", "-hide_banner", "-loglevel", "error", "-y"]);
		expect(ffmpegArgs).toContain("file,pipe");
		expect(ffmpegArgs).toContain("0:a:0");
		expect(whisperArgs).toContain(await realpath(model));
		expect(whisperArgs).toContain("-otxt");
		// The private staging directory is removed after the call. Only the
		// fixed argv protocol is asserted here; this fixture is not an ASR pass.
		expect(await readFile(wav)).toEqual(header);
	});
});

// Opt in on a real macOS host. This creates an actual PNG and runs Apple's
// Vision recognizer through the production adapter; no mocked text is accepted.
const nativeOcr = process.platform === "darwin" && process.env.TALOS_TEST_NATIVE_OCR === "1";
const IMAGE_SWIFT = [
	"import AppKit",
	"import Foundation",
	"let image = NSImage(size: NSSize(width: 900, height: 180))",
	"image.lockFocus()",
	"NSColor.white.setFill()",
	"NSRect(x: 0, y: 0, width: 900, height: 180).fill()",
	"(\"TALOS 4268\" as NSString).draw(at: NSPoint(x: 30, y: 45), withAttributes: [.font: NSFont.systemFont(ofSize: 80), .foregroundColor: NSColor.black])",
	"image.unlockFocus()",
	"guard let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!),",
	"      let png = bitmap.representation(using: .png, properties: [:]) else { exit(2) }",
	"try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))",
].join("\n");

it.skipIf(!nativeOcr)("recognizes synthetic text with the real macOS Vision engine", async () => {
	const { root, vault } = await fixture();
	const image = join(vault, "Assets", "synthetic.png");
	execFileSync("/usr/bin/swift", ["-module-cache-path", join(root, "swift-cache"), "-e", IMAGE_SWIFT, image], {
		timeout: 120_000, maxBuffer: 1024 * 1024,
	});
	expect((await readFile(image)).subarray(1, 4).toString("ascii")).toBe("PNG");
	const result = await new LocalMediaRecognition({ vaultRoot: vault }).recognize("media.ocr", "Assets/synthetic.png");
	expect(result.engine).toBe("macos-vision");
	expect(result.text).toContain("TALOS 4268");
	expect(result.warnings).toContain("请核对识别文字与原图。");
}, 180_000);
