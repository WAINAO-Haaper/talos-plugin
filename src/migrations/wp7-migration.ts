import type { ProviderSecretStore } from "../ai/provider/provider-secret-store";
import {
	migrateLegacyProviderSecrets,
	type LegacySecretField,
	type LegacySecretSettings,
} from "../ai/provider/settings-migration";

export const WP7_MIGRATION_SCHEMA_VERSION = 1;
const SETTINGS_STEP = "settings-and-sessions";
const SECRETS_STEP = "provider-secrets";
const SECRET_FIELDS: LegacySecretField[] = [
	"elevenLabsApiKey",
	"aliyunApiKey",
	"anthropicApiKey",
	"openaiApiKey",
	"codexApiKey",
	"jarvisSttApiKey",
];

export interface Wp7MigrationRecord {
	schemaVersion: number;
	completedSteps: string[];
}

export interface Wp7MigrationOptions<T extends LegacySecretSettings> {
	stored: Record<string, unknown>;
	settings: T;
	secretStore: ProviderSecretStore | null;
	persist(data: Record<string, unknown>): void | Promise<void>;
}

export interface Wp7MigrationResult<T extends LegacySecretSettings> {
	data: Record<string, unknown>;
	settings: T;
	record: Wp7MigrationRecord;
	status: "complete" | "blocked";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Wp7MigrationRecord {
	if (!isRecord(value)) {
		return { schemaVersion: 0, completedSteps: [] };
	}
	const schemaVersion =
		typeof value.schemaVersion === "number" &&
		Number.isInteger(value.schemaVersion) &&
		value.schemaVersion >= 0
			? value.schemaVersion
			: 0;
	if (schemaVersion > WP7_MIGRATION_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported WP7 migration schema version: ${schemaVersion}`
		);
	}
	const completedSteps = Array.isArray(value.completedSteps)
		? [
				...new Set(
					value.completedSteps.filter(
						(step): step is string => typeof step === "string"
					)
				),
			]
		: [];
	return { schemaVersion, completedSteps };
}

function hasPlaintextSecrets(settings: LegacySecretSettings): boolean {
	return SECRET_FIELDS.some((field) => settings[field].trim() !== "");
}

function addStep(record: Wp7MigrationRecord, step: string): void {
	if (!record.completedSteps.includes(step)) {
		record.completedSteps.push(step);
	}
}

function removeStep(record: Wp7MigrationRecord, step: string): void {
	record.completedSteps = record.completedSteps.filter(
		(completed) => completed !== step
	);
}

export async function migrateWp7Data<T extends LegacySecretSettings>(
	options: Wp7MigrationOptions<T>
): Promise<Wp7MigrationResult<T>> {
	const data = structuredClone(options.stored);
	let settings = structuredClone(options.settings);
	const record = readRecord(data.wp7Migration);
	const persist = async (): Promise<void> => {
		data.talos = structuredClone(settings);
		data.wp7Migration = structuredClone(record);
		await options.persist(structuredClone(data));
	};

	if (record.schemaVersion === WP7_MIGRATION_SCHEMA_VERSION) {
		// Some WP6/WP7 transition builds left a second, flat copy of settings
		// beside the namespaced `talos` object. A completed schema marker must not
		// make those plaintext secrets permanent. Prefer a verified existing
		// SecretStorage value; only use the flat value to recover a missing secret.
		const rootSecretFields = SECRET_FIELDS.filter((field) =>
			Object.prototype.hasOwnProperty.call(data, field)
		);
		const rootPlaintextFields = rootSecretFields.filter((field) =>
			typeof data[field] === "string" && data[field].trim() !== ""
		);
		const hasNamespacedPlaintext = hasPlaintextSecrets(settings);
		if (
			(rootPlaintextFields.length > 0 || hasNamespacedPlaintext) &&
			!options.secretStore
		) {
			return {
				data,
				settings,
				record,
				status: "blocked",
			};
		}

		if (
			options.secretStore &&
			(rootPlaintextFields.length > 0 || hasNamespacedPlaintext)
		) {
			const migrated = structuredClone(settings);
			for (const field of rootPlaintextFields) {
				const reference = migrated.providerSecretRefs[field];
				const existing = reference
					? options.secretStore.get(reference)
					: null;
				if (!existing && !migrated[field].trim()) {
					migrated[field] = String(data[field]).trim();
				}
			}
			migrateLegacyProviderSecrets(migrated, options.secretStore);
			for (const field of rootPlaintextFields) {
				const reference = migrated.providerSecretRefs[field];
				if (!reference || !options.secretStore.get(reference)) {
					throw new Error(`SecretStorage verification failed: ${field}`);
				}
			}
			settings = migrated;
		}

		if (rootSecretFields.length > 0 || hasNamespacedPlaintext) {
			for (const field of rootSecretFields) delete data[field];
			await persist();
		}
		return {
			data,
			settings,
			record,
			status: "complete",
		};
	}
	if (!isRecord(options.stored.talos)) {
		for (const key of Object.keys(settings)) delete data[key];
	}

	if (!record.completedSteps.includes(SETTINGS_STEP)) {
		addStep(record, SETTINGS_STEP);
		await persist();
	}

	// A completed secret step may only be trusted when plaintext is gone. If a
	// prior interrupted build persisted an inconsistent marker, rerun it.
	if (
		record.completedSteps.includes(SECRETS_STEP) &&
		hasPlaintextSecrets(settings)
	) {
		removeStep(record, SECRETS_STEP);
	}

	if (!record.completedSteps.includes(SECRETS_STEP)) {
		if (hasPlaintextSecrets(settings) && !options.secretStore) {
			return {
				data,
				settings,
				record,
				status: "blocked",
			};
		}
		const migrated = structuredClone(settings);
		if (options.secretStore) {
			migrateLegacyProviderSecrets(migrated, options.secretStore);
		}
		settings = migrated;
		addStep(record, SECRETS_STEP);
		await persist();
	}

	record.schemaVersion = WP7_MIGRATION_SCHEMA_VERSION;
	await persist();
	return {
		data,
		settings,
		record,
		status: "complete",
	};
}
