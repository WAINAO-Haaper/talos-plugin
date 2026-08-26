import type { ProviderProfile } from "../contracts/provider-profile";

export const TALOS_MANAGED_PROVIDER_PROFILE_IDS = ["anthropic", "openai"] as const;

export interface TalosProviderProfileSettings {
	anthropicBaseUrl: string;
	codexBaseUrl: string;
	jarvisModel: string;
	codexModel: string;
	agentWorkbenchClaudeModels: string;
	agentWorkbenchCodexModels: string;
	providerSecretRefs: {
		anthropicApiKey?: string;
		codexApiKey?: string;
	};
}

export function parseModelCatalog(value: string, legacyModel = ""): string[] {
	return Array.from(
		new Set(
			`${value}\n${legacyModel}`
				.split(/[\r\n,]+/)
				.map((model) => model.trim())
				.filter(Boolean)
		)
	);
}

export function buildTalosProviderProfiles(
	settings: TalosProviderProfileSettings,
	hasSecret: (reference: string) => boolean
): ProviderProfile[] {
	const profiles: ProviderProfile[] = [];
	const anthropicSecretRef = settings.providerSecretRefs.anthropicApiKey;
	if (anthropicSecretRef && hasSecret(anthropicSecretRef)) {
		profiles.push({
			id: "anthropic",
			displayName: "Anthropic API",
			runtimeId: "claude",
			protocol: "anthropic-agent",
			...(settings.anthropicBaseUrl.trim()
				? { endpoint: settings.anthropicBaseUrl.trim() }
				: {}),
			models: parseModelCatalog(
				settings.agentWorkbenchClaudeModels,
				settings.jarvisModel
			),
			headerNames: ["x-api-key", "anthropic-version"],
			secretRef: anthropicSecretRef,
			enabled: true,
		});
	}

	const codexSecretRef = settings.providerSecretRefs.codexApiKey;
	if (codexSecretRef && hasSecret(codexSecretRef)) {
		profiles.push({
			id: "openai",
			displayName: "OpenAI Responses API",
			runtimeId: "codex",
			protocol: "openai-responses",
			...(settings.codexBaseUrl.trim()
				? { endpoint: settings.codexBaseUrl.trim() }
				: {}),
			models: parseModelCatalog(
				settings.agentWorkbenchCodexModels,
				settings.codexModel
			),
			headerNames: ["authorization"],
			secretRef: codexSecretRef,
			enabled: true,
		});
	}

	return profiles;
}
