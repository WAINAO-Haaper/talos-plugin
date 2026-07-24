import { describe, expect, it } from "vitest";
import {
	ProviderEgressAuditStore,
	type ProviderEgressAuditPersistence,
} from "../src/ai/privacy/provider-egress-audit-store";

function memoryPersistence(): ProviderEgressAuditPersistence & {
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

describe("ProviderEgressAuditStore", () => {
	it("appends metadata-only JSONL to the managed audit path", async () => {
		const persistence = memoryPersistence();
		const store = new ProviderEgressAuditStore(
			persistence,
			() => "2026-07-24T10:00:00.000Z"
		);

		await store.append({
			runId: "run-1",
			turnId: "turn-1",
			sessionId: "chat:session-1",
			namespace: "chat",
			audit: {
				providerId: "claude-api",
				modules: ["10 身份", "40 项目"],
				redactions: {
					email: 1,
					phone: 0,
					identityNumber: 0,
					absolutePath: 0,
				},
				blockedReasons: [],
				deniedModules: [],
				contentDigest:
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		});

		expect(persistence.directories).toEqual([".talos/audit"]);
		expect(persistence.appends).toHaveLength(1);
		expect(persistence.appends[0]?.path).toBe(
			".talos/audit/provider-egress.jsonl"
		);
		const line = persistence.appends[0]?.value ?? "";
		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line)).toEqual({
			version: 1,
			at: "2026-07-24T10:00:00.000Z",
			runId: "run-1",
			turnId: "turn-1",
			sessionId: "chat:session-1",
			namespace: "chat",
			providerId: "claude-api",
			modules: ["10 身份", "40 项目"],
			redactions: {
				email: 1,
				phone: 0,
				identityNumber: 0,
				absolutePath: 0,
			},
			blockedReasons: [],
			deniedModules: [],
			contentDigest:
				"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		});
	});

	it("rejects unsafe identifiers before writing an audit line", async () => {
		const persistence = memoryPersistence();
		const store = new ProviderEgressAuditStore(persistence);

		await expect(
			store.append({
				runId: "run\nsecret",
				turnId: "turn",
				sessionId: "chat:session",
				namespace: "chat",
				audit: {
					providerId: "claude-api",
					modules: [],
					redactions: {
						email: 0,
						phone: 0,
						identityNumber: 0,
						absolutePath: 0,
					},
					blockedReasons: [],
					deniedModules: [],
					contentDigest:
						"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				},
			})
		).rejects.toThrow("runId");
		expect(persistence.appends).toHaveLength(0);
	});
});
