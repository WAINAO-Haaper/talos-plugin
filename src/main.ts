import { FileSystemAdapter, Modal, Notice, Plugin, TFile, WorkspaceLeaf, addIcon, debounce, normalizePath, requestUrl } from "obsidian";
import { DEFAULT_SETTINGS, TalosSettingTab, TalosSettings, normalizeVisualTheme } from "./settings";
import { TalosView, VIEW_TYPE_TALOS } from "./view";
import { VIEW_TYPE_CLAUDIAN } from "./quyuan/claudian/core/types";
import type { ProviderId } from "./quyuan/claudian/core/providers/types";
import { AgentWorkbenchService } from "./agent-workbench/core/agent-workbench-service";
import { ConversationService } from "./agent-workbench/core/conversation-service";
import { WorkbenchConversationCoordinator } from "./agent-workbench/core/workbench-conversation-coordinator";
import { ClaudianReadonlyImporter, type LegacyImportState } from "./agent-workbench/legacy/claudian-readonly-importer";
import { RuntimeDiscoveryService } from "./agent-workbench/discovery/runtime-discovery-service";
import { NodeRuntimeProbeHost } from "./agent-workbench/discovery/node-runtime-probe-host";
import { DesktopRuntimeFactory } from "./agent-workbench/discovery/desktop-runtime-factory";
import { NodeSandboxProbeHost, ProcessSandbox } from "./agent-workbench/security/process-sandbox";
import { ApprovalBroker } from "./agent-workbench/security/approval-broker";
import { ExternalAccessGrantStore } from "./agent-workbench/security/external-access-grant";
import { JsonlSecurityAuditSink } from "./agent-workbench/security/jsonl-security-audit-sink";
import { PermissionRuleStore } from "./agent-workbench/security/permission-rule-store";
import { VaultBoundary } from "./agent-workbench/security/vault-boundary";
import { ObsidianLegacyReadAdapter, ObsidianWorkbenchStorage } from "./agent-workbench/storage/obsidian-workbench-storage";
import { PortableConversationStore } from "./agent-workbench/storage/portable-conversation-store";
import { RuntimeBindingStore } from "./agent-workbench/storage/runtime-binding-store";
import { WorkbenchSettingsStore } from "./agent-workbench/storage/workbench-settings-store";
import { ClaudianCompatibilityHost } from "./agent-workbench/ui/claudian-compatibility-host";
import {
	getCodexProviderSettings,
	updateCodexProviderSettings,
} from "./quyuan/claudian/providers/codex/settings";
import { parseEnvironmentVariables } from "./quyuan/claudian/utils/env";
import {
	loadQuyuanSoulContextWithFallback,
	type QuyuanSoulContext,
} from "./quyuan/persona-context";
import {
	evaluateQuyuanGovernance,
	type QuyuanGovernanceResult,
} from "./quyuan/governance";
import { StreamTts } from "./jarvis/voiceio";
import {
	enforceRealtimeVoiceIoSettings,
	VOICE_QWEN_WEB_SEARCH_ALLOWED,
} from "./quyuan/runtime-policy";
import { TALOS_ICON_SVG } from "./talos-mark";
import {
	MODULE_KEYS,
	VaultPaths,
	detectSchemaDetailed,
	resolveSchema,
	type DataSourceKey,
} from "./data/schema";
import {
	providerSecretStoreFromApp,
	readProviderSecret,
	saveProviderSecret,
} from "./ai/provider/secret-storage-runtime";
import type { LegacySecretField } from "./ai/provider/settings-migration";
import {
	buildProviderConfig,
	saveProviderConfigToVault,
} from "./ai/provider/provider-config-runtime";
import type { ProviderConfigFile } from "./ai/provider/provider-config-store";
import { ProviderFacade } from "./ai/provider/provider-facade";
import { createClaudianProviderAdapters } from "./ai/provider/claudian-provider-adapter";
import { AnthropicApiProvider } from "./ai/provider/anthropic-api-provider";
import { OpenAiCompatibleProvider } from "./ai/provider/openai-compatible-provider";
import { VaultRetriever } from "./ai/context/vault-retrieval";
import { inspectToolTargetPaths } from "./ai/context/tool-path-policy";
import { TalosAskService } from "./ai/ask-service";
import { createVaultProviderEgressAuditStore } from "./ai/privacy/provider-egress-audit-store";
import {
	createVaultProviderUsageAuditStore,
	type ProviderUsageMetrics,
} from "./ai/privacy/provider-usage-audit-store";
import { preflightChatProviderEgress } from "./ai/privacy/chat-provider-egress-preflight";
import type { ProviderEgressSourceKind } from "./ai/privacy/provider-egress-gate";
import {
	createConsoleActionRuntime,
	type ConsoleActionRuntime,
} from "./console-action-runtime";
import { VaultRecoveryStore } from "./task-core/recovery-store";
import {
	createWindowTimerHost,
	partialTaskResult,
} from "./task-core/task-runner";
import {
	registerApprovalTaskRuntime,
	unregisterApprovalTaskRuntime,
} from "./actions";
import {
	createVaultCanonicalRegistryReader,
} from "./canonical/registry-reader";
import {
	createVaultCanonicalRequestWriter,
} from "./canonical/request-writer";
import { TalosAskCommand } from "./canonical/talos-ask-command";
import { migrateWp7Data } from "./migrations/wp7-migration";
import {
	buildProviderCenterSnapshot,
	engineProviderSettingForProvider,
	providerIdForEngineSetting,
	type ProviderCenterSnapshot,
} from "./ui/provider-center";
import { DshProcessManager } from "./harness/dsh-process-manager";
import { normalizeDshPort } from "./harness/dsh-runtime";
import {
	executeVoiceVaultTool,
	type VoiceVaultToolName,
} from "./quyuan/voice-vault-tools";
import {
	buildQwenWebSearchRequest,
	parseQwenWebSearchResponse,
	qwenWebSearchEndpoint,
	QWEN_VOICE_WEB_SEARCH_MODEL,
	type QwenVoiceWebSearchRegion,
} from "./quyuan/qwen-web-search";

// 统一的 TALOS 品牌图标：库内 02-品牌资产/TALOS-Logo-Reverse-Origin-v1.svg 的实际矢量
// （蓝底 #005CFF + 白色 T 标志，裁去 TALOS 文字，缩放进 100×100 视框）。ribbon 与视图标签共用。
export const TALOS_ICON = "talos-logo";
const QUYUAN_SOUL_START = "<!-- TALOS_QUYUAN_SOUL:START -->";
const QUYUAN_SOUL_END = "<!-- TALOS_QUYUAN_SOUL:END -->";
const QUYUAN_RUNTIME_ERROR_LIMIT = 24;

type QuyuanRuntimeErrorRecord = {
	at: string;
	scope: string;
	message: string;
	stack: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatError(error: unknown): { message: string; stack: string } {
	if (error instanceof Error) {
		return {
			message: error.message || error.name || "Unknown Error",
			stack: error.stack || "",
		};
	}
	if (typeof error === "string") return { message: error, stack: "" };
	try {
		return { message: JSON.stringify(error), stack: "" };
	} catch {
		return { message: String(error), stack: "" };
	}
}

function timestampForPath(date = new Date()): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

class TalosAskPromptModal extends Modal {
	private resolveResult: ((value: string | null) => void) | null = null;
	private settled = false;

	openAndWait(): Promise<string | null> {
		this.open();
		return new Promise((resolve) => {
			this.resolveResult = resolve;
		});
	}

	onOpen(): void {
		this.titleEl.setText("TALOS 全库问答");
		const textarea = this.contentEl.createEl("textarea", {
			attr: {
				rows: "6",
				placeholder: "输入要向当前 Vault 提问的内容",
			},
		});
		textarea.setCssProps({ width: "100%" });
		const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = actions.createEl("button", { text: "取消" });
		const submit = actions.createEl("button", {
			text: "提问",
			cls: "mod-cta",
		});
		const finish = (value: string | null): void => {
			if (this.settled) return;
			this.settled = true;
			this.resolveResult?.(value);
			this.close();
		};
		cancel.addEventListener("click", () => finish(null));
		submit.addEventListener("click", () => {
			const query = textarea.value.trim();
			if (query) finish(query);
		});
		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				const query = textarea.value.trim();
				if (query) finish(query);
			}
		});
		textarea.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.resolveResult?.(null);
		}
	}
}

export default class TalosPlugin extends Plugin {
	talosSettings!: TalosSettings;
	private agentWorkbenchService: AgentWorkbenchService | null = null;
	private claudianCompatibility: ClaudianCompatibilityHost | null = null;
	private quyuanSoul: QuyuanSoulContext | null = null;
	private quyuanSoulError = "";
	private quyuanWorkbenchError = "";
	private readonly quyuanRuntimeErrors: QuyuanRuntimeErrorRecord[] = [];
	private readonly quyuanReadPaths = new Set<string>();
	private quyuanTts: StreamTts | null = null;
	private quyuanWorkbenchReady = false;
	private talosAskService: TalosAskService | null = null;
	private talosAskCommand: TalosAskCommand | null = null;
	private talosProviderFacade: ProviderFacade | null = null;
	private talosActionRuntime: ConsoleActionRuntime | null = null;
	private harnessManager: DshProcessManager | null = null;
	private quyuanChatAuditSequence = 0;
	private readonly handleWindowError = (event: ErrorEvent): void => {
		this.recordQuyuanRuntimeError("window.error", event.error ?? event.message);
	};
	private readonly handleWindowRejection = (event: PromiseRejectionEvent): void => {
		this.recordQuyuanRuntimeError("window.unhandledrejection", event.reason);
	};

	async onload(): Promise<void> {
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

		this.addSettingTab(new TalosSettingTab(this.app, this));

		this.registerDomEvent(window, "error", this.handleWindowError);
		this.registerDomEvent(window, "unhandledrejection", this.handleWindowRejection);

		void this.initializeQuyuanSoul();
		void this.initializeQuyuanWorkbench();

		this.app.workspace.onLayoutReady(() => {
			// 部署即自适应：首次加载（尚无目录映射）时自动识别客户库结构并落盘。
			// 必须等 onLayoutReady——此时 vault 索引才完整，否则扫不到目录。
			void this.autoDetectVaultSchemaOnFirstRun();
			if (this.talosSettings.openOnStartup) void this.activateHomeView();
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

	private refreshViews(): void {
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
		const actionTimers = createWindowTimerHost(activeWindow);
		const noteRoots = Array.from(
			new Set(
				[
					this.talosSettings.inboxFolder,
					this.talosSettings.dailyFolder,
					this.paths.dir("insights"),
					this.paths.dir("output"),
					"00 收件箱",
					"01 日志",
					"30 洞察",
					"70 输出",
				].map((path) => normalizePath(path))
			)
		);
		const executeCallback = async (input: unknown): Promise<unknown> => {
			if (
				!input ||
				typeof input !== "object" ||
				typeof (input as { execute?: unknown }).execute !== "function"
			) {
				throw new Error("该受控动作缺少已批准的执行回调");
			}
			return (input as { execute(): Promise<unknown> }).execute();
		};
		return createConsoleActionRuntime({
			dependencies: {
				refreshStats: async () => {
					this.refreshViews();
					return { refreshed: true };
				},
				vaultLint: async () => {
					const notes = this.app.vault.getMarkdownFiles();
					const missingFrontmatter = notes.filter(
						(file) =>
							!this.app.metadataCache.getFileCache(file)?.frontmatter
					).length;
					new Notice(
						`只读 Lint：扫描 ${notes.length} 篇，缺 frontmatter ${missingFrontmatter} 篇`
					);
					if (missingFrontmatter > 0) {
						return partialTaskResult({
							result: {
								notes: notes.length,
								missingFrontmatter,
							},
							error: `${missingFrontmatter} 篇笔记缺少 frontmatter`,
						});
					}
					return { notes: notes.length, missingFrontmatter };
				},
				deepResearch: async (_input, context) => {
					const { deepResearch } = await import("./actions");
					await deepResearch(
						this.app,
						this.talosSettings,
						context.signal
					);
					return { requested: true };
				},
				createNote: async (input) => {
					if (
						!input ||
						typeof input !== "object" ||
						typeof (input as { targetPath?: unknown }).targetPath !==
							"string"
					) {
						throw new Error("新建内容缺少目标路径");
					}
					const targetPath = normalizePath(
						(input as { targetPath: string }).targetPath
					);
					if (
						targetPath.startsWith(".talos/private/") ||
						!noteRoots.some(
							(root) =>
								targetPath === root ||
								targetPath.startsWith(`${root}/`)
						)
					) {
						throw new Error(`新建内容目标超出允许范围：${targetPath}`);
					}
					const slash = targetPath.lastIndexOf("/");
					if (slash > 0) {
						await this.ensureVaultFolder(targetPath.slice(0, slash));
					}
					const content =
						typeof (input as { content?: unknown }).content === "string"
							? (input as { content: string }).content
							: "# TALOS 行动记录\n";
					await this.app.vault.create(targetPath, content);
					return { path: targetPath };
				},
				publishBackfill: executeCallback,
				decideApproval: executeCallback,
				decidePreference: executeCallback,
			},
			scopes: {
				noteWriteScopes: noteRoots.map((path) => `${path}/**`),
			},
			recoveryStore: new VaultRecoveryStore({
				exists: (path) => this.app.vault.adapter.exists(path),
				read: (path) => this.app.vault.adapter.read(path),
				write: (path, value) =>
					this.app.vault.adapter.write(path, value),
				remove: (path) => this.app.vault.adapter.remove(path),
			}),
			timers: actionTimers,
		});
	}

	/**
	 * 首次运行自动识别库结构（部署即用，客户零操作）。
	 *
	 * 只在「用户从未配置过目录映射」时执行一次，绝不覆盖用户的手动设置。
	 * 识别结果同时写入目录映射与统计来源文件路径，并弹一次可见提示，
	 * 让客户知道插件已按他的库结构对齐（也知道去哪儿改）。
	 */
	private async autoDetectVaultSchemaOnFirstRun(): Promise<void> {
		try {
			const configured = this.talosSettings.vaultSchema;
			if (configured && Object.keys(configured).length > 0) return; // 用户已配置，不动
			if (this.talosSettings.schemaAutoDetected) return; // 已自动检测过，不重复打扰

			const result = detectSchemaDetailed(this.app);
			this.talosSettings.schemaAutoDetected = true;

			// 库里几乎没有可识别目录（例如全新空库）：不硬套，留默认，也不弹窗打扰
			if (result.matchedCount < 3) {
				await this.saveTalosSettings();
				return;
			}

			this.talosSettings.vaultSchema = { ...result.schema };
			// 统计来源文件：只在识别到时覆盖，避免把用户已改的路径冲掉
			const sourceKeys: DataSourceKey[] = [
				"tasksPath",
				"pendingApprovalsPath",
				"candidatesPath",
				"healthLogPath",
			];
			for (const key of sourceKeys) {
				const found = result.dataSources[key];
				if (found) this.talosSettings[key] = found;
			}
			// 收件箱/日记目录跟随识别结果
			this.talosSettings.inboxFolder = result.schema.inbox;
			this.talosSettings.dailyFolder = result.schema.logs;

			await this.saveTalosSettings();
			this.refreshViews();

			const renamed = result.entries.filter((e) => e.how === "alias" && e.matched);
			const detail = renamed.length > 0
				? `其中 ${renamed.length} 项按你的命名自动对齐（如 ${renamed
					.slice(0, 2)
					.map((e) => e.matched)
					.join("、")}）`
				: "全部与标准结构一致";
			new Notice(
				`TALOS 已自动识别你的库结构：匹配 ${result.matchedCount}/${result.entries.length} 个模块，${detail}。`
					+ "\n如需调整：设置 → TALOS → 目录映射。",
				12000
			);
		} catch (error) {
			this.recordQuyuanRuntimeError("autoDetectVaultSchema", error);
			console.error("TALOS auto schema detection failed", error);
		}
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
		this.claudianCompatibility = null;
		activeDocument.body.removeAttribute("data-talos-vault-theme");
	}

	getAgentWorkbenchService(): AgentWorkbenchService {
		if (!this.agentWorkbenchService?.isReady()) {
			throw new Error(this.quyuanWorkbenchError || "TALOS 智能体工作台仍在初始化");
		}
		return this.agentWorkbenchService;
	}

	getAgentWorkbenchCompatibility(): ClaudianCompatibilityHost {
		if (!this.claudianCompatibility || !this.quyuanWorkbenchReady) {
			throw new Error(this.quyuanWorkbenchError || "兼容展示层仍在初始化");
		}
		return this.claudianCompatibility;
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
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
		const mainLeaf = existing.find(
			(candidate) => candidate.getRoot() === workspace.rootSplit
		);
		const leaf = mainLeaf ?? workspace.getLeaf("tab");
		if (!mainLeaf) {
			await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
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
			await leaf.setViewState({ type: VIEW_TYPE_TALOS, active: true });
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
		this.syncCodexHarnessEnvironment();
	}

	/**
	 * D-TLP-013：设置页 → Codex harness 环境同步。
	 * base_url/model 写入 codex provider 的环境文本（非密，可持久化）；
	 * 环境文本里遗留的明文 OPENAI_API_KEY 先迁入 SecretStorage 再剔除（D-WP7-004）。
	 */
	private syncCodexHarnessEnvironment(): void {
		const compatibility = this.claudianCompatibility;
		if (!compatibility?.settings || !this.talosSettings) return;
		const current = getCodexProviderSettings(compatibility.settings).environmentVariables;
		const parsed = parseEnvironmentVariables(current);
		const legacyKey = parsed.OPENAI_API_KEY?.trim() ?? "";
		if (legacyKey && !this.readProviderSecret("codexApiKey")) {
			const store = providerSecretStoreFromApp(this.app);
			if (store) {
				try {
					saveProviderSecret(
						this.talosSettings,
						"codexApiKey",
						legacyKey,
						store
					);
				} catch (error) {
					this.recordQuyuanRuntimeError("syncCodexHarnessEnvironment.secret", error);
				}
			}
		}

		const managedKeys = new Set(["OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY"]);
		const kept = current.split(/\r?\n/).filter((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) return true;
			const normalized = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
			const eqIndex = normalized.indexOf("=");
			const key = eqIndex > 0 ? normalized.substring(0, eqIndex).trim() : "";
			return !managedKeys.has(key);
		});
		const baseUrl = this.talosSettings.codexBaseUrl.trim();
		const model = this.talosSettings.codexModel.trim();
		if (baseUrl) kept.push(`OPENAI_BASE_URL=${baseUrl}`);
		if (model) kept.push(`OPENAI_MODEL=${model}`);
		const next = kept.join("\n").trim();
		if (next !== current.trim()) {
			updateCodexProviderSettings(compatibility.settings, { environmentVariables: next });
			void compatibility.saveSettings();
		}
	}

	/**
	 * D-TLP-013/D-WP7-004：Codex API Key 只在 spawn 子进程前运行时注入，
	 * 永不写入可持久化的设置文本。
	 */
	decorateClaudianEnvironment(providerId: ProviderId, base: string): string {
		if (providerId !== undefined && providerId !== "codex") return base;
		const key = this.readProviderSecret("codexApiKey");
		if (!key) return base;
		return base.trim() ? `${base.trim()}\nOPENAI_API_KEY=${key}` : `OPENAI_API_KEY=${key}`;
	}

	private selectedTalosAskProviderId(): string {
		return providerIdForEngineSetting(this.talosSettings.engineProvider);
	}

	getTalosProviderFacade(): ProviderFacade {
		if (this.talosProviderFacade) return this.talosProviderFacade;
		const facade = new ProviderFacade();
		if (this.quyuanWorkbenchReady && this.claudianCompatibility) {
			for (const provider of createClaudianProviderAdapters(this.claudianCompatibility)) {
				facade.register(provider);
			}
		}
		const secrets = providerSecretStoreFromApp(this.app);
		const governedToolRunner = {
			async run(): Promise<{ content: string; isError: boolean }> {
				return {
					content: "工具请求必须进入 TALOS 任务审批，canonical 入口不直接执行",
					isError: true,
				};
			},
		};
		if (secrets) {
			facade.register(
				new AnthropicApiProvider({
					id: "claude-api",
					endpoint:
						this.talosSettings.anthropicBaseUrl.trim() ||
						"https://api.anthropic.com",
					model:
						this.talosSettings.jarvisModel.trim() ||
						"claude-sonnet-4-6",
					systemPrompt: this.quyuanSoul?.systemContext ?? "",
					secretRef:
						this.talosSettings.providerSecretRefs.anthropicApiKey ||
						"talos-anthropic-api-key",
					secrets,
					toolRunner: governedToolRunner,
					thinkingLevel: this.talosSettings.jarvisThinkingLevel,
				})
			);
			facade.register(
				new OpenAiCompatibleProvider({
					id: "openai-compatible",
					endpoint:
						this.talosSettings.openaiBaseUrl.trim() ||
						"https://api.openai.com",
					model: this.talosSettings.openaiModel.trim() || "gpt-4o",
					systemPrompt: this.quyuanSoul?.systemContext ?? "",
					secretRef:
						this.talosSettings.providerSecretRefs.openaiApiKey ||
						"talos-openai-api-key",
					secrets,
					toolRunner: governedToolRunner,
					thinkingLevel: this.talosSettings.jarvisThinkingLevel,
				})
			);
		}
		this.talosProviderFacade = facade;
		return facade;
	}

	getProviderCenterSnapshot(): ProviderCenterSnapshot {
		const facade = this.getTalosProviderFacade();
		const config: ProviderConfigFile = buildProviderConfig(
			this.talosSettings
		);
		const known = new Set(config.providers.map((provider) => provider.id));
		const capabilities = [
			"chat",
			"stream",
			"tools",
			"usage",
			"cancel",
			"resume",
			"fork",
		] as const;
		for (const provider of facade.listProviders()) {
			if (known.has(provider.id)) continue;
			const missing = new Set(
				facade.getAvailability(provider.id, [...capabilities]).missing
			);
			config.providers.push({
				id: provider.id,
				name:
					provider.id === "codex"
						? "Codex harness · 本机"
						: `${provider.id} · 本机 Provider`,
				kind: provider.kind,
				endpoint: "local://cli",
				model: this.talosSettings.jarvisModel.trim() || "CLI 默认模型",
				capabilities: capabilities.filter(
					(capability) => !missing.has(capability)
				),
				isDefault:
					provider.id === this.selectedTalosAskProviderId(),
				secretRef: "talos-local-cli",
				vaultAccess: this.talosSettings.providerVaultAccess
					? "full"
					: "denied",
				moduleAccess: {
					...(this.talosSettings.providerModuleAccess[provider.id] ??
						{}),
				},
			});
		}
		return buildProviderCenterSnapshot({
			facade,
			config,
			secrets: providerSecretStoreFromApp(this.app),
		});
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

	async changeConsoleProviderModel(
		providerId: string,
		model: string
	): Promise<void> {
		const normalized = model.trim();
		if (!normalized) throw new Error("模型名称不能为空");
		if (providerId === "openai-compatible") {
			this.talosSettings.openaiModel = normalized;
		} else {
			this.talosSettings.jarvisModel = normalized;
		}
		await this.saveTalosSettings();
	}

	private getTalosAskService(): TalosAskService {
		if (this.talosAskService) return this.talosAskService;
		if (!this.quyuanSoul) {
			throw new Error(
				`屈原人格未启动：${this.quyuanSoulError || "强制上下文仍在加载"}`
			);
		}

		const facade = this.getTalosProviderFacade();

		const retriever = new VaultRetriever(
			{
				listPaths: async () =>
					this.app.vault.getMarkdownFiles().map((file) => file.path),
				read: (path) => this.app.vault.adapter.read(path),
			},
			{ configDir: this.app.vault.configDir }
		);
		const auditStore = createVaultProviderEgressAuditStore(this.app);
		this.talosAskService = new TalosAskService({
			facade,
			retriever,
			manualReview: () => true,
			vaultAccess: () =>
				this.talosSettings.providerVaultAccess ? "full" : "denied",
			moduleAccess: (providerId) =>
				this.talosSettings.providerModuleAccess[providerId] ?? {},
			vaultSchema: () => this.talosSettings.vaultSchema,
			auditSink: (record) => auditStore.append(record),
			configDir: this.app.vault.configDir,
			toolGateway: {
				propose: async (input) =>
					this.getConsoleActionRuntime().proposeProviderTool(input),
			},
		});
		return this.talosAskService;
	}

	private getTalosAskCommand(): TalosAskCommand {
		if (this.talosAskCommand) return this.talosAskCommand;
		this.talosAskCommand = new TalosAskCommand({
			registryReader: createVaultCanonicalRegistryReader(this.app),
			requestWriter: createVaultCanonicalRequestWriter(this.app),
			askService: {
				ask: (input) => this.getTalosAskService().ask(input),
			},
		});
		return this.talosAskCommand;
	}

	private async executeTalosAskCommand(): Promise<void> {
		const query = await new TalosAskPromptModal(this.app).openAndWait();
		if (!query) return;
		try {
			const text: string[] = [];
			let errorMessage = "";
			let proposedTools = 0;
			for await (const event of this.getTalosAskCommand().execute({
				channel: "obsidian",
				providerId: this.selectedTalosAskProviderId(),
				query,
				writebackIntent: "display-only",
				approvalState: "not-required",
				currentPath: this.app.workspace.getActiveFile()?.path,
			})) {
				if (event.type === "text") text.push(event.text);
				if (event.type === "error") errorMessage = event.message;
				if (event.type === "tool-request") proposedTools += 1;
			}
			if (errorMessage) {
				new Notice(`TALOS 问答失败：${errorMessage}`, 10000);
				return;
			}
			const answer = text.join("").trim() || "（Provider 未返回文本）";
			const proposal = proposedTools
				? `\n${proposedTools} 个工具请求已进入待审批任务。`
				: "";
			new Notice(`${answer.slice(0, 1200)}${proposal}`, 15000);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`TALOS canonical 问答不可用：${message}`, 12000);
		}
	}

	recordQuyuanRuntimeError(scope: string, error: unknown): void {
		const formatted = formatError(error);
		this.quyuanRuntimeErrors.push({
			at: new Date().toISOString(),
			scope,
			message: formatted.message,
			stack: formatted.stack,
		});
		while (this.quyuanRuntimeErrors.length > QUYUAN_RUNTIME_ERROR_LIMIT) {
			this.quyuanRuntimeErrors.shift();
		}
	}

	async writeQuyuanDiagnostics(openReport = true): Promise<string> {
		const folder = this.talosSettings?.reportsFolder || DEFAULT_SETTINGS.reportsFolder;
		await this.ensureVaultFolder(folder);
		const path = normalizePath(
			`${folder}/talos-quyuan-diagnostics-${timestampForPath()}.md`
		);
		const report = this.buildQuyuanDiagnosticsReport(path);
		// 同一秒内重复生成时文件已存在，create 会抛错——存在则改为覆盖
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, report);
		else await this.app.vault.create(path, report);
		if (openReport) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
		}
		new Notice(`屈原诊断报告已生成：${path}`);
		return path;
	}

	/**
	 * 屈原页白屏视觉诊断（2026-07-10）：面板已挂载、麦克风在工作，但页面一片白
	 * 且拦截点击——说明渲染层被盖住或布局塌了。此命令把控制台视图的 DOM 布局、
	 * 关键节点计算样式、以及视图中心点的元素堆叠链写进 vault 报告，免开 DevTools。
	 */
	async writeQuyuanVisualDiagnostics(): Promise<string> {
		const folder = this.talosSettings?.reportsFolder || DEFAULT_SETTINGS.reportsFolder;
		await this.ensureVaultFolder(folder);
		const path = normalizePath(
			`${folder}/talos-quyuan-visual-${timestampForPath()}.md`
		);

		const describe = (el: Element | null, label: string): string => {
			if (!el) return `- ${label}: (不存在)`;
			const rect = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			const cls = (typeof el.className === "string" ? el.className : "")
				.split(/\s+/).filter(Boolean).slice(0, 4).join(".");
			return `- ${label}: \`${el.tagName.toLowerCase()}${cls ? "." + cls : ""}\` ` +
				`${Math.round(rect.width)}×${Math.round(rect.height)} @(${Math.round(rect.left)},${Math.round(rect.top)}) ` +
				`display=${cs.display} opacity=${cs.opacity} visibility=${cs.visibility} ` +
				`position=${cs.position} z=${cs.zIndex} pointerEvents=${cs.pointerEvents} bg=${cs.backgroundColor}`;
		};

		const lines: string[] = [
			"---",
			'title: "TALOS 屈原页面视觉诊断"',
			`date: ${new Date().toISOString()}`,
			"tags: [TALOS, 屈原, diagnostics]",
			"status: active",
			"type: report",
			'summary: "屈原页白屏的 DOM/样式现场快照。"',
			"---",
			"",
			"# TALOS 屈原页面视觉诊断",
			"",
		];

		// 样式表审计：.tq-voice 规则是否真的进了 document、样式是否被截断
		lines.push("## 样式表审计", "");
		const styleTags = Array.from(activeDocument.head.querySelectorAll("style"));
		styleTags.forEach((tag, i) => {
			const text = tag.textContent ?? "";
			if (!text.includes("talos-console") && !text.includes("tq-voice")) return;
			const tail = text.slice(-100).replace(/\s+/g, " ");
			lines.push(
				`- style#${i + 1}: 长度=${text.length} 字符, ` +
				`含 .tq-voice 出现 ${(text.match(/\.tq-voice/g) || []).length} 次, ` +
				`含 page-jarvis 出现 ${(text.match(/page-jarvis|data-talos-page="jarvis"/g) || []).length} 次`,
				`  - 末尾 100 字符: \`${tail}\``
			);
		});
		let tqRuleCount = 0;
		let jarvisGuardCount = 0;
		for (const sheet of Array.from(activeDocument.styleSheets)) {
			let rules: CSSRuleList;
			try {
				rules = sheet.cssRules;
			} catch {
				continue;
			}
			for (const rule of Array.from(rules)) {
				if (!(rule instanceof CSSStyleRule)) continue;
				const sel = rule.selectorText ?? "";
				if (sel.includes(".tq-voice")) tqRuleCount++;
				if (sel.includes('[data-talos-page="jarvis"]')) jarvisGuardCount++;
			}
		}
		lines.push(
			`- 已解析生效的 .tq-voice 规则总数: ${tqRuleCount}`,
			`- 已解析生效的 [data-talos-page="jarvis"] 规则总数: ${jarvisGuardCount}`,
			""
		);

		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS);
		if (leaves.length === 0) lines.push("- 未找到控制台视图 leaf。");

		leaves.forEach((leaf, i) => {
			const container = leaf.view.containerEl;
			const consoleEl = container.querySelector(".talos-console");
			lines.push(`## Leaf #${i + 1}`, "");
			if (!consoleEl) {
				lines.push("- 未找到 `.talos-console` 根元素（视图 shell 未渲染）。", "");
				lines.push(describe(container, "containerEl"), "");
				return;
			}
			lines.push(
				`- data-talos-page: \`${consoleEl.getAttribute("data-talos-page") ?? "(无)"}\``,
				`- class: \`${consoleEl.className}\``,
				"",
				"### 关键节点",
				"",
				describe(container.querySelector(".view-content"), "view-content"),
				describe(consoleEl, "talos-console"),
				describe(consoleEl.querySelector(".app"), "app"),
				describe(consoleEl.querySelector(".sidebar"), "sidebar"),
				describe(consoleEl.querySelector(".main"), "main"),
				describe(consoleEl.querySelector(".page-content"), "page-content"),
				describe(consoleEl.querySelector(".tq-voice"), "tq-voice"),
				""
			);
			const tq = consoleEl.querySelector(".tq-voice");
			if (tq) {
				lines.push("### tq-voice 子元素", "");
				Array.from(tq.children).forEach((child, j) =>
					lines.push(describe(child, `child#${j + 1}`))
				);
				lines.push("");
			}
			const pc = consoleEl.querySelector(".page-content");
			if (pc && pc !== tq?.parentElement) {
				lines.push("### page-content 子元素", "");
				Array.from(pc.children).forEach((child, j) =>
					lines.push(describe(child, `child#${j + 1}`))
				);
				lines.push("");
			}
			// 视图中心点的元素堆叠：白屏时最上层是谁、谁在拦截点击，一目了然
			const rect = container.getBoundingClientRect();
			const cx = rect.left + rect.width / 2;
			const cy = rect.top + rect.height / 2;
			const stack = activeDocument.elementsFromPoint(cx, cy).slice(0, 14);
			lines.push(`### 中心点 (${Math.round(cx)},${Math.round(cy)}) 元素堆叠（上→下）`, "");
			stack.forEach((el, j) => lines.push(describe(el, `#${j + 1}`)));
			lines.push("");
		});

		// 同一秒内重复生成时文件已存在，create 会抛错——存在则改为覆盖
		const existingVisual = this.app.vault.getAbstractFileByPath(path);
		if (existingVisual instanceof TFile) await this.app.vault.modify(existingVisual, lines.join("\n"));
		else await this.app.vault.create(path, lines.join("\n"));
		new Notice(`屈原视觉诊断已生成：${path}`);
		return path;
	}

	private buildQuyuanDiagnosticsReport(path: string): string {
		const workspace = this.app.workspace;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
		const compatibilitySettings = this.claudianCompatibility?.settings;
		const safeWorkbenchSettings = compatibilitySettings
			? {
				settingsProvider: compatibilitySettings.settingsProvider,
				model: compatibilitySettings.model,
				permissionMode: compatibilitySettings.permissionMode,
				maxTabs: compatibilitySettings.maxTabs,
				chatViewPlacement: compatibilitySettings.chatViewPlacement,
				locale: compatibilitySettings.locale,
			}
			: null;
		const safeTalosSettings = this.talosSettings
			? {
				visualTheme: this.talosSettings.visualTheme,
				syncVaultTheme: this.talosSettings.syncVaultTheme,
				openOnStartup: this.talosSettings.openOnStartup,
				engineProvider: this.talosSettings.engineProvider,
				quyuanAsrEngine: this.talosSettings.quyuanAsrEngine,
				jarvisVoiceEnabled: this.talosSettings.jarvisVoiceEnabled,
			}
			: null;

		const lines = [
			"---",
			'title: "TALOS 屈原诊断报告"',
			`date: ${new Date().toISOString()}`,
			"tags: [TALOS, 屈原, diagnostics]",
			"status: active",
			"type: report",
			'summary: "Obsidian 内 TALOS 屈原模块运行时诊断。"',
			"---",
			"",
			"# TALOS 屈原诊断报告",
			"",
				`- 报告文件：\`${path}\``,
				`- 插件版本：\`${this.manifest.version}\``,
				`- 完整工作台视图类型：\`${VIEW_TYPE_CLAUDIAN}\``,
				`- 完整工作台初始化：${this.describeQuyuanWorkbenchStatus()}`,
				`- 屈原人格启动：${this.quyuanSoul ? "✅ 已加载" : `❌ ${this.quyuanSoulError || "未加载"}`}`,
			`- 屈原人格加载时间：${this.quyuanSoul?.loadedAt ? new Date(this.quyuanSoul.loadedAt).toISOString() : "n/a"}`,
			`- 当前工作台 leaf 数：${leaves.length}`,
			"",
			"## Leaf 状态",
			"",
			...this.describeQuyuanLeaves(leaves),
			"",
			"## 工作台设置快照",
			"",
			"```json",
			JSON.stringify(safeWorkbenchSettings, null, 2),
			"```",
			"",
			"## TALOS 设置快照",
			"",
			"```json",
			JSON.stringify(safeTalosSettings, null, 2),
			"```",
			"",
			"## 最近运行时错误",
			"",
			...this.describeQuyuanRuntimeErrors(),
			"",
			"## 下一步",
			"",
			"- 如果 `ClaudianWorkbenchPlugin.onload` 有错误，优先看完整工作台初始化链路。",
			"- 如果 leaf 已创建但 `hasShell=false` 或 `hasTabManager=false`，优先看 `ClaudianView.onOpen` 抛错。",
			"- 如果没有错误但仍不可见，优先查 Obsidian 布局位置、右侧栏折叠状态和 CSS 可见性。",
			"",
		];
		return lines.join("\n");
	}

	private describeQuyuanLeaves(leaves: WorkspaceLeaf[]): string[] {
		if (leaves.length === 0) return ["- 未找到 `talos-quyuan-view` leaf。"];
		const workspace = this.app.workspace;
		return leaves.map((leaf, index) => {
			const view = leaf.view as unknown as {
				containerEl?: HTMLElement;
				contentEl?: HTMLElement;
				getViewType?: () => string;
				getTabManager?: () => unknown;
			};
			const root = view.containerEl ?? view.contentEl ?? null;
			const rootName = leaf.getRoot() === workspace.rootSplit ? "main" : "sidebar/other";
			const hasShell = !!root?.querySelector(".talos-quyuan-shell, .claudian-container");
			const hasTabManager = typeof view.getTabManager === "function" && !!view.getTabManager();
			const viewType = typeof view.getViewType === "function" ? view.getViewType() : "unknown";
			return `- #${index + 1}: root=${rootName}, viewType=${viewType}, hasShell=${hasShell}, hasTabManager=${hasTabManager}`;
		});
	}

	private describeQuyuanWorkbenchStatus(): string {
		if (this.quyuanWorkbenchReady) return "✅ 已完成";
		if (this.quyuanWorkbenchError) return `❌ ${this.quyuanWorkbenchError}`;
		return "⏳ 初始化中，主控制台不等待此步骤";
	}

	private describeQuyuanRuntimeErrors(): string[] {
		if (this.quyuanRuntimeErrors.length === 0) return ["- 暂无记录。"];
		return this.quyuanRuntimeErrors.flatMap((item, index) => [
			`### ${index + 1}. ${item.scope}`,
			"",
			`- 时间：${item.at}`,
			`- 错误：${item.message}`,
			"",
			"```text",
			item.stack || "(no stack)",
			"```",
			"",
		]);
	}

	private async ensureVaultFolder(folder: string): Promise<void> {
		const path = normalizePath(folder);
		const parts = path.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(current))) {
				try {
					await this.app.vault.createFolder(current);
				} catch {
					/* Folder may have been created by another Obsidian event. */
				}
			}
		}
	}

	private scheduleQuyuanWorkbenchCheck(leaf: WorkspaceLeaf): void {
		window.setTimeout(() => {
			const view = leaf.view as unknown as {
				containerEl?: HTMLElement;
				contentEl?: HTMLElement;
				getTabManager?: () => unknown;
			};
			const root = view.containerEl ?? view.contentEl ?? null;
			const hasShell = !!root?.querySelector(".talos-quyuan-shell, .claudian-container");
			const hasTabManager = typeof view.getTabManager === "function" && !!view.getTabManager();
			if (hasShell && hasTabManager) return;
			const error = new Error(
				`屈原完整工作台打开后自检失败：hasShell=${hasShell}, hasTabManager=${hasTabManager}`
			);
			this.recordQuyuanRuntimeError("activateQuyuanV2View.postOpenCheck", error);
			void this.writeQuyuanDiagnostics(false).then((path) => {
				new Notice(`屈原工作台打开后自检失败，诊断已写入：${path}`);
			});
		}, 1200);
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
		// Microphone media and the explicitly granted voice-only Vault snippet
		// channel are independently authorized. Neither grant changes the global
		// text-provider switch, and Vault egress still has to name exact source
		// paths and pass the provider/module/secret gate below.
		const isAuthorizedVoiceAudio =
			input.namespace === "voice" && input.kind === "voice-audio";
		const isAuthorizedVoiceVaultSnippet =
			input.namespace === "voice" && input.kind === "vault-snippet";
		const isAuthorizedVoiceWebSearchQuery =
			input.namespace === "voice" && input.kind === "web-search-query";
		const result = await preflightChatProviderEgress({
			providerId: input.providerId,
			vaultAccess: isAuthorizedVoiceAudio
				|| isAuthorizedVoiceVaultSnippet
				|| isAuthorizedVoiceWebSearchQuery
				|| this.talosSettings.providerVaultAccess
				? "full"
				: "denied",
			moduleAccess:
				this.talosSettings.providerModuleAccess[input.providerId] ?? {},
			vaultSchema: this.talosSettings.vaultSchema,
			configDir: this.app.vault.configDir,
			prompt: input.prompt,
			historyText: input.historyText,
			contextPaths: input.contextPaths,
			sourcePaths: input.sourcePaths,
			sourceKinds: input.sourceKinds,
			externalContextPaths: input.externalContextPaths,
			hasImages: input.hasImages,
			hasMcpMentions: input.hasMcpMentions,
			hasBrowserContext: input.hasBrowserContext,
			readContext: (path) => this.app.vault.adapter.read(path),
		});

		this.quyuanChatAuditSequence += 1;
		const stamp = Date.now();
		const suffix = `${stamp}-${this.quyuanChatAuditSequence}`;
		const session = (input.sessionId || "new")
			.replace(/[^a-zA-Z0-9._:-]/g, "-")
			.slice(0, 140);
		await createVaultProviderEgressAuditStore(this.app).append({
			runId: `${input.namespace}-${input.kind}-run-${suffix}`,
			turnId: `${input.namespace}-${input.kind}-turn-${suffix}`,
			sessionId: `${input.namespace}:${session || "new"}`,
			namespace: input.namespace,
			audit: result.audit,
		});

		if (result.allowed) return { allowed: true };
		return {
			allowed: false,
			message: `Provider 出库隐私审计未通过：${
				result.audit.blockedReasons.join("、") || "安全策略拒绝"
			}`,
		};
	}

	async recordQuyuanProviderUsage(input: {
		namespace: "voice";
		providerId: string;
		operation: string;
		model: string;
		usage: ProviderUsageMetrics;
		sessionId?: string;
	}): Promise<void> {
		this.quyuanChatAuditSequence += 1;
		const stamp = Date.now();
		const suffix = String(stamp) + "-" + this.quyuanChatAuditSequence;
		const session = (input.sessionId || "new")
			.replace(/[^a-zA-Z0-9._:-]/g, "-")
			.slice(0, 140);
		await createVaultProviderUsageAuditStore(this.app).append({
			runId: input.namespace + "-" + input.operation + "-" + suffix,
			sessionId: input.namespace + ":" + (session || "new"),
			namespace: input.namespace,
			providerId: input.providerId,
			operation: input.operation,
			model: input.model,
			usage: input.usage,
		});
	}

	async executeQuyuanVoiceVaultTool(input: {
		name: VoiceVaultToolName;
		args: Record<string, unknown>;
		sessionId?: string;
	}): Promise<string> {
		const result = await executeVoiceVaultTool({
			listPaths: async () =>
				this.app.vault.getMarkdownFiles().map((file) => file.path),
			read: async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) throw new Error("Vault 文档不存在");
				return this.app.vault.cachedRead(file);
			},
		}, input.name, input.args, {
			configDir: this.app.vault.configDir,
			modulePaths: Object.fromEntries(
				MODULE_KEYS.map((key) => [key, this.paths.dir(key)])
			),
			maxHits: 4,
			maxExcerptChars: 900,
			maxFiles: 3000,
			maxFileChars: 400_000,
			maxConcurrency: 12,
			maxListResults: 100,
			maxReadLines: 200,
			maxGrepHits: 40,
			maxOutputChars: 6000,
		});
		const audit = await this.auditQuyuanProviderEgress({
			namespace: "voice",
			kind: "vault-snippet",
			providerId: "aliyun-qwen-realtime",
			prompt: result.output,
			sourcePaths: result.sourcePaths,
			sourceKinds: ["vault-snippet"],
			sessionId: input.sessionId,
		});
		if (!audit.allowed) {
			throw new Error(audit.message || "库内片段出库审计未通过");
		}
		for (const path of result.sourcePaths) {
			this.recordQuyuanToolUse(result.operation, {
				...input.args,
				path,
			});
		}
		return result.output;
	}

	async executeQuyuanVoiceWebSearch(input: {
		query: string;
		callId: string;
		sessionId?: string;
	}): Promise<string> {
		if (!VOICE_QWEN_WEB_SEARCH_ALLOWED) {
			throw new Error("语音 Qwen 联网搜索未获运行策略授权");
		}
		const query = input.query.trim();
		const requestBody = buildQwenWebSearchRequest(query);
		const workspaceId = this.talosSettings.quyuanRealtimeWorkspaceId.trim();
		const region: QwenVoiceWebSearchRegion =
			this.talosSettings.quyuanRealtimeRegion === "ap-southeast-1"
				? "ap-southeast-1"
				: "cn-beijing";
		const endpoint = qwenWebSearchEndpoint(workspaceId, region);
		const apiKey = this.readProviderSecret("aliyunApiKey")?.trim();
		if (!apiKey) {
			throw new Error("请先在设置中安全保存百炼 API Key");
		}
		const sessionId = input.sessionId || "qwen-web-search:" + input.callId;
		const audit = await this.auditQuyuanProviderEgress({
			namespace: "voice",
			kind: "web-search-query",
			providerId: "aliyun-qwen-search",
			prompt: query,
			sourceKinds: ["web-search-query"],
			sessionId,
		});
		if (!audit.allowed) {
			throw new Error(audit.message || "联网搜索问题出库审计未通过");
		}
		const response = await requestUrl({
			url: endpoint,
			method: "POST",
			headers: {
				Authorization: "Bearer " + apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error("百炼联网搜索失败（HTTP " + response.status + "）");
		}
		let payload: unknown;
		try {
			payload = JSON.parse(response.text);
		} catch {
			throw new Error("百炼联网搜索返回无法解析的响应");
		}
		const result = parseQwenWebSearchResponse(payload);
		await this.recordQuyuanProviderUsage({
			namespace: "voice",
			providerId: "aliyun-qwen-search",
			operation: "web-search",
			model: QWEN_VOICE_WEB_SEARCH_MODEL,
			usage: result.usage,
			sessionId,
		});
		return result.output;
	}

	async exchangeQuyuanRealtimeSdp(input: {
		model: string;
		instructions: string;
		offerSdp: string;
	}): Promise<{ answerSdp: string }> {
		const allowedModels = new Set([
			"qwen3.5-omni-flash-realtime",
			"qwen3.5-omni-plus-realtime",
		]);
		if (!allowedModels.has(input.model)) {
			throw new Error("不支持的千问 Realtime 模型");
		}
		if (!input.offerSdp.startsWith("v=0")) {
			throw new Error("无效的 WebRTC Offer SDP");
		}
		const workspaceId = this.talosSettings.quyuanRealtimeWorkspaceId.trim();
		if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,127}$/.test(workspaceId)) {
			throw new Error("请先在设置中填写有效的百炼业务空间 ID");
		}
		const region = this.talosSettings.quyuanRealtimeRegion === "ap-southeast-1"
			? "ap-southeast-1"
			: "cn-beijing";
		const apiKey = this.readProviderSecret("aliyunApiKey")?.trim();
		if (!apiKey) {
			throw new Error("请先在设置中安全保存百炼 API Key");
		}
		const audit = await this.auditQuyuanProviderEgress({
			namespace: "voice",
			kind: "voice-audio",
			providerId: "aliyun-qwen-realtime",
			prompt: input.instructions,
			sourceKinds: ["prompt", "voice-audio"],
			sessionId: `qwen-realtime-${Date.now()}`,
		});
		if (!audit.allowed) {
			throw new Error(audit.message || "实时语音出库审计未通过");
		}
		const endpoint = new URL(
			`https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/webrtc/realtime`
		);
		endpoint.searchParams.set("model", input.model);
		const response = await requestUrl({
			url: endpoint.toString(),
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/sdp",
			},
			body: input.offerSdp,
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error(
				`百炼 WebRTC SDP 交换失败（HTTP ${response.status}）：${response.text.slice(0, 240)}`
			);
		}
		if (!response.text.trim()) {
			throw new Error("百炼 WebRTC SDP 交换返回空响应");
		}
		return { answerSdp: response.text };
	}

	async auditQuyuanChatEgress(input: {
		providerId: string;
		prompt: string;
		historyText?: string;
		currentNotePath?: string;
		editorSourcePath?: string;
		canvasSourcePath?: string;
		externalContextPaths?: string[];
		hasImages?: boolean;
		hasMcpMentions?: boolean;
		hasBrowserContext?: boolean;
		sessionId?: string;
	}): Promise<{ allowed: boolean; message?: string }> {
		const sourceKinds: ProviderEgressSourceKind[] = ["prompt"];
		if (input.historyText) sourceKinds.push("history");
		if (input.currentNotePath) sourceKinds.push("current-note");
		if (input.editorSourcePath) sourceKinds.push("editor-selection");
		if (input.canvasSourcePath) sourceKinds.push("canvas-selection");
		if (input.hasBrowserContext) sourceKinds.push("browser-selection");
		if (input.hasImages) sourceKinds.push("attachment");
		if ((input.externalContextPaths?.length ?? 0) > 0) {
			sourceKinds.push("external-context");
		}
		return this.auditQuyuanProviderEgress({
			namespace: "chat",
			kind: "prompt",
			providerId: input.providerId,
			prompt: input.prompt,
			historyText: input.historyText,
			contextPaths: input.currentNotePath
				? [input.currentNotePath]
				: [],
			sourcePaths: [
				input.editorSourcePath,
				input.canvasSourcePath,
			].filter((path): path is string => Boolean(path)),
			sourceKinds,
			externalContextPaths: input.externalContextPaths,
			hasImages: input.hasImages,
			hasMcpMentions: input.hasMcpMentions,
			hasBrowserContext: input.hasBrowserContext,
			sessionId: input.sessionId,
		});
	}

	evaluateQuyuanToolPolicy(
		toolName: string,
		input: Record<string, unknown>
	): QuyuanGovernanceResult {
		return evaluateQuyuanGovernance({
			toolName,
			input,
			readPaths: this.quyuanReadPaths,
				configDir: this.app.vault.configDir,
		});
	}

	async prepareQuyuanInlineEdit(
		path: string
	): Promise<{ decision: "allow" | "deny"; reason: string }> {
		const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "");
		const slash = normalized.lastIndexOf("/");
		const readme = slash < 0
			? "_README.md"
			: `${normalized.slice(0, slash)}/_README.md`;

		try {
			if (!(await this.app.vault.adapter.exists(readme))) {
				return {
					decision: "deny",
					reason: `目标目录缺少 ${readme}，不能安全执行行内编辑`,
				};
			}
			await this.app.vault.adapter.read(readme);
			this.quyuanReadPaths.add(readme);
		} catch (error) {
			return {
				decision: "deny",
				reason: `无法读取 ${readme}：${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}

		const policy = evaluateQuyuanGovernance({
			toolName: "inline-edit",
			input: { file_path: normalized },
			readPaths: this.quyuanReadPaths,
			approvalGranted: true,
		});
		return {
			decision: policy.decision === "allow" ? "allow" : "deny",
			reason: policy.reason,
		};
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

	private async initializeQuyuanWorkbench(): Promise<void> {
		this.quyuanWorkbenchReady = false;
		this.quyuanWorkbenchError = "";
		try {
			if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
				throw new Error("TALOS 多智能体本地运行时仅支持桌面 FileSystem Vault");
			}
			const vaultRoot = this.app.vault.adapter.getBasePath();
			const discovery = new RuntimeDiscoveryService(new NodeRuntimeProbeHost());
			const runtimeFactory = new DesktopRuntimeFactory(
				discovery,
				new ProcessSandbox(new NodeSandboxProbeHost()),
			);
			const portableStorage = new ObsidianWorkbenchStorage(this.app.vault.adapter, vaultRoot);
			const workbenchStateRoot = ".talos/agent-workbench/v1";
			const permissionRules = new PermissionRuleStore({
				read: () => portableStorage.readJson(`${workbenchStateRoot}/permission-rules.json`),
				write: (rules) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/permission-rules.json`, rules),
			});
			const approvalBroker = new ApprovalBroker(
				new VaultBoundary(vaultRoot, undefined, 20, this.app.vault.configDir),
				permissionRules,
				new ExternalAccessGrantStore(),
				new JsonlSecurityAuditSink(vaultRoot),
			);
			const secretStore = providerSecretStoreFromApp(this.app);
			const workbenchSettings = new WorkbenchSettingsStore({
				read: () => portableStorage.readJson(`${workbenchStateRoot}/settings.json`),
				write: (value) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/settings.json`, value),
			}, { has: (reference) => secretStore?.has(reference) ?? false });
			const conversations = new ConversationService(new PortableConversationStore(portableStorage));
			const nativeBindings = new RuntimeBindingStore({
				read: () => portableStorage.readJson<Record<string, unknown>>(`${workbenchStateRoot}/runtime-bindings.json`),
				write: (value) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/runtime-bindings.json`, value),
			});
			const importManifestPath = ".talos/agent-workbench/v1/import-manifest.json";
			const legacyImporter = new ClaudianReadonlyImporter(
				new ObsidianLegacyReadAdapter(this.app.vault.adapter),
				conversations,
				{
					read: () => portableStorage.readJson<LegacyImportState>(importManifestPath),
					write: (state) => portableStorage.writeJsonAtomic(importManifestPath, state),
				},
			);
			const conversationCoordinator = new WorkbenchConversationCoordinator(
				conversations,
				nativeBindings,
				legacyImporter,
			);
			const compatibility = new ClaudianCompatibilityHost(this);
			const service = new AgentWorkbenchService({
				compatibility,
				approvalBroker,
				conversationCoordinator,
				settingsStore: workbenchSettings,
				onPersistenceError: (error) => this.recordQuyuanRuntimeError("AgentWorkbenchService.settings", error),
				probeRuntime: (runtimeId, profile, signal) => discovery.probe(runtimeId, profile),
				listModels: async (runtimeId) => {
					const runtime = await runtimeFactory.create(runtimeId, { vaultRoot, configDir: this.app.vault.configDir, approve: async () => "deny" });
					try { return await runtime.listModels(); } finally { await runtime.dispose(); }
				},
				createRuntime: (runtimeId, input) => runtimeFactory.create(runtimeId, { ...input, configDir: this.app.vault.configDir }),
			});
			this.claudianCompatibility = compatibility;
			this.agentWorkbenchService = service;
			await service.initialize();
			this.quyuanWorkbenchReady = true;
			this.talosProviderFacade = null;
			this.talosAskService = null;
			this.quyuanWorkbenchError = "";
			this.syncCodexHarnessEnvironment();
			this.syncQuyuanSoulPrompt();
		} catch (error) {
			this.agentWorkbenchService?.dispose();
			this.agentWorkbenchService = null;
			this.claudianCompatibility = null;
			this.quyuanWorkbenchReady = false;
			this.talosProviderFacade = null;
			this.talosAskService = null;
			this.quyuanWorkbenchError =
				error instanceof Error ? error.message : String(error);
			this.recordQuyuanRuntimeError("ClaudianWorkbenchPlugin.onload", error);
			console.error("TALOS Quyuan workbench failed to initialize", error);
		}
	}

	private async initializeQuyuanSoul(): Promise<void> {
		try {
			const P = this.paths;
			this.quyuanSoul = await loadQuyuanSoulContextWithFallback(
				this.app,
				[P.personaFile, P.personaMemoryFile, P.contextFile],
				[
					P.join("identity", "身份.md"),
					P.join("identity", "偏好与边界.md"),
					P.join("identity", "目标.md"),
				]
			);
			this.talosProviderFacade = null;
			this.talosAskService = null;
			this.quyuanSoulError = "";
			this.syncQuyuanSoulPrompt();
		} catch (error) {
			this.quyuanSoul = null;
			this.quyuanSoulError =
				error instanceof Error ? error.message : String(error);
			this.recordQuyuanRuntimeError("initializeQuyuanSoul", error);
		}
	}

	private syncQuyuanSoulPrompt(): void {
		const compatibility = this.claudianCompatibility;
		if (!this.quyuanSoul || !compatibility?.settings) return;
		const current = compatibility.settings.systemPrompt || "";
		const escapedStart = QUYUAN_SOUL_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const escapedEnd = QUYUAN_SOUL_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const block = `${QUYUAN_SOUL_START}\n${this.quyuanSoul.systemContext}\n${QUYUAN_SOUL_END}`;
		const blockPattern = new RegExp(
			`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`,
			"m"
		);
		compatibility.settings.systemPrompt = blockPattern.test(current)
			? current.replace(blockPattern, `\n${block}\n`)
			: `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}`;
	}
}
