import {
	ItemView,
	Notice,
	WorkspaceLeaf,
	setIcon,
	type ViewStateResult,
} from "obsidian";
import type TalosPlugin from "./main";
import { TalosSettingTab } from "./settings";
import type {
	GateItem,
	MetricTile,
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
import { TaskDrawer } from "./ui/task-drawer";
import { ConsoleActionPanel } from "./ui/console-action-panel";
import { taskStateLabel } from "./ui/task-state-label";
import { showWelcomeEasterEgg } from "./ui/welcome-easter-egg";
import {
	LEGACY_PAGE_KEYS,
	PRIMARY_NAVIGATION,
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
import { fillCapabilityDistribution, fillGateStateChart, fillKnowledgeTreemap, fillOutputClosureChart, fillProjectPortfolioChart } from "./ui/charts/talos-view-charts";
import { renderOverviewAttentionRows, renderOverviewPage } from "./ui/pages/overview-page";
import { renderDailyPage } from "./ui/pages/daily-page";
import { renderHealthPage, renderOutputPage, renderProjectsPage } from "./ui/pages/project-pages";
import { renderCapabilityPage, renderIdentityPage, renderKnowledgePage, renderVaultPage } from "./ui/pages/knowledge-pages";
import { renderChatPage, renderInboxPage, renderJarvisPage, renderSettingsPage, renderTalosPage } from "./ui/pages/workspace-pages";
import { createApprovalActionButton, createCandidateActionButton, renderApprovalSide, renderDecisionWorkspace } from "./ui/view-approvals";
import { renderCosmosStats, syncPixelScene, updateCosmosHeader } from "./ui/view-cosmos";
import { buildShell, renderNav, renderSecondaryTabs } from "./ui/view-chrome";
import { addActionButtonContent, wireModuleSelection } from "./ui/view-modules";
// 屈原语音面板按需动态加载，避免完整工作台运行时影响 TALOS 主控制台启动。

export const VIEW_TYPE_TALOS = "talos-console-view";

export class TalosView extends ItemView {
	plugin: TalosPlugin;

	timeEl!: HTMLElement;
	dateEl!: HTMLElement;
	weekEl!: HTMLElement;
	pageNavEl!: HTMLElement;
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
	readonly pageRouter = new TalosPageRouter("overview");
	activeCap = "commands";
	selectedModuleByScope = new Map<string, string>();
	lastApprovalFeedback: ApprovalDecisionFeedback | null = null;
	lastCandidateFeedback: CandidateDecisionFeedback | null = null;
	jarvis: QuyuanVoicePanelLike | null = null;
	jarvisMounted = false;
	chatSurface: TalosChatSurface | null = null;
	chatMounted = false;
	private clockTimer: number | null = null;
	taskDrawer: TaskDrawer | null = null;
	actionPanel: ConsoleActionPanel | null = null;
	embeddedSettingsTab: TalosSettingTab | null = null;

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
			this.app.workspace.requestSaveLayout();
		}
	}

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
		this.unmountJarvisSafely();
		await this.chatSurface?.dispose();
		this.chatSurface = null;
		this.chatMounted = false;
		this.taskDrawer?.unmount();
		this.taskDrawer = null;
		this.actionPanel?.unmount();
		this.actionPanel = null;
		this.embeddedSettingsTab = null;
		if (this.clockTimer !== null) {
			window.clearInterval(this.clockTimer);
			this.clockTimer = null;
		}
		this.contentEl.empty();
	}

	hasRenderedShell(): boolean {
		return !!this.contentEl.querySelector(".app, .talos-view-error-panel");
	}

	async recoverFromBlankView(): Promise<void> {
		await this.onOpen();
	}

	private buildShell(): void {
		return buildShell(this);
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
		const theme = this.plugin.talosSettings.visualTheme || "aurora";
		this.contentEl.classList.remove(
			"theme-aurora",
			"theme-cosmos-dark",
			"theme-animal-island",
			"theme-system-classic",
			"theme-data-stream",
			"theme-soft-relief",
			"theme-geometric-modern",
			"theme-executive-brief",
			"theme-paper-ink",
			"theme-swiss-modern"
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
		for (const pageKey of [...LEGACY_PAGE_KEYS, "chat", "settings"]) {
			this.contentEl.classList.remove(`page-${pageKey}`);
		}
		for (const page of PRIMARY_NAVIGATION) {
			this.contentEl.classList.remove(`section-${page.key}`);
		}
		this.contentEl.classList.add(`page-${this.activePage}`);
		this.contentEl.classList.add(
			`section-${this.pageRouter.current().primary}`
		);
		this.updateCosmosHeader();
	}

	updateCosmosHeader(): void {
		return updateCosmosHeader(this);
	}


	renderNav(): void {
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
		const { focus, taskFlow } = await collectFocusAndFlow(app, s);
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

		this.data = {
			total,
			dist,
			modules,
			focus,
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
		};

		const now = new Date();
		this.stampEl.setText(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
		this.renderNav();

		// 屈原页活跃时，库变动触发的后台刷新不重绘控制台——
		// 否则会拆掉对话页、打断朗读、画面闪跳。数据已存，离开此页时自然刷新。
		if (this.activePage === "jarvis" && this.jarvisMounted) return;

		this.renderHeroStats();
		this.renderApprovalSide();
		this.renderPage();
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
	unmountJarvisSafely(): void {
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
		const page = this.pageEl;
		this.applyPageState();
		this.renderSecondaryTabs();
		// 已在屈原页且已挂载：保持不动（不打断朗读/不闪跳）
		if (this.activePage === "jarvis" && this.jarvisMounted) return;
		if (this.activePage === "chat" && this.chatMounted) return;
		// 离开屈原或换页：先卸载屈原
		if (this.jarvisMounted) this.unmountJarvisSafely();
		if (this.chatMounted) {
			this.chatMounted = false;
			void this.chatSurface?.unmount();
		}
		this.actionPanel?.unmount();
		this.actionPanel = null;
		page.empty();
		const d = this.data;
		if (!d) { page.createDiv({ cls: "empty", text: "加载中…" }); return; }
		switch (this.activePage) {
			case "overview": this.pageOverview(page, d); break;
			case "chat": void this.pageChat(page); break;
			case "jarvis": void this.pageJarvis(page); break;
			case "daily": this.pageDaily(page, d); break;
			case "output": this.pageOutput(page, d); break;
			case "talos": this.pageTalos(page, d); break;
			case "inbox": this.pageInbox(page, d); break;
			case "health": this.pageHealth(page, d); break;
			case "projects": this.pageProjects(page, d); break;
			case "knowledge": this.pageKnowledge(page, d); break;
			case "identity": this.pageIdentity(page, d); break;
			case "capability": this.pageCapability(page, d); break;
			case "vault": this.pageVault(page, d); break;
			case "settings": this.pageSettings(page); break;
		}
		this.wireModuleSelection(page, this.activePage);
		this.syncPixelScene(d);
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
		todoHead.createEl("h3", { text: "待办" });
		todoHead.createSpan({ cls: "overview-kanban-count", text: String(d.focus.length) });
		if (d.focus.length === 0) {
			todoCol.createDiv({ cls: "overview-kanban-empty", text: "暂无待办 · 运行 /morning 生成今日焦点" });
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
		activeHead.createEl("h3", { text: "进行中" });
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
		doneHead.createEl("h3", { text: "最近完成" });
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

	private pageOverview(page: HTMLElement, d: Collected): void {
		return renderOverviewPage(this, page, d);
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

	private fillKnowledgeTreemap(parent: HTMLElement,
		metrics: MetricTile[]): void {
		return fillKnowledgeTreemap(this, parent, metrics);
	}

	private fillOutputClosureChart(parent: HTMLElement,
		platforms: OutputCenter["platforms"]): void {
		return fillOutputClosureChart(this, parent, platforms);
	}

	private fillProjectPortfolioChart(parent: HTMLElement,
		projects: ProjectScene[]): void {
		return fillProjectPortfolioChart(this, parent, projects);
	}










	async copyText(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			new Notice(`已复制：${text}`);
		} catch {
			new Notice(`复制失败：${text}`);
		}
	}

	navigateToPage(pageKey: string): void {
		this.activePage = pageKey;
		if (this.pageNavEl) this.renderNav();
		if (this.pageEl) this.renderPage();
	}

	// 主页「屈原」入口 → 控制台内的屈原语音页（QuyuanVoicePanel）。
	// 文字对话使用独立 AI 对话页面；原生恢复视图只负责兼容已保存的 leaf 地址。
	async openQuyuan(): Promise<void> {
		this.activePage = "jarvis";
		this.renderNav();
		this.renderPage();
	}
}
