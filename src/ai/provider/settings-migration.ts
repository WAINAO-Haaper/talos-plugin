import type { ProviderSecretStore } from "./provider-secret-store";

export type LegacySecretField =
	| "elevenLabsApiKey"
	| "aliyunApiKey"
	| "anthropicApiKey"
	| "openaiApiKey"
	| "jarvisSttApiKey";

export interface LegacySecretSettings
	extends Record<LegacySecretField, string> {
	providerSecretRefs: Partial<Record<LegacySecretField, string>>;
}

export interface LegacySecretMigrationResult {
	migrated: LegacySecretField[];
	references: Partial<Record<LegacySecretField, string>>;
}

const SECRET_IDS: ReadonlyArray<
	readonly [LegacySecretField, string]
> = [
	["elevenLabsApiKey", "talos-elevenlabs-api-key"],
	["aliyunApiKey", "talos-aliyun-api-key"],
	["anthropicApiKey", "talos-anthropic-api-key"],
	["openaiApiKey", "talos-openai-api-key"],
	["jarvisSttApiKey", "talos-stt-api-key"],
];

export function migrateLegacyProviderSecrets(
	settings: LegacySecretSettings,
	store: ProviderSecretStore
): LegacySecretMigrationResult {
	const pending = SECRET_IDS.flatMap(([field, secretId]) => {
		const value = settings[field].trim();
		return value ? [{ field, secretId, value }] : [];
	});
	if (pending.length === 0) {
		return { migrated: [], references: { ...settings.providerSecretRefs } };
	}

	// SecretStorage 是同步 API：先写完全部，再逐项读回验证。只有所有项都
	// 验证成功后才改变 settings，避免 data.json 出现半迁移状态。
	for (const item of pending) store.set(item.secretId, item.value);
	for (const item of pending) {
		if (store.get(item.secretId) !== item.value) {
			throw new Error(`SecretStorage verification failed: ${item.secretId}`);
		}
	}

	const references = { ...settings.providerSecretRefs };
	for (const item of pending) references[item.field] = item.secretId;
	for (const item of pending) settings[item.field] = "";
	settings.providerSecretRefs = references;
	return {
		migrated: pending.map((item) => item.field),
		references: { ...references },
	};
}
