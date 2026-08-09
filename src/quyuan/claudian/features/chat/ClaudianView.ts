import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope, setIcon } from 'obsidian';

import { getHiddenProviderCommandSet } from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../core/providers/types';
import { VIEW_TYPE_CLAUDIAN } from '../../core/types';
import type ClaudianPlugin from '../../main';
import { createProviderIconSvg } from '../../shared/icons';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../utils/animationFrame';
import type { HistoryConversationStatus } from './controllers/ConversationController';
import {
  getTabProviderId,
  onProviderAvailabilityChanged,
  sendTabInputMessageFromExplicitEnterShortcut,
  updatePlanModeUI,
} from './tabs/Tab';
import { TabBar } from './tabs/TabBar';
import { TabManager } from './tabs/TabManager';
import type { TabData, TabId } from './tabs/types';
import { recalculateUsageForModel } from './utils/usageInfo';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

type TalosDiagnosticsPlugin = ClaudianPlugin & {
  recordQuyuanRuntimeError?: (scope: string, error: unknown) => void;
  writeQuyuanDiagnostics?: (openReport?: boolean) => Promise<string>;
};

export class ClaudianView extends ItemView {
  private plugin: ClaudianPlugin;

  // Tab management
  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;
  private inputFooterEl: HTMLElement | null = null;
  private inputNavRowHostEl: HTMLElement | null = null;
  private activeInputSlotEl: HTMLElement | null = null;
  private activeInputTabId: TabId | null = null;

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;
  private newTabButtonEl: HTMLElement | null = null;
  private talosStatusTextEl: HTMLElement | null = null;
  private talosPermissionSelectEl: HTMLSelectElement | null = null;
  private talosCapabilitiesPanelEl: HTMLElement | null = null;
  private embeddedMode = false;
  private surfaceActive = false;

  // Header elements
  private historyDropdown: HTMLElement | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];
  private workspaceEventRefs: EventRef[] = [];
  private domCleanups: Array<() => void> = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudianPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches ClaudianView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype = Object.getPrototypeOf(this) as LoadableView;
    const originalLoad = prototype.load.bind(this);
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN;
  }

  getDisplayText(): string {
    return '屈原';
  }

  getIcon(): string {
    return 'bot';
  }

  /** Refreshes model-dependent UI across all tabs (used after settings/env changes). */
  refreshModelSelector(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      onProviderAvailabilityChanged(tab, this.plugin);
      const providerId = getTabProviderId(tab, this.plugin);
      const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
        this.plugin.settings,
        providerId,
      );
      const model = providerSettings.model;
      const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
      const capabilities = ProviderRegistry.getCapabilities(providerId);
      const contextWindow = uiConfig.getContextWindowSize(
        model,
        providerSettings.customContextLimits,
        providerSettings,
      );

      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(tab.state.usage, model, contextWindow);
      }

      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.permissionToggle?.updateDisplay();
      tab.ui.serviceTierToggle?.updateDisplay();
      tab.dom.inputWrapper.toggleClass(
        'claudian-input-plan-mode',
        providerSettings.permissionMode === 'plan' && capabilities.supportsPlanMode,
      );
    }

    this.tabManager?.primeProviderRuntime();
  }

  invalidateProviderCommandCaches(providerIds?: ProviderId[]): void {
    this.tabManager?.invalidateProviderCommandCaches(providerIds);
  }

  /** Updates provider-scoped hidden commands on all tabs after settings changes. */
  updateHiddenProviderCommands(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(
        getHiddenProviderCommandSet(this.plugin.settings, getTabProviderId(tab, this.plugin)),
      );
    }
  }

  async onOpen() {
    try {
      this.surfaceActive = true;
      await this.openWorkbench();
    } catch (error) {
      console.error('TALOS Quyuan workbench view failed to open', error);
      const diagnosticsPlugin = this.plugin as TalosDiagnosticsPlugin;
      diagnosticsPlugin.recordQuyuanRuntimeError?.('ClaudianView.onOpen', error);
      this.renderOpenError(error);
    }
  }

  private async openWorkbench(containerOverride?: HTMLElement): Promise<void> {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!containerOverride && !this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null = containerOverride
      ?? this.contentEl
      ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('claudian-container');
    this.viewContainerEl.addClass('talos-quyuan-shell');

    const header = this.viewContainerEl.createDiv({ cls: 'claudian-header' });
    this.buildHeader(header);
    this.buildTalosChrome();

    this.navRowContent = this.buildNavRowContent();
    this.tabContentEl = this.viewContainerEl.createDiv({ cls: 'claudian-tab-content-container' });
    this.buildInputFooter();

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
          this.syncProviderBrandColor();
          this.updateTalosChrome();
        },
        onActiveTabChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.syncProviderBrandColor();
          this.updateTalosChrome();
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
          this.syncProviderBrandColor();
          this.updateTalosChrome();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
          this.updateTalosChrome();
        },
        onTabStreamingChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateTalosChrome();
        },
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => this.updateTabBar(),
        onTabConversationChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.persistTabState();
          this.syncProviderBrandColor();
        },
        onTabProviderChanged: () => {
          this.updateTabBar();
          this.syncProviderBrandColor();
          this.updateTalosChrome();
        },
      }
    );

    this.wireEventHandlers();
    await this.restoreOrCreateTabs();
    this.syncProviderBrandColor();
    this.attachNavRowContentToInputFooter();
    this.updateInputLocation();
    this.updateTabBarVisibility();
    this.tabManager?.primeProviderRuntime();
    this.updateTalosChrome();
  }

  private renderOpenError(error: unknown): void {
    const container = this.embeddedMode
      ? this.viewContainerEl
      : this.contentEl ?? this.viewContainerEl ?? this.containerEl;
    if (!container) return;
    container.empty();
    container.addClass('claudian-container');
    container.addClass('talos-quyuan-shell');
    const panel = container.createDiv({ cls: 'talos-quyuan-open-error' });
    const icon = panel.createDiv({ cls: 'talos-quyuan-open-error-icon' });
    setIcon(icon, 'triangle-alert');
    const copy = panel.createDiv({ cls: 'talos-quyuan-open-error-copy' });
    copy.createEl('h2', { text: '屈原完整工作台加载失败' });
    copy.createEl('p', {
      text: error instanceof Error ? error.message : String(error),
    });
    const actions = panel.createDiv({ cls: 'talos-quyuan-open-error-actions' });
    const retry = actions.createEl('button', { attr: { type: 'button' } });
    setIcon(retry.createSpan(), 'rotate-cw');
    retry.createSpan({ text: '重试' });
    retry.addEventListener('click', () => void this.onOpen());
    const diagnostic = actions.createEl('button', { attr: { type: 'button' } });
    setIcon(diagnostic.createSpan(), 'bug');
    diagnostic.createSpan({ text: '生成诊断' });
    diagnostic.addEventListener('click', () => {
      const diagnosticsPlugin = this.plugin as TalosDiagnosticsPlugin;
      void diagnosticsPlugin.writeQuyuanDiagnostics?.(true).catch((diagnosticError: unknown) => {
        diagnosticsPlugin.recordQuyuanRuntimeError?.('ClaudianView.writeDiagnostics', diagnosticError);
        new Notice('诊断报告生成失败，请打开开发者控制台查看错误。');
      });
    });
  }

  async onClose() {
    this.surfaceActive = false;
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }

    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];
    for (const ref of this.workspaceEventRefs) {
      this.plugin.app.workspace.offref(ref);
    }
    this.workspaceEventRefs = [];
    for (const cleanup of this.domCleanups) cleanup();
    this.domCleanups = [];

    await this.persistTabStateImmediate();

    this.restoreActiveInputToTabContent();
    await this.tabManager?.destroy();
    this.tabManager = null;

    this.tabBar?.destroy();
    this.tabBar = null;
    this.scope = null;
  }

  async mountEmbedded(
    container: HTMLElement,
    namespace: 'chat',
  ): Promise<void> {
    if (namespace !== 'chat') {
      throw new Error('ClaudianView 只允许 chat 会话命名空间');
    }
    this.embeddedMode = true;
    this.surfaceActive = true;
    if (this.tabManager && this.viewContainerEl) {
      container.appendChild(this.viewContainerEl);
      return;
    }

    const root = container.ownerDocument.createElement('div');
    root.className = 'claudian-embedded-root';
    container.appendChild(root);
    try {
      await this.openWorkbench(root);
    } catch (error) {
      this.renderOpenError(error);
      throw error;
    }
  }

  async suspendEmbedded(): Promise<void> {
    if (!this.embeddedMode || !this.surfaceActive) return;
    this.surfaceActive = false;
    try {
      await this.persistTabStateImmediate();
    } finally {
      this.viewContainerEl?.remove();
    }
  }

  focusComposer(): void {
    this.tabManager?.getActiveTab()?.dom.inputEl.focus();
  }

  isEmbeddedSurfaceActive(): boolean {
    return this.embeddedMode && this.surfaceActive;
  }

  async destroyEmbedded(): Promise<void> {
    if (!this.embeddedMode) return;
    await this.onClose();
    this.viewContainerEl?.remove();
    this.embeddedMode = false;
  }

  // ============================================
  // UI Building
  // ============================================

  private buildHeader(header: HTMLElement): void {
    const titleEl = header.createDiv({ cls: 'claudian-title' });

    this.logoEl = titleEl.createSpan({ cls: 'claudian-logo' });
    this.syncHeaderLogo(DEFAULT_CHAT_PROVIDER_ID);

    titleEl.createEl('h4', { text: '屈原 · AGENTIC', cls: 'claudian-title-text' });
  }

  private buildTalosChrome(): void {
    if (!this.viewContainerEl) return;

    const statusBar = this.viewContainerEl.createDiv({ cls: 'talos-quyuan-statusbar' });
    const status = statusBar.createDiv({ cls: 'talos-quyuan-status' });
    status.createSpan({ cls: 'talos-quyuan-status-dot' });
    this.talosStatusTextEl = status.createSpan({ text: '待命' });

    const permission = statusBar.createDiv({ cls: 'talos-quyuan-permission' });
    permission.createSpan({ text: '权限' });
    this.talosPermissionSelectEl = permission.createEl('select', {
      attr: { 'aria-label': '权限模式' },
    });
    this.talosPermissionSelectEl.addEventListener('change', () => {
      const mode = this.talosPermissionSelectEl?.value;
      const toggle = this.tabManager?.getActiveTab()?.ui.permissionToggle;
      if (!mode || !toggle) return;
      void toggle.selectMode(mode).then(() => this.updateTalosChrome());
    });

    const capabilityButton = statusBar.createEl('button', {
      cls: 'talos-quyuan-capability-button',
      attr: {
        type: 'button',
        'aria-label': '屈原能力',
        'aria-expanded': 'false',
      },
    });
    setIcon(capabilityButton, 'blocks');
    capabilityButton.createSpan({ text: '能力' });

    this.talosCapabilitiesPanelEl = this.viewContainerEl.createDiv({
      cls: 'talos-quyuan-capabilities',
    });
    const capabilities = [
      ['terminal-square', 'Commands', '/'],
      ['sparkles', 'Skills', '$'],
      ['network', 'MCP', '@'],
      ['bot', '子智能体', '#'],
    ] as const;
    for (const [icon, label, prefix] of capabilities) {
      const button = this.talosCapabilitiesPanelEl.createEl('button', {
        cls: 'talos-quyuan-capability-chip',
        attr: { type: 'button', title: `调用 ${label}` },
      });
      setIcon(button, icon);
      button.createSpan({ text: label });
      button.addEventListener('click', () => {
        const input = this.tabManager?.getActiveTab()?.dom.inputEl;
        if (!input) return;
        input.value = `${prefix}${input.value}`;
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        this.setCapabilitiesOpen(false, capabilityButton);
      });
    }

    const inlineEdit = this.talosCapabilitiesPanelEl.createEl('button', {
      cls: 'talos-quyuan-capability-chip',
      attr: { type: 'button', title: '对当前编辑器选区执行行内编辑' },
    });
    setIcon(inlineEdit, 'file-pen-line');
    inlineEdit.createSpan({ text: 'Inline Edit' });
    inlineEdit.addEventListener('click', () => {
      const app = this.app as typeof this.app & {
        commands?: { executeCommandById: (id: string) => boolean };
      };
      app.commands?.executeCommandById('talos:inline-edit');
      this.setCapabilitiesOpen(false, capabilityButton);
    });

    capabilityButton.addEventListener('click', () => {
      const open = !this.talosCapabilitiesPanelEl?.hasClass('is-open');
      this.setCapabilitiesOpen(open, capabilityButton);
    });
  }

  private setCapabilitiesOpen(open: boolean, button: HTMLElement): void {
    this.talosCapabilitiesPanelEl?.toggleClass('is-open', open);
    button.setAttribute('aria-expanded', String(open));
  }

  private updateTalosChrome(): void {
    const tab = this.tabManager?.getActiveTab();
    if (this.talosStatusTextEl) {
      this.talosStatusTextEl.setText(tab?.state.isStreaming ? '思考中' : '待命');
      this.talosStatusTextEl.parentElement?.toggleClass(
        'is-streaming',
        tab?.state.isStreaming ?? false,
      );
    }

    const select = this.talosPermissionSelectEl;
    const toggle = tab?.ui.permissionToggle;
    if (!select) return;
    select.empty();
    const modes = toggle?.getAvailableModes() ?? [];
    for (const mode of modes) {
      const option = select.createEl('option', { text: mode.label });
      option.value = mode.value;
    }
    select.disabled = modes.length === 0;
    if (toggle) select.value = toggle.getCurrentMode();
  }

  /**
   * Builds the active tab nav row content.
   * The wrapper is moved to the active tab's nav row on tab switches.
   */
  private buildNavRowContent(): HTMLElement {
    const activeDocument =
      this.viewContainerEl?.ownerDocument ?? this.containerEl.ownerDocument;

    const fragment = activeDocument.createDocumentFragment();

    this.tabBarContainerEl = activeDocument.createElement('div');
    this.tabBarContainerEl.className = 'claudian-tab-bar-container';
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice('Failed to create tab'));
      },
    });
    fragment.appendChild(this.tabBarContainerEl);

    const navActionsEl = activeDocument.createElement('div');
    navActionsEl.className = 'claudian-input-nav-actions';

    this.newTabButtonEl = navActionsEl.createDiv({ cls: 'claudian-input-nav-btn claudian-new-tab-btn' });
    setIcon(this.newTabButtonEl, 'square-plus');
    this.newTabButtonEl.setAttribute('aria-label', 'New tab');
    this.newTabButtonEl.addEventListener('click', () => {
      void this.createNewTab().catch(() => new Notice('Failed to create tab'));
    });

    const newBtn = navActionsEl.createDiv({ cls: 'claudian-input-nav-btn' });
    setIcon(newBtn, 'square-pen');
    newBtn.setAttribute('aria-label', 'New conversation');
    newBtn.addEventListener('click', () => {
      void (async () => {
        await this.tabManager?.createNewConversation();
        this.updateHistoryDropdown();
      })().catch(() => new Notice('Failed to create conversation'));
    });

    // History dropdown
    const historyContainer = navActionsEl.createDiv({ cls: 'claudian-history-container' });
    const historyBtn = historyContainer.createDiv({ cls: 'claudian-input-nav-btn' });
    setIcon(historyBtn, 'history');
    historyBtn.setAttribute('aria-label', 'Chat history');

    this.historyDropdown = historyContainer.createDiv({ cls: 'claudian-history-menu' });

    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    fragment.appendChild(navActionsEl);

    const wrapper = activeDocument.createElement('div');
    wrapper.className = 'claudian-input-nav-content';
    wrapper.appendChild(fragment);
    return wrapper;
  }

  private buildInputFooter(): void {
    if (!this.viewContainerEl) return;

    this.inputFooterEl = this.viewContainerEl.createDiv({ cls: 'claudian-input-footer' });
    this.inputNavRowHostEl = this.inputFooterEl.createDiv({
      cls: 'claudian-input-nav-row claudian-view-input-nav-row',
    });
    this.activeInputSlotEl = this.inputFooterEl.createDiv({ cls: 'claudian-active-input-slot' });
  }

  private attachNavRowContentToInputFooter(): void {
    if (!this.inputNavRowHostEl || !this.navRowContent) return;

    this.tabBar?.captureScrollPosition();
    this.inputNavRowHostEl.appendChild(this.navRowContent);
    this.tabBar?.restoreScrollPosition();
  }

  private updateInputLocation(): void {
    const activeTab = this.tabManager?.getActiveTab();
    if (!this.activeInputSlotEl) return;

    if (!activeTab) {
      this.activeInputSlotEl.empty();
      this.activeInputTabId = null;
      return;
    }

    if (this.activeInputTabId && this.activeInputTabId !== activeTab.id) {
      const previousTab = this.tabManager?.getTab(this.activeInputTabId);
      if (previousTab) {
        previousTab.dom.contentEl.appendChild(previousTab.dom.inputComposerEl);
      }
    }

    if (this.activeInputTabId === activeTab.id) {
      if (activeTab.dom.inputComposerEl.parentElement !== this.activeInputSlotEl) {
        this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
      }
      return;
    }

    this.activeInputSlotEl.empty();
    this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
    this.activeInputTabId = activeTab.id;
  }

  private restoreActiveInputToTabContent(): void {
    if (!this.activeInputTabId) return;

    const activeInputTab = this.tabManager?.getTab(this.activeInputTabId);
    if (activeInputTab) {
      activeInputTab.dom.contentEl.appendChild(activeInputTab.dom.inputComposerEl);
    }
    this.activeInputSlotEl?.empty();
    this.activeInputTabId = null;
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateTabBarVisibility();
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice('Failed to switch tab'));
    }
  }

  private async handleTabClose(tabId: TabId): Promise<void> {
    try {
      const tab = this.tabManager?.getTab(tabId);
      // If streaming, treat close like user interrupt (force close cancels the stream)
      const force = tab?.state.isStreaming ?? false;
      await this.tabManager?.closeTab(tabId, force);
      this.updateTabBarVisibility();
    } catch {
      new Notice('Failed to close tab');
    }
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = this.plugin.settings.maxTabs ?? 3;
      new Notice(`Maximum ${maxTabs} tabs allowed`);
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.updateTabBarVisibility();
    }, this.viewContainerEl?.ownerDocument.defaultView
      ?? this.containerEl.ownerDocument.defaultView
      ?? null);
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.getTabCount();
    const showTabBar = tabCount >= 2;

    this.tabBarContainerEl.toggleClass('claudian-hidden', !showTabBar);

    this.updateNewTabButtonVisibility();
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.newTabButtonEl || !this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    this.newTabButtonEl.toggleClass('claudian-hidden', !canCreateTab);
    if (canCreateTab) {
      this.newTabButtonEl.removeAttribute('aria-disabled');
      this.newTabButtonEl.removeAttribute('aria-hidden');
      return;
    }

    this.newTabButtonEl.setAttribute('aria-disabled', 'true');
    this.newTabButtonEl.setAttribute('aria-hidden', 'true');
  }

  /** Sets `data-provider` on the root container so CSS brand color follows the active provider. */
  private syncProviderBrandColor(): void {
    if (!this.viewContainerEl) return;
    const activeTab = this.tabManager?.getActiveTab();
    const providerId = activeTab ? getTabProviderId(activeTab, this.plugin) : DEFAULT_CHAT_PROVIDER_ID;
    this.viewContainerEl.dataset.provider = providerId;
    this.syncHeaderLogo(providerId);
  }

  /** Rebuilds the header logo SVG to match the given provider. */
  private syncHeaderLogo(providerId: ProviderId): void {
    if (!this.logoEl) return;
    const icon = ProviderRegistry.getChatUIConfig(providerId).getProviderIcon?.();
    if (!icon) return;
    const existing = this.logoEl.querySelector('svg');
    if (existing?.getAttribute('data-provider') === providerId) return;
    this.logoEl.empty();
    const svg = createProviderIconSvg(icon, {
      dataProvider: providerId,
      height: 18,
      ownerDocument: this.logoEl.ownerDocument,
      width: 18,
    });
    this.logoEl.appendChild(svg);
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
    }
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;

    if (conversationController) {
      conversationController.renderHistoryDropdown(this.historyDropdown, {
        onSelectConversation: (id) => this.openHistoryConversation(id),
        onOpenConversationInNewTab: (id, activate) =>
          this.openHistoryConversationInNewTab(id, activate),
        getConversationStatus: (id) => this.getHistoryConversationStatus(id),
      });
    }
  }

  private async openHistoryConversation(conversationId: string): Promise<void> {
    await this.tabManager?.openConversation(conversationId);
    this.historyDropdown?.removeClass('visible');
  }

  private async openHistoryConversationInNewTab(
    conversationId: string,
    activate = true,
  ): Promise<void> {
    await this.tabManager?.openConversation(conversationId, {
      preferNewTab: true,
      activate,
    });
    this.historyDropdown?.removeClass('visible');
  }

  private getHistoryConversationStatus(conversationId: string): HistoryConversationStatus {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === conversationId) {
      return {
        openState: 'current',
        isRunning: activeTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(activeTab),
      };
    }

    const localTab = this.findTabWithConversation(conversationId);
    if (localTab) {
      return {
        openState: 'open',
        isRunning: localTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(localTab),
      };
    }

    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    if (crossViewResult && crossViewResult.view !== this) {
      const crossViewTab = crossViewResult.view.getTabManager()?.getTab(crossViewResult.tabId);
      return {
        openState: 'open',
        isRunning: crossViewTab?.state.isStreaming ?? false,
        location: 'other-view',
      };
    }

    return {
      openState: 'closed',
      isRunning: false,
      location: 'current-view',
    };
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  private getHistoryTabIndex(tab: TabData): number | undefined {
    const index = this.tabManager?.getAllTabs().findIndex(candidate => candidate.id === tab.id) ?? -1;
    return index >= 0 ? index + 1 : undefined;
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const eventHost = this.viewContainerEl ?? this.containerEl;
    const activeDocument = eventHost.ownerDocument;

    // Document-level click to close dropdowns
    const closeHistory = () => {
      if (!this.surfaceActive) return;
      this.historyDropdown?.removeClass('visible');
    };
    activeDocument.addEventListener('click', closeHistory);
    this.domCleanups.push(() =>
      activeDocument.removeEventListener('click', closeHistory)
    );

    // View-level Shift+Tab to toggle plan mode (works from any focused element)
    const handlePlanShortcut = (e: KeyboardEvent) => {
      if (!this.surfaceActive) return;
      if (e.key === 'Tab' && e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const activeTab = this.tabManager?.getActiveTab();
        if (!activeTab) return;
        const providerId = getTabProviderId(activeTab, this.plugin);
        if (!ProviderRegistry.getCapabilities(providerId).supportsPlanMode) return;
        const current = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
          this.plugin.settings,
          providerId,
        ).permissionMode as string;
        if (current === 'plan') {
          const restoreMode = activeTab.state.prePlanPermissionMode ?? 'normal';
          activeTab.state.prePlanPermissionMode = null;
          updatePlanModeUI(activeTab, this.plugin, restoreMode);
        } else {
          activeTab.state.prePlanPermissionMode = current;
          updatePlanModeUI(activeTab, this.plugin, 'plan');
        }
      }
    };
    eventHost.addEventListener('keydown', handlePlanShortcut);
    this.domCleanups.push(() =>
      eventHost.removeEventListener('keydown', handlePlanShortcut)
    );

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (e: KeyboardEvent) => {
      if (!this.surfaceActive) return;
      if (e.isComposing) return;
      if (!e.defaultPrevented) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
      if (!this.surfaceActive) return;
      if (e.isComposing || e.defaultPrevented) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (!activeTab) return;
      if (sendTabInputMessageFromExplicitEnterShortcut(activeTab, e, { requireInputFocus: true })) {
        return false;
      }
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      if (!this.surfaceActive) return;
      const mgr = this.tabManager?.getActiveTab()?.ui.fileContextManager;
      if (!mgr) return;
      mgr.markFileCacheDirty();
      if (includesFolders) mgr.markFolderCacheDirty();
    };
    this.eventRefs.push(
      this.plugin.app.vault.on('create', () => markCacheDirty(true)),
      this.plugin.app.vault.on('delete', () => markCacheDirty(true)),
      this.plugin.app.vault.on('rename', () => markCacheDirty(true)),
      this.plugin.app.vault.on('modify', () => markCacheDirty(false))
    );

    // File open event
    this.workspaceEventRefs.push(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (!this.surfaceActive) return;
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    const closeMention = (e: MouseEvent) => {
      if (!this.surfaceActive) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    };
    activeDocument.addEventListener('click', closeMention);
    this.domCleanups.push(() =>
      activeDocument.removeEventListener('click', closeMention)
    );
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    if (!this.tabManager) return;

    // Try to restore from persisted state
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await this.tabManager.restoreState(persistedState);
      return;
    }

    // Fallback: create a new empty tab
    await this.tabManager.createTab();
  }

  private persistTabState(): void {

    // Debounce persistence to avoid rapid writes (300ms delay)
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = window.setTimeout(() => {
      this.pendingPersist = null;
      if (!this.tabManager) return;
      const state = this.tabManager.getPersistedState();
      this.plugin.persistTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    // Cancel any pending debounced persist
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Gets shared view controls that should preserve active tab selection context. */
  getSharedSelectionFocusScopeEls(): HTMLElement[] {
    return [
      this.inputNavRowHostEl,
    ].filter((el): el is HTMLElement => el !== null);
  }
}
