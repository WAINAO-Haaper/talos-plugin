import { FileSystemAdapter, Notice, Plugin, TFile, WorkspaceLeaf, addIcon, debounce } from "obsidian";
import { DEFAULT_SETTINGS, TalosSettingTab, TalosSettings, normalizeVisualTheme } from "./settings";
import { TalosView, VIEW_TYPE_TALOS } from "./view";
import { AgentWorkbenchService } from "./agent-workbench/core/agent-workbench-service";
import { CLAUDE_SDK_BUNDLE_FILE, configureClaudeSdkBundle } from "./agent-workbench/transports/claude-sdk-port";
import { ObsidianWorkbenchStorage } from "./agent-workbench/storage/obsidian-workbench-storage";
import {
	TalosAgentRecoveryView,
	VIEW_TYPE_TALOS_AGENT_RECOVERY,
} from "./agent-workbench/ui/talos-agent-recovery-view";
import {
	type QuyuanSoulContext,
} from "./quyuan/persona-context";
import { StreamTts } from "./jarvis/voiceio";
import {
	enforceRealtimeVoiceIoSettings,
} from "./quyuan/runtime-policy";
import { TALOS_ICON_SVG } from "./talos-mark";
import {
	VaultPaths,
	resolveSchema,
} from "./data/schema";
import {
	providerSecretStoreFromApp,
	readProviderSecret,
} from "./ai/provider/secret-storage-runtime";
import type { LegacySecretField } from "./ai/provider/settings-migration";
import {
	saveProviderConfigToVault,
} from "./ai/provider/provider-config-runtime";
import { ProviderFacade } from "./ai/provider/provider-facade";
import { inspectToolTargetPaths } from "./ai/context/tool-path-policy";
import { TalosAskService } from "./ai/ask-service";
import {
	type ProviderUsageMetrics,
} from "./ai/privacy/provider-usage-audit-store";
import type { ProviderEgressSourceKind } from "./ai/privacy/provider-egress-gate";
import {
	type ConsoleActionRuntime,
} from "./console-action-runtime";
import {
	registerApprovalTaskRuntime,
	unregisterApprovalTaskRuntime,
} from "./actions";
import { TalosAskCommand } from "./canonical/talos-ask-command";
import { migrateWp7Data } from "./migrations/wp7-migration";
import {
	engineProviderSettingForProvider,
	providerIdForEngineSetting,
} from "./ui/provider-center";
import { DshProcessManager } from "./harness/dsh-process-manager";
import { normalizeDshPort } from "./harness/dsh-runtime";
import {
	type VoiceVaultToolName,
} from "./quyuan/voice-vault-tools";
import { isRecord, type QuyuanRuntimeErrorRecord } from "./plugin/plugin-support";
import { exchangeQuyuanRealtimeSdp, executeQuyuanVoiceVaultTool, executeQuyuanVoiceWebSearch, prepareQuyuanInlineEdit } from "./plugin/quyuan-voice-tools";
import { auditQuyuanChatEgress, auditQuyuanProviderEgress, recordQuyuanProviderUsage } from "./plugin/quyuan-egress-audit";
import { recordQuyuanRuntimeError, scheduleQuyuanWorkbenchCheck, writeQuyuanDiagnostics, writeQuyuanVisualDiagnostics } from "./plugin/quyuan-diagnostics";
import { initializeQuyuanWorkbench } from "./plugin/quyuan-workbench-init";
import { executeTalosAskCommand, getTalosProviderFacade, syncAgentWorkbenchProviderProfiles, syncCodexHarnessEnvironment } from "./plugin/provider-runtime";
import { createTalosActionRuntime } from "./plugin/action-runtime";
import { initializeFirstRunContext } from "./plugin/first-run";

// 统一的 TALOS 品牌图标：TalosBall 0.3.0 的固定 blob 静态姿态。Ribbon 与视图标签共用。
export const TALOS_ICON = "talos-logo";

export default class TalosPlugin extends Plugin {
	talosSettings!: TalosSettings;
	agentWorkbenchService: AgentWorkbenchService | null = null;
	agentWorkbenchStorage: ObsidianWorkbenchStorage | null = null;
	agentWorkbenchSurface: "dsh" | "codex" = "dsh";
	quyuanSoul: QuyuanSoulContext | null = null;
	quyuanSoulError = "";
	quyuanWorkbenchError = "";
	readonly quyuanRuntimeErrors: QuyuanRuntimeErrorRecord[] = [];
	readonly quyuanReadPaths = new Set<string>();
	private quyuanTts: StreamTts | null = null;
	quyuanWorkbenchReady = false;
	private quyuanWorkbenchInitialization: Promise<{ service: AgentWorkbenchService }> | null = null;
	private firstRunContextInitialization: Promise<void> | null = null;
	talosAskService: TalosAskService | null = null;
	talosAskCommand: TalosAskCommand | null = null;
	talosProviderFacade: ProviderFacade | null = null;
	private talosActionRuntime: ConsoleActionRuntime | null = null;
	private harnessManager: DshProcessManager | null = null;
	quyuanChatAuditSequence = 0;
	private readonly handleWindowError = (event: ErrorEvent): void => {
		this.recordQuyuanRuntimeError("window.error", event.error ?? event.message);
	};
	private readonly handleWindowRejection = (event: PromiseRejectionEvent): void => {
		this.recordQuyuanRuntimeError("window.unhandledrejection", event.reason);
	};

	async onload(): Promise<void> {
		configureClaudeSdkBundle(this.claudeSdkBundlePath());
		await this.loadTalosSettings();
		this.talosActionRuntime = this.createTalosActionRuntime();
		registerApprovalTaskRuntime(
			this.app,
			this.talosActionRuntime.approvals
		);
		this.quyuanTts = new StreamTts(
			this.talosSettings,
			() => {}
		);
		this.applyVaultTheme();

		addIcon(TALOS_ICON, TALOS_ICON_SVG);

		this.registerView(
			VIEW_TYPE_TALOS,
			(leaf: WorkspaceLeaf) => new TalosView(leaf, this)
		);
		this.registerView(
			VIEW_TYPE_TALOS_AGENT_RECOVERY,
			(leaf: WorkspaceLeaf) => new TalosAgentRecoveryView(
				leaf,
				async () => (await this.waitForAgentWorkbench()).service,
			)
		);

		this.addRibbonIcon(TALOS_ICON, "打开 TALOS 控制台", () => {
			void this.activateTalosView();
		});

		this.addCommand({
			id: "open",
			name: "Open console",
			callback: () => void this.activateTalosView(),
		});
		this.addCommand({
			id: "open-quyuan-v2",
			name: "打开 AI 对话",
			callback: () => void this.activateQuyuanV2View(),
		});
		this.addCommand({
			id: "open-quyuan-v2-recovery",
			name: "打开屈原独立恢复视图",
			callback: () => void this.activateQuyuanV2MainView(),
		});
		this.addCommand({
			id: "quyuan-diagnostics",
			name: "生成屈原诊断报告",
			callback: () => void this.writeQuyuanDiagnostics(true),
		});
		this.addCommand({
			id: "quyuan-visual-diagnostics",
			name: "生成屈原页面视觉诊断",
			callback: () => void this.writeQuyuanVisualDiagnostics(),
		});
		this.addCommand({
			// Canonical registry contract requires this stable ID verbatim.
			// eslint-disable-next-line obsidianmd/commands/no-plugin-id-in-command-id
			id: "talos-ask",
			name: "全库问答",
			callback: () => void this.executeTalosAskCommand(),
		});
		this.addCommand({
			id: "refresh-peer-status",
			name: "刷新状态桥快照（只读）",
			callback: () => {
				for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS)) {
					if (leaf.view instanceof TalosView) void leaf.view.refresh();
				}
			},
		});

		this.addSettingTab(new TalosSettingTab(this.app, this));

		this.registerDomEvent(window, "error", this.handleWindowError);
		this.registerDomEvent(window, "unhandledrejection", this.handleWindowRejection);

		void this.startQuyuanWorkbenchInitialization().catch(() => {
			// The recorded initialization error is delivered to a waiting view.
		});

		this.app.workspace.onLayoutReady(() => {
			// Schema discovery must settle before bootstrap resolves persona paths.
			void this.startFirstRunContextInitialization().finally(() => {
				if (this.talosSettings.openOnStartup) void this.activateHomeView();
			});
		});

		const refresh = debounce(() => this.refreshViews(), 1500, true);
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (f instanceof TFile && f.extension === "md") refresh();
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (f) => {
				if (f instanceof TFile && f.extension === "md") refresh();
			})
		);
		this.registerEvent(this.app.vault.on("delete", () => refresh()));
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS)) {
			const view = leaf.view;
			if (view instanceof TalosView) void view.refresh();
		}
	}

	/** 供设置页调用：改完目录映射后立即按新 schema 重新统计 */
	refreshAllViews(): void {
		this.refreshViews();
	}

	getConsoleActionRuntime(): ConsoleActionRuntime {
		if (!this.talosActionRuntime) {
			throw new Error("TALOS 动作运行时尚未初始化");
		}
		return this.talosActionRuntime;
	}

	private createTalosActionRuntime(): ConsoleActionRuntime {
		return createTalosActionRuntime(this);
	}

	/**
	 * 首次运行自动识别库结构（部署即用，客户零操作）。
	 *
	 * 只在「用户从未配置过目录映射」时执行一次，绝不覆盖用户的手动设置。
	 * 识别结果同时写入目录映射与统计来源文件路径，并弹一次可见提示，
	 * 让客户知道插件已按他的库结构对齐（也知道去哪儿改）。
	 */
	startFirstRunContextInitialization(): Promise<void> {
		this.firstRunContextInitialization ??= this.initializeFirstRunContext();
		return this.firstRunContextInitialization;
	}

	private async initializeFirstRunContext(): Promise<void> {
		return initializeFirstRunContext(this);
	}


	/**
	 * 当前库目录映射（唯一真源）。数据层与视图层一律经此取路径，
	 * 不再各自拼裸字符串——客户改设置即可整体适配自己的目录命名。
	 */
	get paths(): VaultPaths {
		return new VaultPaths(resolveSchema(this.talosSettings?.vaultSchema));
	}

	applyViewSettings(): void {
		this.applyVaultTheme();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS)) {
			const view = leaf.view;
			if (view instanceof TalosView) view.applySettings();
		}
	}

	private applyVaultTheme(): void {
		if (!this.talosSettings.syncVaultTheme) {
			activeDocument.body.removeAttribute("data-talos-vault-theme");
			return;
		}
		activeDocument.body.setAttribute(
			"data-talos-vault-theme",
			normalizeVisualTheme(this.talosSettings.visualTheme)
		);
	}

	// Claude SDK 单独打包在插件目录的 claude-sdk.cjs，首次运行 Claude 时才加载。
	// 用 getBasePath 能力判断而非 instanceof（真实宿主曾因 instanceof 判断失败）。
	private claudeSdkBundlePath(): string | null {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		const dir = this.manifest.dir;
		if (typeof adapter.getBasePath !== "function" || !dir) return null;
		return [adapter.getBasePath(), dir, CLAUDE_SDK_BUNDLE_FILE].join("/");
	}

	// D-TLP-014：DeepSeek Harness 嵌入面的进程管理单例。
	// cwd 锁死当前 vault 根（工作区锁死），$DSH_HOME 固定在用户主目录（凭证出 vault）。
	getHarnessManager(): DshProcessManager {
		this.harnessManager ??= new DshProcessManager({
			getConfiguredExecutable: () =>
				this.talosSettings.harnessExecutable ?? "",
			getPort: () => normalizeDshPort(this.talosSettings.harnessPort),
			getVaultRoot: () => {
				const adapter = this.app.vault.adapter;
				return adapter instanceof FileSystemAdapter
					? adapter.getBasePath()
					: null;
			},
		});
		return this.harnessManager;
	}

	onunload(): void {
		unregisterApprovalTaskRuntime(this.app);
		this.talosActionRuntime = null;
		void this.harnessManager?.dispose();
		this.harnessManager = null;
		this.quyuanTts?.stop();
		this.quyuanTts = null;
		this.agentWorkbenchService?.dispose();
		this.agentWorkbenchService = null;
		this.agentWorkbenchStorage = null;
		activeDocument.body.removeAttribute("data-talos-vault-theme");
	}

	private startQuyuanWorkbenchInitialization(): Promise<{ service: AgentWorkbenchService }> {
		this.quyuanWorkbenchInitialization ??= this.initializeQuyuanWorkbench();
		return this.quyuanWorkbenchInitialization;
	}

	async waitForAgentWorkbench(): Promise<{ service: AgentWorkbenchService }> {
		return this.startQuyuanWorkbenchInitialization();
	}

	getAgentWorkbenchService(): AgentWorkbenchService {
		if (!this.agentWorkbenchService?.isReady()) {
			throw new Error(this.quyuanWorkbenchError || "TALOS 智能体工作台仍在初始化");
		}
		return this.agentWorkbenchService;
	}

	getAgentWorkbenchSurface(): "dsh" | "codex" {
		return this.agentWorkbenchSurface;
	}

	setAgentWorkbenchSurface(value: string): void {
		const activeChannel = value === "codex" ? "codex" : "dsh";
		this.agentWorkbenchSurface = activeChannel;
		const storage = this.agentWorkbenchStorage;
		if (!storage) {
			this.recordQuyuanRuntimeError(
				"AgentWorkbenchService.chatSurface",
				new Error("工作台 sidecar 存储尚未初始化")
			);
			return;
		}
		void storage.writeJsonAtomic(".talos/agent-workbench/v1/chat-surface.json", {
			schemaVersion: 1,
			activeChannel,
		}).catch((error) => {
			this.recordQuyuanRuntimeError("AgentWorkbenchService.chatSurface", error);
		});
	}

	// 旧版右侧栏 JarvisView 已随 C-3b 移除；语音统一走控制台内屈原语音页。
	async activateQuyuanV2View(): Promise<void> {
		try {
			const leaf = await this.openOrReviveTalosLeaf(false);
			if (!leaf) throw new Error("无法创建 TALOS 主视图");
			if (leaf.view instanceof TalosView) {
				leaf.view.navigateToPage("chat");
			}
			void this.app.workspace.revealLeaf(leaf);
		} catch (error) {
			this.recordQuyuanRuntimeError("activateQuyuanV2View", error);
			console.error("TALOS AI chat failed to open", error);
			const path = await this.writeQuyuanDiagnostics(false);
			new Notice(`TALOS AI 对话打开失败，诊断已写入：${path}`);
		}
	}

	async activateQuyuanV2MainView(): Promise<void> {
		if (!this.quyuanWorkbenchReady) {
			new Notice(
				this.quyuanWorkbenchError
					? `屈原完整工作台加载失败：${this.quyuanWorkbenchError}`
					: "屈原完整工作台仍在初始化，TALOS 控制台已保持可用。"
			);
			return;
		}
		if (!this.quyuanSoul) {
			new Notice(`屈原人格未启动：${this.quyuanSoulError || "缺少强制上下文"}`);
			return;
		}

		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TALOS_AGENT_RECOVERY);
		const mainLeaf = existing.find(
			(candidate) => candidate.getRoot() === workspace.rootSplit
		);
		const leaf = mainLeaf ?? workspace.getLeaf("tab");
		if (!mainLeaf) {
			await leaf.setViewState({ type: VIEW_TYPE_TALOS_AGENT_RECOVERY, active: true });
		}
		await workspace.revealLeaf(leaf);
		this.scheduleQuyuanWorkbenchCheck(leaf);
	}

	async activateView(): Promise<void> {
		await this.activateQuyuanV2View();
	}

	async activateTalosView(): Promise<void> {
		const leaf = await this.openOrReviveTalosLeaf(false);
		if (leaf) void this.app.workspace.revealLeaf(leaf);
	}

	private async activateHomeView(): Promise<void> {
		const leaf = await this.openOrReviveTalosLeaf(false);
		if (leaf) void this.app.workspace.revealLeaf(leaf);
	}

	private async openOrReviveTalosLeaf(useNewLeaf: boolean): Promise<WorkspaceLeaf | null> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TALOS);
		if (existing.length > 0) {
			const leaf = existing[0];
			if (!leaf) return null;
			await leaf.setViewState({
				...leaf.getViewState(),
				type: VIEW_TYPE_TALOS,
				active: true,
			});
			const view = leaf.view;
			if (view instanceof TalosView && !view.hasRenderedShell()) {
				await view.recoverFromBlankView();
			}
			return leaf;
		}
		const leaf = workspace.getLeaf(useNewLeaf);
		await leaf.setViewState({ type: VIEW_TYPE_TALOS, active: true });
		const view = leaf.view;
		if (view instanceof TalosView && !view.hasRenderedShell()) {
			await view.recoverFromBlankView();
		}
		return leaf;
	}

	async loadTalosSettings(): Promise<void> {
		const loaded: unknown = await this.loadData();
		const stored = isRecord(loaded) ? loaded : {};
		const namespaced = isRecord(stored.talos) ? stored.talos : stored;
		const knownSettings = Object.fromEntries(
			Object.entries(namespaced).filter(([key]) =>
				Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
			)
		) as Partial<TalosSettings>;
		let settings = Object.assign({}, DEFAULT_SETTINGS, knownSettings);
		// D-TLP-013：claude-cli 通道已移除，旧设置一次性迁移到 codex-cli harness。
		if (settings.engineProvider === "claude-cli") {
			settings.engineProvider = "codex-cli";
		}
		// 远程 JavaScript 和自定义模型 URL 已停用。字段只为兼容旧 data.json，
		// 运行时不再消费其值；归一化为空避免后续保存继续传播不安全配置。
		settings.quyuanLocalAsrCdn = "";
		settings.quyuanLocalAsrModel = "";
		settings.quyuanVadCdn = "";
		settings.quyuanVadModel = "";
		settings.visualTheme = normalizeVisualTheme(settings.visualTheme);
		// 屈原背景效果容错：只接受合法值，否则回退默认
		if (settings.quyuanBackground !== "letter-glitch" && settings.quyuanBackground !== "grid-scan") {
			settings.quyuanBackground = "letter-glitch";
		}
		const secretStore = providerSecretStoreFromApp(this.app);
		try {
			const migration = await migrateWp7Data({
				stored,
				settings,
				secretStore,
				persist: (data) => this.saveData(data),
			});
			settings = migration.settings;
			if (migration.status === "blocked") {
				settings.engineProvider = "codex-cli";
				new Notice(
					"当前 Obsidian 不支持 SecretStorage，WP7 密钥迁移已暂停且原明文未删除；云端 API Provider 已禁用，本机 Codex harness 仍可使用。"
				);
			}
		} catch {
			settings.engineProvider = "codex-cli";
			new Notice(
				"WP7 设置或密钥迁移中断，云端 API Provider 已禁用；已完成步骤将在下次启动继续，原设置不会提前删除。"
			);
		}
		this.talosSettings = enforceRealtimeVoiceIoSettings(settings);
		if (
			!secretStore &&
			this.talosSettings.engineProvider !== "codex-cli"
		) {
			this.talosSettings.engineProvider = "codex-cli";
			new Notice(
				"当前 Obsidian 不支持 SecretStorage，云端 API Provider 已禁用；请升级到 1.11.4 或更高版本。本机 Codex harness 仍可使用。"
			);
		}
		await saveProviderConfigToVault(this.app, this.talosSettings);
	}

	readProviderSecret(field: LegacySecretField): string | null {
		return readProviderSecret(
			this.talosSettings,
			field,
			providerSecretStoreFromApp(this.app)
		);
	}

	async saveTalosSettings(): Promise<void> {
		enforceRealtimeVoiceIoSettings(this.talosSettings);
		const loaded: unknown = await this.loadData();
		const stored = isRecord(loaded) ? loaded : {};
		await this.saveData({ ...stored, talos: this.talosSettings });
		await saveProviderConfigToVault(this.app, this.talosSettings);
		this.talosAskService = null;
		this.talosAskCommand = null;
		this.talosProviderFacade = null;
		await this.syncCodexHarnessEnvironment();
		await this.syncAgentWorkbenchProviderProfiles();
	}


	private async syncCodexHarnessEnvironment(): Promise<void> {
		return syncCodexHarnessEnvironment(this);
	}

	private async syncAgentWorkbenchProviderProfiles(): Promise<void> {
		return syncAgentWorkbenchProviderProfiles(this);
	}

	/**
	 * D-TLP-013/D-WP7-004：Codex API Key 只在 spawn 子进程前运行时注入，
	 * 永不写入可持久化的设置文本。
	 */
	decorateRuntimeEnvironment(providerId: string | undefined, base: string): string {
		if (providerId !== undefined && providerId !== "codex") return base;
		const key = this.readProviderSecret("codexApiKey");
		if (!key) return base;
		return base.trim() ? `${base.trim()}\nOPENAI_API_KEY=${key}` : `OPENAI_API_KEY=${key}`;
	}

	selectedTalosAskProviderId(): string {
		return providerIdForEngineSetting(this.talosSettings.engineProvider);
	}

	getTalosProviderFacade(): ProviderFacade {
		return getTalosProviderFacade(this);
	}


	async selectConsoleProvider(providerId: string): Promise<void> {
		const available = this.getTalosProviderFacade()
			.listProviders()
			.some((provider) => provider.id === providerId);
		if (!available) throw new Error(`未注册 Provider：${providerId}`);
		this.talosSettings.engineProvider =
			engineProviderSettingForProvider(providerId);
		await this.saveTalosSettings();
	}




	private async executeTalosAskCommand(): Promise<void> {
		return executeTalosAskCommand(this);
	}

	recordQuyuanRuntimeError(scope: string, error: unknown): void {
		return recordQuyuanRuntimeError(this, scope, error);
	}

	async writeQuyuanDiagnostics(openReport = true): Promise<string> {
		return writeQuyuanDiagnostics(this, openReport);
	}

	async writeQuyuanVisualDiagnostics(): Promise<string> {
		return writeQuyuanVisualDiagnostics(this);
	}



	describeQuyuanWorkbenchStatus(): string {
		if (this.quyuanWorkbenchReady) return "✅ 已完成";
		if (this.quyuanWorkbenchError) return `❌ ${this.quyuanWorkbenchError}`;
		return "⏳ 初始化中，主控制台不等待此步骤";
	}



	private scheduleQuyuanWorkbenchCheck(leaf: WorkspaceLeaf): void {
		return scheduleQuyuanWorkbenchCheck(this, leaf);
	}

	getQuyuanSoulStatus(): { ready: boolean; error: string; loadedAt: number | null } {
		return {
			ready: this.quyuanSoul !== null,
			error: this.quyuanSoulError,
			loadedAt: this.quyuanSoul?.loadedAt ?? null,
		};
	}

	recordQuyuanToolUse(toolName: string, input: Record<string, unknown>): void {
		if (!["Read", "Glob", "Grep", "Search"].includes(toolName)) return;
		const inspection = inspectToolTargetPaths(toolName, input, {
			configDir: this.app.vault.configDir,
		});
		if (inspection.blocked) return;
		for (const path of inspection.paths) this.quyuanReadPaths.add(path);
	}

	async auditQuyuanProviderEgress(input: {
		namespace: "chat" | "voice" | "auxiliary";
		kind: ProviderEgressSourceKind;
		providerId: string;
		prompt: string;
		historyText?: string;
		contextPaths?: string[];
		sourcePaths?: string[];
		sourceKinds?: ProviderEgressSourceKind[];
		externalContextPaths?: string[];
		hasImages?: boolean;
		hasMcpMentions?: boolean;
		hasBrowserContext?: boolean;
		sessionId?: string;
	}): Promise<{ allowed: boolean; message?: string }> {
		return auditQuyuanProviderEgress(this, input);
	}

	async recordQuyuanProviderUsage(input: {
		namespace: "voice";
		providerId: string;
		operation: string;
		model: string;
		usage: ProviderUsageMetrics;
		sessionId?: string;
	}): Promise<void> {
		return recordQuyuanProviderUsage(this, input);
	}

	async executeQuyuanVoiceVaultTool(input: {
		name: VoiceVaultToolName;
		args: Record<string, unknown>;
		sessionId?: string;
	}): Promise<string> {
		return executeQuyuanVoiceVaultTool(this, input);
	}

	async executeQuyuanVoiceWebSearch(input: {
		query: string;
		callId: string;
		sessionId?: string;
	}): Promise<string> {
		return executeQuyuanVoiceWebSearch(this, input);
	}

	async exchangeQuyuanRealtimeSdp(input: {
		model: string;
		instructions: string;
		offerSdp: string;
	}): Promise<{ answerSdp: string }> {
		return exchangeQuyuanRealtimeSdp(this, input);
	}

	async auditQuyuanChatEgress(input: {
		providerId: string;
		prompt: string;
		historyText?: string;
		currentNotePath?: string;
		editorSourcePaths?: string[];
		canvasSourcePaths?: string[];
		externalContextPaths?: string[];
		hasImages?: boolean;
		hasMcpMentions?: boolean;
		hasBrowserContext?: boolean;
		sessionId?: string;
	}): Promise<{ allowed: boolean; message?: string }> {
		return auditQuyuanChatEgress(this, input);
	}


	async prepareQuyuanInlineEdit(path: string): Promise<{ decision: "allow" | "deny"; reason: string }> {
		return prepareQuyuanInlineEdit(this, path);
	}

	onQuyuanAssistantText(content: string): void {
		if (this.talosSettings.jarvisVoiceEnabled) this.quyuanTts?.feed(content);
	}

	onQuyuanAssistantDone(): void {
		if (this.talosSettings.jarvisVoiceEnabled) this.quyuanTts?.flush();
	}

	getQuyuanVoiceEnabled(): boolean {
		return this.talosSettings.jarvisVoiceEnabled;
	}

	async setQuyuanVoiceEnabled(enabled: boolean): Promise<void> {
		this.talosSettings.jarvisVoiceEnabled = enabled;
		if (!enabled) {
			this.stopQuyuanVoiceInput();
			this.stopQuyuanSpeech();
		}
		await this.saveTalosSettings();
	}

	toggleQuyuanVoiceInput(handlers: {
		onInterim: (text: string) => void;
		onFinal: (text: string) => void;
		onStateChange: (listening: boolean, error?: string) => void;
	}): void {
		handlers.onStateChange(
			false,
			"旧 WebSpeech 入口已停用；请使用屈原语音页的千问 Realtime"
		);
	}

	stopQuyuanVoiceInput(): void {}

	stopQuyuanSpeech(): void {
		this.quyuanTts?.stop();
	}

	private async initializeQuyuanWorkbench(): Promise<{ service: AgentWorkbenchService }> {
		return initializeQuyuanWorkbench(this);
	}


}
