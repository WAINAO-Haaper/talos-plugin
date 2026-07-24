import { describe, expect, it } from "vitest";
import {
	CANONICAL_TALOS_ASK_REQUEST_PATH,
	CanonicalRequestWriter,
	type CanonicalRequestPersistence,
} from "../src/canonical/request-writer";

function memoryPersistence(): CanonicalRequestPersistence & {
	directories: string[];
	writes: Array<{ path: string; value: string }>;
	renames: Array<{ from: string; to: string }>;
} {
	return {
		directories: [],
		writes: [],
		renames: [],
		async ensureDirectory(path) {
			this.directories.push(path);
		},
		async write(path, value) {
			this.writes.push({ path, value });
		},
		async rename(from, to) {
			this.renames.push({ from, to });
		},
	};
}

describe("CanonicalRequestWriter", () => {
	it("atomically projects a metadata-safe talos-ask request", async () => {
		const persistence = memoryPersistence();
		const writer = new CanonicalRequestWriter(persistence);

		const written = await writer.write({
			requestId: "request-20260725-001",
			commandId: "talos-ask",
			timestamp: "2026-07-25T04:30:00.000Z",
			channel: "obsidian",
			providerId: "claude-api",
			query: "总结 WP7 当前状态",
			writebackIntent: "display-only",
			approvalState: "not-required",
		});

		expect(persistence.directories).toEqual([
			".talos/command-requests",
		]);
		expect(persistence.writes).toHaveLength(1);
		const temporary = persistence.writes[0];
		expect(temporary?.path).toMatch(
			/^\.talos\/command-requests\/\.talos-ask\.request-20260725-001\.tmp$/
		);
		expect(persistence.renames).toEqual([
			{
				from: temporary?.path,
				to: CANONICAL_TALOS_ASK_REQUEST_PATH,
			},
		]);
		expect(written.path).toBe(CANONICAL_TALOS_ASK_REQUEST_PATH);
		expect(JSON.parse(temporary?.value ?? "")).toEqual({
			schema_version: 1,
			request_id: "request-20260725-001",
			command_id: "talos-ask",
			timestamp: "2026-07-25T04:30:00.000Z",
			channel: "obsidian",
			provider_id: "claude-api",
			query: "总结 WP7 当前状态",
			writeback_intent: "display-only",
			approval_state: "not-required",
		});
	});

	it.each([
		[
			"unknown fields",
			{ authorization: "Bearer fake-token-value" },
			"unknown field",
		],
		[
			"bearer secrets",
			{ query: "Authorization: Bearer abcdefghijklmnop" },
			"secret",
		],
		[
			"API key material",
			{ query: "sk-proj-abcdefghijklmnop" },
			"secret",
		],
	])("rejects %s before touching persistence", async (_label, patch, message) => {
		const persistence = memoryPersistence();
		const writer = new CanonicalRequestWriter(persistence);
		const input = {
			requestId: "request-safe",
			commandId: "talos-ask" as const,
			timestamp: "2026-07-25T04:30:00.000Z",
			channel: "codex" as const,
			providerId: "openai-compatible",
			query: "safe query",
			writebackIntent: "display-only" as const,
			approvalState: "not-required" as const,
			...patch,
		};

		await expect(writer.write(input)).rejects.toThrow(message);
		expect(persistence.directories).toHaveLength(0);
		expect(persistence.writes).toHaveLength(0);
		expect(persistence.renames).toHaveLength(0);
	});
});
