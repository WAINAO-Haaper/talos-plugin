import { describe, expect, it } from "vitest";
import {
	extractToolTargetPaths,
	inspectToolTargetPaths,
	relativizeVaultToolPath,
} from "../src/ai/context/tool-path-policy";

describe("tool target path policy", () => {
	it("collects every declared target instead of trusting the first safe-looking field", () => {
		expect(
			extractToolTargetPaths("Read", {
				file_path: "30 洞察/safe.md",
				path: ".talos/private/provider.json",
			})
		).toEqual([
			"30 洞察/safe.md",
			".talos/private/provider.json",
		]);
	});

	it.each([
		["Read", { file_path: ".TALOS/PRIVATE/provider.json" }, "talos-private"],
		["Glob", { path: ".codex", pattern: "**/*" }, "config-directory"],
		["Glob", { pattern: "**/*" }, "unclassified-path"],
		["Grep", { path: "safe/%2e%2e/.talos/private" }, "unsafe-path"],
		["Search", {}, "unclassified-path"],
	])("blocks %s bypass input", (toolName, input, reason) => {
		expect(inspectToolTargetPaths(toolName, input)).toMatchObject({
			blocked: true,
			reasons: [reason],
		});
	});

	it("allows an explicitly scoped safe read root", () => {
		expect(
			inspectToolTargetPaths("Grep", { path: "30 洞察" })
		).toEqual({
			blocked: false,
			reasons: [],
			paths: ["30 洞察"],
		});
	});

	it.each(["Glob", "Grep", "Search"])(
		"allows %s to use the Vault root as an explicit read-only scope",
		(toolName) => {
			expect(inspectToolTargetPaths(toolName, { path: "." })).toEqual({
				blocked: false,
				reasons: [],
				paths: ["."],
			});
		}
	);

	it.each(["Read", "Write", "Delete"])(
		"does not broaden the Vault root exception to %s",
		(toolName) => {
			expect(inspectToolTargetPaths(toolName, { path: "." })).toMatchObject({
				blocked: true,
				reasons: ["unsafe-path"],
			});
		}
	);

	it("does not treat a glob expression as a trusted target root", () => {
		expect(extractToolTargetPaths("Glob", { pattern: "30 洞察/**/*" }))
			.toEqual([]);
		expect(inspectToolTargetPaths("Glob", {
			path: "30 洞察",
			pattern: "**/*.md",
		})).toMatchObject({ blocked: false, paths: ["30 洞察"] });
	});

	it("extracts every source and destination from structured file changes", () => {
		expect(extractToolTargetPaths("apply_patch", {
			changes: [
				{ path: "02-洞察/a.md" },
				{
					path: "03-项目/b.md",
					movePath: "04-项目/c.md",
					move_path: "05-归档/d.md",
					target_path: "06-目标/e.md",
					destinationPath: ".talos/private/b.md",
				},
			],
		})).toEqual([
			"02-洞察/a.md",
			"03-项目/b.md",
			"04-项目/c.md",
			"05-归档/d.md",
			"06-目标/e.md",
			".talos/private/b.md",
		]);
		expect(inspectToolTargetPaths("apply_patch", {
			changes: [
				{ path: "02-洞察/a.md" },
				{ path: "03-项目/b.md", movePath: ".talos/private/b.md" },
			],
		})).toMatchObject({ blocked: true, reasons: ["talos-private"] });
	});

	it("relativizes only absolute paths proven to be inside the Vault", () => {
		expect(relativizeVaultToolPath("/target/Vault/03-项目/a.md", {
			mappedPath: "/host/vault/03-项目/a.md",
			vaultRoot: "/host/vault",
		})).toBe("03-项目/a.md");
		expect(relativizeVaultToolPath("/outside/private.txt", {
			vaultRoot: "/host/vault",
		})).toBe("/outside/private.txt");
		expect(relativizeVaultToolPath("C:\\VAULT\\Notes\\a.md", {
			mappedPath: "C:\\vault\\Notes\\a.md",
			vaultRoot: "c:\\vault",
			caseInsensitive: true,
		})).toBe("Notes/a.md");
		expect(relativizeVaultToolPath("./03-项目/a.md", {
			vaultRoot: "/host/vault",
		})).toBe("03-项目/a.md");
	});
});
