import { describe, expect, it } from "vitest";
import type { WorkbenchSettings } from "../src/agent-workbench/storage/workbench-settings-store";
import { WorkbenchSettingsStore } from "../src/agent-workbench/storage/workbench-settings-store";
import { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";

function settings(): WorkbenchSettings {
	return {
		schemaVersion: 1,
		runtimes: [{ id: "codex-local", runtimeId: "codex", executablePath: "/synthetic/codex" }],
		providers: [{
			id: "openai-main", displayName: "OpenAI", runtimeId: "codex", protocol: "openai-responses",
			endpoint: "https://api.example.test/", models: ["model-a"], secretRef: "talos-openai-main", enabled: true,
		}],
		selection: { runtimeId: "codex", providerProfileId: "openai-main", model: "model-a" },
		workflow: "plan", permission: "ask",
	};
}

describe("WorkbenchSettingsStore", () => {
	it("stores only provider secret references and normalizes the displayed endpoint", async () => {
		const persisted: WorkbenchSettings[] = [];
		let secretReads = 0;
		const store = new WorkbenchSettingsStore(
			{ read: async () => persisted.at(-1) ?? null, write: async (value) => { persisted.push(structuredClone(value)); } },
			{ has: (reference) => { secretReads += 1; return reference === "talos-openai-main"; } },
		);
		await store.save(settings());
		const saved = persisted.at(0);
		expect(saved?.providers.at(0)?.endpoint).toBe("https://api.example.test");
		expect(JSON.stringify(saved)).not.toMatch(/sk-|bearer|apiKey|password/i);
		const provider = saved?.providers.at(0);
		if (!provider) throw new Error("expected saved provider");
		expect(store.authenticationStatus(provider)).toBe("configured");
		expect(secretReads).toBe(1);
	});

	it("rejects protocol mismatch, invalid secret refs and plaintext secret fields", async () => {
		const store = new WorkbenchSettingsStore({ read: async () => null, write: async () => {} }, { has: () => false });
		const wrongProtocol = settings();
		const wrongProtocolProvider = wrongProtocol.providers.at(0);
		if (!wrongProtocolProvider) throw new Error("expected provider fixture");
		wrongProtocolProvider.protocol = "openai-chat";
		await expect(store.save(wrongProtocol)).rejects.toThrow("Responses");
		const wrongRef = settings();
		const wrongRefProvider = wrongRef.providers.at(0);
		if (!wrongRefProvider) throw new Error("expected provider fixture");
		wrongRefProvider.secretRef = "not valid";
		await expect(store.save(wrongRef)).rejects.toThrow("secretRef");
		const plaintext = { ...settings(), apiKey: "sk-synthetic-not-a-real-secret" } as unknown as WorkbenchSettings;
		await expect(store.save(plaintext)).rejects.toThrow("禁止字段");
	});

	it("restores provider/runtime/model selection and clears incompatible fields on runtime switch", async () => {
		let value = settings();
		const store = new WorkbenchSettingsStore(
			{ read: async () => structuredClone(value), write: async (next) => { value = structuredClone(next); } },
			{ has: () => true },
		);
		const service = new AgentWorkbenchService({ compatibility: { initialize: async () => {}, dispose: () => {} }, settingsStore: store });
		await service.initialize();
		expect(service.getSelectedRuntimeId()).toBe("codex");
		expect(service.getSelection()).toEqual({ runtimeId: "codex", providerProfileId: "openai-main", model: "model-a" });
		expect(service.getRuntimeProfile("codex")?.executablePath).toBe("/synthetic/codex");
		expect(await service.listModels("codex")).toEqual([{ id: "model-a", label: "model-a", providerProfileId: "openai-main" }]);
		service.selectRuntime("ohmypi");
		service.setWorkflowMode("execute");
		service.setPermissionMode("scoped");
		await service.flushSettings();
		expect(value).toMatchObject({ selection: { runtimeId: "ohmypi" }, workflow: "execute", permission: "scoped" });
		expect(value.selection).toEqual({ runtimeId: "ohmypi" });
		expect(value.providers[0]?.secretRef).toBe("talos-openai-main");
	});
});

it("allows egress only to the selected provider profile", async () => {
	let value = settings();
	value.providers.push({
		id: "openai-unused", displayName: "Unused", runtimeId: "codex", protocol: "openai-responses",
		endpoint: "https://unused.example.test", models: ["model-unused"], enabled: true,
	});
	let providerEgressHosts: string[] = [];
	const store = new WorkbenchSettingsStore(
		{ read: async () => structuredClone(value), write: async (next) => { value = structuredClone(next); } },
		{ has: () => true },
	);
	const approvalBroker = {
		evaluate: async (_request: unknown, context: { providerEgressHosts?: string[] }) => {
			providerEgressHosts = context.providerEgressHosts ?? [];
			return { decision: "allow" };
		},
		rememberExactRule: async () => undefined,
	} as never;
	const service = new AgentWorkbenchService({
		compatibility: { initialize: async () => {}, dispose: () => {} },
		settingsStore: store,
		approvalBroker,
	});
	await service.initialize();
	service.setWorkflowMode("execute");
	await service.authorizeTool({
		runtimeId: "codex", conversationId: "conversation-1", vaultRoot: "/synthetic/vault",
		toolName: "NetworkRequest", toolInput: { url: "https://api.example.test/v1" },
		approvalUiAttached: true,
		prompt: async () => "deny",
	});
	expect(providerEgressHosts).toEqual(["api.example.test"]);
});
