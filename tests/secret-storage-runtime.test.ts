import { describe, expect, it } from "vitest";
import {
	migrateProviderSecretsOnStartup,
	providerSecretStoreFromApp,
	readProviderSecret,
	saveProviderSecret,
} from "../src/ai/provider/secret-storage-runtime";
import type { LegacySecretSettings } from "../src/ai/provider/settings-migration";
import type { SecretStoragePort } from "../src/ai/provider/provider-secret-store";

class MemorySecrets implements SecretStoragePort {
	readonly values = new Map<string, string>();

	setSecret(id: string, value: string): void {
		this.values.set(id, value);
	}

	getSecret(id: string): string | null {
		return this.values.get(id) ?? null;
	}

	listSecrets(): string[] {
		return [...this.values.keys()];
	}
}

function legacy(): LegacySecretSettings {
	return {
		elevenLabsApiKey: "",
		aliyunApiKey: "",
		anthropicApiKey: "anthropic-private",
		openaiApiKey: "",
		jarvisSttApiKey: "",
		providerSecretRefs: {},
	};
}

describe("SecretStorage runtime", () => {
	it("feature-detects unsupported Obsidian versions without a plaintext fallback", () => {
		expect(providerSecretStoreFromApp({})).toBeNull();
		expect(readProviderSecret(legacy(), "anthropicApiKey", null)).toBeNull();
	});

	it("stores a new key by reference without placing it in settings", () => {
		const settings = legacy();
		settings.anthropicApiKey = "";
		const storage = new MemorySecrets();
		const store = providerSecretStoreFromApp({ secretStorage: storage });

		saveProviderSecret(
			settings,
			"anthropicApiKey",
			"new-private",
			store
		);

		expect(settings.anthropicApiKey).toBe("");
		expect(settings.providerSecretRefs.anthropicApiKey).toBe(
			"talos-anthropic-api-key"
		);
		expect(readProviderSecret(settings, "anthropicApiKey", store)).toBe(
			"new-private"
		);
		expect(JSON.stringify(settings)).not.toContain("new-private");
	});

	it("restores the in-memory plaintext snapshot if persistence fails", async () => {
		const settings = legacy();
		const before = structuredClone(settings);
		const store = providerSecretStoreFromApp({
			secretStorage: new MemorySecrets(),
		});

		await expect(
			migrateProviderSecretsOnStartup(settings, store, async () => {
				throw new Error("save failed");
			})
		).rejects.toThrow("save failed");

		expect(settings).toEqual(before);
	});

	it("persists references only after every secret verifies", async () => {
		const settings = legacy();
		const storage = new MemorySecrets();
		const store = providerSecretStoreFromApp({
			secretStorage: storage,
		});
		let persisted = "";

		const result = await migrateProviderSecretsOnStartup(
			settings,
			store,
			async () => {
				persisted = JSON.stringify(settings);
			}
		);

		expect(result.migrated).toEqual(["anthropicApiKey"]);
		expect(persisted).not.toContain("anthropic-private");
		expect(settings.providerSecretRefs.anthropicApiKey).toBe(
			"talos-anthropic-api-key"
		);
	});
});
