import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	CLAUDE_SDK_BUNDLE_FILE,
	ClaudeSdkQueryPort,
	configureClaudeSdkBundle,
	loadClaudeSdk,
} from "../src/agent-workbench/transports/claude-sdk-port";

interface SplitGuard {
	sdkMarkersIn(text: string): string[];
	assertMainBundleWithoutSdk(text: string): boolean;
	assertSdkBundleExports(module: unknown): boolean;
}

const fakeSdk = {
	query: () => { throw new Error("not used"); },
	forkSession: async () => ({ sessionId: "fork" }),
};

describe("Claude SDK lazy loading", () => {
	afterEach(() => configureClaudeSdkBundle(null));

	it("does not touch the bundle until the SDK is first needed", async () => {
		configureClaudeSdkBundle("/plugin/claude-sdk.cjs");
		const port = new ClaudeSdkQueryPort("/synthetic/vault", async () => ({ runtimeId: "claude", status: "ready" }), { decide: async () => ({ allow: false }) });
		expect(await port.models()).toHaveLength(4);
	});

	it("requires the configured bundle once and caches it", () => {
		configureClaudeSdkBundle("/plugin/claude-sdk.cjs");
		const requested: string[] = [];
		const load = (id: string) => { requested.push(id); return fakeSdk; };
		const first = loadClaudeSdk(load);
		const second = loadClaudeSdk(load);
		expect(first).toBe(second);
		expect(requested).toEqual(["/plugin/claude-sdk.cjs"]);
	});

	it("reloads after the bundle location changes", () => {
		const requested: string[] = [];
		const load = (id: string) => { requested.push(id); return fakeSdk; };
		configureClaudeSdkBundle("/a/claude-sdk.cjs");
		loadClaudeSdk(load);
		configureClaudeSdkBundle("/b/claude-sdk.cjs");
		loadClaudeSdk(load);
		expect(requested).toEqual(["/a/claude-sdk.cjs", "/b/claude-sdk.cjs"]);
	});

	it("fails with a readable error when the location is unknown", () => {
		expect(() => loadClaudeSdk(() => fakeSdk)).toThrow(CLAUDE_SDK_BUNDLE_FILE);
	});

	it("rejects an incomplete bundle", () => {
		configureClaudeSdkBundle("/plugin/claude-sdk.cjs");
		expect(() => loadClaudeSdk(() => ({ query: fakeSdk.query }))).toThrow(/内容不完整/);
		expect(() => loadClaudeSdk(() => null)).toThrow(/内容不完整/);
	});

	it("ships the bundle as CommonJS regardless of package type", () => {
		expect(CLAUDE_SDK_BUNDLE_FILE.endsWith(".cjs")).toBe(true);
		const config = readFileSync(resolve(__dirname, "../esbuild.config.mjs"), "utf8");
		expect(config).toContain(`outfile: '${CLAUDE_SDK_BUNDLE_FILE}'`);
	});
});

describe("Claude SDK split guard", () => {
	it("flags SDK code inside main.js and accepts a clean bundle", async () => {
		const guard = (await import("../scripts/check-claude-sdk-split.mjs")) as unknown as SplitGuard;
		expect(guard.sdkMarkersIn('x="CLAUDE_CODE_ENTRYPOINT"')).toEqual(["CLAUDE_CODE_ENTRYPOINT"]);
		expect(() => guard.assertMainBundleWithoutSdk('require("@anthropic-ai/claude-agent-sdk")')).toThrow(/claude-sdk\.cjs/);
		expect(guard.assertMainBundleWithoutSdk('const port = "lazy";')).toBe(true);
	});

	it("checks that the SDK bundle exports query and forkSession", async () => {
		const guard = (await import("../scripts/check-claude-sdk-split.mjs")) as unknown as SplitGuard;
		expect(guard.assertSdkBundleExports(fakeSdk)).toBe(true);
		expect(() => guard.assertSdkBundleExports({})).toThrow(/query/);
	});
});
