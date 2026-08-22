import {
	ProviderSecretStore,
	type SecretStoragePort,
} from "./provider-secret-store";
import {
	migrateLegacyProviderSecrets,
	type LegacySecretField,
	type LegacySecretMigrationResult,
	type LegacySecretSettings,
} from "./settings-migration";

const SECRET_IDS: Readonly<Record<LegacySecretField, string>> = {
	elevenLabsApiKey: "talos-elevenlabs-api-key",
	aliyunApiKey: "talos-aliyun-api-key",
	anthropicApiKey: "talos-anthropic-api-key",
	openaiApiKey: "talos-openai-api-key",
	codexApiKey: "talos-codex-api-key",
	jarvisSttApiKey: "talos-stt-api-key",
};

interface AppWithOptionalSecretStorage {
	secretStorage?: SecretStoragePort;
}

export function providerSecretStoreFromApp(
	app: AppWithOptionalSecretStorage
): ProviderSecretStore | null {
	const storage = app.secretStorage;
	if (
		!storage ||
		typeof storage.setSecret !== "function" ||
		typeof storage.getSecret !== "function" ||
		typeof storage.listSecrets !== "function"
	) {
		return null;
	}
	return new ProviderSecretStore(storage);
}

export function readProviderSecret(
	settings: LegacySecretSettings,
	field: LegacySecretField,
	store: ProviderSecretStore | null
): string | null {
	const reference = settings.providerSecretRefs[field];
	if (!reference || !store) return null;
	return store.get(reference);
}

export function saveProviderSecret(
	settings: LegacySecretSettings,
	field: LegacySecretField,
	value: string,
	store: ProviderSecretStore | null
): void {
	if (!store) {
		throw new Error("当前 Obsidian 版本不支持 SecretStorage");
	}
	const secretId = SECRET_IDS[field];
	store.set(secretId, value.trim());
	if (store.get(secretId) !== value.trim()) {
		throw new Error(`SecretStorage verification failed: ${secretId}`);
	}
	settings[field] = "";
	settings.providerSecretRefs = {
		...settings.providerSecretRefs,
		[field]: secretId,
	};
}

export async function migrateProviderSecretsOnStartup(
	settings: LegacySecretSettings,
	store: ProviderSecretStore | null,
	persist: () => Promise<void>
): Promise<LegacySecretMigrationResult> {
	if (!store) {
		return {
			migrated: [],
			references: { ...settings.providerSecretRefs },
		};
	}
	const snapshot = structuredClone(settings);
	try {
		const result = migrateLegacyProviderSecrets(settings, store);
		if (result.migrated.length > 0) await persist();
		return result;
	} catch (error) {
		Object.assign(settings, snapshot);
		throw error;
	}
}
