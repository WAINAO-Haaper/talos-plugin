import { describe, expect, it } from "vitest";
import {
	CANONICAL_REGISTRY_PATH,
	CanonicalRegistryReader,
	type CanonicalRegistryPersistence,
} from "../src/canonical/registry-reader";

function validRegistry(): Record<string, unknown> {
	return {
		schema_version: 1,
		commands: [
			{
				id: "talos-ask",
				obsidian_command_id: "talos-ask",
				request_path: ".talos/command-requests/talos-ask.json",
				summary: "AI 全库问答与受控执行",
				engine_asset:
					"TALOS中枢/引擎/00-系统种子/.claude/commands/talos-ask.md",
				claude_wrapper:
					"vault-template/.claude/commands/talos-ask.md",
			},
		],
	};
}

function persistence(value: unknown): CanonicalRegistryPersistence & {
	reads: string[];
} {
	return {
		reads: [],
		async read(path) {
			this.reads.push(path);
			return JSON.stringify(value);
		},
	};
}

describe("CanonicalRegistryReader", () => {
	it("loads schema v1 and resolves the canonical talos-ask entry", async () => {
		const source = persistence(validRegistry());
		const reader = new CanonicalRegistryReader(source);

		const registry = await reader.read();

		expect(source.reads).toEqual([CANONICAL_REGISTRY_PATH]);
		expect(registry.talosAsk).toMatchObject({
			id: "talos-ask",
			obsidianCommandId: "talos-ask",
			requestPath: ".talos/command-requests/talos-ask.json",
		});
	});

	it("rejects unsupported schema versions, duplicate command IDs, and a missing talos-ask", async () => {
		const unsupported = validRegistry();
		unsupported.schema_version = 2;
		await expect(
			new CanonicalRegistryReader(persistence(unsupported)).read()
		).rejects.toThrow("schema_version");

		const duplicate = validRegistry();
		duplicate.commands = [
			...(duplicate.commands as unknown[]),
			{ ...(duplicate.commands as Record<string, unknown>[])[0] },
		];
		await expect(
			new CanonicalRegistryReader(persistence(duplicate)).read()
		).rejects.toThrow("duplicate command id");

		const missing = validRegistry();
		missing.commands = [];
		await expect(
			new CanonicalRegistryReader(persistence(missing)).read()
		).rejects.toThrow("talos-ask");
	});

	it("rejects unknown registry and command fields", async () => {
		const topLevel = { ...validRegistry(), extra: true };
		await expect(
			new CanonicalRegistryReader(persistence(topLevel)).read()
		).rejects.toThrow("unknown field");

		const commandLevel = validRegistry();
		(commandLevel.commands as Record<string, unknown>[])[0] = {
			...(commandLevel.commands as Record<string, unknown>[])[0],
			token: "not-allowed",
		};
		await expect(
			new CanonicalRegistryReader(persistence(commandLevel)).read()
		).rejects.toThrow("unknown field");
	});

	it.each([
		[
			"wrong request path",
			"request_path",
			".talos/command-requests/other.json",
			"canonical request path",
		],
		[
			"absolute request path",
			"request_path",
			"/tmp/talos-ask.json",
			"absolute path",
		],
		[
			"Windows absolute path",
			"engine_asset",
			"C:\\tmp\\talos-ask.md",
			"absolute path",
		],
		[
			"path escape",
			"claude_wrapper",
			"../talos-ask.md",
			"path escape",
		],
	])("rejects %s", async (_label, field, value, message) => {
		const candidate = validRegistry();
		const command = (candidate.commands as Record<string, unknown>[])[0];
		if (!command) throw new Error("fixture command missing");
		command[field] = value;

		await expect(
			new CanonicalRegistryReader(persistence(candidate)).read()
		).rejects.toThrow(message);
	});
});
