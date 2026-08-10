import { describe, expect, it, vi } from "vitest";
import { MockProvider } from "../src/ai/provider/mock-provider";
import type { ProviderConfigFile } from "../src/ai/provider/provider-config-store";
import { ProviderFacade } from "../src/ai/provider/provider-facade";
import { ProviderSecretStore } from "../src/ai/provider/provider-secret-store";
import {
	ProviderCenter,
	buildProviderCenterSnapshot,
	engineProviderSettingForProvider,
	providerIdForEngineSetting,
} from "../src/ui/provider-center";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

function config(): ProviderConfigFile {
	return {
		version: 1,
		providers: [
			{
				id: "mock-a",
				name: "Mock A",
				kind: "mock",
				endpoint: "mock://local",
				model: "mock-model-a",
				capabilities: ["chat", "stream", "cancel"],
				isDefault: true,
				secretRef: "talos-mock-a-key",
				vaultAccess: "denied",
				moduleAccess: {},
			},
			{
				id: "mock-b",
				name: "Mock B",
				kind: "mock",
				endpoint: "mock://local",
				model: "mock-model-b",
				capabilities: ["chat", "tools"],
				isDefault: false,
				secretRef: "talos-mock-b-key",
				vaultAccess: "denied",
				moduleAccess: {},
			},
		],
	};
}

function facade(): ProviderFacade {
	const facade = new ProviderFacade();
	for (const [id, capabilities] of [
		["mock-a", ["chat", "stream", "cancel"]],
		["mock-b", ["chat", "tools"]],
	] as const) {
		facade.register(
			new MockProvider({
				id,
				seed: 0,
				capabilities: [...capabilities],
				fixtures: [[{ type: "done" }]],
			})
		);
	}
	return facade;
}

describe("ProviderCenter", () => {
	it("preserves registered mock provider ids while retaining legacy aliases", () => {
		expect(engineProviderSettingForProvider("claude-api")).toBe("claude-api");
		expect(engineProviderSettingForProvider("openai-compatible")).toBe("codex");
		expect(engineProviderSettingForProvider("claude")).toBe("claude-cli");
		expect(engineProviderSettingForProvider("codex")).toBe("codex-cli");
		expect(engineProviderSettingForProvider("mock-acceptance")).toBe(
			"mock-acceptance"
		);
		expect(providerIdForEngineSetting("claude-api")).toBe("claude-api");
		expect(providerIdForEngineSetting("codex")).toBe("openai-compatible");
		expect(providerIdForEngineSetting("claude-cli")).toBe("claude");
		expect(providerIdForEngineSetting("codex-cli")).toBe("codex");
		expect(providerIdForEngineSetting("mock-acceptance")).toBe(
			"mock-acceptance"
		);
	});

	it("projects provider, model, capability and connection state without reading or rendering secrets", () => {
		const getSecret = vi.fn(() => {
			throw new Error("Provider center must not read secret values");
		});
		const secrets = new ProviderSecretStore({
			setSecret: vi.fn(),
			getSecret,
			listSecrets: () => ["talos-mock-a-key"],
		});
		const snapshot = buildProviderCenterSnapshot({
			facade: facade(),
			config: config(),
			secrets,
		});
		const { host, element } = createMiniHost();
		new ProviderCenter({
			parent: host,
			snapshot,
			onSelectProvider: vi.fn(),
			onChangeModel: vi.fn(),
		}).mount();

		expect(snapshot.providers).toEqual([
			expect.objectContaining({
				id: "mock-a",
				model: "mock-model-a",
				capabilities: ["chat", "stream", "cancel"],
				connection: "configured",
				selected: true,
			}),
			expect.objectContaining({
				id: "mock-b",
				connection: "missing-secret",
				selected: false,
			}),
		]);
		expect(element.textContent).toContain("Mock A");
		expect(
			element.querySelector<MiniElement>(
				"input[data-provider-model='mock-a']"
			)?.value
		).toBe("mock-model-a");
		expect(element.textContent).toContain("chat");
		expect(element.textContent).not.toContain("talos-mock-a-key");
		expect(element.textContent).not.toContain("secret-value");
		expect(getSecret).not.toHaveBeenCalled();
	});

	it("switches provider and model through separate controls without invoking provider chat", () => {
		const providerFacade = facade();
		const select = vi.fn();
		const changeModel = vi.fn();
		const { host, element } = createMiniHost();
		new ProviderCenter({
			parent: host,
			snapshot: buildProviderCenterSnapshot({
				facade: providerFacade,
				config: config(),
				secrets: null,
			}),
			onSelectProvider: select,
			onChangeModel: changeModel,
		}).mount();

		element
			.querySelector<MiniElement>(
				"button[data-provider-select='mock-b']"
			)
			?.click();
		const model = element.querySelector<MiniElement>(
			"input[data-provider-model='mock-b']"
		);
		if (model) model.value = "mock-model-b2";
		element
			.querySelector<MiniElement>(
				"button[data-provider-model-save='mock-b']"
			)
			?.click();

		expect(select).toHaveBeenCalledWith("mock-b");
		expect(changeModel).toHaveBeenCalledWith("mock-b", "mock-model-b2");
	});
});
