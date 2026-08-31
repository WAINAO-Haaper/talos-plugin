import { describe, expect, it } from "vitest";
import {
	buildTalosProviderProfiles,
	parseModelCatalog,
	preferredDirectApiProfile,
} from "../src/agent-workbench/config/talos-provider-profiles";
import {
	providerEnvironmentForRuntime,
} from "../src/agent-workbench/discovery/desktop-runtime-factory";
import type { ProviderProfile } from "../src/agent-workbench/contracts/provider-profile";
import { RuntimeBindingStore } from "../src/agent-workbench/storage/runtime-binding-store";

const settings = {
	anthropicBaseUrl: "https://anthropic.example.test",
	openaiBaseUrl: "https://chat.example.test/v1",
	codexBaseUrl: "https://responses.example.test/v1",
	jarvisModel: "claude-legacy",
	openaiModel: "chat-legacy",
	codexModel: "codex-legacy",
	agentWorkbenchClaudeModels: "claude-a\nclaude-b\nclaude-a",
	agentWorkbenchCodexModels: "codex-a, codex-b",
	providerSecretRefs: {
		anthropicApiKey: "talos-anthropic-api-key",
		openaiApiKey: "talos-openai-api-key",
		codexApiKey: "talos-codex-api-key",
	},
};

describe("TALOS provider profile projection", () => {
	it("publishes only API profiles backed by SecretStorage references", () => {
		const onlyAnthropic = buildTalosProviderProfiles(
			settings,
			(reference) => reference === "talos-anthropic-api-key"
		);
		expect(onlyAnthropic).toEqual([
			expect.objectContaining({
				id: "anthropic",
				runtimeId: "claude",
				protocol: "anthropic-agent",
				secretRef: "talos-anthropic-api-key",
				models: ["claude-a", "claude-b", "claude-legacy"],
			}),
			expect.objectContaining({
				id: "anthropic-api",
				runtimeId: "claude",
				protocol: "anthropic-messages",
				secretRef: "talos-anthropic-api-key",
			}),
		]);
		expect(JSON.stringify(onlyAnthropic)).not.toContain("synthetic-secret-value");
	});

	it("projects OpenAI Chat as an explicit direct profile", () => {
		const profiles = buildTalosProviderProfiles(
			settings,
			(reference) => reference === "talos-openai-api-key",
		);
		expect(profiles).toEqual([
			expect.objectContaining({
				id: "openai-compatible",
				runtimeId: "codex",
				protocol: "openai-chat",
				endpoint: "https://chat.example.test/v1",
				models: ["chat-legacy"],
			}),
		]);
	});

	it("prefers the console-selected direct profile and falls back deterministically", () => {
		const profiles = buildTalosProviderProfiles(settings, () => true);
		expect(preferredDirectApiProfile(profiles, "claude-api")?.id).toBe("anthropic-api");
		expect(preferredDirectApiProfile(profiles, "codex-cli")?.id).toBe("openai-compatible");
		expect(preferredDirectApiProfile(
			profiles.filter((profile) => profile.id !== "openai-compatible"),
			"codex-cli",
		)?.id).toBe("anthropic-api");
	});

	it("deduplicates newline and comma model catalogs while retaining a legacy model", () => {
		expect(parseModelCatalog("model-a\nmodel-b, model-a", "model-c")).toEqual([
			"model-a",
			"model-b",
			"model-c",
		]);
	});
});

describe("provider runtime environment", () => {
	const claudeProfile: ProviderProfile = {
		id: "anthropic",
		displayName: "Anthropic API",
		runtimeId: "claude",
		protocol: "anthropic-agent",
		endpoint: "https://anthropic.example.test",
		models: ["claude-a"],
		secretRef: "talos-anthropic-api-key",
		enabled: true,
	};

	it("injects only the selected profile secret and endpoint", () => {
		const environment = providerEnvironmentForRuntime(
			"claude",
			claudeProfile,
			(reference) =>
				reference === "talos-anthropic-api-key"
					? "synthetic-secret-value"
					: null
		);
		expect(environment).toEqual({
			ANTHROPIC_API_KEY: "synthetic-secret-value",
			ANTHROPIC_BASE_URL: "https://anthropic.example.test",
		});
		expect(environment).not.toHaveProperty("OPENAI_API_KEY");
	});

	it("injects the selected Codex Responses API without leaking Anthropic settings", () => {
		const codexProfile: ProviderProfile = {
			id: "openai",
			displayName: "OpenAI Responses API",
			runtimeId: "codex",
			protocol: "openai-responses",
			endpoint: "https://responses.example.test/v1",
			models: ["codex-a"],
			secretRef: "talos-codex-api-key",
			enabled: true,
		};
		expect(
			providerEnvironmentForRuntime(
				"codex",
				codexProfile,
				() => "synthetic-codex-secret"
			)
		).toEqual({
			OPENAI_API_KEY: "synthetic-codex-secret",
			OPENAI_BASE_URL: "https://responses.example.test/v1",
		});
	});

	it("does not read SecretStorage for native auth and fails closed for a missing API secret", () => {
		let reads = 0;
		expect(
			providerEnvironmentForRuntime("claude", undefined, () => {
				reads += 1;
				return null;
			})
		).toEqual({});
		expect(reads).toBe(0);
		expect(() =>
			providerEnvironmentForRuntime("claude", claudeProfile, () => null)
		).toThrow("SecretStorage");
	});
});

describe("provider-scoped native bindings", () => {
	it("keeps native and API sessions separate while retaining legacy native fallback", async () => {
		let state: Record<string, unknown> | null = {
			bindings: {
				"legacy:codex": {
					runtimeId: "codex",
					sessionId: "legacy-native",
				},
			},
		};
		const store = new RuntimeBindingStore({
			read: async () => structuredClone(state),
			write: async (value) => {
				state = structuredClone(value);
			},
		});
		await store.set("conversation", {
			runtimeId: "codex",
			sessionId: "native-session",
		});
		await store.set("conversation", {
			runtimeId: "codex",
			sessionId: "api-session",
			providerProfileId: "openai",
		});
		expect(await store.get("conversation", "codex")).toMatchObject({
			sessionId: "native-session",
		});
		expect(await store.get("conversation", "codex", "openai")).toMatchObject({
			sessionId: "api-session",
			providerProfileId: "openai",
		});
		expect(await store.get("legacy", "codex")).toMatchObject({
			sessionId: "legacy-native",
		});
		expect(await store.get("legacy", "codex", "openai")).toBeNull();
	});
});
