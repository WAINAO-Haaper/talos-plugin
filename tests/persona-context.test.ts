import { describe, expect, it } from "vitest";
import {
	loadQuyuanSoulContext,
	loadQuyuanSoulContextWithFallback,
} from "../src/quyuan/persona-context";

function appWithFiles(files: Record<string, string>) {
	return {
		vault: {
			adapter: {
				exists: async (path: string) => Object.hasOwn(files, path),
				read: async (path: string) => files[path] ?? "",
			},
		},
	};
}

describe("Quyuan persona context", () => {
	it("loads the complete primary layout without mixing fallback files", async () => {
		const app = appWithFiles({
			"legacy/PERSONA.md": "legacy persona",
			"legacy/memory.md": "legacy memory",
			"legacy/CONTEXT.md": "legacy context",
			"10 身份/身份.md": "standard identity",
			"10 身份/偏好与边界.md": "standard preferences",
			"10 身份/目标.md": "standard goals",
		});

		const result = await loadQuyuanSoulContextWithFallback(
			app as never,
			["legacy/PERSONA.md", "legacy/memory.md", "legacy/CONTEXT.md"],
			["10 身份/身份.md", "10 身份/偏好与边界.md", "10 身份/目标.md"]
		);

		expect(result.sources.map((source) => source.path)).toEqual([
			"legacy/PERSONA.md",
			"legacy/memory.md",
			"legacy/CONTEXT.md",
		]);
		expect(result.systemContext).not.toContain("standard identity");
	});

	it("falls back atomically to Standard confirmed identity files", async () => {
		const app = appWithFiles({
			"legacy/PERSONA.md": "partial legacy persona",
			"10 身份/身份.md": "standard identity",
			"10 身份/偏好与边界.md": "standard preferences",
			"10 身份/目标.md": "standard goals",
		});

		const result = await loadQuyuanSoulContextWithFallback(
			app as never,
			["legacy/PERSONA.md", "legacy/memory.md", "legacy/CONTEXT.md"],
			["10 身份/身份.md", "10 身份/偏好与边界.md", "10 身份/目标.md"]
		);

		expect(result.sources.map((source) => source.path)).toEqual([
			"10 身份/身份.md",
			"10 身份/偏好与边界.md",
			"10 身份/目标.md",
		]);
		expect(result.systemContext).not.toContain("partial legacy persona");
	});

	it("still fails closed when neither complete layout is available", async () => {
		const app = appWithFiles({ "10 身份/身份.md": "identity only" });

		await expect(
			loadQuyuanSoulContextWithFallback(
				app as never,
				["legacy/PERSONA.md", "legacy/memory.md", "legacy/CONTEXT.md"],
				["10 身份/身份.md", "10 身份/偏好与边界.md", "10 身份/目标.md"]
			)
		).rejects.toThrow("10 身份/偏好与边界.md");
	});

	it("rejects blank required files", async () => {
		const app = appWithFiles({ "one.md": " " });
		await expect(loadQuyuanSoulContext(app as never, ["one.md"])).rejects.toThrow(
			"one.md"
		);
	});
});
