import { Notice, TFile } from "obsidian";
import type TalosPlugin from "../main";
import { DEFAULT_SETTINGS, type TalosSettings } from "../settings";
import { MODULE_KEYS, SCHEMA_PRESET_CN, VaultPaths, detectDataSources, readSuperbrainDirectoryConfig, resolveSchema, type DataSourceKey, type SchemaDetectionResult, type SuperbrainDirectoryConfig, type TalosSchemaKey } from "../data/schema";
import { VAULT_FILE_KEYS, type VaultFileKey } from "../data/vault-files";
import { recordQuyuanRuntimeError } from "./quyuan-diagnostics";

export const SUPERBRAIN_CONFIG_PATH = "System/config.json";
const SOURCE_KEYS: DataSourceKey[] = ["tasksPath", "pendingApprovalsPath", "candidatesPath", "healthLogPath"];
const FOLDER_KEYS = ["inboxFolder", "dailyFolder"] as const;
export type DirectoryManagedKey = `schema.${TalosSchemaKey}` | `file.${VaultFileKey}` | DataSourceKey | typeof FOLDER_KEYS[number];
export interface DirectoryConfigConflict { key: DirectoryManagedKey; current: string; configured: string }
/** Only provenance and the last applied values live here. Framework config remains in config.json. */
export interface DirectoryConfigState {
	version: 1;
	manualKeys: DirectoryManagedKey[];
	legacyKeys: DirectoryManagedKey[];
	applied: Partial<Record<DirectoryManagedKey, string>>;
	conflicts: DirectoryConfigConflict[];
}
const MANAGED_KEYS: DirectoryManagedKey[] = [
	...MODULE_KEYS.map(key => `schema.${key}` as const),
	...VAULT_FILE_KEYS.map(key => `file.${key}` as const), ...SOURCE_KEYS, ...FOLDER_KEYS,
];
const configs = new WeakMap<object, SuperbrainDirectoryConfig>();
const messages = new WeakMap<object, string>();
const pending = new WeakMap<object, Promise<void>>();

function provenance(settings: TalosSettings): DirectoryConfigState {
	const value = settings.directoryConfig;
	if (!value || value.version !== 1) return { version: 1, manualKeys: [], legacyKeys: [], applied: {}, conflicts: [] };
	const keys = (raw: unknown): DirectoryManagedKey[] => Array.isArray(raw)
		? MANAGED_KEYS.filter(key => raw.includes(key)) : [];
	const applied: DirectoryConfigState["applied"] = {};
	for (const key of MANAGED_KEYS) {
		if (typeof value.applied?.[key] === "string") applied[key] = value.applied[key];
	}
	return { version: 1, manualKeys: keys(value.manualKeys), legacyKeys: keys(value.legacyKeys), applied, conflicts: [] };
}

function readValue(settings: TalosSettings, key: DirectoryManagedKey): string | undefined {
	if (key.startsWith("schema.")) return settings.vaultSchema[key.slice(7) as TalosSchemaKey];
	if (key.startsWith("file.")) return settings.vaultFiles[key.slice(5) as VaultFileKey];
	return settings[key as DataSourceKey | typeof FOLDER_KEYS[number]];
}
function writeValue(settings: TalosSettings, key: DirectoryManagedKey, value: string): void {
	if (key.startsWith("schema.")) settings.vaultSchema[key.slice(7) as TalosSchemaKey] = value;
	else if (key.startsWith("file.")) settings.vaultFiles[key.slice(5) as VaultFileKey] = value;
	else settings[key as DataSourceKey | typeof FOLDER_KEYS[number]] = value;
}

/** Settings writes call this even when the chosen value happens to equal an automatic value. */
export function markDirectorySettingsManual(settings: TalosSettings, keys: readonly DirectoryManagedKey[]): void {
	const state = provenance(settings);
	state.manualKeys = MANAGED_KEYS.filter(key => state.manualKeys.includes(key) || keys.includes(key));
	state.legacyKeys = state.legacyKeys.filter(key => !keys.includes(key));
	state.conflicts = (settings.directoryConfig?.conflicts ?? []).filter(item => !keys.includes(item.key));
	for (const key of keys) delete state.applied[key];
	settings.directoryConfig = state;
}

/** Detection is lower priority than framework config; keep its explicit automatic baseline. */
export function markDirectorySettingsAutomatic(settings: TalosSettings, keys: readonly DirectoryManagedKey[]): void {
	const state = provenance(settings);
	state.manualKeys = state.manualKeys.filter(key => !keys.includes(key));
	state.legacyKeys = state.legacyKeys.filter(key => !keys.includes(key));
	state.conflicts = (settings.directoryConfig?.conflicts ?? []).filter(item => !keys.includes(item.key));
	for (const key of keys) {
		const value = readValue(settings, key);
		if (value !== undefined) state.applied[key] = value;
	}
	settings.directoryConfig = state;
}

/** A scan can update automatic fields, while explicit settings remain in force. */
export function applyDetectedDirectorySettings(settings: TalosSettings, result: SchemaDetectionResult): void {
	const manual = provenance(settings).manualKeys;
	const changed: DirectoryManagedKey[] = [];
	const apply = (key: DirectoryManagedKey, value: string) => {
		if (manual.includes(key)) return;
		writeValue(settings, key, value);
		changed.push(key);
	};
	for (const key of MODULE_KEYS) apply(`schema.${key}`, result.schema[key]);
	for (const key of VAULT_FILE_KEYS) if (result.files[key] !== undefined) apply(`file.${key}`, result.files[key]);
	for (const key of SOURCE_KEYS) if (result.dataSources[key] !== undefined) apply(key, result.dataSources[key]);
	const effective = resolveSchema(settings.vaultSchema);
	apply("inboxFolder", effective.inbox);
	apply("dailyFolder", effective.logs);
	markDirectorySettingsAutomatic(settings, changed);
}

export function getSuperbrainDirectoryConfig(plugin: TalosPlugin): SuperbrainDirectoryConfig | undefined { return configs.get(plugin); }

async function sync(plugin: TalosPlugin): Promise<void> {
	if (!plugin.hasSuperbrainCatalog) { configs.delete(plugin); return; }
	const file = plugin.app.vault.getAbstractFileByPath(SUPERBRAIN_CONFIG_PATH);
	if (!file) { configs.delete(plugin); return; }
	const previous = plugin.talosSettings;
	try {
		if (!(file instanceof TFile)) throw new Error("超级大脑目录配置不是文件");
		const config = readSuperbrainDirectoryConfig(await plugin.app.vault.cachedRead(file));
		const next: TalosSettings = { ...previous, vaultSchema: { ...previous.vaultSchema }, vaultFiles: { ...previous.vaultFiles } };
		const state = provenance(previous);
		const apply = (key: DirectoryManagedKey, configured: string) => {
			if (state.manualKeys.includes(key)) return;
			const current = readValue(previous, key);
			const baseline = state.applied[key];
			const unknownExisting = baseline === undefined && current !== undefined && (
				key.startsWith("schema.") || key.startsWith("file.") || current !== DEFAULT_SETTINGS[key as DataSourceKey | typeof FOLDER_KEYS[number]]
			);
			if (state.legacyKeys.includes(key) || unknownExisting || (baseline !== undefined && current !== baseline)) {
				if (!state.legacyKeys.includes(key)) state.legacyKeys.push(key);
				state.conflicts.push({ key, current: current ?? "", configured });
				delete state.applied[key];
				return;
			}
			writeValue(next, key, configured);
			state.applied[key] = configured;
		};
		for (const key of MODULE_KEYS) apply(`schema.${key}`, config.schema[key]);
		const effective = resolveSchema(next.vaultSchema);
		const paths = new VaultPaths(effective);
		for (const key of VAULT_FILE_KEYS) apply(`file.${key}`, paths.file(key));
		apply("inboxFolder", effective.inbox);
		apply("dailyFolder", effective.logs);
		const found = detectDataSources(plugin.app, effective);
		for (const key of SOURCE_KEYS) {
			const fallback = DEFAULT_SETTINGS[key].replace(`${SCHEMA_PRESET_CN.system}/`, `${effective.system}/`);
			apply(key, found[key]?.startsWith(`${effective.system}/`) ? found[key] : fallback);
		}
		state.applied = Object.fromEntries(MANAGED_KEYS.filter(key => state.applied[key] !== undefined).map(key => [key, state.applied[key]!]));
		state.legacyKeys = MANAGED_KEYS.filter(key => state.legacyKeys.includes(key));
		next.directoryConfig = state;
		if (JSON.stringify(previous) !== JSON.stringify(next)) {
			plugin.talosSettings = next;
			try { await plugin.saveTalosSettings(); } catch (error) { plugin.talosSettings = previous; throw error; }
		}
		configs.set(plugin, config);
		const message = state.conflicts.length ? `TALOS 保留了 ${state.conflicts.length} 项来源不明的旧目录设置。请在「设置 → TALOS → 库与数据」核对框架配置冲突。` : "";
		if (message && messages.get(plugin) !== message) new Notice(message, 12000);
		messages.set(plugin, message);
	} catch (error) {
		configs.delete(plugin);
		const message = error instanceof Error ? error.message : String(error);
		if (messages.get(plugin) !== message) {
			recordQuyuanRuntimeError(plugin, "superbrainDirectoryConfig", error);
			new Notice(`TALOS 未应用 ${SUPERBRAIN_CONFIG_PATH}：${message}。已保留当前设置。`, 12000);
		}
		messages.set(plugin, message);
	}
}

/** Serializes startup and file events; no write occurs when the resolved settings are unchanged. */
export async function syncSuperbrainDirectoryConfig(plugin: TalosPlugin): Promise<void> {
	const prior = pending.get(plugin) ?? Promise.resolve();
	const task = prior.then(() => sync(plugin));
	pending.set(plugin, task);
	try { await task; } finally { if (pending.get(plugin) === task) pending.delete(plugin); }
}
