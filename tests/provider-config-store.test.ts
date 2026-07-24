import { describe, expect, it } from "vitest";
import {
	ProviderConfigStore,
	type ProviderConfigPersistence,
} from "../src/ai/provider/provider-config-store";

function memoryPersistence(): ProviderConfigPersistence & { value: string } {
	return {
		value: "",
		read() {
			return this.value;
		},
		write(value) {
			this.value = value;
		},
	};
}

describe("ProviderConfigStore", () => {
	it("saves only non-sensitive provider metadata", async () => {
		const persistence = memoryPersistence();
		const store = new ProviderConfigStore(persistence);

		await store.save({
			version: 1,
			providers: [
				{
					id: "anthropic-main",
					name: "Claude",
					kind: "api",
					endpoint: "https://api.anthropic.com",
					model: "claude-sonnet",
					capabilities: ["chat", "stream", "tools"],
					isDefault: true,
					secretRef: "talos-anthropic-api-key",
					vaultAccess: "full",
				},
			],
		});

		expect(JSON.parse(persistence.value)).toMatchObject({
			version: 1,
			providers: [
				{
					id: "anthropic-main",
					secretRef: "talos-anthropic-api-key",
					vaultAccess: "full",
				},
			],
		});
	});

	it.each([
		[{ apiKey: "sk-private" }, "apiKey"],
		[{ token: "private-token" }, "token"],
		[{ Authorization: "Bearer private" }, "Authorization"],
		[{ endpoint: "https://example.com?token=private" }, "endpoint"],
	])("rejects sensitive config %j", async (extra, expected) => {
		const store = new ProviderConfigStore(memoryPersistence());
		const provider = {
			id: "unsafe",
			name: "Unsafe",
			kind: "api" as const,
			endpoint: "https://example.com",
			model: "model",
			capabilities: ["chat" as const],
			isDefault: false,
			secretRef: "talos-unsafe-key",
			vaultAccess: "full" as const,
			...extra,
		};

		await expect(
			store.save({ version: 1, providers: [provider] })
		).rejects.toThrow(expected);
	});
});
