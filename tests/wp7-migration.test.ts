import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProviderSecretStore } from "../src/ai/provider/provider-secret-store";
import type { LegacySecretSettings } from "../src/ai/provider/settings-migration";
import {
	WP7_MIGRATION_SCHEMA_VERSION,
	migrateWp7Data,
} from "../src/migrations/wp7-migration";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");

class MemorySecrets {
	readonly values = new Map<string, string>();
	readonly operations: string[] = [];
	failReadId: string | null = null;

	setSecret(id: string, value: string): void {
		this.operations.push(`set:${id}`);
		this.values.set(id, value);
	}

	getSecret(id: string): string | null {
		this.operations.push(`get:${id}`);
		if (id === this.failReadId) return "verification-mismatch";
		return this.values.get(id) ?? null;
	}

	listSecrets(): string[] {
		return [...this.values.keys()];
	}
}

type TestSettings = LegacySecretSettings & {
	engineProvider: string;
	jarvisTabsJson: string;
	quyuanVoiceSessionJson: string;
	jarvisVoiceEnabled: boolean;
	jarvisSttEngine: string;
	ttsEngine: string;
	vaultSchema: Record<string, string>;
	customMarker?: string;
};

function settings(
	patch: Partial<TestSettings> = {}
): TestSettings {
	return {
		elevenLabsApiKey: "",
		aliyunApiKey: "",
		anthropicApiKey: "",
		openaiApiKey: "",
		codexApiKey: "",
		jarvisSttApiKey: "",
		providerSecretRefs: {},
		engineProvider: "claude-cli",
		jarvisTabsJson: "",
		quyuanVoiceSessionJson: "",
		jarvisVoiceEnabled: false,
		jarvisSttEngine: "webspeech",
		ttsEngine: "system",
		vaultSchema: {},
		...patch,
	};
}

describe("WP7 migration", () => {
	it("preserves 0.4.0 settings, Claudian tabs, voice state, and custom schema", async () => {
		const legacySettings = settings({
			engineProvider: "claude-cli",
			jarvisTabsJson: '{"tabs":["legacy"]}',
			quyuanVoiceSessionJson: '{"version":1,"namespace":"voice"}',
			jarvisVoiceEnabled: true,
			jarvisSttEngine: "aliyun",
			ttsEngine: "elevenlabs",
			vaultSchema: { identity: "Identity", projects: "Projects" },
			customMarker: "keep-me",
		});
		const stored = {
			version: "0.4.0",
			engineProvider: "claude-cli",
			jarvisTabsJson: '{"tabs":["legacy"]}',
			claudian: { model: "claude-sonnet", locale: "zh-CN" },
			tabManagerState: {
				openTabs: [{ tabId: "tab-1", conversationId: "session-1" }],
				activeTabId: "tab-1",
			},
			unrelated: { ownedByUser: true },
		};
		const snapshots: Record<string, unknown>[] = [];

		const result = await migrateWp7Data({
			stored,
			settings: legacySettings,
			secretStore: null,
			persist(data) {
				snapshots.push(structuredClone(data));
			},
		});

		expect(result.status).toBe("complete");
		expect(result.record.schemaVersion).toBe(
			WP7_MIGRATION_SCHEMA_VERSION
		);
		expect(result.data).toMatchObject({
			claudian: stored.claudian,
			tabManagerState: stored.tabManagerState,
			unrelated: stored.unrelated,
			talos: {
				engineProvider: "claude-cli",
				jarvisTabsJson: '{"tabs":["legacy"]}',
				quyuanVoiceSessionJson:
					'{"version":1,"namespace":"voice"}',
				jarvisVoiceEnabled: true,
				jarvisSttEngine: "aliyun",
				ttsEngine: "elevenlabs",
				vaultSchema: { identity: "Identity", projects: "Projects" },
				customMarker: "keep-me",
			},
		});
		expect(snapshots.length).toBeGreaterThanOrEqual(2);
		expect(result.data).not.toHaveProperty("engineProvider");
		expect(result.data).not.toHaveProperty("jarvisTabsJson");
	});

	it("moves Claude and OpenAI plaintext keys only after SecretStorage verification", async () => {
		const adapter = new MemorySecrets();
		const secretStore = new ProviderSecretStore(adapter);
		const legacySettings = settings({
			engineProvider: "claude-api",
			anthropicApiKey: "anthropic-private",
			openaiApiKey: "openai-private",
		});
		const snapshots: Record<string, unknown>[] = [];

		const result = await migrateWp7Data({
			stored: { talos: legacySettings },
			settings: legacySettings,
			secretStore,
			persist(data) {
				snapshots.push(structuredClone(data));
			},
		});

		expect(result.status).toBe("complete");
		expect(adapter.operations.slice(0, 2)).toEqual([
			"set:talos-anthropic-api-key",
			"set:talos-openai-api-key",
		]);
		expect(adapter.operations.slice(2, 4)).toEqual([
			"get:talos-anthropic-api-key",
			"get:talos-openai-api-key",
		]);
		expect(result.settings).toMatchObject({
			anthropicApiKey: "",
			openaiApiKey: "",
			providerSecretRefs: {
				anthropicApiKey: "talos-anthropic-api-key",
				openaiApiKey: "talos-openai-api-key",
			},
		});
		const completed = snapshots.at(-1);
		expect(JSON.stringify(completed)).not.toContain("anthropic-private");
		expect(JSON.stringify(completed)).not.toContain("openai-private");
	});

	it("stays at schema v0 and retains plaintext when SecretStorage is unavailable", async () => {
		const legacySettings = settings({
			engineProvider: "codex",
			openaiApiKey: "must-survive",
		});
		const snapshots: Record<string, unknown>[] = [];

		const result = await migrateWp7Data({
			stored: {},
			settings: legacySettings,
			secretStore: null,
			persist(data) {
				snapshots.push(structuredClone(data));
			},
		});

		expect(result.status).toBe("blocked");
		expect(result.record.schemaVersion).toBe(0);
		expect(result.settings.openaiApiKey).toBe("must-survive");
		expect(result.settings.providerSecretRefs.openaiApiKey).toBeUndefined();
		expect(JSON.stringify(snapshots.at(-1))).toContain("must-survive");
	});

	it("does not delete any key or advance the secret step when verification fails", async () => {
		const adapter = new MemorySecrets();
		adapter.failReadId = "talos-openai-api-key";
		const secretStore = new ProviderSecretStore(adapter);
		const legacySettings = settings({ openaiApiKey: "openai-private" });
		const snapshots: Record<string, unknown>[] = [];

		await expect(
			migrateWp7Data({
				stored: {},
				settings: legacySettings,
				secretStore,
				persist(data) {
					snapshots.push(structuredClone(data));
				},
			})
		).rejects.toThrow("talos-openai-api-key");
		expect(legacySettings.openaiApiKey).toBe("openai-private");
		expect(
			(snapshots.at(-1)?.wp7Migration as { completedSteps: string[] })
				.completedSteps
		).not.toContain("provider-secrets");
	});

	it("resumes after an interrupted final version bump without repeating secret writes", async () => {
		const adapter = new MemorySecrets();
		const secretStore = new ProviderSecretStore(adapter);
		let durable: Record<string, unknown> = {};
		let writes = 0;

		await expect(
			migrateWp7Data({
				stored: durable,
				settings: settings({ anthropicApiKey: "anthropic-private" }),
				secretStore,
				async persist(data) {
					writes += 1;
					if (writes === 3) throw new Error("simulated interruption");
					durable = structuredClone(data);
				},
			})
		).rejects.toThrow("simulated interruption");
		const secretWritesBeforeRestart = adapter.operations.filter((operation) =>
			operation.startsWith("set:")
		).length;

		const resumed = await migrateWp7Data({
			stored: durable,
			settings: durable.talos as TestSettings,
			secretStore,
			persist(data) {
				durable = structuredClone(data);
			},
		});

		expect(resumed.status).toBe("complete");
		expect(resumed.record.schemaVersion).toBe(1);
		expect(
			adapter.operations.filter((operation) => operation.startsWith("set:"))
		).toHaveLength(secretWritesBeforeRestart);
	});

	it("is idempotent after schema v1 and keeps legacy command compatibility", async () => {
		const completed = {
			talos: settings(),
			wp7Migration: {
				schemaVersion: 1,
				completedSteps: ["settings-and-sessions", "provider-secrets"],
			},
		};
		let persistCalls = 0;

		const result = await migrateWp7Data({
			stored: completed,
			settings: completed.talos,
			secretStore: null,
			persist() {
				persistCalls += 1;
			},
		});

		expect(result.status).toBe("complete");
		expect(persistCalls).toBe(0);
		expect(mainSource).toContain("migrateWp7Data");
		expect(mainSource).toContain('id: "open-quyuan-v2"');
		// C-3b（D-TLP-016）：旧右侧栏 JarvisView 与 open-jarvis 回滚命令随旧引擎栈移除，
		// 语音统一走控制台内屈原语音页；此处由「存在性」反转为「不存在」契约。
		expect(mainSource).not.toContain('id: "open-jarvis"');
		expect(mainSource).not.toContain("jarvis-view");
		expect(mainSource).toContain("VIEW_TYPE_TALOS_AGENT_RECOVERY");
		expect(mainSource).not.toContain("VIEW_TYPE_CLAUDIAN");
	});

	it("scrubs a stale flat Aliyun key after schema v1 without replacing the verified secret", async () => {
		const adapter = new MemorySecrets();
		adapter.values.set("talos-aliyun-api-key", "current-secret");
		const secretStore = new ProviderSecretStore(adapter);
		const completedSettings = settings({
			providerSecretRefs: {
				aliyunApiKey: "talos-aliyun-api-key",
			},
		});
		const completed = {
			aliyunApiKey: "stale-flat-secret",
			talos: completedSettings,
			wp7Migration: {
				schemaVersion: 1,
				completedSteps: ["settings-and-sessions", "provider-secrets"],
			},
		};
		const snapshots: Record<string, unknown>[] = [];

		const result = await migrateWp7Data({
			stored: completed,
			settings: completedSettings,
			secretStore,
			persist(data) {
				snapshots.push(structuredClone(data));
			},
		});

		expect(result.status).toBe("complete");
		expect(result.data).not.toHaveProperty("aliyunApiKey");
		expect(JSON.stringify(snapshots.at(-1))).not.toContain(
			"stale-flat-secret"
		);
		expect(adapter.values.get("talos-aliyun-api-key")).toBe(
			"current-secret"
		);
		expect(
			adapter.operations.filter((operation) => operation.startsWith("set:"))
		).toHaveLength(0);
	});

	it("retains a flat key and blocks cleanup when schema v1 cannot verify SecretStorage", async () => {
		const completedSettings = settings();
		const completed = {
			aliyunApiKey: "must-survive",
			talos: completedSettings,
			wp7Migration: {
				schemaVersion: 1,
				completedSteps: ["settings-and-sessions", "provider-secrets"],
			},
		};
		let persistCalls = 0;

		const result = await migrateWp7Data({
			stored: completed,
			settings: completedSettings,
			secretStore: null,
			persist() {
				persistCalls += 1;
			},
		});

		expect(result.status).toBe("blocked");
		expect(result.data.aliyunApiKey).toBe("must-survive");
		expect(persistCalls).toBe(0);
	});
});
