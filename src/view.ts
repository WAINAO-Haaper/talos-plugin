import { readRegisteredFiles } from "./plugin/scaffold-modal";
import { fileStatus, type AnyFileKey, type FileStatus } from "./data/vault-files";
import { renderSetupHint, setupProblems } from "./ui/setup-hint";
import {
	ItemView,
	Notice,
	WorkspaceLeaf,
	setIcon,
	type ViewStateResult,
} from "obsidian";
import type TalosPlugin from "./main";
import { TalosSettingTab } from "./settings";
import { LensConsole, LENS_ROOT_ID } from "./ui/lens/lens-console";
import type { QuickNote } from "./ui/quick-note";
import type { InboxTriageSession } from "./ui/inbox-triage-panel";
import type { LensModuleId } from "./ui/lens/lens-pages";
import type {
	GateItem,
	OutputCenter,
	ProjectScene,
	SignalItem,
} from "./types";
import {
	collectApprovals,
	collectCandidates,
	collectDist,
	collectFocusAndFlow,
	collectHealthTrend,
	collectHeatmap,
	collectModules,
	collectOverview,
} from "./data/stats";
import { collectInsightStats } from "./data/insights";
import { collectWarRoom } from "./data/talos";
import type { TalosSchemaKey } from "./data/schema";
import { collectCapabilities, type CapabilityGroup } from "./data/capabilities";
import {
	collectHealthDigest,
	collectInboxDigest,
	collectKnowledgeHub,
	collectOutputCenter,
	collectProjectScenes,
	collectTalosProduct,
} from "./data/navigation";
import {
	openFile,
} from "./actions";
import { ConsoleActionPanel } from "./ui/console-action-panel";
import { taskStateLabel } from "./ui/task-state-label";
import { showWelcomeEasterEgg } from "./ui/welcome-easter-egg";
import {
	LEGACY_PAGE_KEYS,
	PRIMARY_NAVIGATION,
	SUPERBRAIN_NAVIGATION,
	homePageFor,
	isSuperbrainPage,
	pageBelongsTo,
	resolvePageRoute,
} from "./ui/navigation-model";
import {
	decodeTalosViewState,
	encodeTalosViewState,
	TalosPageRouter,
} from "./ui/page-router";
import { TalosChatSurface } from "./quyuan/chat-surface";
import {
	NodePeerStatusFileHost,
	readTalosPeerStatus,
	resolveVaultRootFromAdapter,
	talosPeerStatusDisplay,
	type TalosPeerStatusState,
} from "./peer-status/talos-peer-status";
import { WEEKDAYS, PAGE_ARCHETYPES, dailyRota, dailyTimeline, type QuyuanVoicePanelLike, type Collected, type OverviewAttention, type ApprovalDecisionFeedback, type CandidateDecisionFeedback } from "./ui/talos-view-model";
import { fillCapabilityDistribution, fillGateStateChart, fillOutputClosureChart, fillProjectPortfolioChart } from "./ui/charts/talos-view-charts";
import { renderOverviewAttentionRows } from "./ui/pages/overview-page";
import { renderTodayPage } from "./ui/pages/today-page";
import { renderHomePage } from "./ui/pages/home";
import { renderWorkbenchContent, renderWorkbenchPage } from "./ui/pages/workbench-page";
import { renderDailyPage } from "./ui/pages/daily-page";
import { renderHealthPage, renderOutputPage, renderProjectsPage } from "./ui/pages/project-pages";
import { renderCapabilityPage, renderIdentityPage, renderKnowledgePage, renderVaultPage } from "./ui/pages/knowledge-pages";
import { renderChatPage, renderInboxPage, renderJarvisPage, renderSettingsPage, renderTalosPage } from "./ui/pages/workspace-pages";
import { createApprovalActionButton, createCandidateActionButton, renderApprovalSide, renderDecisionWorkspace } from "./ui/view-approvals";
import { renderCosmosStats, syncPixelScene, updateCosmosHeader } from "./ui/view-cosmos";
import { buildShell, renderNav, renderSecondaryTabs } from "./ui/view-chrome";
import { addActionButtonContent, wireModuleSelection } from "./ui/view-modules";
import { SuperbrainPages } from "./ui/pages/superbrain-pages";
import { normalizeConsoleMode, type ConsoleMode } from "./ui/console-mode";
// 屈原语音面板按需动态加载，避免完整工作台运行时影响 TALOS 主控制台启动。

/** 经典页面键 → Lens 模块（命令面板等经典入口在 Lens 界面下的落点）。 */
const LENS_PAGE_FOR_CLASSIC: Readonly<Record<string, LensModuleId>> = {
	today: "overview", overview: "overview", daily: "overview",
	inbox: "workbench", knowledge: "workbench", output: "workbench",
	projects: "workbench", tasks: "workbench", talos: "workbench",
	health: "workbench", vault: "workbench", capability: "workbench", identity: "workbench",
	chat: "assistant", jarvis: "assistant", voice: "assistant", settings: "preferences",
};

/** 子页命令必须带上 Lens 页签，不能只跳到模块默认页。 */
const LENS_TAB_FOR_CLASSIC: Readonly<Record<string, string>> = {
	today: "today", overview: "today", daily: "tasks", inbox: "inbox", knowledge: "knowledge", output: "output",
	projects: "projects", tasks: "tasks", health: "health", vault: "knowledge", capability: "capability", identity: "identity", chat: "chat", jarvis: "voice", voice: "voice",
};

const CLASSIC_PAGE_FOR_LENS: Readonly<Record<string, string>> = {
	overview: "today", collect: "inbox", knowledge: "knowledge", output: "output",
	projects: "projects", system: "health", identity: "identity", voice: "jarvis", workbench: "inbox", preferences: "settings",
};

export const VIEW_TYPE_TALOS = "talos-console-view";

const LEGACY_SECTION_PAGES = ["chat", "settings"] as const;

export class TalosView extends ItemView {
	plugin: TalosPlugin;

	timeEl!: HTMLElement;
	dateEl!: HTMLElement;
	weekEl!: HTMLElement;
	pageNavEl!: HTMLElement;
	/** 框架模式的图标导航栏（个人体系模式为空）。 */
	canvasNavEl: HTMLElement | null = null;
	chatSwitchHostEl!: HTMLElement;
	cosmosNodesEl!: HTMLElement;
	cosmosTitleEl!: HTMLElement;
	cosmosSubEl!: HTMLElement;
	cosmosStatusTextEl!: HTMLElement;
	cosmosClockEl!: HTMLElement;
	approvalCardEl!: HTMLElement;
	approvalSideEl!: HTMLElement;
	pageTabsEl!: HTMLElement;
	pageEl!: HTMLElement;
	stampEl!: HTMLElement;
	patrolEl!: HTMLElement;
	/** 上次渲染时的发布数，用于 output 场景检测「新发布」触发火箭升空 */
	lastPublished: number | undefined;

	data: Collected | null = null;
	private peerStatus: TalosPeerStatusState | null = null;
	readonly pageRouter = new TalosPageRouter();
	/** 助手二级入口可独立展开，不靠挂载语音页来显示导航。 */
	assistantNavigationOpen = false;
	private readonly pageScroll = new Map<string, number>();
	private renderedPage: string | null = null;
	activeCap = "commands";
	selectedModuleByScope = new Map<string, string>();
	lastApprovalFeedback: ApprovalDecisionFeedback | null = null;
	lastCandidateFeedback: CandidateDecisionFeedback | null = null;
	jarvis: QuyuanVoicePanelLike | null = null;
	jarvisMounted = false;
	/** 每次挂载或卸载更新代次，过期异步结果不得写入新的页面。 */
	voiceMountRevision = 0;
	chatSurface: TalosChatSurface | null = null;
	chatMounted = false;
	/** 收件箱分诊的会话状态（「稍后」顺序），页面重绘后保留，不写文件。 */
	readonly inboxTriageSession: InboxTriageSession = { deferred: [] };
	/** 合并页签的选中项（单页原则），页面重绘后保留，不写文件。 */
	readonly panelTabSelections = new Map<string, string>();
	/** 便签组件由视图持有，重绘只移动节点，保留草稿、保存与撤销状态。 */
	quickNote: QuickNote | null = null;
	private clockTimer: number | null = null;
	actionPanel: ConsoleActionPanel | null = null;
	embeddedSettingsTab: TalosSettingTab | null = null;
	/** Lens 界面语言外壳；经典界面时为 null。 */
	lens: LensConsole | null = null;
	/** C/M 分组与详情复用同一渲染器；框架模式另有画布首页。 */
	readonly superbrainPages = new SuperbrainPages(this);

	constructor(leaf: WorkspaceLeaf, plugin: TalosPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	get activePage(): string {
		return this.pageRouter.renderKey();
	}

	set activePage(pageKey: string) {
		const previousPage = this.pageRouter.renderKey();
		this.pageRouter.navigate(pageKey);
		if (this.pageRouter.renderKey() !== previousPage) {
			this.assistantNavigationOpen = false;
			this.app.workspace.requestSaveLayout();
		}
	}

	get consoleMode(): ConsoleMode { return normalizeConsoleMode(this.plugin.talosSettings.consoleMode); }

	get hasSuperbrainCatalog(): boolean { return this.plugin.hasSuperbrainCatalog; }

	/** 库目录映射（单一真源，随设置页「目录映射」实时生效） */
	get paths() { return this.plugin.paths; }

	dailyRota() { return dailyRota(this.paths, this.plugin.talosSettings.tasksPath); }
	dailyTimeline() { return dailyTimeline(this.paths, this.plugin.talosSettings.tasksPath); }

	/** 按 schema 键取模块笔记数（模块名即当前 schema 下的目录名） */
	moduleCount(d: Collected, key: TalosSchemaKey): number {
		return d.modules.find((item) => item.name === this.paths.dir(key))?.count ?? 0;
	}

	getViewType(): string { return VIEW_TYPE_TALOS; }
	getDisplayText(): string { return "TALOS 控制台"; }
	getIcon(): string { return "talos-logo"; }
	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			...encodeTalosViewState(this.activePage),
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		this.pageRouter.navigate(decodeTalosViewState(state));
		await super.setState(state, result);
		if (this.pageEl) {
			this.renderNav();
			this.renderPage();
		}
	}

	async onOpen(): Promise<void> {
		try {
			this.removeOrphanedEmbeddedWorkbenchContent();
			if (this.clockTimer !== null) {
				window.clearInterval(this.clockTimer);
				this.clockTimer = null;
			}
			this.buildShell();
			this.updateClock();
			this.clockTimer = window.setInterval(() => this.updateClock(), 1000);
			this.registerInterval(this.clockTimer);
			await this.refresh();
			// 彩蛋：每次打开控制台播放（用户确认的 1B 方案）；
			// 设置页「开屏彩蛋」开关或卡片上的「不再显示」可永久关闭
			if (this.plugin.talosSettings.welcomeEasterEgg !== false) {
				void showWelcomeEasterEgg({
					app: this.app,
					pluginDir: this.plugin.manifest.dir,
					container: this.contentEl,
					onNeverShow: async () => {
						this.plugin.talosSettings.welcomeEasterEgg = false;
						await this.plugin.saveTalosSettings();
					},
				});
			}
		} catch (error) {
			console.error("TALOS console view failed to open", error);
			this.renderViewError(error);
		}
	}

	private removeOrphanedEmbeddedWorkbenchContent(): void {
		const leafContainer = this.containerEl.parentElement;
		if (!leafContainer) return;
		for (const orphan of Array.from(
			leafContainer.querySelectorAll<HTMLElement>(
				':scope > .workspace-leaf-content[data-type="talos-quyuan-view"]'
			)
		)) {
			if (orphan !== this.containerEl) orphan.remove();
		}
	}

	async onClose(): Promise<void> {
		this.lens?.dispose();
		this.lens = null;
		this.unmountJarvisSafely();
		await this.chatSurface?.dispose();
		this.chatSurface = null;
		this.chatMounted = false;
		this.actionPanel?.unmount();
		this.actionPanel = null;
		this.superbrainPages.teardown();
		this.quickNote = null;
		this.embeddedSettingsTab = null;
		if (this.clockTimer !== null) {
			window.clearInterval(this.clockTimer);
			this.clockTimer = null;
		}
		this.contentEl.empty();
	}

	hasRenderedShell(): boolean {
		return !!this.contentEl.querySelector(`.app, .talos-view-error-panel, #${LENS_ROOT_ID}`);
	}

	async recoverFromBlankView(): Promise<void> {
		await this.onOpen();
	}

	/** C/M 页暂用经典个人外壳；返回个人页后恢复 Lens，不改界面偏好。 */
	private get usesLens(): boolean {
		return this.consoleMode === "personal" && this.plugin.talosSettings.uiLanguage === "lens"
			&& !isSuperbrainPage(this.activePage) && this.activePage !== "harness";
	}

	private buildShell(): void {
		this.unmountJarvisSafely();
		this.lens?.dispose();
		this.lens = null;
		this.contentEl.removeClass("talos-lens-host");
		if (this.usesLens) {
			this.buildLensShell();
			return;
		}
		return buildShell(this);
	}

	/** Lens 界面语言：拆掉经典外壳的挂载物，换成 Lens 外壳；数据、刷新与操作沿用同一套。 */
	private buildLensShell(): void {
		const root = this.contentEl;
		this.unmountJarvisSafely();
		if (this.chatMounted) {
			this.chatMounted = false;
			void this.chatSurface?.unmount();
		}
		this.actionPanel?.unmount();
		this.actionPanel = null;
		this.embeddedSettingsTab = null;
		root.empty();
		root.removeClass("talos-console", "talos-scope", "talos-canvas-shell");
		for (const cls of Array.from(root.classList)) {
			if (cls.startsWith("theme-") || cls.startsWith("page-") || cls.startsWith("section-")) root.removeClass(cls);
		}
		root.removeAttribute("data-talos-theme");
		root.removeAttribute("data-talos-page");
		root.removeAttribute("data-talos-archetype");
		root.addClass("talos-lens-host");
		this.lens = new LensConsole({
			app: this.app,
			paths: () => this.paths,
			tasksPath: () => this.plugin.talosSettings.tasksPath,
			profileName: () => this.plugin.talosSettings.mainTitle.trim() || "本地用户",
			appearance: () => this.plugin.talosSettings.lensAppearance,
			openNote: (path, newTab) => {
				if (newTab) void this.app.workspace.openLinkText(path, "", "tab");
				else void openFile(this.app, path);
			},
			openChat: () => void this.plugin.activateChatSidebar(),
			invokeCommand: (command) => void this.sendCommandToChat(command),
			openHarness: () => this.navigateToPage("harness"),
			renderDecisions: (host) => { if (this.data) this.renderDecisionWorkspace(host, this.data, 12); },
			renderInbox: (host) => { if (this.data) this.pageInbox(host, this.data); },
			renderWorkbench: (host, pageKey) => { if (this.data) renderWorkbenchContent(this, host, this.data, pageKey); },
			renderOverview: (host) => { if (this.data) renderTodayPage(this, host, this.data); },
			cleanupPage: () => { this.actionPanel?.unmount(); this.actionPanel = null; },
			onNavigate: (module, tab) => {
				const page = module === "workbench" && ["inbox", "knowledge", "output", "projects", "tasks", "health", "capability", "identity"].includes(tab ?? "") ? tab!
					: module === "assistant" && tab === "voice" ? "jarvis"
					: module === "assistant" ? "chat"
					: CLASSIC_PAGE_FOR_LENS[module];
				if (page) this.activePage = page;
			},
			renderSettings: (host) => {
				this.embeddedSettingsTab ??= new TalosSettingTab(this.app, this.plugin);
				this.embeddedSettingsTab.renderInto(host);
			},
			mountVoice: (host) => void this.mountLensVoice(host),
			unmountVoice: () => this.unmountJarvisSafely(),
			refresh: () => void this.refresh(),
		}, root);
		this.navigateLensPage(this.activePage);
	}

	private navigateLensPage(pageKey: string): void {
		const module = LENS_PAGE_FOR_CLASSIC[pageKey] ?? "overview";
		const tab = LENS_TAB_FOR_CLASSIC[pageKey];
		if (tab) this.lens?.navigate(module, tab);
		else this.lens?.navigate(module);
	}

	/** Lens「屈原语音」模块：复用经典语音页的同一个面板实例与引擎。 */
	private async mountLensVoice(host: HTMLElement): Promise<void> {
		const revision = ++this.voiceMountRevision;
		const current = () => this.voiceMountRevision === revision && host.isConnected
			&& this.lens !== null && this.activePage === "jarvis";
		host.createDiv({ cls: "empty", text: "语音模块加载中…" });
		try {
			const { QuyuanVoicePanel } = await import("./quyuan/voice-panel");
			await this.plugin.waitForAgentWorkbench();
			if (!current()) return;
			host.empty();
			this.jarvis ??= new QuyuanVoicePanel(
				this.app,
				this.plugin,
				this.plugin.talosSettings,
				() => this.plugin.saveTalosSettings(),
				(pageKey) => this.navigateToPage(pageKey)
			);
			this.jarvis.mount(host);
			this.jarvisMounted = true;
		} catch (error) {
			if (!current()) return;
			console.error("TALOS Quyuan voice panel failed to mount in Lens", error);
			this.unmountJarvisSafely();
			this.jarvis = null;
			host.empty();
			host.createDiv({ cls: "empty", text: `语音模块加载失败：${error instanceof Error ? error.message : String(error)}` });
		}
	}

	/** 切换界面语言时重建外壳并重新填充数据（不重放开屏彩蛋）。 */
	private async rebuildShell(): Promise<void> {
		this.buildShell();
		await this.refresh();
	}

	private renderViewError(error: unknown): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("talos-console");
		this.applySettings();
		this.applyPageState();
		const panel = root.createDiv({ cls: "panel talos-view-error-panel" });
		const icon = panel.createDiv({ cls: "quyuan-error-icon" });
		setIcon(icon, "triangle-alert");
		const copy = panel.createDiv({ cls: "quyuan-error-copy" });
		copy.createEl("h2", { text: "TALOS 控制台加载失败" });
		copy.createEl("p", {
			text: error instanceof Error ? error.message : "初始化时出现未知错误。",
		});
		const actions = panel.createDiv({ cls: "quyuan-error-actions" });
		const retry = actions.createEl("button", {
			cls: "module-hero-action",
			attr: { type: "button" },
		});
		setIcon(retry.createSpan({ cls: "module-hero-action-icon" }), "rotate-cw");
		retry.createSpan({ text: "重试加载" });
		retry.addEventListener("click", () => void this.onOpen());
	}

	secTitle(card: HTMLElement, title: string, small: string): void {
		const st = card.createDiv({ cls: "section-title talos-ui-panel-header" });
		st.createEl("h2", { text: title });
		st.createEl("small", { text: small });
	}

	syncActionButtonTheme(button: HTMLElement, theme: string): void {
		const aurora = theme === "aurora";
		const variant = button.dataset.talosActionVariant || "";
		button.toggleClass("button1", aurora);
		button.toggleClass("button1--compact", aurora && variant === "compact");
		button.toggleClass("button1--mini", aurora && variant === "mini");
	}


	addActionButtonContent(button: HTMLElement,
		label: string,
		variant: "" | "compact" | "mini" = ""): void {
		return addActionButtonContent(this, button, label, variant);
	}

	applySettings(): void {
		if (this.usesLens !== (this.lens !== null)) {
			void this.rebuildShell();
			return;
		}
		if (this.lens) {
			this.lens.applyAppearance();
			return;
		}
		const theme = this.plugin.talosSettings.visualTheme || "aurora";
		this.contentEl.classList.remove(
			"theme-aurora",
			"theme-cosmos-dark",
			"theme-animal-island",
			"theme-data-stream",
			"theme-soft-relief",
			"theme-geometric-modern",
			"theme-executive-brief",
			"theme-paper-ink"
		);
		this.contentEl.classList.add(`theme-${theme}`);
		this.contentEl.setAttribute("data-talos-theme", theme);
		for (const button of Array.from(
			this.contentEl.querySelectorAll<HTMLElement>("[data-talos-action-button]")
		)) {
			this.syncActionButtonTheme(button, theme);
		}
	}

	applyPageState(): void {
		this.contentEl.setAttribute("data-talos-page", this.activePage);
		this.contentEl.setAttribute(
			"data-talos-archetype",
			PAGE_ARCHETYPES[this.activePage] || "workspace"
		);
		for (const pageKey of [...LEGACY_PAGE_KEYS, "chat", "harness", "settings"]) {
			this.contentEl.classList.remove(`page-${pageKey}`);
		}
		for (const page of [...PRIMARY_NAVIGATION, ...SUPERBRAIN_NAVIGATION]) {
			this.contentEl.classList.remove(`section-${page.key}`);
		}
		// 只有框架模式切换外壳；个人 C/M 内容的样式作用域由页面渲染器局部提供。
		const superbrainPage = isSuperbrainPage(this.activePage);
		this.contentEl.classList.toggle("talos-scope", superbrainPage && this.consoleMode === "superbrain");
		this.contentEl.classList.toggle("talos-canvas-shell", superbrainPage && this.consoleMode === "superbrain");
		for (const pageKey of LEGACY_SECTION_PAGES) {
			this.contentEl.classList.remove(`section-${pageKey}`);
		}
		this.contentEl.classList.add(`page-${this.activePage}`);
		this.contentEl.classList.add(
			`section-${this.pageRouter.current().primary}`
		);
		// 对话与设置曾是独立一级入口，整屏布局样式按 .section-chat / .section-settings 编写；
		// 2026-10-07 并入「助手」「系统」后仍需保留这两个 class，否则对话页塌成内容高度。
		if ((LEGACY_SECTION_PAGES as readonly string[]).includes(this.activePage)) {
			this.contentEl.classList.add(`section-${this.activePage}`);
		}
		// Harness 沿用原对话页的整屏布局（.section-chat）。
		if (this.activePage === "harness") this.contentEl.classList.add("section-chat");
		this.updateCosmosHeader();
	}

	updateCosmosHeader(): void {
		return updateCosmosHeader(this);
	}


	renderNav(): void {
		if (this.lens) return;
		return renderNav(this);
	}


	private renderSecondaryTabs(): void {
		return renderSecondaryTabs(this);
	}




	// ---------- 时钟 ----------
	private updateClock(): void {
		if (!this.timeEl) return;
		const d = new Date();
		const hh = String(d.getHours()).padStart(2, "0");
		const mm = String(d.getMinutes()).padStart(2, "0");
		const ss = String(d.getSeconds()).padStart(2, "0");
		this.timeEl.empty();
		this.timeEl.appendText(hh);
		this.timeEl.createEl("em", { text: ":" });
		this.timeEl.appendText(mm);
		this.timeEl.createEl("em", { text: ":" });
		this.timeEl.appendText(ss);
		this.dateEl.setText(
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}\n周${WEEKDAYS[d.getDay()]}`
		);
		this.cosmosClockEl?.setText(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hh}:${mm}:${ss}`);
		if (this.weekEl.childElementCount === 0) this.renderWeek();
	}

	private renderWeek(): void {
		this.weekEl.empty();
		const now = new Date();
		const sunday = new Date(now);
		sunday.setDate(now.getDate() - now.getDay());
		for (let i = 0; i < 7; i++) {
			const day = new Date(sunday);
			day.setDate(sunday.getDate() + i);
			const el = this.weekEl.createDiv({ cls: "day" });
			if (day.toDateString() === now.toDateString()) el.addClass("today");
			el.createEl("b", { text: WEEKDAYS[i] });
			el.createEl("span", { text: String(day.getDate()) });
		}
	}

	// ---------- 刷新 ----------
	async refresh(): Promise<void> {
		await this.refreshPeerStatus();
		const app = this.app;
		const s = this.plugin.talosSettings;
		const paths = this.paths;
		const { dist, total } = collectDist(app, paths);
		const inboxCount = dist.find((d) => d.name === "收件箱")?.count ?? 0;
		const modules = collectModules(app, paths);
		const { focus, focusTotal, taskFlow } = await collectFocusAndFlow(app, s);
		const healthTrend = await collectHealthTrend(app, s);
		const overview = collectOverview(app, paths, total, inboxCount, taskFlow, healthTrend);
		const approvals = await collectApprovals(app, s);
		const candidates = await collectCandidates(app, s);
		const heatmap = collectHeatmap(app);
		const warRoom = await collectWarRoom(app, s);
		const capGroups = await collectCapabilities(app);
		const output = await collectOutputCenter(app, paths);
		const inbox = await collectInboxDigest(app, s);
		const healthDigest = await collectHealthDigest(app, paths, s, approvals, candidates);
		const projects = await collectProjectScenes(app, paths);
		const knowledge = collectKnowledgeHub(app, paths);
		const talosProduct = collectTalosProduct(app, paths);
		const insights = collectInsightStats(app);
		const registered = await readRegisteredFiles(this.plugin);
		const setup = Object.fromEntries(
			registered.map(({ spec, content }) => [spec.key, fileStatus(spec, content)])
		) as Partial<Record<AnyFileKey, FileStatus>>;

		this.data = {
			total,
			dist,
			modules,
			focus,
			focusTotal,
			healthTrend,
			overview,
			approvals,
			candidates,
			heatmap,
			warRoom,
			capGroups,
			output,
			inbox,
			healthDigest,
			projects,
			knowledge,
			talosProduct,
			insights,
			setup,
		};

		if (this.lens) {
			this.lens.setData(this.data, this.peerStatus);
			return;
		}

		const now = new Date();
		this.stampEl.setText(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
		this.renderNav();

		// 屈原页活跃时，库变动触发的后台刷新不重绘控制台——
		// 否则会拆掉对话页、打断朗读、画面闪跳。数据已存，离开此页时自然刷新。
		if (this.activePage === "jarvis" && this.hasConnectedVoicePanel()) return;

		this.renderHeroStats();
		this.renderApprovalSide();
		this.renderCurrentPage(true);
	}

	// Hero 数字只住星轨节点一处（门面层）；行动指标住总览页（行动层）。
	private renderHeroStats(): void {
		const d = this.data;
		if (!d) return;
		this.renderCosmosStats(d);
	}

	private renderCosmosStats(d: Collected): void {
		return renderCosmosStats(this, d);
	}

	private renderApprovalSide(): void {
		return renderApprovalSide(this);
	}



	renderDecisionWorkspace(parent: HTMLElement,
		d: Collected,
		limit = 2): void {
		return renderDecisionWorkspace(this, parent, d, limit);
	}

	private createCandidateActionButton(parent: HTMLElement,
		decision: "approve" | "reject",
		iconName: string,
		label: string,
		it: SignalItem): void {
		return createCandidateActionButton(this, parent, decision, iconName, label, it);
	}

	private createApprovalActionButton(parent: HTMLElement,
		decision: "approve" | "reject",
		iconName: string,
		label: string,
		it: SignalItem): void {
		return createApprovalActionButton(this, parent, decision, iconName, label, it);
	}


	shortTime(): string {
		const now = new Date();
		return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	}



	// ---------- 页 ----------
	// ---------- TALOS 状态桥（只读消费 lili 派生缓存） ----------
	private async refreshPeerStatus(): Promise<void> {
		try {
			const vaultRoot = resolveVaultRootFromAdapter(this.app.vault.adapter);
			if (!vaultRoot) {
				this.peerStatus = { state: "invalid", reason: "vault-not-filesystem" };
				return;
			}
			this.peerStatus = await readTalosPeerStatus(new NodePeerStatusFileHost(vaultRoot), {
				enabled: this.plugin.talosSettings.talosPeerStatusBridgeEnabled !== false,
			});
		} catch {
			this.peerStatus = { state: "invalid", reason: "cache-unreachable" };
		}
	}

	renderPeerStatusPanel(parent: HTMLElement): void {
		const status = this.peerStatus ?? { state: "missing" as const };
		const view = talosPeerStatusDisplay(status);
		const panel = this.panel(parent, "#76B0FA", "TALOS 状态", "lili 状态桥只读快照 · 不解析控制仓库");
		panel.setAttribute("data-workbench-section", "peer-status");
		const body = panel.createDiv({ cls: "talos-peer-status" });
		const head = body.createDiv({ cls: "talos-peer-status-head" });
		head.createDiv({ cls: "talos-peer-status-label", text: view.focusName });
		const tone = status.state === "ready" ? "good" : status.state === "stale" ? "warn" : status.state === "disabled" ? "muted" : "hot";
		head.createDiv({ cls: "talos-peer-status-pill is-" + tone, text: view.statusLabel });
		const grid = body.createDiv({ cls: "talos-peer-status-grid" });
		const rows: Array<[string, string]> = [
			["当前主线", view.mainlineTitle],
			["下一步", view.nextAction],
			["阻塞", view.blockerCount ? view.blockerCount + " 项 · " + (view.blockerTop ?? "") : "无"],
			["修订", view.revision],
		];
		for (const row of rows) {
			const cell = grid.createDiv({ cls: "talos-peer-status-cell" });
			cell.createDiv({ cls: "talos-peer-status-key", text: row[0] });
			cell.createDiv({ cls: "talos-peer-status-value", text: row[1] });
		}
		body.createDiv({
			cls: "talos-peer-status-foot",
			text: "快照 " + view.generatedAtLabel + " · 序号 " + (view.sequence ?? "—") + " · 仅本地派生缓存"
				+ (view.state === "invalid" && view.reason ? " · " + view.reason : ""),
		});
	}

	panel(parent: HTMLElement, ac: string, title: string, small: string): HTMLElement {
		const p = parent.createDiv({ cls: "panel talos-ui-panel" });
		p.setCssProps({ "--ac": ac });
		this.secTitle(p, title, small);
		return p;
	}


	/**
	 * 卸载屈原面板，异常不外泄。
	 * 背景（2026-07-09）：底层 SDK 关闭子进程时曾抛
	 * `setTimeout(...).unref is not a function`，异常沿 unmount → renderPage
	 * 冒泡后 `jarvisMounted` 永远停留在 true，屈原页从此白屏。
	 * 无论 unmount 是否抛错，状态必须复位。
	 */
	private hasConnectedVoicePanel(): boolean {
		return this.jarvisMounted && Boolean(this.pageEl?.querySelector(".tq-voice")?.isConnected);
	}

	unmountJarvisSafely(): void {
		this.voiceMountRevision = (this.voiceMountRevision ?? 0) + 1;
		try {
			this.jarvis?.unmount();
		} catch (error) {
			console.error("TALOS Quyuan voice panel failed to unmount", error);
			this.jarvis = null;
		} finally {
			this.jarvisMounted = false;
		}
	}

	renderPage(): void {
		this.renderCurrentPage(false);
	}

	private renderCurrentPage(backgroundRefresh: boolean): void {
		// 页面能力独立于界面模式；没有目录时保持个人界面的原有回退。
		if (!pageBelongsTo(this.consoleMode, this.activePage, this.hasSuperbrainCatalog)) {
			this.activePage = homePageFor(this.consoleMode);
			this.superbrainPages.activeDetailId = null;
			if (this.pageNavEl) this.renderNav();
		}
		if (this.usesLens !== (this.lens !== null)) {
			const leavingLens = this.lens !== null;
			this.buildShell();
			if (leavingLens) new Notice("工作流与机制将在经典界面打开；返回个人页面后恢复 Lens。");
			if (this.lens) {
				if (this.data) this.lens.setData(this.data, this.peerStatus);
				this.navigateLensPage(this.activePage);
			}
		}
		if (this.lens) return;
		// AI 对话改为常驻右侧边栏：任何入口切到 chat 都转去右栏，主区留在当前页。
		if (this.activePage === "chat") {
			const opened = this.renderedPage !== null;
			this.activePage = this.renderedPage && this.renderedPage !== "chat" ? this.renderedPage : homePageFor(this.consoleMode);
			if (this.pageNavEl) this.renderNav();
			this.renderSecondaryTabs();
			if (opened) void this.plugin.activateChatSidebar();
			if (this.renderedPage === this.activePage) return;
		}
		const page = this.pageEl;
		// 与 Lens 一致：离开页面时记下滚动位置，切回时恢复；同页刷新保持原位。
		const leaving = this.renderedPage;
		if (leaving && leaving !== this.activePage) this.pageScroll.set(leaving, this.contentEl.scrollTop);
		const scrollTarget = leaving === this.activePage
			? this.contentEl.scrollTop
			: this.pageScroll.get(this.activePage) ?? 0;
		this.renderedPage = this.activePage;
		this.applyPageState();
		this.renderSecondaryTabs();
		// 已在屈原页且已挂载：保持不动（不打断朗读/不闪跳）
		if (this.activePage === "jarvis" && this.hasConnectedVoicePanel()) return;
		if (this.activePage === "harness" && this.chatMounted) return;
		// 详情包含表单、预览与进行中操作；后台数据更新不能当作离开页面。
		if (backgroundRefresh && leaving === this.activePage && this.superbrainPages.activeDetailId !== null) return;
		// 离开屈原或换页：先卸载屈原
		if (this.jarvisMounted) this.unmountJarvisSafely();
		if (this.chatMounted) {
			this.chatMounted = false;
			void this.chatSurface?.unmount();
		}
		this.actionPanel?.unmount();
		this.actionPanel = null;
		this.superbrainPages.teardown();
		page.empty();
		const d = this.data;
		if (!d) { page.createDiv({ cls: "empty", text: "加载中…" }); return; }
		switch (this.activePage) {
			case "today": this.pageToday(page, d); break;
			case "home": this.pageHome(page, d); break;
			case "harness": void this.pageChat(page); break;
			case "jarvis": void this.pageJarvis(page); break;
			case "daily": this.pageDaily(page, d); break;
			case "talos": this.pageTalos(page, d); break;
			case "inbox": case "knowledge": case "output": case "projects":
			case "tasks": case "health": case "capability": case "identity":
				renderWorkbenchPage(this, page, d, this.activePage); break;
			case "vault": this.pageVault(page, d); break;
			case "settings": this.pageSettings(page); break;
			default: if (isSuperbrainPage(this.activePage)) this.superbrainPages.render(page, d);
		}
		this.mountSetupHint(page, d);
		this.wireModuleSelection(page, this.activePage);
		this.syncPixelScene(d);
		if (this.activePage !== "harness" && this.activePage !== "jarvis") {
			this.contentEl.scrollTop = scrollTarget;
		}
	}

	/** 本页依赖的数据文件缺失或缺分区时，在页头下方插入一条单行提示。 */
	private mountSetupHint(page: HTMLElement, d: Collected): void {
		const problems = setupProblems(this.activePage, d.setup);
		if (problems.length === 0) return;
		const hint = renderSetupHint(page, problems, {
			onScaffold: () => void this.plugin.openScaffold(),
			onSettings: () => this.navigateToPage("settings"),
		});
		const header = page.querySelector(".talos-ui-page-header");
		if (hint && header) header.after(hint);
	}

	private syncPixelScene(d: Collected): void {
		return syncPixelScene(this, d);
	}

	wireModuleSelection(scope: HTMLElement, selectionScope: string): void {
		return wireModuleSelection(this, scope, selectionScope);
	}


		// 总览页：主判断缩成可操作模块，指标与二级状态重排，避免横向大面板铺满。
		fillOverviewKanban(parent: HTMLElement, d: Collected): void {
		const runs = this.plugin.getConsoleActionRuntime().store.list();
		const activeStates = new Set(["ready", "queued", "running"]);
		const active = runs.filter((run) => activeStates.has(run.state));
		const finished = runs.filter((run) => !activeStates.has(run.state)).slice(-5).reverse();
		const kanban = parent.createDiv({ cls: "overview-kanban" });

		const todoCol = kanban.createDiv({ cls: "overview-kanban-col" });
		const todoHead = todoCol.createDiv({ cls: "overview-kanban-col-head" });
		todoHead.createEl("h3", { text: "焦点预览（最多 3 项）" });
		todoHead.createSpan({ cls: "overview-kanban-count", text: String(d.focus.length) });
		if (d.focus.length === 0) {
			todoCol.createDiv({ cls: "overview-kanban-empty", text: "暂无焦点预览" });
		}
		for (const item of d.focus.slice(0, 6)) {
			const card = todoCol.createDiv({ cls: "overview-kanban-card" });
			card.createEl("b", { text: item.title });
			card.createEl("small", { text: item.doneWhen ? `done_when · ${item.doneWhen}` : item.desc });
			if (item.path) {
				const target = item.path;
				card.addClass("is-clickable");
				card.addEventListener("click", () => void openFile(this.app, target));
			}
		}

		const activeCol = kanban.createDiv({ cls: "overview-kanban-col" });
		const activeHead = activeCol.createDiv({ cls: "overview-kanban-col-head" });
		activeHead.createEl("h3", { text: "运行中的动作" });
		activeHead.createSpan({ cls: "overview-kanban-count", text: String(active.length) });
		if (active.length === 0) {
			activeCol.createDiv({ cls: "overview-kanban-empty", text: "暂无执行中的动作" });
		}
		for (const run of active.slice(0, 6)) {
			const card = activeCol.createDiv({ cls: "overview-kanban-card" });
			card.createEl("b", { text: run.actionId });
			card.createEl("small", { text: `${taskStateLabel(run.state)} · ${run.createdAt.slice(11, 16)}` });
		}

		const doneCol = kanban.createDiv({ cls: "overview-kanban-col" });
		const doneHead = doneCol.createDiv({ cls: "overview-kanban-col-head" });
		doneHead.createEl("h3", { text: "最近结束的动作（含失败）" });
		doneHead.createSpan({ cls: "overview-kanban-count", text: String(finished.length) });
		if (finished.length === 0) {
			doneCol.createDiv({ cls: "overview-kanban-empty", text: "暂无已结束的动作记录" });
		}
		for (const run of finished) {
			const card = doneCol.createDiv({ cls: "overview-kanban-card" });
			card.createEl("b", { text: run.actionId });
			card.createEl("small", { text: `${taskStateLabel(run.state)} · ${(run.finishedAt || run.createdAt).slice(11, 16)}` });
		}
	}

	private pageToday(page: HTMLElement, d: Collected): void {
		return renderTodayPage(this, page, d);
	}

	private pageHome(page: HTMLElement, d: Collected): void {
		return renderHomePage(this, page, d);
	}



	private renderOverviewAttentionRows(parent: HTMLElement,
		items: OverviewAttention[]): void {
		return renderOverviewAttentionRows(this, parent, items);
	}

	private async pageChat(page: HTMLElement): Promise<void> {
		return renderChatPage(this, page);
	}

	private pageSettings(page: HTMLElement): void {
		return renderSettingsPage(this, page);
	}

	private async pageJarvis(page: HTMLElement): Promise<void> {
		return renderJarvisPage(this, page);
	}

	private pageDaily(page: HTMLElement, d: Collected): void {
		return renderDailyPage(this, page, d);
	}

	private pageOutput(page: HTMLElement, d: Collected): void {
		return renderOutputPage(this, page, d);
	}

	private pageTalos(page: HTMLElement, d: Collected): void {
		return renderTalosPage(this, page, d);
	}

	private pageInbox(page: HTMLElement, d: Collected): void {
		return renderInboxPage(this, page, d);
	}

	private pageHealth(page: HTMLElement, d: Collected): void {
		return renderHealthPage(this, page, d);
	}

	private pageProjects(page: HTMLElement, d: Collected): void {
		return renderProjectsPage(this, page, d);
	}

	private pageKnowledge(page: HTMLElement, d: Collected): void {
		return renderKnowledgePage(this, page, d);
	}

	private pageIdentity(page: HTMLElement, d: Collected): void {
		return renderIdentityPage(this, page, d);
	}

	private pageVault(page: HTMLElement, d: Collected): void {
		return renderVaultPage(this, page, d);
	}

	private pageCapability(page: HTMLElement, d: Collected): void {
		return renderCapabilityPage(this, page, d);
	}






	private fillCapabilityDistribution(parent: HTMLElement,
		groups: CapabilityGroup[]): void {
		return fillCapabilityDistribution(this, parent, groups);
	}

	private fillGateStateChart(parent: HTMLElement,
		gates: GateItem[]): void {
		return fillGateStateChart(this, parent, gates);
	}


	private fillOutputClosureChart(parent: HTMLElement,
		platforms: OutputCenter["platforms"]): void {
		return fillOutputClosureChart(this, parent, platforms);
	}

	private fillProjectPortfolioChart(parent: HTMLElement,
		projects: ProjectScene[]): void {
		return fillProjectPortfolioChart(this, parent, projects);
	}










	/** 控制台命令按钮：填进右栏 TALOS 对话由用户确认发送；对话不可用时退回复制。 */
	async sendCommandToChat(command: string): Promise<void> {
		if (await this.plugin.prefillChatSidebar(command)) {
			new Notice(`已填入 TALOS 对话：${command}（按回车发送）`);
			return;
		}
		try {
			await navigator.clipboard.writeText(command);
			new Notice(`对话暂不可用，已复制：${command}`);
		} catch {
			new Notice(`对话暂不可用，复制也失败：${command}`);
		}
	}

	async copyText(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			new Notice(`已复制：${text}`);
		} catch {
			new Notice(`复制失败：${text}`);
		}
	}

	/** 定位当前界面的待决策区；经典首页直接展示，不隐藏在页签内。 */
	openDecisions(): void {
		this.panelTabSelections.set("today-status", "decisions");
		if (this.activePage !== "tasks") this.navigateToPage("tasks");
		this.contentEl?.querySelector<HTMLElement>('[data-workbench-section="decisions"]')
			?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}

	/** 深链仅在主动导航时定位，后台刷新不改变阅读位置。 */
	private focusWorkbenchTarget(pageKey: string): void {
		const selectors: Record<string, string> = {
			knowledge: '[data-workbench-data="knowledge"]', output: '[data-workbench-data="output"]',
			tasks: '[data-workbench-section="decisions"]', capability: '[data-workbench-section="capability"]',
			identity: '[data-workbench-section="identity"]',
		};
		const selector = selectors[pageKey];
		if (selector) this.contentEl?.querySelector?.<HTMLElement>(selector)?.scrollIntoView?.({ block: "nearest" });
	}

	/** 打开设置页（框架首页的「设置」入口）。 */
	openSettingsPage(): void {
		this.navigateToPage("settings");
	}

	/** 偏好与审批复核：框架模式在首页下方展开决策区，个人体系模式转到今日页「待决策」。 */
	openPreferenceReview(): void {
		if (this.consoleMode !== "superbrain") { this.openDecisions(); return; }
		this.navigateToPage(homePageFor("superbrain"));
		if (!this.data || !this.pageEl) return;
		const host = this.pageEl.createDiv({ cls: "talos-canvas-review" });
		this.renderDecisionWorkspace(host, this.data, 12);
		host.scrollIntoView({ block: "nearest" });
	}

	/** 按 C/M 编号打开超级大脑功能详情页。 */
	openSuperbrainDetailPage(id: string): void {
		this.superbrainPages.openDetailPage(id);
	}

	navigateToPage(pageKey: string, superbrainDetailId: string | null = null): void {
		this.assistantNavigationOpen = false;
		// Resolve legacy aliases before deciding whether Lens or the classic Harness handles them.
		pageKey = resolvePageRoute(pageKey)?.secondary ?? pageKey;
		if (isSuperbrainPage(pageKey) && !pageBelongsTo(this.consoleMode, pageKey, this.hasSuperbrainCatalog)) {
			if (this.lens) {
				this.superbrainPages.activeDetailId = null;
				this.lens.navigate(LENS_PAGE_FOR_CLASSIC[this.activePage] ?? "overview");
				return;
			}
			pageKey = homePageFor(this.consoleMode);
			superbrainDetailId = null;
		}
		if (this.lens && !isSuperbrainPage(pageKey) && pageKey !== "harness") {
			if (pageKey === "chat") void this.plugin.activateChatSidebar();
			else this.activePage = pageKey;
			this.navigateLensPage(pageKey);
			this.focusWorkbenchTarget(pageKey);
			return;
		}
		this.superbrainPages.activeDetailId = superbrainDetailId;
		this.activePage = pageKey;
		if (this.pageNavEl) this.renderNav();
		if (this.pageEl || this.lens) this.renderPage();
		this.focusWorkbenchTarget(pageKey);
	}

	// 主页「屈原」入口 → 控制台内的屈原语音页（QuyuanVoicePanel）。
	// 文字对话使用独立 AI 对话页面；原生恢复视图只负责兼容已保存的 leaf 地址。
	async openQuyuan(): Promise<void> {
		this.activePage = "jarvis";
		this.renderNav();
		this.renderPage();
	}
}
