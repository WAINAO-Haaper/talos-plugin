import { describe, expect, it } from "vitest";
import { buildProviderConfig } from "../src/ai/provider/provider-config-runtime";

describe("Provider config runtime", () => {
	it("projects settings to non-sensitive .talos/provider.json metadata", () => {
		const config = buildProviderConfig({
			engineProvider: "codex",
			anthropicBaseUrl: "https://api.anthropic.com",
			jarvisModel: "claude-sonnet",
			openaiBaseUrl: "https://gateway.test",
			openaiModel: "model-x",
			providerVaultAccess: true,
			providerSecretRefs: {
				anthropicApiKey: "talos-anthropic-api-key",
				openaiApiKey: "talos-openai-api-key",
			},
		});

		expect(config).toMatchObject({
			version: 1,
			providers: [
				{
					id: "claude-api",
					isDefault: false,
					secretRef: "talos-anthropic-api-key",
					vaultAccess: "full",
				},
				{
					id: "openai-compatible",
					isDefault: true,
					endpoint: "https://gateway.test",
					model: "model-x",
				},
			],
		});
		const serialized = JSON.stringify(config);
		expect(serialized).not.toContain("apiKey");
		expect(serialized).not.toContain("Authorization");
	});
});
