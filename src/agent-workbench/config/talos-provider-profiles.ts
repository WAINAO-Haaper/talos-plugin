import type { ProviderProfile } from "../contracts/provider-profile";

export const TALOS_MANAGED_PROVIDER_PROFILE_IDS = [
	"anthropic",
	"anthropic-api",
	"openai",
	"openai-compatible",
] as const;

export interface TalosProviderProfileSettings {
	anthropicBaseUrl: string;
	openaiBaseUrl: string;
	codexBaseUrl: string;
	jarvisModel: string;
	openaiModel: string;
	codexModel: string;
	agentWorkbenchClaudeModels: string;
	agentWorkbenchCodexModels: string;
	providerSecretRefs: {
		anthropicApiKey?: string;
		openaiApiKey?: string;
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

export function preferredDirectApiProfile(
	profiles: ProviderProfile[],
	engineProvider: string,
): ProviderProfile | undefined {
	const preferredId = engineProvider === "claude-api"
		? "anthropic-api"
		: "openai-compatible";
	const direct = profiles.filter((profile) =>
		profile.enabled
		&& (
			profile.protocol === "openai-chat"
			|| profile.protocol === "anthropic-messages"
		)
	);
	return direct.find((profile) => profile.id === preferredId) ?? direct[0];
}

export function buildTalosProviderProfiles(
	settings: TalosProviderProfileSettings,
	hasSecret: (reference: string) => boolean
): ProviderProfile[] {
	const profiles: ProviderProfile[] = [];
	const anthropicSecretRef = settings.providerSecretRefs.anthropicApiKey;
	if (anthropicSecretRef && hasSecret(anthropicSecretRef)) {
		const models = parseModelCatalog(
			settings.agentWorkbenchClaudeModels,
			settings.jarvisModel
		);
		profiles.push({
			id: "anthropic",
			displayName: "Anthropic Agent API",
			runtimeId: "claude",
			protocol: "anthropic-agent",
			...(settings.anthropicBaseUrl.trim()
				? { endpoint: settings.anthropicBaseUrl.trim() }
				: {}),
			models,
			headerNames: ["x-api-key", "anthropic-version"],
			secretRef: anthropicSecretRef,
			enabled: true,
		});
		profiles.push({
			id: "anthropic-api",
			displayName: "Anthropic Messages · Direct API",
			runtimeId: "claude",
			protocol: "anthropic-messages",
			...(settings.anthropicBaseUrl.trim()
				? { endpoint: settings.anthropicBaseUrl.trim() }
				: {}),
			models: models.length > 0 ? models : ["claude-sonnet-4-6"],
			headerNames: ["x-api-key", "anthropic-version"],
			secretRef: anthropicSecretRef,
			enabled: true,
		});
	}

	const openAiSecretRef = settings.providerSecretRefs.openaiApiKey;
	if (openAiSecretRef && hasSecret(openAiSecretRef)) {
		profiles.push({
			id: "openai-compatible",
			displayName: "OpenAI-compatible · Direct API",
			runtimeId: "codex",
			protocol: "openai-chat",
			...(settings.openaiBaseUrl.trim()
				? { endpoint: settings.openaiBaseUrl.trim() }
				: {}),
			models: [settings.openaiModel.trim() || "gpt-4o"],
			headerNames: ["authorization"],
			secretRef: openAiSecretRef,
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
