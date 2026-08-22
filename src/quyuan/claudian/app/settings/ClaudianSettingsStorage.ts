import {
  CLAUDIAN_SETTINGS_PATH,
  LEGACY_CLAUDIAN_SETTINGS_PATH,
} from '../../core/bootstrap/StoragePaths';
import {
  normalizeHiddenProviderCommands,
} from '../../core/providers/commands/hiddenCommands';
import {
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  resolveEnvironmentSnippetScope,
} from '../../core/providers/providerEnvironment';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import {
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  type ClaudianSettings,
  type EnvironmentScope,
  type EnvSnippet,
  type ProviderConfigMap,
} from '../../core/types/settings';
import {
  getCodexProviderSettings,
  updateCodexProviderSettings,
} from '../../providers/codex/settings';
import { DEFAULT_CLAUDIAN_SETTINGS } from './defaultSettings';

export {
  CLAUDIAN_SETTINGS_PATH,
  LEGACY_CLAUDIAN_SETTINGS_PATH,
};

export type StoredClaudianSettings = ClaudianSettings;

const LEGACY_TOP_LEVEL_PROVIDER_FIELDS = [
  'claudeSafeMode',
  'codexSafeMode',
  'claudeCliPath',
  'claudeCliPathsByHost',
  'codexCliPath',
  'codexCliPathsByHost',
  'codexReasoningSummary',
  'loadUserClaudeSettings',
  'codexEnabled',
  'lastClaudeModel',
  'enableChrome',
  'enableBangBash',
  'enableOpus1M',
  'enableSonnet1M',
  'environmentVariables',
  'lastEnvHash',
  'lastCodexEnvHash',
] as const;

const LEGACY_STRIPPED_SETTING_FIELDS = [
  'activeConversationId',
  'show1MModel',
  'hiddenSlashCommands',
  'slashCommands',
  'allowExternalAccess',
  'allowedExportPaths',
  'enableBlocklist',
  'blockedCommands',
  ...LEGACY_TOP_LEVEL_PROVIDER_FIELDS,
  'openInMainTab',
] as const;

function stripLegacyFields(settings: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...settings };
  for (const key of LEGACY_STRIPPED_SETTING_FIELDS) {
    delete cleaned[key];
  }
  return cleaned;
}

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return typeof value === 'string'
    && (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeChatViewPlacement(
  value: unknown,
  legacyOpenInMainTab: unknown,
): ChatViewPlacement {
  if (isChatViewPlacement(value)) {
    return value;
  }

  if (typeof legacyOpenInMainTab === 'boolean') {
    return legacyOpenInMainTab ? 'main-tab' : 'right-sidebar';
  }

  return DEFAULT_CLAUDIAN_SETTINGS.chatViewPlacement;
}

function shouldPersistChatViewPlacementMigration(
  stored: Record<string, unknown>,
  normalized: ChatViewPlacement,
): boolean {
  return 'openInMainTab' in stored
    || (
      'chatViewPlacement' in stored
      && stored.chatViewPlacement !== normalized
    );
}

// D-TLP-013：旧 harness 的 providerConfigs 随链路一并清除，不再载入或回写。
const REMOVED_PROVIDER_IDS = new Set(['claude', 'opencode', 'pi']);

function normalizeProviderConfigs(value: unknown): ProviderConfigMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: ProviderConfigMap = {};
  for (const [providerId, config] of Object.entries(value as Record<string, unknown>)) {
    if (REMOVED_PROVIDER_IDS.has(providerId)) {
      continue;
    }
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      result[providerId] = { ...(config as Record<string, unknown>) };
    }
  }
  return result;
}

// D-TLP-013：唯一 harness 为 codex，只保留 codex 的 host 作用域字段归一化。
const HOST_SCOPED_PROVIDER_CONFIG_FIELDS: Record<string, string[]> = {
  codex: ['cliPathsByHost', 'installationMethodsByHost', 'wslDistroOverridesByHost'],
};

function hasHostScopedProviderConfigNormalization(
  original: ProviderConfigMap,
  normalized: unknown,
): boolean {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return false;
  }

  const normalizedConfigs = normalized as ProviderConfigMap;
  for (const [providerId, fields] of Object.entries(HOST_SCOPED_PROVIDER_CONFIG_FIELDS)) {
    const originalConfig = original[providerId];
    const normalizedConfig = normalizedConfigs[providerId];
    if (!originalConfig || !normalizedConfig) {
      continue;
    }

    for (const field of fields) {
      if (
        field in originalConfig
        && JSON.stringify(originalConfig[field]) !== JSON.stringify(normalizedConfig[field])
      ) {
        return true;
      }
    }
  }

  return false;
}

function isEnvironmentScope(value: unknown): value is EnvironmentScope {
  return value === 'shared' || (typeof value === 'string' && value.startsWith('provider:'));
}

function normalizeContextLimits(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
      result[key] = entry;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const modelId = key.trim();
    const normalizedAlias = alias.trim();
    if (modelId && normalizedAlias) {
      result[modelId] = normalizedAlias;
    }
  }

  return result;
}

function normalizeEnvSnippets(value: unknown): EnvSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const snippets: EnvSnippet[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.description !== 'string'
      || typeof candidate.envVars !== 'string'
    ) {
      continue;
    }

    const modelAliases = 'modelAliases' in candidate
      ? normalizeModelAliases(candidate.modelAliases)
      : undefined;

    snippets.push({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      envVars: candidate.envVars,
      scope: resolveEnvironmentSnippetScope(
        candidate.envVars,
        isEnvironmentScope(candidate.scope)
          ? candidate.scope
          : inferEnvironmentSnippetScope(candidate.envVars),
      ),
      contextLimits: normalizeContextLimits(candidate.contextLimits),
      modelAliases,
    });
  }

  return snippets;
}

function hasLegacyTopLevelProviderFields(stored: Record<string, unknown>): boolean {
  return LEGACY_TOP_LEVEL_PROVIDER_FIELDS.some((key) => key in stored);
}

export class ClaudianSettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<StoredClaudianSettings> {
    const settingsPath = await this.getLoadPath();
    if (!settingsPath) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(settingsPath);
    const stored = JSON.parse(content) as Record<string, unknown>;
    // D-TLP-013：旧 claude 专属 hiddenSlashCommands 迁移随 claude 链路一并移除。
    const hiddenProviderCommands = normalizeHiddenProviderCommands(stored.hiddenProviderCommands);
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const customModelAliases = normalizeModelAliases(stored.customModelAliases);
    const providerConfigs = normalizeProviderConfigs(stored.providerConfigs);
    const chatViewPlacement = normalizeChatViewPlacement(
      stored.chatViewPlacement,
      stored.openInMainTab,
    );
    const legacyProviderSettings = {
      ...stored,
      hiddenProviderCommands,
      providerConfigs,
    };
    const storedWithoutLegacy = stripLegacyFields({
      ...legacyProviderSettings,
    });

    const legacyNormalized = {
      ...storedWithoutLegacy,
      sharedEnvironmentVariables: getSharedEnvironmentVariables(legacyProviderSettings),
      envSnippets,
      customModelAliases,
      hiddenProviderCommands,
      providerConfigs,
      chatViewPlacement,
    };

    const merged = {
      ...this.getDefaults(),
      ...legacyNormalized,
    };

    updateCodexProviderSettings(
      merged,
      getCodexProviderSettings(legacyProviderSettings),
    );
    const didNormalizeHostScopedProviderConfigs = hasHostScopedProviderConfigNormalization(
      providerConfigs,
      merged.providerConfigs,
    );

    if (
      settingsPath !== CLAUDIAN_SETTINGS_PATH
      || (
      hasLegacyTopLevelProviderFields(stored)
      || 'show1MModel' in stored
      || 'slashCommands' in stored
      || 'hiddenSlashCommands' in stored
      || 'activeConversationId' in stored
      || 'allowExternalAccess' in stored
      || 'allowedExportPaths' in stored
      || 'enableBlocklist' in stored
      || 'blockedCommands' in stored
      || shouldPersistChatViewPlacementMigration(stored, chatViewPlacement)
      || JSON.stringify(envSnippets) !== JSON.stringify(stored.envSnippets ?? [])
      || (
        'customModelAliases' in stored
        && JSON.stringify(customModelAliases) !== JSON.stringify(stored.customModelAliases ?? {})
      )
      || didNormalizeHostScopedProviderConfigs
      )
    ) {
      await this.save(merged);
    }

    return merged;
  }

  async save(settings: StoredClaudianSettings): Promise<void> {
    const content = JSON.stringify(
      stripLegacyFields(settings),
      null,
      2,
    );
    await this.adapter.write(CLAUDIAN_SETTINGS_PATH, content);
    await this.deleteLegacyFileIfPresent();
  }

  async exists(): Promise<boolean> {
    if (await this.adapter.exists(CLAUDIAN_SETTINGS_PATH)) {
      return true;
    }

    return this.adapter.exists(LEGACY_CLAUDIAN_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredClaudianSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  private getDefaults(): StoredClaudianSettings {
    return DEFAULT_CLAUDIAN_SETTINGS;
  }

  private async getLoadPath(): Promise<string | null> {
    if (await this.adapter.exists(CLAUDIAN_SETTINGS_PATH)) {
      return CLAUDIAN_SETTINGS_PATH;
    }

    if (await this.adapter.exists(LEGACY_CLAUDIAN_SETTINGS_PATH)) {
      return LEGACY_CLAUDIAN_SETTINGS_PATH;
    }

    return null;
  }

  private async deleteLegacyFileIfPresent(): Promise<void> {
    if (await this.adapter.exists(LEGACY_CLAUDIAN_SETTINGS_PATH)) {
      await this.adapter.delete(LEGACY_CLAUDIAN_SETTINGS_PATH);
    }
  }
}
