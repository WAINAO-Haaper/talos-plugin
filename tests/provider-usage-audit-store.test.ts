import { describe, expect, it } from "vitest";
import {
	ProviderUsageAuditStore,
	type ProviderUsageAuditPersistence,
} from "../src/ai/privacy/provider-usage-audit-store";

function memoryPersistence(): ProviderUsageAuditPersistence & {
	directories: string[];
	appends: Array<{ path: string; value: string }>;
} {
	return {
		directories: [],
		appends: [],
		async ensureDirectory(path) {
			this.directories.push(path);
		},
		async append(path, value) {
			this.appends.push({ path, value });
		},
	};
}

describe("ProviderUsageAuditStore", () => {
	it("stores only numeric provider usage metadata", async () => {
		const persistence = memoryPersistence();
		const store = new ProviderUsageAuditStore(
			persistence,
			() => "2026-08-26T10:00:00.000Z"
		);

		await store.append({
			runId: "voice-search-1",
			sessionId: "voice:search-1",
			namespace: "voice",
			providerId: "aliyun-qwen-search",
			operation: "web-search",
			model: "qwen-flash",
			usage: {
				inputTextTokens: 120,
				outputTextTokens: 64,
				totalTokens: 184,
				searchRequests: 1,
				sourceCount: 5,
			},
		});

		const line = persistence.appends[0]?.value ?? "";
		expect(persistence.directories).toEqual([".talos/audit"]);
		expect(persistence.appends[0]?.path).toBe(
			".talos/audit/provider-usage.jsonl"
		);
		expect(JSON.parse(line)).toEqual({
			version: 1,
			at: "2026-08-26T10:00:00.000Z",
			runId: "voice-search-1",
			sessionId: "voice:search-1",
			namespace: "voice",
			providerId: "aliyun-qwen-search",
			operation: "web-search",
			model: "qwen-flash",
			usage: {
				inputTextTokens: 120,
				outputTextTokens: 64,
				totalTokens: 184,
				searchRequests: 1,
				sourceCount: 5,
			},
		});
		expect(line).not.toContain("联网搜索");
	});

	it("rejects unsafe or non-integer metadata", async () => {
		const persistence = memoryPersistence();
		const store = new ProviderUsageAuditStore(persistence);
		await expect(store.append({
			runId: "voice-search-2",
			sessionId: "voice:search-2",
			namespace: "voice",
			providerId: "aliyun-qwen-search",
			operation: "web-search",
			model: "qwen-flash",
			usage: { totalTokens: -1 },
		})).rejects.toThrow("totalTokens");
		await expect(store.append({
			runId: "voice-search-3",
			sessionId: "voice:search-3",
			namespace: "voice",
			providerId: "aliyun-qwen-search",
			operation: "web-search",
			model: "qwen-flash",
			usage: { transcript: 1 } as unknown as { totalTokens?: number },
		})).rejects.toThrow("transcript");
		expect(persistence.appends).toHaveLength(0);
	});
});
