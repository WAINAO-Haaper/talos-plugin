import type { App } from "obsidian";
import type { TalosSettings } from "../../settings";
import {
	ProviderConfigStore,
	type ProviderConfigFile,
} from "./provider-config-store";

type ProviderConfigSettings = Pick<
	TalosSettings,
	| "engineProvider"
	| "anthropicBaseUrl"
	| "jarvisModel"
	| "openaiBaseUrl"
	| "openaiModel"
	| "providerVaultAccess"
	| "providerSecretRefs"
>;

export function buildProviderConfig(
	settings: ProviderConfigSettings
): ProviderConfigFile {
	const vaultAccess = settings.providerVaultAccess ? "full" : "denied";
	return {
		version: 1,
		providers: [
			{
				id: "claude-api",
				name: "Claude API",
				kind: "api",
				endpoint:
					settings.anthropicBaseUrl.trim() ||
					"https://api.anthropic.com",
				model:
					settings.jarvisModel.trim() || "claude-sonnet-4-6",
				capabilities: [
					"chat",
					"stream",
					"tools",
					"usage",
					"cancel",
					"resume",
					"fork",
				],
				isDefault: settings.engineProvider === "claude-api",
				secretRef:
					settings.providerSecretRefs.anthropicApiKey ||
					"talos-anthropic-api-key",
				vaultAccess,
			},
			{
				id: "openai-compatible",
				name: "OpenAI-compatible API",
				kind: "api",
				endpoint:
					settings.openaiBaseUrl.trim() ||
					"https://api.openai.com",
				model: settings.openaiModel.trim() || "gpt-4o",
				capabilities: [
					"chat",
					"stream",
					"tools",
					"usage",
					"cancel",
					"resume",
					"fork",
				],
				isDefault: settings.engineProvider === "codex",
				secretRef:
					settings.providerSecretRefs.openaiApiKey ||
					"talos-openai-api-key",
				vaultAccess,
			},
		],
	};
}

export async function saveProviderConfigToVault(
	app: App,
	settings: ProviderConfigSettings
): Promise<void> {
	const adapter = app.vault.adapter;
	const directory = ".talos";
	const path = `${directory}/provider.json`;
	const store = new ProviderConfigStore({
		read: async () =>
			(await adapter.exists(path)) ? await adapter.read(path) : "",
		write: async (value) => {
			if (!(await adapter.exists(directory))) {
				await adapter.mkdir(directory);
			}
			await adapter.write(path, value);
		},
	});
	await store.save(buildProviderConfig(settings));
}
