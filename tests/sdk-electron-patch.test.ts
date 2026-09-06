import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const patchSource = readFileSync(resolve("patches/apply-sdk-electron-patch.mjs"), "utf8");

function fixture(source: string) {
	const root = mkdtempSync(join(tmpdir(), "talos-sdk-patch-"));
	roots.push(root);
	const script = join(root, "patches/apply-sdk-electron-patch.mjs");
	const sdk = join(root, "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs");
	mkdirSync(dirname(script), { recursive: true });
	mkdirSync(dirname(sdk), { recursive: true });
	writeFileSync(script, patchSource);
	writeFileSync(sdk, source);
	return { script, sdk, run: () => spawnSync(process.execPath, [script], { encoding: "utf8" }) };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Claude SDK Electron installation patch", () => {
	it.each([
		"function da(e=w1){let t=new AbortController;return x1(e,t.signal),t}",
		"function updated(n=limit){let controller=new AbortController;return listeners(n,controller.signal),controller}",
	])("can be replayed without changing an already patched SDK: %s", (source) => {
		const test = fixture(source);
		expect(test.run().status).toBe(0);
		const first = readFileSync(test.sdk, "utf8");
		expect(test.run().status).toBe(0);
		expect(readFileSync(test.sdk, "utf8")).toBe(first);
	});

	it("keeps abort propagation when a foreign-realm signal rejects listener tuning", () => {
		const test = fixture('var w1=50;function x1(){throw Object.assign(new TypeError("foreign signal"),{code:"ERR_INVALID_ARG_TYPE"})}function da(e=w1){let t=new AbortController;return x1(e,t.signal),t}const controller=da();controller.abort();if(!controller.signal.aborted)throw new Error("abort lost");');
		expect(test.run().status).toBe(0);
		expect(() => execFileSync(process.execPath, [test.sdk])).not.toThrow();
	});

	it("does not suppress unrelated listener configuration errors", () => {
		const test = fixture('var w1=50;function x1(){throw Object.assign(new RangeError("bad limit"),{code:"ERR_OUT_OF_RANGE"})}function da(e=w1){let t=new AbortController;return x1(e,t.signal),t}da();');
		expect(test.run().status).toBe(0);
		const result = spawnSync(process.execPath, [test.sdk], { encoding: "utf8" });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("ERR_OUT_OF_RANGE");
	});

	it("fails without modifying an unknown or ambiguous SDK layout", () => {
		for (const source of [
			"export const changedSdk = true;",
			"function da(e=w1){let t=new AbortController;return x1(e,t.signal),t}function other(n=limit){let c=new AbortController;return listeners(n,c.signal),c}",
		]) {
			const test = fixture(source);
			expect(test.run().status).not.toBe(0);
			expect(readFileSync(test.sdk, "utf8")).toBe(source);
		}
	});
});
