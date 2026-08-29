import type { DataAdapter } from "obsidian";
import type { ProviderSecretStore } from "../../ai/provider/provider-secret-store";
import { saveProviderSecret } from "../../ai/provider/secret-storage-runtime";
import type { LegacySecretSettings } from "../../ai/provider/settings-migration";

const LEGACY_SETTINGS_PATHS = [
	".talos/agent-workbench/v1/compatibility-settings.json",
	".talos/quyuan/claudian-settings.json",
	".talos/quyuan/legacy-settings.json",
] as const;

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function codexEnvironment(settings: Record<string, unknown>): string {
	const providerConfigs = record(settings.providerConfigs);
	const codex = record(providerConfigs.codex);
	for (const value of [codex.environmentVariables, settings.environmentVariables]) {
		if (typeof value === "string" && value.trim()) return value;
	}
	return "";
}

function parseEnvironment(value: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of value.split(/\r?\n/)) {
		const normalized = line.trim().replace(/^export\s+/, "");
		if (!normalized || normalized.startsWith("#")) continue;
		const separator = normalized.indexOf("=");
		if (separator <= 0) continue;
		const key = normalized.slice(0, separator).trim();
		let entry = normalized.slice(separator + 1).trim();
		if ((entry.startsWith('"') && entry.endsWith('"')) || (entry.startsWith("'") && entry.endsWith("'"))) entry = entry.slice(1, -1);
		result[key] = entry;
	}
	return result;
}

/**
 * One-way credential bridge for pre-native installations. The old files stay
 * untouched for rollback; secret material is copied only into SecretStorage.
 */
export async function migrateLegacyCodexCredential(input: {
	adapter: DataAdapter;
	settings: LegacySecretSettings;
	store: ProviderSecretStore | null;
}): Promise<{ migrated: boolean; sourcePath?: string }> {
	if (!input.store || input.settings.providerSecretRefs.codexApiKey) return { migrated: false };
	for (const path of LEGACY_SETTINGS_PATHS) {
		if (!(await input.adapter.exists(path))) continue;
		let parsed: unknown;
		try { parsed = JSON.parse(await input.adapter.read(path)); }
		catch { continue; }
		const key = parseEnvironment(codexEnvironment(record(parsed))).OPENAI_API_KEY?.trim();
		if (!key) continue;
		saveProviderSecret(input.settings, "codexApiKey", key, input.store);
		return { migrated: true, sourcePath: path };
	}
	return { migrated: false };
}
