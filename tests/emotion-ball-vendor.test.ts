import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = `${root}src/quyuan/vendor/emotion-ball/`;

const sha1 = (path: string): string =>
	createHash("sha1").update(readFileSync(path)).digest("hex");

describe("pinned Emotion Ball vendor snapshot", () => {
	it("matches the exact upstream runtime and license hashes", () => {
		const expected: Record<string, string> = {
			"rings.js": "7ef919f7ea8a4c2d90c8fbcf0311988580d0ac53",
			"emotions.js": "1695cddcc5b4ec5ceeef51f0cf0e92f4880a6891",
			"ball.js": "c37a2c121805d3068ea5944c203f177be0ce25fd",
			"engine.js": "858baf98f9ce9d2235f1359b774da8107e964e23",
			LICENSE: "31df6f846646863f9d18c5e1f3caac87a8d63249",
			"NOTICE.md": "a8fd240384becc7051b8c189066e419482fa7ec4",
			"LICENSE-COMMERCIAL.md": "7912b06fc75e295fc0f00f293b89e6f490683d64",
		};
		for (const [file, hash] of Object.entries(expected)) {
			expect(sha1(`${vendor}${file}`), file).toBe(hash);
		}
	});

	it("loads only the four local runtime files and records the immutable pin", () => {
		const runtime = readFileSync(`${root}src/quyuan/emotion-ball-runtime.ts`, "utf8");
		for (const file of ["rings.js", "emotions.js", "ball.js", "engine.js"]) {
			expect(runtime).toContain(`./vendor/emotion-ball/${file}`);
		}
		expect(runtime).toContain("b406eeb20a1b1ae0084d4006e77cc74e28be009d");
		expect(runtime).not.toMatch(/https?:\/\//);
		expect(runtime).not.toContain("fetch(");
	});

	it("retains upstream notices and keeps distribution authorization closed", () => {
		const license = readFileSync(`${vendor}LICENSE`, "utf8");
		const notice = readFileSync(`${vendor}NOTICE.md`, "utf8");
		const upstream = readFileSync(`${vendor}UPSTREAM.md`, "utf8");
		const projectNotice = readFileSync(`${root}THIRD-PARTY-NOTICES.md`, "utf8");
		expect(license).toContain("Emotion Ball Community License");
		expect(license).toContain("VISUAL DESIGNS NEVER COMMERCIAL");
		expect(notice).toContain("视觉形象使用限制");
		expect(upstream).toMatch(
			/does not\s+grant TALOS a distribution or commercial-use right/
		);
		expect(projectNotice).toContain("只能形成本地候选");
		expect(projectNotice).toMatch(/不构成对外\s+分发、商业交付或发布授权/);
	});
});
