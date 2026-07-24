import { describe, expect, it } from "vitest";
import {
	migrateLegacyProviderSecrets,
	type LegacySecretSettings,
} from "../src/ai/provider/settings-migration";
import {
	ProviderSecretStore,
	type SecretStoragePort,
} from "../src/ai/provider/provider-secret-store";

class MemorySecrets implements SecretStoragePort {
	readonly values = new Map<string, string>();
	readonly operations: string[] = [];
	failReadId: string | null = null;

	setSecret(id: string, value: string): void {
		this.operations.push(`set:${id}`);
		this.values.set(id, value);
	}

	getSecret(id: string): string | null {
		this.operations.push(`get:${id}`);
		if (id === this.failReadId) return "mismatch";
		return this.values.get(id) ?? null;
	}

	listSecrets(): string[] {
		return [...this.values.keys()];
	}
}

function legacy(): LegacySecretSettings {
	return {
		elevenLabsApiKey: "eleven-secret",
		aliyunApiKey: "aliyun-secret",
		anthropicApiKey: "anthropic-secret",
		openaiApiKey: "openai-secret",
		jarvisSttApiKey: "stt-secret",
		providerSecretRefs: {},
	};
}

describe("legacy provider secret migration", () => {
	it("writes, verifies, records references, then removes all plaintext fields", () => {
		const adapter = new MemorySecrets();
		const store = new ProviderSecretStore(adapter);
		const settings = legacy();

		const result = migrateLegacyProviderSecrets(settings, store);

		expect(result.migrated).toEqual([
			"elevenLabsApiKey",
			"aliyunApiKey",
			"anthropicApiKey",
			"openaiApiKey",
			"jarvisSttApiKey",
		]);
		expect(settings).toMatchObject({
			elevenLabsApiKey: "",
			aliyunApiKey: "",
			anthropicApiKey: "",
			openaiApiKey: "",
			jarvisSttApiKey: "",
			providerSecretRefs: {
				anthropicApiKey: "talos-anthropic-api-key",
				openaiApiKey: "talos-openai-api-key",
			},
		});
		expect(adapter.operations.slice(0, 5).every((op) => op.startsWith("set:")))
			.toBe(true);
		expect(adapter.operations.slice(5, 10).every((op) => op.startsWith("get:")))
			.toBe(true);
	});

	it("does not delete any plaintext or save references when verification fails", () => {
		const adapter = new MemorySecrets();
		adapter.failReadId = "talos-openai-api-key";
		const store = new ProviderSecretStore(adapter);
		const settings = legacy();
		const before = structuredClone(settings);

		expect(() => migrateLegacyProviderSecrets(settings, store)).toThrow(
			"talos-openai-api-key"
		);
		expect(settings).toEqual(before);
	});

	it("returns secret values only on demand and never exposes them in references", () => {
		const adapter = new MemorySecrets();
		const store = new ProviderSecretStore(adapter);

		store.set("talos-anthropic-api-key", "sk-private");

		expect(store.get("talos-anthropic-api-key")).toBe("sk-private");
		expect(store.reference("talos-anthropic-api-key")).toEqual({
			secretRef: "talos-anthropic-api-key",
		});
		expect(JSON.stringify(store.reference("talos-anthropic-api-key"))).not
			.toContain("sk-private");
	});
});
