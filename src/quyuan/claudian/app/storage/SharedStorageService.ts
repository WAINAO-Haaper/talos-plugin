import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import { SESSIONS_PATH, SessionStorage, type CompatibilitySessionHost } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { CLAUDIAN_STORAGE_PATH } from '../../core/bootstrap/StoragePaths';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { ClaudianSettingsStorage, type StoredClaudianSettings } from '../settings/ClaudianSettingsStorage';

const TALOS_COMPATIBILITY_SETTINGS_PATH = '.talos/agent-workbench/v1/compatibility-settings.json';
const TALOS_COMPATIBILITY_HOST_PATH = '.talos/agent-workbench/v1/compatibility-host.json';
const TALOS_TAB_MANAGER_STATE_PATH = '.talos/agent-workbench/v1/tab-manager-state.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class SharedStorageService implements SharedAppStorage {
  readonly claudianSettings: ClaudianSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;

  constructor(plugin: Plugin, private readonly readOnly = false) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    this.claudianSettings = new ClaudianSettingsStorage(this.adapter, readOnly ? {
      writePath: TALOS_COMPATIBILITY_SETTINGS_PATH,
      readPaths: [TALOS_COMPATIBILITY_SETTINGS_PATH, CLAUDIAN_STORAGE_PATH + '/claudian-settings.json', CLAUDIAN_STORAGE_PATH + '/legacy-settings.json'],
      deleteLegacyOnSave: false,
    } : undefined);
    const compatibilityHost: CompatibilitySessionHost | undefined = readOnly ? {
      read: async () => {
        const loaded = await this.readSidecar(TALOS_COMPATIBILITY_HOST_PATH);
        const data = isRecord(loaded) ? loaded : {};
        const host = isRecord(data.agentWorkbenchHost) ? data.agentWorkbenchHost : {};
        const bindings = isRecord(host.compatibilityBindings)
          ? host.compatibilityBindings as Record<string, { sessionId?: string | null; providerId?: string }>
          : {};
        const deletedIds = Array.isArray(host.compatibilityDeletedIds)
          ? host.compatibilityDeletedIds.filter((id): id is string => typeof id === 'string')
          : [];
        return { bindings: { ...bindings }, deletedIds: [...deletedIds] };
      },
      write: async (value) => {
        const loaded = await this.readSidecar(TALOS_COMPATIBILITY_HOST_PATH);
        const data = isRecord(loaded) ? loaded : {};
        const host = isRecord(data.agentWorkbenchHost) ? data.agentWorkbenchHost : {};
        await this.writeSidecar(TALOS_COMPATIBILITY_HOST_PATH, {
          ...data,
          agentWorkbenchHost: {
            ...host,
            compatibilityBindings: value.bindings,
            compatibilityDeletedIds: value.deletedIds,
          },
        });
      },
    } : undefined;
    this.sessions = new SessionStorage(this.adapter, readOnly, compatibilityHost);
  }

  async initialize(): Promise<{ claudian: Record<string, unknown> }> {
    if (!this.readOnly) await this.ensureDirectories();
    const claudian = await this.claudianSettings.load();
    return { claudian };
  }

  async saveClaudianSettings(settings: Record<string, unknown>): Promise<void> {
    await this.claudianSettings.save(settings as StoredClaudianSettings);
  }

  async setTabManagerState(state: { openTabs: Array<{ tabId: string; conversationId: string | null; draftModel?: string | null }>; activeTabId: string | null }): Promise<void> {
    try {
      if (this.readOnly) {
        await this.writeSidecar(TALOS_TAB_MANAGER_STATE_PATH, state);
        return;
      }
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      data.tabManagerState = state;
      await this.plugin.saveData(data);
    } catch {
      new Notice('Failed to save tab layout');
    }
  }

  async getTabManagerState(): Promise<{ openTabs: Array<{ tabId: string; conversationId: string | null; draftModel?: string | null }>; activeTabId: string | null } | null> {
    try {
      const data: unknown = this.readOnly
        ? await this.readSidecar(TALOS_TAB_MANAGER_STATE_PATH)
        : await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      return this.validateTabManagerState(data.tabManagerState);
    } catch {
      return null;
    }
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  private async readSidecar(path: string): Promise<unknown> {
    if (!(await this.adapter.exists(path))) return null;
    return JSON.parse(await this.adapter.read(path)) as unknown;
  }

  private async writeSidecar(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.tmp`;
    await this.adapter.write(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await this.adapter.rename(temporary, path);
  }

  private async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(CLAUDIAN_STORAGE_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
  }

  private validateTabManagerState(data: unknown): { openTabs: Array<{ tabId: string; conversationId: string | null; draftModel?: string | null }>; activeTabId: string | null } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const state = data as Record<string, unknown>;
    if (!Array.isArray(state.openTabs)) {
      return null;
    }

    const validatedTabs: Array<{ tabId: string; conversationId: string | null; draftModel?: string | null }> = [];
    for (const tab of state.openTabs) {
      if (!tab || typeof tab !== 'object') {
        continue;
      }

      const tabObj = tab as Record<string, unknown>;
      if (typeof tabObj.tabId !== 'string') {
        continue;
      }

      validatedTabs.push({
        tabId: tabObj.tabId,
        conversationId: typeof tabObj.conversationId === 'string' ? tabObj.conversationId : null,
        ...(typeof tabObj.draftModel === 'string'
          ? { draftModel: tabObj.draftModel }
          : {}),
      });
    }

    return {
      openTabs: validatedTabs,
      activeTabId: typeof state.activeTabId === 'string' ? state.activeTabId : null,
    };
  }
}
