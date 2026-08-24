import {
	ItemView,
	Notice,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import type TalosPlugin from "./main";
import { TalosSettingTab } from "./settings";
import type {
	DistBar,
	FocusItem,
	GateItem,
	HealthPoint,
	HealthDigest,
	HeatMonth,
	InboxDigest,
	KnowledgeHub,
	MetricTile,
	ModuleTile,
	OutputCenter,
	ProjectScene,
	ReleaseWarRoom,
	SignalItem,
	StatCard,
	TalosProduct,
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
import type { TalosSchemaKey, VaultPaths } from "./data/schema";
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
	CreateModal,
	PublishBackfillModal,
	approveAndExecuteApprovalWithMockModel,
	decidePendingApproval,
	decidePreferenceCandidate,
	deepResearch,
	openFile,
	vaultLint,
} from "./actions";
import { TaskDrawer } from "./ui/task-drawer";
import { ConsoleActionPanel } from "./ui/console-action-panel";
import { taskStateLabel } from "./ui/task-state-label";
import {
	LEGACY_PAGE_KEYS,
	PRIMARY_NAVIGATION,
	primaryPage,
} from "./ui/navigation-model";
import { TalosPageRouter } from "./ui/page-router";
import { TalosChatSurface } from "./quyuan/chat-surface";
import {
	renderTalosEmptyState,
	renderTalosKpiStrip,
	renderTalosPageHeader,
} from "./ui/page-primitives";
import { QuickNote } from "./ui/quick-note";
// 屈原语音面板按需动态加载，避免完整工作台运行时影响 TALOS 主控制台启动。

export const VIEW_TYPE_TALOS = "talos-console-view";

type QuyuanVoicePanelLike = {
	mount(container: HTMLElement): void;
	unmount(): void;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const SVG_NS = "http://www.w3.org/2000/svg";

type TalosPageArchetype = "dashboard" | "execution" | "knowledge" | "workspace" | "settings";

const PAGE_ARCHETYPES: Record<string, TalosPageArchetype> = {
	overview: "dashboard",
	health: "dashboard",
	vault: "dashboard",
	daily: "execution",
	inbox: "execution",
	output: "execution",
	projects: "execution",
	talos: "execution",
	knowledge: "knowledge",
	identity: "knowledge",
	capability: "knowledge",
	chat: "workspace",
	jarvis: "workspace",
	settings: "settings",
};
const dailyRota = (P: VaultPaths, tasksPath: string) => [
	{ day: 1, code: "MON", label: "周一", project: "TALOS 系统", desc: "产品脊柱、交付包、控制台", path: `${P.talosProjectDir}/_README.md` },
	{ day: 2, code: "TUE", label: "周二", project: "输出器官 / 首发件", desc: "发布流程、首发件、承接口", path: P.readme("output") },
	{ day: 3, code: "WED", label: "周三", project: "B 端交付", desc: "样板项目与客户推进", path: P.readme("projects") },
	{ day: 4, code: "THU", label: "周四", project: "GEO 站点 + TALOS 支撑", desc: "公开资产、搜索入口、理论支撑", path: `${P.talosProjectDir}/_README.md` },
	{ day: 5, code: "FRI", label: "周五", project: "私域承接 / AI 社群", desc: "CTA、社群与模板包", path: P.opsCandidatesFile },
	{ day: 6, code: "SAT", label: "周六", project: "缓冲日", desc: "补阻塞、学习、修小破口", path: tasksPath },
	{ day: 0, code: "SUN", label: "周日", project: "休息 + 周重置", desc: "刷新上下文并摆好下周轨道", path: P.contextFile },
];
// 每日固定骨架时间轴（pageDaily 渲染与像素小人里程碑共用同一数据源）
const dailyTimeline = (P: VaultPaths, tasksPath: string) => [
	{ time: "08:30", mins: 510, dur: 15, length: "15 min", title: "开工 · 接收系统指令", desc: "只确认焦点与 done_when，不重新规划人生。", starter: "复制「开工」，接今天第一步。", path: tasksPath, deep: false },
	{ time: "09:00", mins: 540, dur: 120, length: "120 min", title: "深度块① · 输出闭环", desc: "完成选、改、发、回填中的最短可验证闭环。", starter: "只处理统一出口今日待发的一条。", path: P.outletFile, deep: true },
	{ time: "11:00", mins: 660, dur: 45, length: "45 min", title: "分发回填 · 数据与消息", desc: "发布后立即回填链接、状态与运营观察。", starter: "检查 publish_url、signal 与 views。", path: P.opsCandidatesFile, deep: false },
	{ time: "14:00", mins: 840, dur: 120, length: "120 min", title: "深度块② · 当日轮值项目", desc: "", starter: "只做一个能留下痕迹的下一步。", path: P.readme("projects"), deep: true },
	{ time: "16:00", mins: 960, dur: 45, length: "45 min", title: "轻输入 · 客户沟通", desc: "最多处理 3 条，只捞能变成输出或交付的信号。", starter: "不做全库清仓。", path: P.readme("inbox"), deep: false },
	{ time: "17:00", mins: 1020, dur: 20, length: "20 min", title: "收工 · 关环并铺明天", desc: "记录实质碎片、更新任务池、留下明早第一步。", starter: "复制「收工」，写结果与阻塞。", path: `${P.workingMemoryDir}/_README.md`, deep: false },
];
const SELECTABLE_MODULES = [
	".commands .command",
	".overview-card",
	".quick-card",
	".metric-card",
	".platform-card",
	".cluster-card",
	".project-card",
	".talos-module",
	".detail-row",
	".note",
	".focus",
	".gate",
	".signal-pill",
	".approval .item",
	".barrow",
	".stat",
	".daily-item",
].join(",");

interface Collected {
	total: number;
	dist: DistBar[];
	modules: ModuleTile[];
	focus: FocusItem[];
	healthTrend: HealthPoint[];
	overview: { totalNotes: StatCard; inbox: StatCard; taskFlow: StatCard; health: StatCard };
	approvals: SignalItem[];
	candidates: SignalItem[];
	heatmap: { meta: string; months: HeatMonth[] };
	warRoom: ReleaseWarRoom;
	capGroups: CapabilityGroup[];
	output: OutputCenter;
	inbox: InboxDigest;
	healthDigest: HealthDigest;
	projects: ProjectScene[];
	knowledge: KnowledgeHub;
	talosProduct: TalosProduct;
}

interface OverviewAttention {
	title: string;
	meta: string;
	detail: string;
	action: string;
	path: string;
	icon: string;
	tone: "hot" | "warn" | "default";
}

interface ApprovalDecisionFeedback {
	title: string;
	decision: "approve" | "reject" | "execute";
	path?: string;
	at: string;
}

interface CandidateDecisionFeedback {
	title: string;
	decision: "approve" | "reject";
	path?: string;
	at: string;
}

interface ModuleHeroStat {
	label: string;
	value: string;
	sub?: string;
	path?: string;
	tone?: "default" | "warn" | "hot" | "good";
}

interface ModuleHeroAction {
	label: string;
	icon: string;
	path?: string;
	command?: string;
}

interface ModuleHeroOptions {
	ac: string;
	icon: string;
	eyebrow: string;
	title: string;
	desc: string;
	stats: ModuleHeroStat[];
	actions?: ModuleHeroAction[];
}

export class TalosView extends ItemView {
	plugin: TalosPlugin;

	private timeEl!: HTMLElement;
	private dateEl!: HTMLElement;
	private weekEl!: HTMLElement;
	private pageNavEl!: HTMLElement;
	private chatSwitchHostEl!: HTMLElement;
	private cosmosNodesEl!: HTMLElement;
	private cosmosTitleEl!: HTMLElement;
	private cosmosSubEl!: HTMLElement;
	private cosmosStatusTextEl!: HTMLElement;
	private cosmosClockEl!: HTMLElement;
	private approvalCardEl!: HTMLElement;
	private approvalSideEl!: HTMLElement;
	private pageTabsEl!: HTMLElement;
	private pageEl!: HTMLElement;
	private stampEl!: HTMLElement;
	private patrolEl!: HTMLElement;
	/** 上次渲染时的发布数，用于 output 场景检测「新发布」触发火箭升空 */
	private lastPublished: number | undefined;

	private data: Collected | null = null;
	private readonly pageRouter = new TalosPageRouter("overview");
	private activeCap = "commands";
	private selectedModuleByScope = new Map<string, string>();
	private lastApprovalFeedback: ApprovalDecisionFeedback | null = null;
	private lastCandidateFeedback: CandidateDecisionFeedback | null = null;
	private jarvis: QuyuanVoicePanelLike | null = null;
	private jarvisMounted = false;
	private chatSurface: TalosChatSurface | null = null;
	private chatMounted = false;
	private clockTimer: number | null = null;
	private taskDrawer: TaskDrawer | null = null;
	private actionPanel: ConsoleActionPanel | null = null;
	private embeddedSettingsTab: TalosSettingTab | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TalosPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	private get activePage(): string {
		return this.pageRouter.renderKey();
	}

	private set activePage(pageKey: string) {
		this.pageRouter.navigate(pageKey);
	}

	/** 库目录映射（单一真源，随设置页「目录映射」实时生效） */
	private get paths() { return this.plugin.paths; }

	private dailyRota() { return dailyRota(this.paths, this.plugin.talosSettings.tasksPath); }
	private dailyTimeline() { return dailyTimeline(this.paths, this.plugin.talosSettings.tasksPath); }

	/** 按 schema 键取模块笔记数（模块名即当前 schema 下的目录名） */
	private moduleCount(d: Collected, key: TalosSchemaKey): number {
		return d.modules.find((item) => item.name === this.paths.dir(key))?.count ?? 0;
	}

	getViewType(): string { return VIEW_TYPE_TALOS; }
	getDisplayText(): string { return "TALOS 控制台"; }
	getIcon(): string { return "talos-logo"; }

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

	// ---------- 外壳 ----------
	private buildShell(): void {
		const root = this.contentEl;
		if (this.chatMounted) {
			this.chatMounted = false;
			void this.chatSurface?.unmount();
		}
		this.taskDrawer?.unmount();
		this.taskDrawer = null;
		this.actionPanel?.unmount();
		this.actionPanel = null;
		this.embeddedSettingsTab = null;
		root.empty();
		root.addClass("talos-console");
		this.applySettings();
		this.applyPageState();

		const bg = root.createDiv({ cls: "bg-fx" });
		for (const o of ["o1", "o2", "o3", "o4"]) bg.createEl("i", { cls: `orb ${o}` });
		this.buildThemeAtmosphere(bg);

		const app = root.createDiv({ cls: "app" });
		const sidebar = app.createEl("aside", { cls: "sidebar" });
		const main = app.createEl("main", { cls: "main" });

		this.buildSidebar(sidebar);
		this.buildMain(main);
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

	private secTitle(card: HTMLElement, title: string, small: string): void {
		const st = card.createDiv({ cls: "section-title talos-ui-panel-header" });
		st.createEl("h2", { text: title });
		st.createEl("small", { text: small });
	}

	private syncActionButtonTheme(button: HTMLElement, theme: string): void {
		const aurora = theme === "aurora";
		const variant = button.dataset.talosActionVariant || "";
		button.toggleClass("button1", aurora);
		button.toggleClass("button1--compact", aurora && variant === "compact");
		button.toggleClass("button1--mini", aurora && variant === "mini");
	}

	private buildThemeAtmosphere(bg: HTMLElement): void {
		const rain = bg.createDiv({ cls: "data-rain" });
		rain.setAttribute("aria-hidden", "true");
		const streams = [
			"01\n10\nCTX\n01\nSYS\n10\nMEM\n01\n11\nNODE\n00",
			"10\n01\nTALOS\n11\nDATA\n00\n01\nCORE\n10\n01",
			"11\n00\nSIGNAL\n01\n10\nSYNC\n11\n01\nINDEX\n00",
			"01\nNODE\n10\n00\nLINK\n11\n01\nTRACE\n10\n01",
			"10\nMEM\n01\n11\nFLOW\n00\n10\nGRAPH\n01\n11",
			"00\n01\nVAULT\n10\n11\nSCAN\n01\nINDEX\n00\n10",
			"11\n10\nAGENT\n01\n00\nLOOP\n11\n01\nSTATE\n10",
			"01\nSIGNAL\n00\n10\nCTX\n11\n01\nMEM\n10\n00",
		];
		for (let i = 0; i < 20; i++) {
			const col = rain.createEl("i", { text: streams[i % streams.length] });
			col.setCssProps({
				"--rain-x": `${3 + i * 5}%`,
				"--rain-delay": `${-(i % 9) * 1.7}s`,
				"--rain-duration": `${16 + (i % 7) * 2}s`,
			});
		}

		const geometry = bg.createDiv({ cls: "geometry-field" });
		geometry.setAttribute("aria-hidden", "true");
		for (const shape of ["circle", "square", "triangle", "bar"]) {
			geometry.createEl("i", { cls: `geometry-shape is-${shape}` });
		}
	}

	private addActionButtonContent(
		button: HTMLElement,
		label: string,
		variant: "" | "compact" | "mini" = ""
	): void {
		button.dataset.talosActionButton = "true";
		button.dataset.talosActionVariant = variant;
		const iconWrap = button.createSpan({ cls: "button1__icon-wrapper" });
		const icon = iconWrap.createSpan({ cls: "button1__icon-svg" });
		setIcon(icon, "arrow-up-right");
		const iconCopy = iconWrap.createSpan({
			cls: "button1__icon-svg button1__icon-svg--copy",
		});
		setIcon(iconCopy, "arrow-up-right");
		button.createSpan({ cls: "button1__label", text: label });
		this.syncActionButtonTheme(button, this.plugin.talosSettings.visualTheme || "aurora");
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

	private applyPageState(): void {
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

	private updateCosmosHeader(): void {
		if (!this.cosmosTitleEl || !this.cosmosSubEl || !this.cosmosStatusTextEl) return;
		const route = this.pageRouter.current();
		const primary = primaryPage(route.primary);
		const secondary = primary.children.find(
			(child) => child.key === route.secondary
		);
		const isWorkbench = route.primary === "workbench";
		this.cosmosTitleEl.setText(
			isWorkbench
				? this.plugin.talosSettings.mainTitle
				: secondary?.label || primary.label
		);
		this.cosmosSubEl.setText(primary.subtitle);
		this.cosmosStatusTextEl.setText(
			isWorkbench ? "系统运行中" : primary.label
		);
	}

	private buildSidebar(side: HTMLElement): void {
		// 时钟
		const clockCard = side.createEl("section", { cls: "card clock-card" });
		clockCard.setCssProps({ "--ac": "#38E1FF" });
		const clock = clockCard.createDiv({ cls: "clock" });
		const cl = clock.createDiv();
		this.timeEl = cl.createDiv({ cls: "time", text: "--:--" });
		cl.createDiv({ cls: "sub", text: "ASIA/SHANGHAI" });
		this.dateEl = clock.createDiv({ cls: "date" });
		this.weekEl = clockCard.createDiv({ cls: "week" });

		// 导航
		const navCard = side.createEl("section", { cls: "card pagenav-card" });
		navCard.setCssProps({ "--ac": "#4D8DFF" });
		this.secTitle(navCard, "导航", `${PRIMARY_NAVIGATION.length} SECTIONS`);
		this.pageNavEl = navCard.createEl("nav", { cls: "nav" });
		this.renderNav();
		this.taskDrawer = new TaskDrawer({
			parent: navCard,
			store: this.plugin.getConsoleActionRuntime().store,
			controller: this.plugin.getConsoleActionRuntime().runner,
		});
		this.taskDrawer.mount();
		this.chatSwitchHostEl = navCard.createDiv({
			cls: "talos-chat-nav-switch-host",
		});
		this.chatSwitchHostEl.dataset.talosComponent = "chat-switch-host";

		// 快捷入口
		const quick = side.createEl("section", { cls: "card action-card" });
		quick.setCssProps({ "--ac": "#A78BFA" });
		this.secTitle(quick, "快捷入口", "ACTIONS");
		const qnav = quick.createEl("nav", { cls: "nav" });
		const act = (mark: string, label: string, fn: () => void) => {
			const a = qnav.createDiv({ cls: "command" });
			a.createDiv({ cls: "mark", text: mark });
			this.addActionButtonContent(a, label);
			a.addEventListener("click", fn);
		};
		act("刷", "刷新统计", () => void this.refresh());
		act("发", "发布回填", () =>
			new PublishBackfillModal(this.app, this.plugin.talosSettings, () => void this.refresh()).open());
		act("新", "新建", () =>
			new CreateModal(this.app, this.plugin.talosSettings, () => void this.refresh()).open());
		act("研", "Deep Research", () => void deepResearch(this.app, this.plugin.talosSettings));
		act("检", "Vault Lint", () => void vaultLint(this.app, this.plugin.talosSettings));

		// 待审批（无审批时整卡隐藏——健康时保持安静）
		const ap = side.createEl("section", { cls: "card approval-card is-hidden" });
		ap.setCssProps({ "--ac": "#FBBF24" });
		this.secTitle(ap, "待审批", "B/C 类变更");
		this.approvalCardEl = ap;
		this.approvalSideEl = ap.createDiv({ cls: "approval" });
	}

	private renderNav(): void {
		this.pageNavEl.empty();
		const route = this.pageRouter.current();
		const groupEl = this.pageNavEl.createDiv({ cls: "nav-group" });
		groupEl.setAttribute("data-nav-group", "primary");
		groupEl.createDiv({ cls: "nav-group-label", text: "主界面" });
		for (const page of PRIMARY_NAVIGATION) {
			const active = page.key === route.primary;
			const item = groupEl.createDiv({
				cls: `command${page.key === "settings" ? " talos-settings-nav-command" : ""}${active ? " active" : ""}`,
			});
			const mark = item.createDiv({ cls: "mark" });
			setIcon(mark, page.icon);
			item.createSpan({ cls: "nav-label", text: page.label });
			item.dataset.talosActionButton = "true";
			item.dataset.talosActionVariant = "";
			this.syncActionButtonTheme(
				item,
				this.plugin.talosSettings.visualTheme || "aurora"
			);
			item.setAttribute("title", page.subtitle);
			item.setAttribute("aria-label", page.label);
			item.setAttribute("role", "button");
			item.setAttribute("tabindex", "0");
			if (active) item.setAttribute("aria-current", "page");
			const activate = () => {
				this.pageRouter.selectPrimary(page.key);
				this.renderNav();
				this.renderPage();
			};
			item.addEventListener("click", activate);
			item.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				activate();
			});
		}
		this.renderSecondaryTabs();
	}

	private navMeta(key: string): { value: string; alert?: boolean } | null {
		const d = this.data;
		if (!d) return null;
		switch (key) {
			case "overview": {
				const count = this.collectOverviewAttention(d).length;
				return { value: count > 0 ? `${count} 待处理` : "正常", alert: count > 0 };
			}
			case "daily": return { value: `${d.focus.length} 焦点` };
			case "jarvis": return { value: "AI" };
			case "inbox": return { value: String(d.inbox.count), alert: d.inbox.count > 0 };
			case "output": return { value: d.output.metrics[0]?.value || "0", alert: Number(d.output.metrics[0]?.value || 0) > 0 };
			case "projects": return { value: String(d.projects.length) };
			case "knowledge": {
				const insights = Number(d.knowledge.metrics.find((item) => item.label === "原创洞察")?.value || 0);
				const materials = Number(d.knowledge.metrics.find((item) => item.label === "外部素材")?.value || 0);
				return { value: String(insights + materials) };
			}
			case "identity": return { value: String(this.moduleCount(d, "identity") + this.moduleCount(d, "soul")) };
			case "talos": return { value: d.talosProduct.metrics[0]?.value || "0" };
			case "health": {
				const score = d.overview.health.value;
				return { value: score, alert: score === "—" || Number(score) < 90 };
			}
			case "capability": return { value: String(d.capGroups.reduce((sum, group) => sum + group.items.length, 0)) };
			case "vault": return { value: String(d.total) };
			default: return null;
		}
	}

	private renderSecondaryTabs(): void {
		if (!this.pageTabsEl) return;
		this.pageTabsEl.empty();
		const route = this.pageRouter.current();
		const page = primaryPage(route.primary);
		this.pageTabsEl.toggleClass("is-hidden", page.children.length === 0);
		if (page.children.length === 0) return;
		this.pageTabsEl.setAttribute("aria-label", `${page.label}二级页面`);
		for (const child of page.children) {
			const active = child.key === route.secondary;
			const button = this.pageTabsEl.createEl("button", {
				cls: `talos-page-tab${active ? " is-active" : ""}`,
				attr: {
					type: "button",
					"aria-pressed": String(active),
				},
			});
			const icon = button.createSpan({ cls: "talos-page-tab__icon" });
			setIcon(icon, child.icon);
			button.createSpan({ text: child.label });
			const meta = this.navMeta(child.key);
			if (meta) {
				button.createSpan({
					cls: `talos-page-tab__meta${meta.alert ? " is-alert" : ""}`,
					text: meta.value,
				});
			}
			button.addEventListener("click", () => {
				this.pageRouter.selectSecondary(child.key);
				this.renderSecondaryTabs();
				this.renderPage();
			});
		}
	}

	private buildMain(main: HTMLElement): void {
		// Hero 仅服务总览页；子页面通过 data-talos-page 隐藏，直接展示自身内容。
		const hero = main.createEl("header", { cls: "hero talos-ui-overview-header" });
		const cosmos = hero.createDiv({ cls: "cosmos-scene" });
		const cosmosTop = cosmos.createDiv({ cls: "cosmos-top" });
		const cosmosTitle = cosmosTop.createDiv({ cls: "cosmos-title" });
		this.cosmosTitleEl = cosmosTitle.createEl("h1", { text: this.plugin.talosSettings.mainTitle });
		this.cosmosSubEl = cosmosTitle.createDiv({ cls: "cosmos-sub", text: "个人上下文宇宙" });
		const cosmosStatus = cosmosTop.createDiv({ cls: "cosmos-status" });
		cosmosStatus.createEl("i");
		this.cosmosStatusTextEl = cosmosStatus.createSpan({ text: "系统运行中" });
		this.cosmosClockEl = cosmosStatus.createSpan({ cls: "cosmos-clock", text: "—" });
		this.updateCosmosHeader();
		const orbit = cosmos.createDiv({ cls: "cosmos-orbit" });
		for (const ring of ["r1", "r2", "r3", "r4"]) orbit.createDiv({ cls: `cosmos-ring ${ring}` });
		const core = orbit.createDiv({ cls: "cosmos-core" });
		core.createEl("b", { text: "TALOS" });
		core.createSpan({ text: "核心引擎" });
		core.createEl("i", { text: "运行中" });
		this.cosmosNodesEl = orbit.createDiv({ cls: "cosmos-nodes" });

		const heroHead = hero.createDiv({ cls: "hero-head" });
		const brand = heroHead.createDiv({ cls: "brand brand-text" });
		const bt = brand.createDiv();
		const eye = bt.createDiv({ cls: "eyebrow" });
		eye.appendText(this.plugin.talosSettings.eyebrow);
		const live = eye.createSpan({ cls: "live" });
		live.createEl("i");
		live.appendText("ONLINE");
		const titleText = this.plugin.talosSettings.mainTitle;
		const heroTitle = bt.createEl("h1", { cls: "talos-hero-title" });
		heroTitle.setAttribute("data-text", titleText);
		const titleMatch = titleText.match(/^(TALOS)\s*(.*)$/i);
		if (titleMatch) {
			heroTitle.createSpan({ cls: "talos-title-latin", text: titleMatch[1] });
			if (titleMatch[2]) heroTitle.createSpan({ cls: "talos-title-cn", text: titleMatch[2] });
		} else {
			heroTitle.createSpan({ cls: "talos-title-latin", text: titleText });
		}
		const logoModule = heroHead.createDiv({ cls: "logo-module" });
		logoModule.setAttribute("role", "button");
		logoModule.setAttribute("tabindex", "0");
		logoModule.setAttribute("aria-label", "打开屈原工作台");
		logoModule.setAttribute("title", "打开屈原工作台");
		logoModule.addEventListener("click", () => void this.openQuyuan());
		logoModule.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" || ev.key === " ") {
				ev.preventDefault();
				void this.openQuyuan();
			}
		});
		for (const ring of ["r1", "r2", "r3"]) logoModule.createEl("i", { cls: `logo-ping ${ring}` });
		const logo = logoModule.createDiv({ cls: "logo logo-heart" });
		this.buildLogo(logo);

		this.patrolEl = this.buildPixelPatrol(hero);

		// 二级页签和业务页共用当前 TALOS leaf，不为子页面创建新 leaf。
		this.pageTabsEl = main.createEl("nav", {
			cls: "talos-page-tabs is-hidden",
		});
		this.renderSecondaryTabs();
		this.pageEl = main.createDiv({ cls: "page-content talos-ui-page" });

		const commandBar = main.createDiv({ cls: "cosmos-commandbar" });
		const voice = commandBar.createDiv({ cls: "cosmos-command-voice" });
		setIcon(voice, "audio-lines");
		commandBar.createDiv({ cls: "cosmos-command-text", text: "问屈原或执行命令..." });
		const keys = commandBar.createDiv({ cls: "cosmos-command-keys" });
		keys.createSpan({ text: "⌘ K" });
		const mic = keys.createSpan();
		setIcon(mic, "mic");
		const send = keys.createSpan({ cls: "cosmos-command-send" });
		setIcon(send, "send");
		commandBar.addEventListener("click", () => {
			this.activePage = "chat";
			this.renderNav();
			this.renderPage();
		});

		const footer = main.createDiv({ cls: "footer" });
		footer.appendText("TALOS CONSOLE · AURORA EDITION · 数据刷新 ");
		this.stampEl = footer.createSpan({ text: "—" });
		footer.appendText(" · 原生插件");
	}

	/**
	 * 像素小人舞台（design-system/talos/pixel-bot-system.md）。
	 * 同一个 DOM 用于两处：共享 Hero（总览页巡航）与各业务页的
	 * module-hero（场景皮肤按 data-talos-page 切换）。道具常驻 DOM、
	 * 默认隐藏，显隐/位置由 syncPixelScene 在渲染后一次性写入。
	 */
	private buildPixelPatrol(parent: HTMLElement): HTMLElement {
		const patrol = parent.createDiv({ cls: "talos-pixel-patrol" });
		patrol.setAttribute("aria-hidden", "true");
		patrol.createDiv({ cls: "talos-pixel-track" });
		const bot = patrol.createDiv({ cls: "talos-pixel-bot" });
		bot.createSpan({ cls: "talos-pixel-shadow" });
		bot.createSpan({ cls: "talos-pixel-antenna" });
		const head = bot.createSpan({ cls: "talos-pixel-head" });
		head.createSpan({ cls: "talos-pixel-eye left" });
		head.createSpan({ cls: "talos-pixel-eye right" });
		head.createSpan({ cls: "talos-pixel-mark" });
		head.createSpan({ cls: "pixel-prop bandage" });
		bot.createSpan({ cls: "talos-pixel-body" });
		const parcelRack = patrol.createDiv({ cls: "pixel-props pixel-props-parcels" });
		for (let i = 0; i < 6; i++) {
			parcelRack.createSpan({ cls: "pixel-prop parcel" });
		}
		const flagLine = patrol.createDiv({ cls: "pixel-props pixel-props-flags" });
		for (let i = 0; i < this.dailyTimeline().length; i++) {
			flagLine.createSpan({ cls: "pixel-prop flag" });
		}
		patrol.createSpan({ cls: "pixel-prop zzz", text: "Zzz" });
		// 批次 2 道具：health 心电脉冲 / talos 闸门 / output 火箭 + 停止牌
		const ecgLine = patrol.createDiv({ cls: "pixel-props pixel-props-ecg" });
		for (let i = 0; i < 5; i++) {
			ecgLine.createSpan({ cls: "pixel-prop pulse" });
		}
		const gateLine = patrol.createDiv({ cls: "pixel-props pixel-props-gates" });
		for (let i = 0; i < 3; i++) {
			gateLine.createSpan({ cls: "pixel-prop gate" });
		}
		const rocketRack = patrol.createDiv({ cls: "pixel-props pixel-props-rockets" });
		for (let i = 0; i < 5; i++) {
			rocketRack.createSpan({ cls: "pixel-prop rocket" });
		}
		patrol.createSpan({ cls: "pixel-prop sign" });
		// 批次 3 道具：projects 安全帽 + 集装箱 / knowledge 悬浮岛 + 幼苗 /
		// vault 雷达盘 + 热力 blip（zzz 复用 daily 的元素）
		head.createSpan({ cls: "pixel-prop helmet" });
		const crateLine = patrol.createDiv({ cls: "pixel-props pixel-props-crates" });
		for (let i = 0; i < 3; i++) {
			crateLine.createSpan({ cls: "pixel-prop crate" });
		}
		const isleLine = patrol.createDiv({ cls: "pixel-props pixel-props-isles" });
		for (let i = 0; i < 5; i++) {
			isleLine.createSpan({ cls: "pixel-prop isle" });
		}
		const sproutLine = patrol.createDiv({ cls: "pixel-props pixel-props-sprouts" });
		for (let i = 0; i < 3; i++) {
			sproutLine.createSpan({ cls: "pixel-prop sprout" });
		}
		patrol.createSpan({ cls: "pixel-prop radar" });
		const blipLine = patrol.createDiv({ cls: "pixel-props pixel-props-blips" });
		for (let i = 0; i < 5; i++) {
			blipLine.createSpan({ cls: "pixel-prop blip" });
		}
		// 批次 4 道具：identity 镜厅（镜框 + 刻痕 + 镜像小人，全系统唯一双 bot）/
		// capability 接线员（交换机 + 插线，线缆挂在板内定位）
		const mirror = patrol.createSpan({ cls: "pixel-prop mirror" });
		for (let i = 0; i < 4; i++) {
			mirror.createSpan({ cls: "notch" });
		}
		const reflection = patrol.createDiv({ cls: "talos-pixel-bot reflection" });
		reflection.createSpan({ cls: "talos-pixel-shadow" });
		reflection.createSpan({ cls: "talos-pixel-antenna" });
		const rHead = reflection.createSpan({ cls: "talos-pixel-head" });
		rHead.createSpan({ cls: "talos-pixel-eye left" });
		rHead.createSpan({ cls: "talos-pixel-eye right" });
		rHead.createSpan({ cls: "talos-pixel-mark" });
		reflection.createSpan({ cls: "talos-pixel-body" });
		const board = patrol.createSpan({ cls: "pixel-prop board" });
		for (let i = 0; i < 6; i++) {
			board.createSpan({ cls: "pixel-prop cord" });
		}
		return patrol;
	}

	private buildLogo(host: HTMLElement): void {
		const doc = this.contentEl.ownerDocument;
		const svg = doc.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "96 191 360 360");
		const p1 = doc.createElementNS(SVG_NS, "path");
		p1.setAttribute("fill", "#FFFFFF");
		p1.setAttribute("d", "M180 247H249V286H304V247H374V286H405V411H374V460H306V496H247V460H180V411H148V286H180V247Z");
		const p2 = doc.createElementNS(SVG_NS, "path");
		p2.setAttribute("fill", "#7C3AED");
		p2.setAttribute("d", "M199 326H353V373H306V460H247V373H199V326Z");
		svg.appendChild(p1);
		svg.appendChild(p2);
		host.appendChild(svg);
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
		if (!this.cosmosNodesEl) return;
		this.cosmosNodesEl.empty();
		const capCount = d.capGroups.reduce((sum, g) => sum + g.items.length, 0);
		const nodes = [
			{ page: "output", icon: "send", label: "输出", value: d.output.metrics[0]?.value ?? String(d.warRoom.published), sub: "今日输出", ac: "#FB7185" },
			{ page: "inbox", icon: "inbox", label: "收件箱", value: String(d.inbox.count), sub: "待处理", ac: "#FBBF24" },
			{ page: "health", icon: "activity", label: "健康", value: d.overview.health.value, sub: "系统分", ac: "#34D399" },
			{ page: "projects", icon: "folder", label: "项目", value: String(d.projects.length), sub: "进行中", ac: "#F59E0B" },
			{ page: "capability", icon: "box", label: "能力", value: String(capCount), sub: "能力模块", ac: "#14B8A6" },
			{ page: "knowledge", icon: "book-open", label: "知识", value: d.overview.totalNotes.value, sub: "知识节点", ac: "#A78BFA" },
		];
		nodes.forEach((item, i) => {
			const node = this.cosmosNodesEl.createDiv({ cls: `cosmos-node n${i + 1}` });
			node.setCssProps({ "--node-ac": item.ac });
			const icon = node.createDiv({ cls: "cosmos-node-icon" });
			setIcon(icon, item.icon);
			const copy = node.createDiv({ cls: "cosmos-node-copy" });
			copy.createEl("b", { text: item.label });
			copy.createEl("strong", { text: item.value });
			copy.createSpan({ text: item.sub });
			const arrow = node.createDiv({ cls: "cosmos-node-arrow" });
			setIcon(arrow, "chevron-right");
			node.addEventListener("click", () => {
				this.activePage = item.page;
				this.renderNav();
				this.renderPage();
			});
		});
	}

	private renderApprovalSide(): void {
		this.approvalSideEl.empty();
		const d = this.data;
		if (!d) return;
		this.approvalCardEl.toggleClass("is-hidden", d.approvals.length === 0);
		if (d.approvals.length === 0) return;
		for (const it of d.approvals.slice(0, 5)) {
			this.renderApprovalItem(this.approvalSideEl, it);
		}
	}

	private renderApprovalItem(parent: HTMLElement, it: SignalItem): void {
		const item = parent.createDiv({ cls: "item approval-item" });
		item.createSpan({ cls: "badge", text: "!" });
		item.createEl("span", { cls: "approval-title", text: it.title });
		if (it.path) {
			item.addEventListener("click", () => void openFile(this.app, it.path || ""));
		}

		const actions = item.createDiv({ cls: "approval-actions" });
		this.createApprovalActionButton(actions, "approve", "check", "批准", it);
		this.createApprovalActionButton(actions, "reject", "x", "拒绝", it);
		this.createApprovalExecuteButton(actions, it);
	}

	private renderCandidateItem(parent: HTMLElement, it: SignalItem): void {
		const item = parent.createDiv({ cls: "item approval-item candidate-approval-item" });
		item.createSpan({ cls: "badge candidate-badge", text: "偏" });
		item.createEl("span", { cls: "approval-title", text: it.title });
		if (it.path) {
			item.addEventListener("click", () => void openFile(this.app, it.path || ""));
		}

		const actions = item.createDiv({ cls: "approval-actions" });
		this.createCandidateActionButton(actions, "approve", "check", "批准", it);
		this.createCandidateActionButton(actions, "reject", "x", "拒绝", it);
	}

	private renderDecisionWorkspace(
		parent: HTMLElement,
		d: Collected,
		limit = 2
	): void {
		parent.addClass("talos-decision-workspace");
		parent.addClass("overview-v2-approval-panel");

		const pendingGroup = parent.createDiv({
			cls: "talos-decision-group overview-v2-approval-group overview-pending-panel",
		});
		const pendingHead = pendingGroup.createDiv({
			cls: "talos-decision-group__head overview-v2-approval-group__head",
		});
		pendingHead.createEl("strong", { text: "变更审批" });
		pendingHead.createSpan({ text: String(d.approvals.length) });
		const pendingList = pendingGroup.createDiv({
			cls: "approval talos-decision-list overview-approval-list",
		});
		this.renderApprovalFeedback(pendingList);
		for (const item of d.approvals.slice(0, limit)) {
			this.renderApprovalItem(pendingList, item);
		}
		if (d.approvals.length === 0) {
			pendingList.createDiv({
				cls: "ok",
				text: "当前没有待审批变更",
			});
		}

		const preferenceGroup = parent.createDiv({
			cls: "talos-decision-group overview-v2-approval-group overview-preference-panel",
		});
		const preferenceHead = preferenceGroup.createDiv({
			cls: "talos-decision-group__head overview-v2-approval-group__head",
		});
		preferenceHead.createEl("strong", { text: "偏好确认" });
		preferenceHead.createSpan({ text: String(d.candidates.length) });
		const preferenceList = preferenceGroup.createDiv({
			cls: "approval talos-decision-list overview-approval-list",
		});
		this.renderCandidateFeedback(preferenceList);
		for (const item of d.candidates.slice(0, limit)) {
			this.renderCandidateItem(preferenceList, item);
		}
		if (d.candidates.length === 0) {
			preferenceList.createDiv({
				cls: "ok",
				text: "当前没有待确认偏好",
			});
		}
	}

	private createCandidateActionButton(
		parent: HTMLElement,
		decision: "approve" | "reject",
		iconName: string,
		label: string,
		it: SignalItem
	): void {
		const button = parent.createEl("button", {
			cls: `approval-action approval-action-${decision}`,
		});
		button.type = "button";
		button.setAttribute("aria-label", `${label}偏好候选：${it.title}`);
		const icon = button.createSpan({ cls: "approval-action-icon" });
		setIcon(icon, iconName);
		button.createSpan({ cls: "approval-action-label", text: label });
		button.addEventListener("click", (event) => {
			void (async () => {
				event.preventDefault();
				event.stopPropagation();
				const siblingButtons = Array.from(
					parent.querySelectorAll<HTMLButtonElement>(".approval-action")
				);
				for (const btn of siblingButtons) btn.disabled = true;
				button.addClass("is-loading");
				const ok = await decidePreferenceCandidate(
					this.app,
					this.plugin.talosSettings,
					it.title,
					decision
				);
				if (ok) {
					this.lastCandidateFeedback = {
						title: it.title,
						decision,
						path: it.path,
						at: this.shortTime(),
					};
					await this.refresh();
				} else {
					button.removeClass("is-loading");
					for (const btn of siblingButtons) btn.disabled = false;
				}
			})();
		});
	}

	private createApprovalActionButton(
		parent: HTMLElement,
		decision: "approve" | "reject",
		iconName: string,
		label: string,
		it: SignalItem
	): void {
		const button = parent.createEl("button", {
			cls: `approval-action approval-action-${decision}`,
		});
		button.type = "button";
		button.setAttribute("aria-label", `${label}：${it.title}`);
		const icon = button.createSpan({ cls: "approval-action-icon" });
		setIcon(icon, iconName);
		button.createSpan({ cls: "approval-action-label", text: label });
		button.addEventListener("click", (event) => {
			void (async () => {
				event.preventDefault();
				event.stopPropagation();
				const siblingButtons = Array.from(
					parent.querySelectorAll<HTMLButtonElement>(".approval-action")
				);
				for (const btn of siblingButtons) btn.disabled = true;
				button.addClass("is-loading");
				const ok = await decidePendingApproval(
					this.app,
					this.plugin.talosSettings,
					it.title,
					decision
				);
				if (ok) {
					this.lastApprovalFeedback = {
						title: it.title,
						decision,
						path: it.path,
						at: this.shortTime(),
					};
					await this.refresh();
				} else {
					button.removeClass("is-loading");
					for (const btn of siblingButtons) btn.disabled = false;
				}
			})();
		});
	}

	private createApprovalExecuteButton(parent: HTMLElement, it: SignalItem): void {
		const button = parent.createEl("button", {
			cls: "approval-action approval-action-execute",
		});
		button.type = "button";
		button.setAttribute("aria-label", `批准并模型执行：${it.title}`);
		const icon = button.createSpan({ cls: "approval-action-icon" });
		setIcon(icon, "bot");
		button.createSpan({ cls: "approval-action-label", text: "批准+模型" });
		button.addEventListener("click", (event) => {
			void (async () => {
				event.preventDefault();
				event.stopPropagation();
				const siblingButtons = Array.from(
					parent.querySelectorAll<HTMLButtonElement>(".approval-action")
				);
				for (const btn of siblingButtons) btn.disabled = true;
				button.addClass("is-loading");
				const ok = await approveAndExecuteApprovalWithMockModel(
					this.app,
					this.plugin.talosSettings,
					it.title
				);
				if (ok) {
					this.lastApprovalFeedback = {
						title: it.title,
						decision: "execute",
						path: it.path,
						at: this.shortTime(),
					};
					await this.refresh();
				} else {
					button.removeClass("is-loading");
					for (const btn of siblingButtons) btn.disabled = false;
				}
			})();
		});
	}

	private shortTime(): string {
		const now = new Date();
		return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	}

	private renderApprovalFeedback(parent: HTMLElement): void {
		if (!this.lastApprovalFeedback) return;
		const feedback = this.lastApprovalFeedback;
		const approved = feedback.decision === "approve";
		const executed = feedback.decision === "execute";
		const box = parent.createDiv({
			cls: `approval-feedback ${approved || executed ? "is-approved" : "is-rejected"}`,
		});
		const icon = box.createSpan({ cls: "approval-feedback-icon" });
		setIcon(icon, executed ? "bot" : approved ? "check-circle-2" : "x-circle");
		const copy = box.createDiv({ cls: "approval-feedback-copy" });
		copy.createEl("b", {
			text: executed
				? "已批准并完成模型执行测试"
				: approved
					? "已批准，审批记录已写回"
					: "已拒绝，审批记录已写回",
		});
		copy.createEl("span", { text: feedback.title });
		copy.createEl("small", {
			text: executed
				? `${feedback.at} · 已写回目标文件，并更新审批执行记录。`
				: approved
				? `${feedback.at} · 只记录审批决策，实际变更尚未执行。`
				: `${feedback.at} · 已记录拒绝，提案内容未执行。`,
		});
		const open = box.createEl("button", { cls: "approval-feedback-open", text: "打开记录" });
		open.type = "button";
		open.addEventListener("click", (event) => {
			event.stopPropagation();
			void openFile(this.app, feedback.path || this.plugin.talosSettings.pendingApprovalsPath);
		});
	}

	private renderCandidateFeedback(parent: HTMLElement): void {
		if (!this.lastCandidateFeedback) return;
		const feedback = this.lastCandidateFeedback;
		const approved = feedback.decision === "approve";
		const box = parent.createDiv({
			cls: `approval-feedback ${approved ? "is-approved" : "is-rejected"}`,
		});
		const icon = box.createSpan({ cls: "approval-feedback-icon" });
		setIcon(icon, approved ? "check-circle-2" : "x-circle");
		const copy = box.createDiv({ cls: "approval-feedback-copy" });
		copy.createEl("b", {
			text: approved ? "已批准并移入已确认" : "已拒绝并移入已拒绝",
		});
		copy.createEl("span", { text: feedback.title });
		copy.createEl("small", {
			text: `${feedback.at} · 决策已写回偏好候选池。`,
		});
		const open = box.createEl("button", { cls: "approval-feedback-open", text: "打开记录" });
		open.type = "button";
		open.addEventListener("click", (event) => {
			event.stopPropagation();
			void openFile(this.app, feedback.path || this.plugin.talosSettings.candidatesPath);
		});
	}

	// ---------- 页 ----------
	private panel(parent: HTMLElement, ac: string, title: string, small: string): HTMLElement {
		const p = parent.createDiv({ cls: "panel talos-ui-panel" });
		p.setCssProps({ "--ac": ac });
		this.secTitle(p, title, small);
		return p;
	}

	private moduleHero(parent: HTMLElement, options: ModuleHeroOptions): HTMLElement {
		const hero = renderTalosPageHeader(parent, {
			accent: options.ac,
			icon: options.icon,
			eyebrow: options.eyebrow,
			title: options.title,
			description: options.desc,
			metrics: options.stats.map((stat) => ({
				label: stat.label,
				value: stat.value,
				detail: stat.sub,
				tone: stat.tone,
				...(stat.path
					? { onActivate: () => void openFile(this.app, stat.path as string) }
					: {}),
			})),
			actions: (options.actions || []).map((action) => ({
				label: action.label,
				icon: action.icon,
				onActivate: () => {
					if (action.command) void this.copyText(action.command);
					else if (action.path) void openFile(this.app, action.path);
				},
			})),
		});

		// 像素场景保留为紧凑身份带，不再占据整页宽的大型 Hero 区域。
		const scene = this.buildPixelPatrol(hero);
		scene.addClass("in-module-hero", "talos-ui-page-header__scene");
		return hero;
	}

	/**
	 * 卸载屈原面板，异常不外泄。
	 * 背景（2026-07-09）：底层 SDK 关闭子进程时曾抛
	 * `setTimeout(...).unref is not a function`，异常沿 unmount → renderPage
	 * 冒泡后 `jarvisMounted` 永远停留在 true，屈原页从此白屏。
	 * 无论 unmount 是否抛错，状态必须复位。
	 */
	private unmountJarvisSafely(): void {
		try {
			this.jarvis?.unmount();
		} catch (error) {
			console.error("TALOS Quyuan voice panel failed to unmount", error);
			this.jarvis = null;
		} finally {
			this.jarvisMounted = false;
		}
	}

	private renderPage(): void {
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

	/**
	 * 像素小人场景数据契约（design-system/talos/pixel-bot-system.md §1.2）。
	 * 只在渲染/刷新时写 CSS 变量与道具内联样式，动画全部交给 CSS steps()，
	 * 不引入任何 JS 帧循环。批次 1：inbox 搬运工 + daily 通勤者；
	 * 批次 2：health 心电监护 + talos 闸门守卫 + output 发射指挥；
	 * 批次 3：projects 工地巡视 + knowledge 星图园丁 + vault 雷达守夜人；
	 * 批次 4：identity 镜厅（双 bot 镜像）+ capability 接线员。
	 */
	private syncPixelScene(d: Collected): void {
		// 总览页舞台在共享 Hero；业务页舞台在该页 module-hero 内（每次渲染重建，需重新查询）
		const patrol = this.activePage === "overview"
			? this.patrolEl
			: this.pageEl?.querySelector<HTMLElement>(".talos-pixel-patrol");
		if (!patrol) return;
		const parcels = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.parcel"));
		const flags = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.flag"));
		const zzz = patrol.querySelector<HTMLElement>(".pixel-prop.zzz");
		// inbox 搬运工：包裹数 = min(count, 6)，最老 ≥14d 时末尾包裹落灰抖动；
		// 清空时回到普通巡航（data-scene-empty 还原步态）
		const parcelCount = Math.min(d.inbox.count, parcels.length);
		parcels.forEach((el, i) => {
			el.classList.toggle("is-on", i < parcelCount);
			el.classList.toggle(
				"is-stale",
				i === parcelCount - 1 && parcelCount > 0 && d.inbox.oldestDays >= 14
			);
		});
		patrol.dataset.sceneEmpty = String(d.inbox.count === 0);
		// daily 通勤者：小人位置 = 当前时刻在骨架窗口中的进度；里程碑旗按时段分布
		// （--scene-progress 的语义按页不同，只在 daily 页写时间进度，避免污染其他场景）
		if (this.activePage === "daily") {
			const timeline = this.dailyTimeline();
			const dayStart = timeline[0]?.mins ?? 510;
			const lastSlot = timeline[timeline.length - 1];
			const dayEnd = (lastSlot?.mins ?? 1020) + (lastSlot?.dur ?? 20);
			const now = new Date();
			const minsNow = now.getHours() * 60 + now.getMinutes();
			const progress = Math.min(1, Math.max(0, (minsNow - dayStart) / (dayEnd - dayStart)));
			// --scene-progress = 真实时间进度（轨道色带/旗帜用）；
			// --bot-progress = 小人通勤终点，保底 15%——早于首时段时终点=起点
			// 会原地不动（2026-07-20 07:58 实机反馈），给一段可见行程
			patrol.setCssProps({
				"--scene-progress": progress.toFixed(3),
				"--bot-progress": Math.max(progress, 0.15).toFixed(3),
			});
			flags.forEach((el, i) => {
				const slot = timeline[i];
				if (!slot) {
					el.removeClass("is-on");
					return;
				}
				el.addClass("is-on");
				el.style.left = `${(((slot.mins - dayStart) / (dayEnd - dayStart)) * 100).toFixed(1)}%`;
				el.classList.toggle("is-done", minsNow >= slot.mins + slot.dur);
				el.classList.toggle("is-now", minsNow >= slot.mins && minsNow < slot.mins + slot.dur);
			});
			zzz?.classList.toggle("is-visible", progress >= 1);
		}
		// 批次 2 · health 心电监护：健康分 <90 → 创可贴 + 步频减半（tone=hurt）；
		// 断链 >0 → 心电图纸带毛刺抖动
		if (this.activePage === "health") {
			const score = Number.parseInt(
				d.healthDigest.metrics.find((m) => m.label === "健康分")?.value ?? "",
				10
			);
			const broken = Number.parseInt(
				d.healthDigest.metrics.find((m) => m.label === "断链")?.value ?? "",
				10
			) || 0;
			patrol.dataset.sceneTone = Number.isFinite(score) && score < 90 ? "hurt" : "";
			patrol.dataset.sceneGlitch = String(broken > 0);
		}
		// 批次 2 · talos 闸门守卫：闸门位置均布轨道，done=常开绿灯 / ready=闪烁 /
		// blocked=红灯闭合；--scene-progress = 当前闸门前站位（已过闸门比例推算）
		if (this.activePage === "talos") {
			const gateEls = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.gate"));
			const gates = d.warRoom.gates.slice(0, gateEls.length);
			const doneCount = gates.filter((g) => g.state === "done").length;
			gateEls.forEach((el, i) => {
				const gate = gates[i];
				el.classList.toggle("is-on", Boolean(gate));
				if (!gate) return;
				el.style.left = `${(((i + 1) / (gates.length + 1)) * 100).toFixed(1)}%`;
				el.classList.toggle("is-open", gate.state === "done");
				el.classList.toggle("is-now", gate.state === "ready");
				el.classList.toggle("is-blocked", gate.state === "blocked");
			});
			const progress = gates.length > 0
				? (doneCount + 0.7) / (gates.length + 1)
				: 0.4;
			patrol.setCssProps({ "--scene-progress": progress.toFixed(3) });
		}
		// 批次 2 · output 发射指挥：待发队列 = 排队火箭（cap 5）；published 增加时
		// 队首火箭一次性点火升空；stopTriggered → 红灯 + 小人举停止牌静止。
		// lastPublished 只在 output 页更新，「发布后再进作战室」同样能看到升空。
		if (this.activePage === "output") {
			const rockets = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.rocket"));
			const queued = Math.min(d.output.queue.length, rockets.length);
			rockets.forEach((el, i) => el.classList.toggle("is-on", i < queued));
			patrol.dataset.sceneTone = d.warRoom.stopTriggered ? "hot" : "";
			const published = d.warRoom.published;
			if (this.lastPublished !== undefined && published > this.lastPublished) {
				const top = rockets.find((el) => el.classList.contains("is-on"));
				top?.classList.add("is-launch");
			}
			this.lastPublished = published;
		}
		// 批次 3 · projects 工地巡视：P0 项目 = 发光集装箱（cap 3），小人戴安全帽巡检
		if (this.activePage === "projects") {
			const crates = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.crate"));
			const p0Count = d.projects.filter((p) => p.priority === "p0").length;
			const shown = Math.min(p0Count, crates.length);
			crates.forEach((el, i) => el.classList.toggle("is-on", i < shown));
		}
		// 批次 3 · knowledge 星图园丁：MOC = 悬浮岛（cap 5），近期洞察 = 岛间幼苗（cap 3）
		if (this.activePage === "knowledge") {
			const isles = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.isle"));
			const isleCount = Math.min(d.knowledge.mocs.length, isles.length);
			isles.forEach((el, i) => el.classList.toggle("is-on", i < isleCount));
			const sprouts = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.sprout"));
			const sproutCount = Math.min(d.knowledge.recentInsights.length, sprouts.length);
			sprouts.forEach((el, i) => el.classList.toggle("is-on", i < sproutCount));
		}
		// 批次 3 · vault 雷达守夜人：热力密集天数 → 雷达 blip（cap 5）；
		// 小人全程打盹，zzz 常显（复用 daily 的 zzz 元素）
		if (this.activePage === "vault") {
			let hotCells = 0;
			for (const month of d.heatmap.months) {
				for (const week of month.weeks) {
					for (const cell of week) {
						if (cell.date !== "" && cell.level >= 3) hotCells++;
					}
				}
			}
			const blips = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.blip"));
			const blipCount = Math.min(hotCells, blips.length);
			blips.forEach((el, i) => el.classList.toggle("is-on", i < blipCount));
			zzz?.classList.add("is-visible");
		}
		// 批次 4 · identity 镜厅：Identity/灵魂文件数 → 镜框刻痕（cap 4）；
		// 镜像小人为纯 CSS 实例，无需 JS 写入
		if (this.activePage === "identity") {
			const notches = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.mirror .notch"));
			const shown = Math.min(this.moduleCount(d, "identity") + this.moduleCount(d, "soul"), notches.length);
			notches.forEach((el, i) => el.classList.toggle("is-on", i < shown));
		}
		// 批次 4 · capability 接线员：可用命令数 = 已插线缆数（cap 6）
		if (this.activePage === "capability") {
			const cords = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.board .cord"));
			const commandCount = d.capGroups.find((g) => g.key === "commands")?.items.length ?? 0;
			const shown = Math.min(commandCount, cords.length);
			cords.forEach((el, i) => el.classList.toggle("is-on", i < shown));
		}
	}

	private wireModuleSelection(scope: HTMLElement, selectionScope: string): void {
		const modules = Array.from(scope.querySelectorAll<HTMLElement>(SELECTABLE_MODULES));
		modules.forEach((module, index) => {
			if (module.dataset.talosSelectable === "true") return;
			const label = module.querySelector<HTMLElement>("code, b, .gate-id, .bt")?.textContent
				|| module.textContent
				|| `module-${index + 1}`;
			const key = `${index}:${label.trim().replace(/\s+/g, " ").slice(0, 64)}`;
			module.dataset.talosSelectable = "true";
			module.dataset.talosSelectionScope = selectionScope;
			module.dataset.talosSelectionKey = key;
			module.setAttribute("role", "button");
			module.setAttribute("tabindex", "0");
			module.setAttribute("aria-pressed", "false");

			const select = () => this.selectModule(module, selectionScope, key);
			// 只绑 click：pointerdown+click 双绑会让一次点击选中两次；
			// 键盘激活直接派发 click（click 监听里已含 select），避免三重执行。
			module.addEventListener("click", select);
			module.addEventListener("keydown", (ev) => {
				if (ev.key !== "Enter" && ev.key !== " ") return;
				ev.preventDefault();
				module.click();
			});

			if (this.selectedModuleByScope.get(selectionScope) === key) {
				module.addClass("is-module-selected");
				module.setAttribute("aria-pressed", "true");
			}
		});
	}

	private selectModule(module: HTMLElement, selectionScope: string, key: string): void {
		const candidates = Array.from(
			this.contentEl.querySelectorAll<HTMLElement>("[data-talos-selectable='true']")
		);
		for (const candidate of candidates) {
			if (candidate.dataset.talosSelectionScope !== selectionScope) continue;
			candidate.removeClass("is-module-selected");
			candidate.setAttribute("aria-pressed", "false");
		}
		this.selectedModuleByScope.set(selectionScope, key);
		module.addClass("is-module-selected");
		module.setAttribute("aria-pressed", "true");
	}

		// 总览页：主判断缩成可操作模块，指标与二级状态重排，避免横向大面板铺满。
		private fillOverviewKanban(parent: HTMLElement, d: Collected): void {
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
		const attention = this.collectOverviewAttention(d);
		const focusItem = d.focus[0];
		const primary: OverviewAttention = attention[0] || {
			title: focusItem?.title || "今日焦点尚未设置",
			meta: focusItem?.doneWhen
				? `done_when · ${focusItem.doneWhen}`
				: "从 tasks.md 读取",
			detail:
				focusItem?.desc ||
				"先运行 /morning，写下今天唯一胜利条件，再进入执行。",
			action: focusItem ? "打开今日焦点" : "打开任务池",
			path: focusItem?.path || this.plugin.talosSettings.tasksPath,
			icon: focusItem ? "target" : "calendar-plus",
			tone: focusItem ? "default" : "warn",
		};
		const latestHealth = d.healthTrend[d.healthTrend.length - 1];
		const previousHealth = d.healthTrend[d.healthTrend.length - 2];
		const healthDelta = latestHealth && previousHealth
			? latestHealth.score - previousHealth.score
			: 0;
		const pendingTotal = d.approvals.length + d.candidates.length;

		const primaryGrid = page.createDiv({
			cls: "overview-v2-primary",
		});
		primaryGrid.setAttribute("data-workbench-section", "primary-split");

		const dataColumn = primaryGrid.createDiv({
			cls: "overview-v2-column overview-v2-data-column",
		});
		dataColumn.setAttribute("data-workbench-section", "core-data");
		renderTalosKpiStrip(dataColumn, [
			{
				label: "知识笔记",
				value: d.overview.totalNotes.value,
				detail: d.overview.totalNotes.sub,
				tone: d.overview.totalNotes.tone,
				onActivate: () => void openFile(this.app, this.paths.readme("insights")),
			},
			{
				label: "今日执行",
				value: d.overview.taskFlow.value,
				detail: d.overview.taskFlow.sub,
				tone: d.overview.taskFlow.tone,
				onActivate: () =>
					void openFile(this.app, this.plugin.talosSettings.tasksPath),
			},
			{
				label: "系统健康",
				value: d.overview.health.value,
				detail:
					healthDelta === 0
						? d.overview.health.sub
						: `${healthDelta > 0 ? "较上次 +" : "较上次 "}${healthDelta}`,
				tone: d.overview.health.tone,
				onActivate: () =>
					void openFile(this.app, this.plugin.talosSettings.healthLogPath),
			},
			{
				label: "发布闭环",
				value: `${d.warRoom.published}/${d.warRoom.totalPub}`,
				detail: `冻结 ${d.warRoom.frozenDays} 天`,
				tone: d.warRoom.stopTriggered ? "hot" : "good",
				onActivate: () =>
					void openFile(this.app, this.plugin.talosSettings.talosTasksPath),
			},
		]);

		const trendPanel = this.panel(
			dataColumn,
			"#F472B6",
			"健康分趋势",
			"health-log · 近 9 次真实记录"
		);
		trendPanel.addClass("overview-v2-chart-panel");
		this.fillTrend(trendPanel, d.healthTrend);

		const distributionPanel = this.panel(
			dataColumn,
			"#34D399",
			"知识分布",
			`六大内容目录 · 共 ${d.total} 篇`
		);
		distributionPanel.addClass("overview-v2-chart-panel");
		this.fillDist(
			distributionPanel.createDiv({ cls: "barchart overview-v2-distribution" }),
			d.dist
		);

		const attentionColumn = primaryGrid.createDiv({
			cls: "overview-v2-column overview-v2-attention-column",
		});
		attentionColumn.setAttribute(
			"data-workbench-section",
			"attention-and-approvals"
		);

		const attentionPanel = this.panel(
			attentionColumn,
			this.overviewToneColor(primary.tone),
			"重要事项",
			attention.length > 0
				? `${attention.length} 项需要处理`
				: "当前没有阻塞性异常"
		);
		attentionPanel.addClass("overview-v2-attention-panel");
		const priority = attentionPanel.createDiv({
			cls: `overview-v2-priority tone-${primary.tone}`,
		});
		const priorityHead = priority.createDiv({ cls: "overview-v2-priority__head" });
		const priorityIcon = priorityHead.createSpan({
			cls: "overview-v2-priority__icon",
		});
		setIcon(priorityIcon, primary.icon);
		const priorityCopy = priorityHead.createDiv({
			cls: "overview-v2-priority__copy",
		});
		priorityCopy.createEl("small", {
			text: attention.length > 0 ? "第一优先级" : "下一步",
		});
		priorityCopy.createEl("h3", { text: primary.title });
		priority.createEl("p", { text: primary.detail });
		priority.createEl("span", { text: primary.meta });
		const priorityAction = priority.createEl("button", {
			cls: "module-hero-action overview-v2-priority__action",
			attr: { type: "button" },
		});
		setIcon(
			priorityAction.createSpan({ cls: "module-hero-action-icon" }),
			"arrow-up-right"
		);
		priorityAction.createSpan({ text: primary.action });
		priorityAction.addEventListener("click", () =>
			void openFile(this.app, primary.path)
		);
		this.renderOverviewAttentionRows(attentionPanel, attention.slice(1, 4));

		const approvalPanel = this.panel(
			attentionColumn,
			"var(--amber)",
			"审批工作区",
			pendingTotal > 0 ? `${pendingTotal} 项待决策` : "审批池已清空"
		);
		this.renderDecisionWorkspace(approvalPanel, d, 2);

		const kanbanPanel = this.panel(
			page,
			"#F59E0B",
			"任务进度看板",
			"待办 · 进行中 · 最近完成"
		);
		kanbanPanel.addClass("overview-v2-kanban-panel");
		kanbanPanel.setAttribute("data-workbench-section", "task-kanban");
		this.fillOverviewKanban(kanbanPanel, d);

		const utilityGrid = page.createDiv({ cls: "overview-v2-utility-grid" });
		const actionRuntimePanel = this.panel(
			utilityGrid,
			"#38E1FF",
			"可执行动作",
			"A 直接执行 · C 提案后审批"
		);
		actionRuntimePanel.setAttribute("data-workbench-section", "runtime-actions");
		const actionStamp = Date.now();
		this.actionPanel = new ConsoleActionPanel({
			parent: actionRuntimePanel,
			runtime: this.plugin.getConsoleActionRuntime(),
			actions: [
				{
					actionId: "refresh-stats",
					idempotencyKey: `overview-refresh-${actionStamp}`,
					input: undefined,
					request: {
						readPaths: ["**"],
						writePaths: [],
						effects: ["read"],
					},
					proposal: {
						title: "刷新统计",
						provider: "TALOS 本地运行时",
						steps: ["重新读取 Vault 统计", "刷新当前控制台"],
						fileCount: 0,
						keyDiffs: ["只读动作，不修改文件"],
						reversible: false,
					},
				},
				{
					actionId: "vault-lint",
					idempotencyKey: `overview-lint-${actionStamp}`,
					input: undefined,
					request: {
						readPaths: ["**"],
						writePaths: [],
						effects: ["read"],
					},
					proposal: {
						title: "只读 Vault Lint",
						provider: "TALOS 本地运行时",
						steps: ["扫描 Markdown 元数据", "报告结构化检查结果"],
						fileCount: 0,
						keyDiffs: ["只读动作，不生成报告文件"],
						reversible: false,
					},
				},
				{
					actionId: "deep-research",
					idempotencyKey: `overview-research-${actionStamp}`,
					input: undefined,
					request: {
						readPaths: ["**"],
						writePaths: ["<external>"],
						effects: ["external-publish"],
					},
					proposal: {
						title: "启动 Deep Research",
						provider: "当前 Agent 命令",
						steps: [
							"展示本次外部执行范围",
							"等待独立批准",
							"进入 10 秒可取消安全窗口",
							"批准后调用同一 TALOS runner",
						],
						fileCount: 1,
						keyDiffs: [
							`研究结果将写入 ${this.plugin.talosSettings.reportsFolder}`,
						],
						reversible: false,
					},
				},
			],
		});
		this.actionPanel.mount();

		const quickNotePanel = this.panel(
			utilityGrid,
			"#A78BFA",
			"快捷便签",
			"B 类可恢复写入 · ⌘/Ctrl + Enter 保存"
		);
		quickNotePanel.setAttribute("data-workbench-section", "quick-note");
		new QuickNote({
			parent: quickNotePanel,
			runtime: this.plugin.getConsoleActionRuntime(),
			targetFolder: this.paths.dir("inbox"),
		}).mount();
	}

	private collectOverviewAttention(d: Collected): OverviewAttention[] {
		const items: OverviewAttention[] = [];
		if (d.warRoom.stopTriggered) {
			items.push({
				title: "发布停止条件已触发",
				meta: `${d.warRoom.frozenDays} 天未形成发布闭环 · 高优先级`,
				detail:
					"当前发布节奏已经触发重估条件。继续建设前，先决定恢复发布、调整目标或正式暂停。",
				action: "打开发布任务",
				path: this.plugin.talosSettings.talosTasksPath,
				icon: "octagon-alert",
				tone: "hot",
			});
		}
		if (d.approvals.length > 0) {
			items.push({
				title: `待审批变更 ${d.approvals.length} 项`,
				meta: `${d.approvals[0]?.title || "B/C 类变更"} · 需要决策`,
				detail:
					"这些变更不会自动执行。先处理会阻塞当前工作流或影响身份、规则与系统结构的提案。",
				action: "进入审批池",
				path: this.plugin.talosSettings.pendingApprovalsPath,
				icon: "clipboard-check",
				tone: "warn",
			});
		}
		if (d.inbox.count > 0) {
			items.push({
				title: `收件箱积压 ${d.inbox.count} 篇`,
				meta: `最老 ${d.inbox.oldestDays} 天 · 建议运行 /intake`,
				detail:
					"优先处理长期滞留条目，避免收件箱变成第二个无人维护的知识库。",
				action: "打开收件箱",
				path: this.paths.readme("inbox"),
				icon: "inbox",
				tone: d.inbox.oldestDays >= 7 ? "hot" : "warn",
			});
		}
		if (d.candidates.length > 0) {
			items.push({
				title: `偏好候选 ${d.candidates.length} 条`,
				meta: "待确认 · 运行 /digest 晋升或退回",
				detail:
					"候选偏好尚未成为稳定规则。集中确认，避免未经验证的信号长期悬空。",
				action: "打开候选池",
				path: this.plugin.talosSettings.candidatesPath,
				icon: "list-checks",
				tone: "default",
			});
		}
		return items;
	}

	private overviewToneColor(
		tone: OverviewAttention["tone"] | "good"
	): string {
		if (tone === "hot") return "var(--rose)";
		if (tone === "warn") return "var(--amber)";
		if (tone === "good") return "var(--green)";
		return "var(--blue)";
	}

	private renderOverviewAttentionRows(
		parent: HTMLElement,
		items: OverviewAttention[]
	): void {
		const list = parent.createDiv({ cls: "overview-v2-attention-list" });
		if (items.length === 0) {
			list.createDiv({
				cls: "ok",
				text: "其余巡检项正常，暂无需要展开的异常。",
			});
			return;
		}
		for (const item of items) {
			const row = list.createDiv({
				cls: `overview-v2-attention-row tone-${item.tone}`,
			});
			row.setAttribute("role", "button");
			row.setAttribute("tabindex", "0");
			row.setAttribute("aria-label", `${item.title}：${item.action}`);
			const icon = row.createSpan({ cls: "overview-v2-attention-row__icon" });
			setIcon(icon, item.icon);
			const copy = row.createDiv({ cls: "overview-v2-attention-row__copy" });
			copy.createEl("strong", { text: item.title });
			copy.createEl("span", { text: item.meta });
			const arrow = row.createSpan({ cls: "overview-v2-attention-row__arrow" });
			setIcon(arrow, "chevron-right");
			const activate = () => void openFile(this.app, item.path);
			row.addEventListener("click", activate);
			row.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				activate();
			});
		}
	}

	private async pageChat(page: HTMLElement): Promise<void> {
		try {
			if (!this.chatSurface) {
				// D-TLP-014/D-TLP-015：对话页为双通道滑动切换器——
				// DeepSeek Harness（iframe 嵌入 dsh web 桌面界面）｜
				// Codex 工作台（claudian codex 内核，经适配器挂回）。
				// claudian 工作台另保留独立恢复视图（命令 open-quyuan-v2-recovery）。
				const { HarnessWorkbench } = await import(
					"./harness/harness-workbench"
				);
				const { ClaudianCodexWorkbench } = await import(
					"./harness/claudian-codex-workbench"
				);
				const { HarnessSwitcherWorkbench, normalizeHarnessSurface } =
					await import("./harness/harness-switcher");
				this.chatSurface = new TalosChatSurface(
					new HarnessSwitcherWorkbench({
						channels: [
							{
								id: "dsh",
								label: "DeepSeek Harness",
								workbench: new HarnessWorkbench({
									manager: this.plugin.getHarnessManager(),
								}),
							},
							{
								id: "codex",
								label: "Codex 工作台",
								workbench: new ClaudianCodexWorkbench({
									leaf: this.leaf,
									plugin: this.plugin,
								}),
							},
						],
						getActiveId: () =>
							normalizeHarnessSurface(
								this.plugin.talosSettings.harnessSurface
							),
						setActiveId: (id) => {
							this.plugin.talosSettings.harnessSurface = id;
							void this.plugin.saveTalosSettings();
						},
						getSwitchHost: () => this.chatSwitchHostEl,
					})
				);
			}
			if (!this.chatSurface) throw new Error("AI 对话 surface 未创建");
			await this.chatSurface.mount(page, "chat");
			if (this.activePage !== "chat") {
				await this.chatSurface.unmount();
				return;
			}
			this.chatMounted = true;
		} catch (error) {
			console.error("TALOS AI chat surface failed to mount", error);
			this.chatMounted = false;
			page.empty();
			const panel = page.createDiv({
				cls: "panel talos-chat-migration-panel",
			});
			panel.setCssProps({ "--ac": "#7C3AED" });
			const icon = panel.createDiv({ cls: "talos-chat-migration-icon" });
			setIcon(icon, "triangle-alert");
			const copy = panel.createDiv({ cls: "talos-chat-migration-copy" });
			copy.createEl("h2", { text: "AI 对话加载失败" });
			copy.createEl("p", {
				text: error instanceof Error ? error.message : String(error),
			});
			copy.createEl("small", {
				text: "独立 Claudian 恢复视图仍保留，当前失败不会修改 Vault 内容。",
			});
		}
	}

	private pageSettings(page: HTMLElement): void {
		const shell = page.createDiv({ cls: "talos-inline-settings" });
		const header = shell.createEl("header", {
			cls: "talos-inline-settings__header",
		});
		const identity = header.createDiv({
			cls: "talos-inline-settings__identity",
		});
		const icon = identity.createSpan({ cls: "talos-inline-settings__icon" });
		setIcon(icon, "settings");
		const title = identity.createDiv({ cls: "talos-inline-settings__title" });
		title.createEl("h1", { text: "TALOS 设置" });
		title.createEl("p", {
			text: "界面、目录映射、数据源、AI Provider 与屈原工作台配置",
		});
		const status = header.createDiv({
			cls: "talos-inline-settings__status",
		});
		status.createSpan({ cls: "talos-inline-settings__status-dot" });
		const statusCopy = status.createSpan({
			cls: "talos-inline-settings__status-copy",
		});
		statusCopy.createEl("strong", { text: "本地配置" });
		statusCopy.createEl("small", { text: "修改后自动保存" });
		const body = shell.createDiv({
			cls: "talos-inline-settings__body",
		});
		this.embeddedSettingsTab ??= new TalosSettingTab(this.app, this.plugin);
		this.embeddedSettingsTab.renderInto(body);
		body.addClass("talos-settings--console");
	}

	private async pageJarvis(page: HTMLElement): Promise<void> {
		try {
			page.empty();
			page.createDiv({ cls: "empty", text: "屈原模块加载中…" });
			const { QuyuanVoicePanel } = await import("./quyuan/voice-panel");
			if (this.activePage !== "jarvis") return;
			page.empty();
			if (!this.jarvis) {
				this.jarvis = new QuyuanVoicePanel(
					this.app,
					this.plugin,
					this.plugin.talosSettings,
					() => this.plugin.saveTalosSettings(),
					(pageKey) => this.navigateToPage(pageKey)
				);
			}
			this.jarvis.mount(page);
			this.jarvisMounted = true;
		} catch (error) {
			console.error("TALOS Quyuan voice panel failed to mount", error);
			this.unmountJarvisSafely();
			this.jarvis = null;
			page.empty();
			const panel = page.createDiv({ cls: "panel quyuan-error-panel" });
			const icon = panel.createDiv({ cls: "quyuan-error-icon" });
			setIcon(icon, "triangle-alert");
			const copy = panel.createDiv({ cls: "quyuan-error-copy" });
			copy.createEl("h2", { text: "屈原模块加载失败" });
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
			retry.addEventListener("click", () => this.renderPage());
			const workbench = actions.createEl("button", {
				cls: "module-hero-action",
				attr: { type: "button" },
			});
			setIcon(workbench.createSpan({ cls: "module-hero-action-icon" }), "maximize-2");
			workbench.createSpan({ text: "打开完整工作台" });
			workbench.addEventListener("click", () => void this.plugin.activateQuyuanV2View());
			new Notice("屈原模块加载失败，已显示恢复入口。");
		}
	}

	private pageDaily(page: HTMLElement, d: Collected): void {
		const now = new Date();
		const minsNow = now.getHours() * 60 + now.getMinutes();
		const rota = this.dailyRota();
		const today = rota.find((item) => item.day === now.getDay()) || rota[0];
		const primary = d.focus[0];
		const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;
		const victory =
			primary?.doneWhen || "先跑 /morning，把今天的 done_when 写进 tasks.md";

		this.moduleHero(page, {
			ac: "#4D8DFF",
			icon: "calendar-check",
			eyebrow: `DAILY EXECUTION · ${dateLabel}`,
			title: "每日执行",
			desc: "把今天压成一个胜利条件、两个深度块和一次收工回填。",
			stats: [
				{
					label: "唯一胜利",
					value: primary ? "已锁定" : "待设置",
					sub: primary ? victory : "复制 /morning 后写入 done_when",
					path: primary?.path || this.plugin.talosSettings.tasksPath,
					tone: primary ? "good" : "warn",
				},
				{
					label: "周轮值",
					value: today?.project || "周轮值项目",
					sub: today?.label || "今日深度块 02",
					path: today?.path || this.paths.readme("projects"),
					tone: "default",
				},
				{
					label: "当前焦点",
					value: `${d.focus.length} 项`,
					sub: "tasks.md 活跃焦点",
					path: this.plugin.talosSettings.tasksPath,
					tone: d.focus.length > 0 ? "good" : "warn",
				},
			],
			actions: [
				{ label: "开工", icon: "play", command: "开工" },
				{ label: "晨间", icon: "sunrise", command: "/morning" },
				{
					label: "任务池",
					icon: "list-checks",
					path: this.plugin.talosSettings.tasksPath,
				},
			],
		});

		const primaryGrid = page.createDiv({
			cls: "workflow-v2-primary daily-v2-primary",
		});
		primaryGrid.setAttribute("data-workflow-layout", "split");

		const timelinePanel = this.panel(
			primaryGrid,
			"#38E1FF",
			"今日执行节奏",
			"ZERO DECISION TIMELINE"
		);
		timelinePanel.setAttribute("data-workflow-section", "core-data");
		const timeline = timelinePanel.createDiv({ cls: "daily-timeline" });
		for (const slot of this.dailyTimeline()) {
			const slotPath =
				slot.time === "08:30"
					? this.plugin.talosSettings.tasksPath
					: slot.time === "14:00"
						? today?.path || slot.path
						: slot.path;
			const slotDesc =
				slot.time === "14:00"
					? `${today?.label || "今日"}推进「${today?.project || "周轮值项目"}」的一个可见结果。`
					: slot.desc;
			const state =
				minsNow >= slot.mins + slot.dur
					? "done"
					: minsNow >= slot.mins
						? "now"
						: "todo";
			const item = timeline.createDiv({
				cls: `daily-slot daily-item${slot.deep ? " is-deep" : ""} is-${state}`,
			});
			const time = item.createDiv({ cls: "daily-slot-time" });
			time.createEl("b", { text: slot.time });
			time.createEl("small", { text: slot.length });
			const body = item.createDiv({ cls: "daily-slot-body" });
			body.createEl("h3", { text: slot.title });
			body.createEl("p", { text: slotDesc });
			body.createEl("span", { text: slot.starter });
			item.createSpan({
				cls: `daily-slot-badge is-${state}`,
				text:
					state === "done"
						? "已完成"
						: state === "now"
							? "进行中"
							: "待开始",
			});
			item.addEventListener("click", () => void openFile(this.app, slotPath));
		}

		const cockpit = this.panel(
			primaryGrid,
			"#FB7185",
			"当前战役",
			`IMPORTANT ACTIONS · ${dateLabel}`
		);
		cockpit.addClass("daily-cockpit");
		cockpit.setAttribute("data-workflow-section", "attention-and-actions");
		const overview = cockpit.createDiv({ cls: "daily-overview" });
		const win = overview.createDiv({
			cls: `daily-win${primary ? " daily-item" : ""}`,
		});
		win.createEl("small", { text: "今日唯一胜利条件" });
		win.createEl("strong", { text: victory });
		if (primary) {
			win.createEl("span", {
				text: `${primary.title}${primary.desc ? ` · ${primary.desc}` : ""}`,
			});
			win.addEventListener("click", () =>
				void openFile(
					this.app,
					primary.path || this.plugin.talosSettings.tasksPath
				)
			);
		} else {
			win.createEl("span", { text: "尚未锁定焦点，先运行晨间流程。" });
		}

		const route = overview.createDiv({ cls: "daily-route" });
		const routeItem = (label: string, value: string, path: string) => {
			const item = route.createDiv({ cls: "daily-route-item daily-item" });
			item.createEl("small", { text: label });
			item.createEl("b", { text: value });
			item.addEventListener("click", () => void openFile(this.app, path));
		};
		routeItem("深度块 01", "输出闭环", this.paths.outletFile);
		routeItem(
			"深度块 02",
			today?.project || "周轮值项目",
			today?.path || this.plugin.talosSettings.tasksPath
		);
		routeItem(
			"当前焦点",
			`${d.focus.length} 项`,
			this.plugin.talosSettings.tasksPath
		);

		const actions = cockpit.createDiv({ cls: "daily-actions" });
		for (const action of [
			{ label: "开工", command: "开工", desc: "接收今天第一步", icon: "play" },
			{
				label: "晨间",
				command: "/morning",
				desc: "简报与焦点确认",
				icon: "sunrise",
			},
			{
				label: "收工",
				command: "收工",
				desc: "回填并铺好明天",
				icon: "square",
			},
			{
				label: "记忆",
				command: "/memory",
				desc: "保存实质碎片",
				icon: "brain",
			},
		]) {
			const button = actions.createEl("button", {
				cls: "daily-command daily-item",
			});
			button.type = "button";
			const icon = button.createSpan({ cls: "daily-command-icon" });
			setIcon(icon, action.icon);
			const copy = button.createSpan({ cls: "daily-command-copy" });
			copy.createEl("b", { text: action.label });
			copy.createEl("small", { text: action.desc });
			button.addEventListener("click", () => void this.copyText(action.command));
		}

		const supportGrid = page.createDiv({
			cls: "workflow-v2-secondary daily-v2-secondary",
		});
		const rails = this.panel(
			supportGrid,
			"#F472B6",
			"执行铁轨",
			"RULES · ACTIVE FOCUS"
		);
		rails.setAttribute("data-workflow-section", "supporting-rules");
		const railList = rails.createDiv({ cls: "daily-rails" });
		for (const rail of [
			{
				title: "主轨 · 输出闭环",
				desc: "每天优先推动一条内容走到发布、排期或回填。",
			},
			{
				title: "副轨 · 周轮值项目",
				desc: "项目推进不靠心情，轮到谁就推进谁的一个结果。",
			},
			{
				title: "回轨 · 收工记忆",
				desc: "未完成不内耗，只记录阻塞原因与明早第一步。",
			},
			{
				title: "硬刹车",
				desc: "没发之前，不扩建发布系统；输入处理不清仓。",
			},
		]) {
			const item = railList.createDiv({ cls: "daily-rail" });
			item.createEl("b", { text: rail.title });
			item.createEl("span", { text: rail.desc });
		}

		const focusList = rails.createDiv({ cls: "daily-focus-list" });
		if (d.focus.length === 0) {
			renderTalosEmptyState(
				focusList,
				"暂无活跃焦点",
				"打开任务池写下今天唯一的 done_when。",
				{
					label: "打开任务池",
					icon: "list-checks",
					onActivate: () =>
						void openFile(this.app, this.plugin.talosSettings.tasksPath),
				}
			);
		} else {
			for (const focus of d.focus) {
				const item = focusList.createDiv({
					cls: `daily-focus daily-item level-${focus.level}`,
				});
				item.createEl("b", { text: focus.title });
				if (focus.doneWhen) {
					item.createEl("small", {
						text: `done_when · ${focus.doneWhen}`,
					});
				} else if (focus.desc) {
					item.createEl("small", { text: focus.desc });
				}
				item.addEventListener("click", () =>
					void openFile(
						this.app,
						focus.path || this.plugin.talosSettings.tasksPath
					)
				);
			}
		}

		const guide = this.panel(
			supportGrid,
			"#FBBF24",
			"执行协议与入口",
			"FOUR SWITCHES · LIVE FILES"
		);
		guide.addClass("daily-v2-guide");
		guide.setAttribute("data-workflow-section", "protocol-and-entry");
		const protocolGrid = guide.createDiv({ cls: "daily-protocol" });
		for (const item of [
			["唯一胜利条件", "一天只盯第一个 done_when，其他进展都是 bonus。"],
			["先发后修", "公开发布没破零前，新模板与新基建默认延后。"],
			["周几替你选", "第二深度块由周轮值表决定，不现场挑项目。"],
			["明早第一步", "收工时必须写下明早第一个动作。"],
		]) {
			const card = protocolGrid.createDiv({ cls: "daily-proto" });
			card.createEl("b", { text: item[0] });
			card.createEl("span", { text: item[1] });
		}

		const entryHead = guide.createDiv({ cls: "workflow-v2-subhead" });
		entryHead.createEl("strong", { text: "快速入口" });
		entryHead.createEl("span", { text: "点击进入原始文件" });
		const map = guide.createDiv({ cls: "daily-map" });
		for (const node of [
			{
				label: "每日操作系统",
				desc: "原始说明与规则",
				path: "每日操作系统.md",
				icon: "calendar-check",
			},
			{
				label: "tasks.md",
				desc: "焦点与 done_when",
				path: this.plugin.talosSettings.tasksPath,
				icon: "list-checks",
			},
			{
				label: "输出统一出口",
				desc: "发布前唯一队列",
				path: this.paths.outletFile,
				icon: "send",
			},
			{
				label: "运营候选池",
				desc: "发布后反馈池",
				path: this.paths.opsCandidatesFile,
				icon: "activity",
			},
			{
				label: "CONTEXT",
				desc: "近期状态与项目台账",
				path: this.paths.contextFile,
				icon: "scan-text",
			},
		]) {
			const card = map.createDiv({ cls: "daily-node daily-item" });
			const icon = card.createSpan({ cls: "daily-node-icon" });
			setIcon(icon, node.icon);
			const copy = card.createDiv();
			copy.createEl("b", { text: node.label });
			copy.createEl("span", { text: node.desc });
			card.addEventListener("click", () => void openFile(this.app, node.path));
		}

		const weekPanel = this.panel(
			page,
			"#A78BFA",
			"周轮值表 · 深度块②",
			"WEEK ROUTER"
		);
		weekPanel.addClass("daily-v2-week-panel");
		const week = weekPanel.createDiv({ cls: "daily-week" });
		for (const item of rota) {
			const day = week.createDiv({
				cls: `daily-day daily-item${item.day === now.getDay() ? " is-today" : ""}`,
			});
			day.createEl("small", { text: `${item.code} · ${item.label}` });
			day.createEl("b", { text: item.project });
			day.createEl("span", { text: item.desc });
			day.addEventListener("click", () => void openFile(this.app, item.path));
		}
	}

	private pageOutput(page: HTMLElement, d: Collected): void {
		const pending =
			d.output.metrics.find((item) => item.label === "今日待发") ||
			d.output.metrics[0];
		const platformMetric =
			d.output.metrics.find((item) => item.label === "平台稿件") ||
			d.output.metrics[1];
		const opsMetric =
			d.output.metrics.find((item) => item.label === "运营候选") ||
			d.output.metrics[2];

		this.moduleHero(page, {
			ac: "#FB7185",
			icon: "send",
			eyebrow: "OUTPUT WAR ROOM",
			title: "输出作战室",
			desc: "从统一出口到五平台分发，把待发、发布、回填放在同一条线上看。",
			stats: [
				{
					label: pending?.label || "今日待发",
					value: pending?.value || "0",
					sub: pending?.sub,
					path: pending?.path,
					tone: pending?.tone || "default",
				},
				{
					label: platformMetric?.label || "平台稿件",
					value: platformMetric?.value || "0",
					sub: platformMetric?.sub,
					path: platformMetric?.path,
					tone: platformMetric?.tone || "default",
				},
				{
					label: opsMetric?.label || "运营候选",
					value: opsMetric?.value || "0",
					sub: opsMetric?.sub,
					path: opsMetric?.path,
					tone: opsMetric?.tone || "default",
				},
			],
			actions: [
				{
					label: "统一出口",
					icon: "external-link",
					path: this.paths.outletFile,
				},
				{ label: "输出流", icon: "copy", command: "/output" },
				{
					label: "运营池",
					icon: "activity",
					path: this.paths.opsCandidatesFile,
				},
			],
		});

		const primary = page.createDiv({
			cls: "workflow-v2-primary output-v2-primary",
		});
		primary.setAttribute("data-workflow-layout", "split");

		const closure = this.panel(
			primary,
			"#34D399",
			"平台闭环分布",
			"已发布 · 待闭环 · 未分类"
		);
		closure.setAttribute("data-workflow-section", "core-data");
		this.fillOutputClosureChart(
			closure.createDiv({ cls: "output-v2-closure-chart" }),
			d.output.platforms
		);

		const attention = this.panel(
			primary,
			"#FB7185",
			"今日关注",
			"待发队列 · 运营候选"
		);
		attention.addClass("output-v2-attention-panel");
		attention.setAttribute(
			"data-workflow-section",
			"attention-and-actions"
		);
		for (const group of [
			{
				title: "今日待发",
				meta: this.paths.outletFile,
				items: d.output.queue,
				empty: "统一出口暂无待发条目",
			},
			{
				title: "运营候选",
				meta: "发布后观察 · 待确认",
				items: d.output.opsCandidates,
				empty: "暂无待确认运营候选",
			},
		]) {
			const section = attention.createDiv({
				cls: "output-v2-attention-group",
			});
			const head = section.createDiv({
				cls: "output-v2-attention-group__head",
			});
			head.createEl("strong", { text: group.title });
			head.createEl("span", {
				text: `${group.items.length} · ${group.meta}`,
			});
			this.fillSignalList(
				section.createDiv({ cls: "detail-list" }),
				group.items,
				group.empty
			);
		}

		const platforms = this.panel(
			page,
			"#38E1FF",
			"平台分发明细",
			"抖音 / 小红书 / X / 公众号 / 知识星球"
		);
		platforms.addClass("output-v2-platform-panel");
		platforms.setAttribute("data-workflow-section", "platform-details");
		this.fillPlatforms(
			platforms.createDiv({ cls: "platform-grid" }),
			d.output.platforms
		);
	}

	private pageTalos(page: HTMLElement, d: Collected): void {
		const assets =
			d.talosProduct.metrics.find(
				(item) => item.label === "TALOS 资产"
			) || d.talosProduct.metrics[0];
		const delivery =
			d.talosProduct.metrics.find(
				(item) => item.label === "交付 SOP"
			) || d.talosProduct.metrics[1];
		const consoleMod =
			d.talosProduct.metrics.find(
				(item) => item.label === "控制台"
			) || d.talosProduct.metrics[2];
		const allGates = [...d.warRoom.gates, ...d.warRoom.pubActions];

		this.moduleHero(page, {
			ac: "#1D4ED8",
			icon: "filter",
			eyebrow: "TALOS PRODUCT",
			title: "TALOS 产品",
			desc: "产品分区、发布闸门和交付资产集中巡航，避免产品推进散在不同文件里。",
			stats: [
				{
					label: "发布状态",
					value: d.warRoom.stopTriggered ? "暂停" : "可推进",
					sub: `${d.warRoom.published}/${d.warRoom.totalPub} 发布动作完成`,
					path: `${this.paths.talosProjectDir}/tasks.md`,
					tone: d.warRoom.stopTriggered ? "hot" : "good",
				},
				{
					label: assets?.label || "TALOS 资产",
					value: assets?.value || "0",
					sub: assets?.sub,
					path: assets?.path,
					tone: assets?.tone || "default",
				},
				{
					label: delivery?.label || "交付 SOP",
					value: delivery?.value || "0",
					sub: delivery?.sub,
					path: delivery?.path,
					tone: delivery?.tone || "default",
				},
				{
					label: consoleMod?.label || "控制台",
					value: consoleMod?.value || "0",
					sub: consoleMod?.sub,
					path: consoleMod?.path,
					tone: consoleMod?.tone || "default",
				},
			],
			actions: [
				{
					label: "任务闸门",
					icon: "list-checks",
					path: `${this.paths.talosProjectDir}/tasks.md`,
				},
				{
					label: "产品地图",
					icon: "map",
					path: `${this.paths.talosProjectDir}/_README.md`,
				},
				{ label: "发布流", icon: "copy", command: "/output" },
			],
		});

		const primary = page.createDiv({
			cls: "workflow-v2-primary talos-v2-primary",
		});
		primary.setAttribute("data-workflow-layout", "split");

		const release = this.panel(
			primary,
			d.warRoom.stopTriggered ? "#FB7185" : "#4D8DFF",
			"发布态势",
			"发布动作 · 冻结天数 · 闸门状态分布"
		);
		release.addClass("talos-v2-release-panel");
		release.setAttribute("data-workflow-section", "core-data");
		const banner = release.createDiv({
			cls: "banner talos-v2-release-banner",
		});
		banner.setCssProps({
			"--ac": d.warRoom.stopTriggered ? "#FB7185" : "#4D8DFF",
		});
		this.fillBanner(banner, d.warRoom);
		this.fillGateStateChart(
			release.createDiv({ cls: "talos-v2-gate-chart" }),
			allGates
		);

		const gates = this.panel(
			primary,
			"#FBBF24",
			"关键闸门",
			d.warRoom.stopTriggered
				? "停止条件已触发 · 先处理阻塞"
				: "G1–G7 · PUB-W"
		);
		gates.addClass("talos-v2-gate-panel");
		gates.setAttribute(
			"data-workflow-section",
			"attention-and-actions"
		);
		const gateGroups: Array<[string, string, GateItem[]]> = [
			["统一七门", "G1–G7", d.warRoom.gates],
			["内容发布动作", "PUB-W · 非产品发布门", d.warRoom.pubActions],
		];
		for (const [title, meta, items] of gateGroups) {
			const section = gates.createDiv({
				cls: "talos-v2-gate-group",
			});
			const head = section.createDiv({
				cls: "talos-v2-gate-group__head",
			});
			head.createEl("strong", { text: title });
			head.createEl("span", {
				text: `${items.filter((item) => item.state === "blocked").length} 阻塞 · ${meta}`,
			});
			this.fillGates(section.createDiv({ cls: "gates" }), items);
		}

		const modules = this.panel(
			page,
			"#4D8DFF",
			"产品分区",
			"理论 / 品牌 / 内容 / 产品 / 获客 / 交付 / 控制台"
		);
		modules.addClass("talos-v2-module-panel");
		modules.setAttribute("data-workflow-section", "product-modules");
		this.fillTalosModules(
			modules.createDiv({ cls: "module-grid" }),
			d.talosProduct.modules
		);
	}

	private pageInbox(page: HTMLElement, d: Collected): void {
		const rankedClusters = [...d.inbox.clusters].sort(
			(left, right) => right.count - left.count
		);
		const priorityCluster = rankedClusters[0];

		this.moduleHero(page, {
			ac: "#FBBF24",
			icon: "inbox",
			eyebrow: "INTAKE DIGEST",
			title: "收件箱",
			desc: "先看积压、年龄和主题包，再决定今天是归档、消化，还是只挑高价值条目。",
			stats: [
				{
					label: "待处理",
					value: String(d.inbox.count),
					sub: `${d.inbox.oldestDays}d oldest`,
					path: this.paths.readme("inbox"),
					tone: d.inbox.count > 0 ? "warn" : "good",
				},
				{
					label: "主题包",
					value: String(d.inbox.clusters.length),
					sub: "按标题自动聚类",
					path: this.paths.readme("inbox"),
					tone: "default",
				},
				{
					label: "最近进入",
					value: `${d.inbox.recent.length} 条`,
					sub: "最近改动的收件箱文件",
					path: this.paths.readme("inbox"),
					tone: d.inbox.recent.length > 0 ? "default" : "good",
				},
			],
			actions: [
				{ label: "开始归档", icon: "copy", command: "/intake" },
				{ label: "消化偏好", icon: "copy", command: "/digest" },
				{
					label: "收件地图",
					icon: "external-link",
					path: this.paths.readme("inbox"),
				},
			],
		});

		const triage = page.createDiv({
			cls: "workflow-v2-primary inbox-v2-primary",
		});
		triage.setAttribute("data-workflow-layout", "split");

		const age = this.panel(
			triage,
			"#FBBF24",
			"积压年龄",
			"0–3D · 4–7D · 8–14D · >14D"
		);
		age.setAttribute("data-workflow-section", "core-data");
		if (d.inbox.count > 0) {
			this.fillInboxAgeDist(age.createDiv({ cls: "age-dist" }), d.inbox);
		} else {
			renderTalosEmptyState(
				age,
				"收件箱已清空",
				"当前没有需要分诊的内容，新的输入会继续进入这里。",
				{
					label: "打开收件箱",
					icon: "inbox",
					onActivate: () =>
						void openFile(this.app, this.paths.readme("inbox")),
				}
			);
		}

		const clusters = this.panel(
			triage,
			"#38E1FF",
			"主题分诊",
			priorityCluster
				? `按规模排序 · 先处理「${priorityCluster.name}」`
				: "暂无待消化主题"
		);
		clusters.setAttribute(
			"data-workflow-section",
			"attention-and-actions"
		);
		this.fillInboxClusters(
			clusters.createDiv({ cls: "cluster-grid" }),
			rankedClusters
		);

		const recent = this.panel(
			page,
			"#A78BFA",
			"最近进入",
			"第三层入口 · 点击打开原文件"
		);
		recent.addClass("inbox-v2-recent-panel");
		recent.setAttribute("data-workflow-section", "recent-entry");
		this.fillSignalList(
			recent.createDiv({ cls: "detail-list" }),
			d.inbox.recent,
			"收件箱已清空"
		);
	}

	private pageHealth(page: HTMLElement, d: Collected): void {
		const health =
			d.healthDigest.metrics.find((item) => item.label === "健康分") ||
			d.healthDigest.metrics[0];
		const approvals =
			d.healthDigest.metrics.find((item) => item.label === "待审批") ||
			d.healthDigest.metrics[1];
		const candidates =
			d.healthDigest.metrics.find((item) => item.label === "偏好候选") ||
			d.healthDigest.metrics[2];
		const pendingTotal = d.approvals.length + d.candidates.length;

		if (health && d.healthTrend.length > 1) {
			const last = d.healthTrend[d.healthTrend.length - 1];
			const previous = d.healthTrend[d.healthTrend.length - 2];
			const delta = (last?.score ?? 0) - (previous?.score ?? 0);
			health.aux =
				delta > 0
					? `↑ ${delta} vs 上次`
					: delta < 0
						? `↓ ${Math.abs(delta)} vs 上次`
						: "→ 持平";
		}
		if (approvals && d.approvals.length === 0) approvals.aux = "清空";

		this.moduleHero(page, {
			ac: "#34D399",
			icon: "activity",
			eyebrow: "SYSTEM HEALTH",
			title: "系统健康",
			desc: "把健康分、审批池、偏好候选和错误模式放到同一屏，优先处理会卡住系统的风险。",
			stats: [
				{
					label: health?.label || "健康分",
					value: health?.value || "—",
					sub: health?.sub,
					path: health?.path,
					tone: health?.tone || "default",
				},
				{
					label: approvals?.label || "待审批",
					value: approvals?.value || "0",
					sub: approvals?.sub,
					path: approvals?.path,
					tone: approvals?.tone || "default",
				},
				{
					label: candidates?.label || "偏好候选",
					value: candidates?.value || "0",
					sub: candidates?.sub,
					path: candidates?.path,
					tone: candidates?.tone || "default",
				},
			],
			actions: [
				{
					label: "健康日志",
					icon: "external-link",
					path: this.plugin.talosSettings.healthLogPath,
				},
				{
					label: "审批池",
					icon: "clipboard-list",
					path: this.plugin.talosSettings.pendingApprovalsPath,
				},
				{ label: "快检", icon: "copy", command: "/maintain quick" },
			],
		});

		const primary = page.createDiv({
			cls: "system-v2-primary health-v2-primary",
		});
		primary.setAttribute("data-system-layout", "split");

		const trend = this.panel(
			primary,
			"#F472B6",
			"健康分趋势",
			"health-log · 近 9 次"
		);
		trend.addClass("health-v2-trend-panel");
		trend.setAttribute("data-system-section", "core-data");
		this.fillTrend(trend, d.healthTrend);

		const decisions = this.panel(
			primary,
			"#FBBF24",
			"审批与偏好",
			pendingTotal > 0
				? `${pendingTotal} 项可直接处理`
				: "审批池已清空"
		);
		decisions.setAttribute(
			"data-system-section",
			"attention-and-actions"
		);
		this.renderDecisionWorkspace(decisions, d, 3);

		const diagnostics = page.createDiv({
			cls: "system-v2-secondary health-v2-diagnostics",
		});
		const loops = this.panel(
			diagnostics,
			"#38E1FF",
			"循环状态",
			"loop-health-log"
		);
		this.fillSignalList(
			loops.createDiv({ cls: "detail-list" }),
			d.healthDigest.loopStatus,
			"暂无循环状态记录"
		);
		const errors = this.panel(
			diagnostics,
			"#FB7185",
			"错误模式",
			d.healthDigest.errors.length > 0
				? `${d.healthDigest.errors.length} 项需要诊断`
				: "error-patterns · 当前清空"
		);
		this.fillSignalList(
			errors.createDiv({ cls: "detail-list" }),
			d.healthDigest.errors,
			"暂无活跃错误模式"
		);
	}

	private pageProjects(page: HTMLElement, d: Collected): void {
		const p0Count = d.projects.filter(
			(project) => project.priority === "p0"
		).length;
		const projectNotes = d.projects.reduce(
			(sum, project) => sum + project.count,
			0
		);
		const priorityOrder: Record<ProjectScene["priority"], number> = {
			p0: 0,
			p1: 1,
			p2: 2,
		};
		const rankedProjects = [...d.projects].sort(
			(left, right) =>
				priorityOrder[left.priority] - priorityOrder[right.priority] ||
				right.count - left.count
		);

		this.moduleHero(page, {
			ac: "#F59E0B",
			icon: "folder-kanban",
			eyebrow: "PROJECT SCENES",
			title: "项目场景",
			desc: "按活跃度和优先级扫项目，先让高频项目露头，再进入具体场景推进。",
			stats: [
				{
					label: "项目数",
					value: String(d.projects.length),
					sub: `${this.paths.dir("projects")} 子场景`,
					path: this.paths.readme("projects"),
					tone: "default",
				},
				{
					label: "高频项目",
					value: String(p0Count),
					sub: "P0 场景优先推进",
					path: this.paths.sceneIndexFile,
					tone: p0Count > 0 ? "hot" : "default",
				},
				{
					label: "项目笔记",
					value: String(projectNotes),
					sub: "不含 README",
					path: this.paths.readme("projects"),
					tone: "good",
				},
			],
			actions: [
				{
					label: "项目总图",
					icon: "map",
					path: this.paths.readme("projects"),
				},
				{
					label: "场景索引",
					icon: "external-link",
					path: this.paths.sceneIndexFile,
				},
				{ label: "检索项目", icon: "copy", command: "/retrieval" },
			],
		});

		const primary = page.createDiv({
			cls: "workflow-v2-primary projects-v2-primary project-scene-layout",
		});
		primary.setAttribute("data-workflow-layout", "split");

		const portfolio = this.panel(
			primary,
			"#4D8DFF",
			"项目组合",
			"优先级分布 · 已跟踪任务完成率"
		);
		portfolio.addClass("project-portfolio-panel");
		portfolio.setAttribute("data-workflow-section", "core-data");
		this.fillProjectPortfolioChart(
			portfolio.createDiv({ cls: "project-v2-portfolio-chart" }),
			d.projects
		);

		const attention = this.panel(
			primary,
			"#F59E0B",
			"重点项目",
			"P0 优先 · 最近活跃度次序"
		);
		attention.addClass("project-entry-panel");
		attention.setAttribute(
			"data-workflow-section",
			"attention-and-actions"
		);
		const attentionList = attention.createDiv({
			cls: "project-v2-attention-list",
		});
		if (rankedProjects.length === 0) {
			renderTalosEmptyState(
				attentionList,
				"暂无项目场景",
				"建立项目 README 后，这里会显示优先级与最新进展。",
				{
					label: "打开项目目录",
					icon: "folder-kanban",
					onActivate: () =>
						void openFile(this.app, this.paths.readme("projects")),
				}
			);
		} else {
			for (const project of rankedProjects.slice(0, 4)) {
				const row = attentionList.createEl("button", {
					cls: `project-card project-v2-priority-row priority-${project.priority}`,
					attr: { type: "button" },
				});
				const head = row.createDiv({
					cls: "project-v2-priority-row__head",
				});
				head.createEl("strong", { text: project.name });
				head.createEl("span", {
					cls: `project-v2-priority-badge priority-${project.priority}`,
					text: project.priority.toUpperCase(),
				});
				row.createEl("small", { text: project.status });
				row.createEl("small", {
					cls: "module-latest",
					text: `最新：${project.latestTitle}`,
				});
				if (project.progress) {
					const pct = Math.round(
						(project.progress.done /
							Math.max(project.progress.total, 1)) *
							100
					);
					const progress = row.createDiv({
						cls: "project-v2-priority-progress",
					});
					progress.createSpan().style.width = `${pct}%`;
					progress.createEl("small", {
						text: `${pct}% · ${project.progress.done}/${project.progress.total}`,
					});
				}
				row.addEventListener("click", () =>
					void openFile(this.app, project.readme)
				);
			}
		}

		const entryActions = attention.createDiv({
			cls: "project-v2-entry-actions",
		});
		for (const action of [
			{
				label: "场景索引",
				icon: "map",
				path: this.paths.sceneIndexFile,
			},
			{
				label: "项目总 README",
				icon: "folder-open",
				path: this.paths.readme("projects"),
			},
		]) {
			const button = entryActions.createEl("button", {
				cls: "module-hero-action",
				attr: { type: "button" },
			});
			setIcon(
				button.createSpan({ cls: "module-hero-action-icon" }),
				action.icon
			);
			button.createSpan({ text: action.label });
			button.addEventListener("click", () =>
				void openFile(this.app, action.path)
			);
		}

		const mapPanel = this.panel(
			page,
			"#A78BFA",
			"项目场景地图",
			`${this.paths.dir("projects")} · 全部项目`
		);
		mapPanel.addClass("project-map-panel");
		mapPanel.setAttribute("data-workflow-section", "project-map");
		const cards = mapPanel.createDiv({ cls: "project-grid" });
		if (d.projects.length === 0) {
			renderTalosEmptyState(
				cards,
				"暂无项目",
				"项目目录中出现可识别场景后，将自动生成项目卡片。"
			);
		}
		for (const project of d.projects) {
			const card = cards.createDiv({
				cls: `project-card priority-${project.priority}`,
			});
			card.createEl("b", { text: project.name });
			card.createEl("span", { cls: "big", text: String(project.count) });
			card.createEl("small", { text: project.status });
			if (project.progress) {
				const pct = Math.round(
					(project.progress.done /
						Math.max(project.progress.total, 1)) *
						100
				);
				const progress = card.createDiv({ cls: "proj-progress" });
				const head = progress.createDiv({
					cls: "proj-progress-head",
				});
				head.createEl("small", { text: "任务进度" });
				head.createEl("small", {
					cls: "proj-progress-num",
					text: `${pct}% · ${project.progress.done}/${project.progress.total}`,
				});
				const track = progress.createDiv({
					cls: "proj-progress-track",
				});
				track.createDiv({ cls: "proj-progress-fill" }).style.width =
					`${pct}%`;
			} else {
				card.createEl("small", {
					cls: "proj-progress-none",
					text: "无任务清单 · 进度未跟踪",
				});
			}
			const latest = card.createEl("small", {
				cls: "module-latest",
				text: `最新：${project.latestTitle}`,
			});
			if (project.latestPath) {
				latest.addEventListener("click", (event) => {
					event.stopPropagation();
					void openFile(this.app, project.latestPath || "");
				});
			}
			card.addEventListener("click", () =>
				void openFile(this.app, project.readme)
			);
		}
	}

	private pageKnowledge(page: HTMLElement, d: Collected): void {
		const mocs =
			d.knowledge.metrics.find((item) => item.label === "MOC 枢纽") ||
			d.knowledge.metrics[0];
		const insightMetric =
			d.knowledge.metrics.find((item) => item.label === "原创洞察") ||
			d.knowledge.metrics[1];
		const materialMetric =
			d.knowledge.metrics.find((item) => item.label === "外部素材") ||
			d.knowledge.metrics[2];

		this.moduleHero(page, {
			ac: "#A78BFA",
			icon: "brain",
			eyebrow: "KNOWLEDGE HUB",
			title: "知识枢纽",
			desc: "原创洞察、外部素材和 MOC 入口分层展示，快速判断该检索、该整理，还是该产出。",
			stats: [
				{
					label: mocs?.label || "MOC 枢纽",
					value: mocs?.value || "0",
					sub: mocs?.sub,
					path: mocs?.path,
					tone: mocs?.tone || "default",
				},
				{
					label: insightMetric?.label || "原创洞察",
					value: insightMetric?.value || "0",
					sub: insightMetric?.sub,
					path: insightMetric?.path,
					tone: insightMetric?.tone || "default",
				},
				{
					label: materialMetric?.label || "外部素材",
					value: materialMetric?.value || "0",
					sub: materialMetric?.sub,
					path: materialMetric?.path,
					tone: materialMetric?.tone || "default",
				},
			],
			actions: [
				{
					label: "MOC",
					icon: "external-link",
					path: this.paths.mocReadme,
				},
				{
					label: "洞察库",
					icon: "lightbulb",
					path: this.paths.readme("insights"),
				},
				{
					label: "素材库",
					icon: "archive",
					path: this.paths.readme("assets"),
				},
			],
		});

		const primary = page.createDiv({
			cls: "knowledge-v2-primary knowledge-hub-v2-primary",
		});
		primary.setAttribute("data-knowledge-layout", "split");

		const structure = this.panel(
			primary,
			"#A78BFA",
			"知识资产结构",
			"按真实总量生成树状占比"
		);
		structure.setAttribute("data-knowledge-section", "core-data");
		this.fillKnowledgeTreemap(
			structure.createDiv({ cls: "knowledge-v2-treemap" }),
			d.knowledge.metrics
		);

		const recent = this.panel(
			primary,
			"#F472B6",
			"最近新增",
			"原创洞察 · 外部素材"
		);
		recent.addClass("knowledge-v2-recent-panel");
		recent.setAttribute(
			"data-knowledge-section",
			"attention-and-entry"
		);
		for (const group of [
			{
				title: "原创洞察",
				meta: this.paths.dir("insights"),
				items: d.knowledge.recentInsights,
				empty: "暂无洞察",
			},
			{
				title: "外部素材",
				meta: this.paths.dir("assets"),
				items: d.knowledge.recentMaterials,
				empty: "暂无素材",
			},
		]) {
			const section = recent.createDiv({
				cls: "knowledge-v2-recent-group",
			});
			const head = section.createDiv({
				cls: "knowledge-v2-recent-group__head",
			});
			head.createEl("strong", { text: group.title });
			head.createEl("span", {
				text: `${group.items.length} · ${group.meta}`,
			});
			this.fillSignalList(
				section.createDiv({ cls: "detail-list" }),
				group.items,
				group.empty
			);
		}

		const moc = this.panel(
			page,
			"#38E1FF",
			"MOC 概念入口",
			this.paths.mocDir
		);
		moc.addClass("knowledge-v2-moc-panel");
		moc.setAttribute("data-knowledge-section", "moc-entry");
		this.fillSignalList(
			moc.createDiv({ cls: "detail-list" }),
			d.knowledge.mocs,
			"暂无 MOC"
		);
	}

	private pageIdentity(page: HTMLElement, d: Collected): void {
		const pendingTotal = d.approvals.length + d.candidates.length;
		this.moduleHero(page, {
			ac: "#6366F1",
			icon: "fingerprint",
			eyebrow: "IDENTITY CONTEXT",
			title: "身份上下文",
			desc: "用户身份、AI 灵魂和工作记忆并排巡检，确保行动没有脱离长期自我和当前状态。",
			stats: [
				{
					label: "用户身份",
					value: String(this.moduleCount(d, "identity")),
					sub: "使命、状态、偏好、决策",
					path: this.paths.readme("identity"),
					tone: "default",
				},
				{
					label: "AI 灵魂",
					value: String(this.moduleCount(d, "soul")),
					sub: "人格契约与立场账本",
					path: this.paths.readme("soul"),
					tone: "default",
				},
				{
					label: "待确认",
					value: String(pendingTotal),
					sub: `${d.approvals.length} 审批 · ${d.candidates.length} 偏好`,
					path: this.plugin.talosSettings.pendingApprovalsPath,
					tone: pendingTotal > 0 ? "warn" : "good",
				},
			],
			actions: [
				{
					label: "CONTEXT",
					icon: "scan-text",
					path: this.paths.contextFile,
				},
				{
					label: "PERSONA",
					icon: "sparkles",
					path: this.paths.personaFile,
				},
				{ label: "记忆流", icon: "copy", command: "/memory" },
			],
		});

		const primary = page.createDiv({
			cls: "knowledge-v2-primary identity-v2-primary",
		});
		primary.setAttribute("data-knowledge-layout", "split");

		const contextColumn = primary.createDiv({
			cls: "knowledge-v2-column identity-v2-context-column",
		});
		contextColumn.setAttribute(
			"data-knowledge-section",
			"core-context"
		);
		const foundation = this.panel(
			contextColumn,
			"#4D8DFF",
			"身份底座",
			"Haaper · Identity / 屈原 · 灵魂"
		);
		foundation.addClass("identity-v2-foundation");
		for (const group of [
			{
				title: "Haaper · Identity",
				meta: "身份事实与当前状态",
				items: [
					{
						title: "TELOS",
						meta: "使命、目标、信念与长期方向",
						path: this.paths.telosFile,
					},
					{
						title: "CONTEXT",
						meta: "近期焦点、项目与系统状态",
						path: this.paths.contextFile,
					},
					{
						title: "PROFILE",
						meta: "经确认的场景化偏好",
						path: this.paths.profileFile,
					},
					{
						title: "战略决策",
						meta: "方向、方法与品牌级判断",
						path: this.paths.decisionsFile,
					},
				],
				empty: "Identity 文件未找到",
			},
			{
				title: "屈原 · 灵魂",
				meta: "人格契约与独立判断",
				items: [
					{
						title: "PERSONA",
						meta: "名字、价值内核、反驳权与边界",
						path: this.paths.personaFile,
					},
					{
						title: "persona-memory",
						meta: "演化立场、判断与自我修正",
						path: this.paths.personaMemoryFile,
					},
				],
				empty: "灵魂文件未找到",
			},
		]) {
			const section = foundation.createDiv({
				cls: "identity-v2-context-group",
			});
			const head = section.createDiv({
				cls: "identity-v2-context-group__head",
			});
			head.createEl("strong", { text: group.title });
			head.createEl("span", { text: group.meta });
			this.fillSignalList(
				section.createDiv({ cls: "detail-list" }),
				group.items,
				group.empty
			);
		}

		const attentionColumn = primary.createDiv({
			cls: "knowledge-v2-column identity-v2-attention-column",
		});
		attentionColumn.setAttribute(
			"data-knowledge-section",
			"attention-and-actions"
		);
		const focus = this.panel(
			attentionColumn,
			"#FB7185",
			"当前工作状态",
			"tasks.md · 最多三个焦点"
		);
		this.fillSignalList(
			focus.createDiv({ cls: "detail-list" }),
			d.focus.slice(0, 3).map((item) => ({
				title: item.title,
				meta: item.doneWhen
					? `done_when · ${item.doneWhen}`
					: item.desc,
				path: item.path || this.plugin.talosSettings.tasksPath,
			})),
			"今日尚未设置焦点"
		);

		const decisions = this.panel(
			attentionColumn,
			"#FBBF24",
			"审批与偏好",
			pendingTotal > 0
				? `${pendingTotal} 项可直接处理`
				: "审批池已清空"
		);
		this.renderDecisionWorkspace(decisions, d, 2);

		const governance = this.panel(
			page,
			"#34D399",
			"记忆与治理入口",
			"任务 · 审批 · 偏好 · 健康"
		);
		governance.addClass("identity-v2-governance-panel");
		governance.setAttribute(
			"data-knowledge-section",
			"governance-entry"
		);
		this.fillSignalList(
			governance.createDiv({ cls: "detail-list" }),
			[
				{
					title: "任务池",
					meta: `${d.focus.length} 个当前焦点`,
					path: this.plugin.talosSettings.tasksPath,
				},
				{
					title: "审批池",
					meta: `${d.approvals.length} 项待决策`,
					path: this.plugin.talosSettings.pendingApprovalsPath,
				},
				{
					title: "偏好候选",
					meta: `${d.candidates.length} 条待确认`,
					path: this.plugin.talosSettings.candidatesPath,
				},
				{
					title: "健康日志",
					meta: `系统分 ${d.overview.health.value}`,
					path: this.plugin.talosSettings.healthLogPath,
				},
			],
			"工作记忆入口未找到"
		);
	}

	private pageVault(page: HTMLElement, d: Collected): void {
		const activeDays =
			d.heatmap.meta.split(" · ")[0] || d.heatmap.meta;
		const missingModules = d.modules.filter(
			(module) => !module.readmeExists
		);
		const missingReadmes = missingModules.length;

		this.moduleHero(page, {
			ac: "#38E1FF",
			icon: "database",
			eyebrow: "VAULT MAP",
			title: "全库视图",
			desc: "从内容分布、顶层模块到创建热力图，给整个外脑系统做一次横向巡航。",
			stats: [
				{
					label: "知识笔记",
					value: String(d.total),
					sub: "六大内容目录",
					path: this.paths.readme("projects"),
					tone: "default",
				},
				{
					label: "顶层模块",
					value: String(d.modules.length),
					sub: `${missingReadmes} 个 README 异常`,
					path: this.paths.readme("system"),
					tone: missingReadmes > 0 ? "warn" : "good",
				},
				{
					label: "活跃天数",
					value: activeDays,
					sub: d.heatmap.meta.split(" · ")[1] || "近 12 个月",
					path: this.paths.readme("logs"),
					tone: "good",
				},
			],
			actions: [
				{
					label: "系统地图",
					icon: "map",
					path: this.paths.readme("system"),
				},
				{
					label: "项目地图",
					icon: "folder-kanban",
					path: this.paths.readme("projects"),
				},
				{ label: "周重置", icon: "copy", command: "/weekly-reset" },
			],
		});

		const primary = page.createDiv({
			cls: "system-v2-primary vault-v2-primary",
		});
		primary.setAttribute("data-system-layout", "split");

		const distribution = this.panel(
			primary,
			"#34D399",
			"知识库分布",
			`共 ${d.total} 篇`
		);
		distribution.setAttribute("data-system-section", "core-data");
		this.fillDist(
			distribution.createDiv({ cls: "barchart" }),
			d.dist
		);

		const health = this.panel(
			primary,
			"#F472B6",
			"库健康与异常",
			missingReadmes > 0
				? `${missingReadmes} 个模块缺少 README`
				: "README 完整"
		);
		health.addClass("vault-v2-health-panel");
		health.setAttribute(
			"data-system-section",
			"attention-and-actions"
		);
		this.fillTrend(health, d.healthTrend);
		const anomalyHead = health.createDiv({
			cls: "workflow-v2-subhead vault-v2-anomaly-head",
		});
		anomalyHead.createEl("strong", { text: "README 异常" });
		anomalyHead.createEl("span", {
			text:
				missingReadmes > 0
					? `${missingReadmes} 项待修复`
					: "当前清空",
		});
		this.fillSignalList(
			health.createDiv({ cls: "detail-list vault-v2-anomaly-list" }),
			missingModules.map((module) => ({
				title: module.name,
				meta: `${module.count} 篇 · 缺少模块 README`,
				path: module.readme,
			})),
			"所有顶层模块均有 README"
		);

		const heat = this.panel(
			page,
			"#A78BFA",
			"笔记创建热力图",
			d.heatmap.meta
		);
		heat.addClass("vault-v2-heat-panel");
		heat.setAttribute("data-system-section", "activity-heatmap");
		const heatWrap = heat.createDiv({ cls: "heatmap" });
		heatWrap.setAttribute("role", "img");
		heatWrap.setAttribute(
			"aria-label",
			`笔记创建热力图：${d.heatmap.meta}`
		);
		for (const month of d.heatmap.months) {
			const monthElement = heatWrap.createDiv({
				cls: "heat-month",
			});
			monthElement.createEl("span", {
				cls: "heat-mlabel",
				text: month.label,
			});
			const weeks = monthElement.createDiv({ cls: "heat-weeks" });
			for (const week of month.weeks) {
				const weekElement = weeks.createDiv({
					cls: "heat-week",
				});
				for (const cell of week) {
					const cellElement = weekElement.createDiv({
						cls: "heat-cell",
					});
					if (cell.date === "") {
						cellElement.addClass("is-empty");
					} else {
						cellElement.setAttribute(
							"data-level",
							String(cell.level)
						);
						cellElement.setAttribute(
							"title",
							`${cell.date} · ${cell.count}`
						);
					}
				}
			}
		}

		const modules = this.panel(
			page,
			"#4D8DFF",
			"系统模块地图",
			"顶层模块 · README / 最新文件"
		);
		modules.addClass("vault-v2-module-panel");
		modules.setAttribute("data-system-section", "module-map");
		const grid = modules.createDiv({ cls: "note-grid" });
		for (const module of d.modules) {
			const note = grid.createDiv({
				cls: module.readmeExists
					? "note module-card"
					: "note module-card missing-readme",
			});
			note.createEl("b", { text: module.name });
			note.createEl("span", {
				cls: "big",
				text: String(module.count),
			});
			note.createEl("span", {
				text: `更新 ${module.lastChange} · ${module.readmeExists ? "README OK" : "缺 README"}`,
			});
			const latest = note.createEl("small", {
				cls: "module-latest",
				text: `最新：${module.latestTitle}`,
			});
			if (module.latestPath) {
				latest.addEventListener("click", (event) => {
					event.stopPropagation();
					void openFile(this.app, module.latestPath || "");
				});
			}
			note.addEventListener("click", () =>
				void openFile(this.app, module.readme)
			);
		}
	}

	private pageCapability(page: HTMLElement, d: Collected): void {
		const groupCount = (key: string) =>
			d.capGroups.find((group) => group.key === key)?.items.length ?? 0;
		const capabilityTotal = d.capGroups.reduce(
			(sum, group) => sum + group.items.length,
			0
		);
		if (!d.capGroups.some((group) => group.key === this.activeCap)) {
			this.activeCap = d.capGroups[0]?.key ?? "commands";
		}

		this.moduleHero(page, {
			ac: "#14B8A6",
			icon: "blocks",
			eyebrow: "CAPABILITY CENTER",
			title: "能力中心",
			desc: "把命令、Agents 和工作流做成可复制入口，需要调用时不再从规则文件里翻。",
			stats: [
				{
					label: "能力总数",
					value: String(capabilityTotal),
					sub: "可复制调用入口",
					path: ".claude/commands/morning.md",
					tone: "good",
				},
				{
					label: "命令",
					value: String(groupCount("commands")),
					sub: "对话中直接调用",
					path: ".claude/commands/morning.md",
					tone: "default",
				},
				{
					label: "Agents",
					value: String(groupCount("agents")),
					sub: "子代理与技能",
					tone: "default",
				},
			],
			actions: [
				{ label: "晨间", icon: "copy", command: "/morning" },
				{ label: "归档", icon: "copy", command: "/intake" },
				{ label: "维护", icon: "copy", command: "/maintain" },
			],
		});

		const primary = page.createDiv({
			cls: "knowledge-v2-primary capability-v2-primary",
		});
		primary.setAttribute("data-knowledge-layout", "split");

		const distribution = this.panel(
			primary,
			"#38E1FF",
			"能力分布",
			"库内真实命令 / Agents / 工作流"
		);
		distribution.setAttribute("data-knowledge-section", "core-data");
		this.fillCapabilityDistribution(
			distribution.createDiv({
				cls: "capability-v2-distribution",
			}),
			d.capGroups
		);

		const controls = this.panel(
			primary,
			"#14B8A6",
			"分组控制",
			"选择后更新下方调用入口"
		);
		controls.addClass("capability-v2-controls");
		controls.setAttribute(
			"data-knowledge-section",
			"attention-and-actions"
		);
		const summary = controls.createDiv({
			cls: "capability-v2-current-summary",
		});
		const tabs = controls.createDiv({ cls: "tabs capability-v2-tabs" });

		const browser = this.panel(
			page,
			"#A78BFA",
			"能力调用入口",
			"点击卡片复制调用 · 源文件按钮只负责打开"
		);
		browser.addClass("capability-v2-browser");
		browser.setAttribute("data-knowledge-section", "capability-browser");
		const grid = browser.createDiv({ cls: "commands" });

		const drawGrid = () => {
			grid.empty();
			const group = d.capGroups.find(
				(item) => item.key === this.activeCap
			);
			if (!group || group.items.length === 0) {
				renderTalosEmptyState(
					grid,
					"无可用项",
					"当前分组没有可复制的调用入口。"
				);
				return;
			}
			for (const item of group.items) {
				const card = grid.createDiv({ cls: "command" });
				const top = card.createDiv({ cls: "cap-top" });
				top.createEl("code", { text: item.name });
				const actions = top.createDiv({ cls: "cap-actions" });
				actions.createSpan({ text: "复制调用" });
				if (item.path) {
					const source = actions.createSpan();
					this.addActionButtonContent(
						source,
						"打开源文件",
						"mini"
					);
					source.addEventListener("click", (event) => {
						event.stopPropagation();
						void openFile(this.app, item.path || "");
					});
				}
				card.createEl("small", { text: item.desc || "—" });
				if (item.path) {
					const sourceLine = card.createDiv({ cls: "cap-src" });
					sourceLine.createSpan({ text: item.path });
					sourceLine.createEl("em", { text: group.label });
				}
				card.addEventListener("click", () =>
					void this.copyText(item.invoke)
				);
			}
			this.wireModuleSelection(
				grid,
				`capability:${this.activeCap}`
			);
		};

		const drawTabs = () => {
			tabs.empty();
			summary.empty();
			const active = d.capGroups.find(
				(group) => group.key === this.activeCap
			);
			summary.createEl("small", { text: "当前分组" });
			summary.createEl("strong", {
				text: active?.label || "未选择",
			});
			summary.createEl("span", {
				text: active
					? `${active.items.length} 个调用入口`
					: "暂无可用分组",
			});
			for (const group of d.capGroups) {
				const tab = tabs.createEl("button", {
					cls: `tab${group.key === this.activeCap ? " active" : ""}`,
				});
				tab.type = "button";
				this.addActionButtonContent(
					tab,
					`${group.label} ${group.items.length}`,
					"compact"
				);
				tab.setAttribute(
					"aria-pressed",
					String(group.key === this.activeCap)
				);
				tab.addEventListener("click", () => {
					this.activeCap = group.key;
					drawTabs();
					drawGrid();
				});
			}
		};

		drawTabs();
		drawGrid();
	}




	// ---------- 填充 ----------
	private fillMetricGrid(parent: HTMLElement, metrics: MetricTile[]): void {
		for (const m of metrics) {
			const card = parent.createDiv({ cls: `metric-card tone-${m.tone || "default"}` });
			card.createEl("b", { text: m.value });
			const txt = card.createDiv({ cls: "metric-txt" });
			txt.createEl("span", { text: m.label });
			txt.createEl("small", { text: m.sub });
			if (m.aux) {
				const aux = card.createDiv({ cls: "metric-aux" });
				aux.createSpan({ cls: "chip", text: m.aux });
			}
			if (m.path) card.addEventListener("click", () => void openFile(this.app, m.path || ""));
		}
	}

	private fillSignalList(parent: HTMLElement, items: SignalItem[], emptyText: string): void {
		if (items.length === 0) {
			parent.createDiv({ cls: "empty", text: emptyText });
			return;
		}
		for (const it of items) {
			const row = parent.createDiv({ cls: "detail-row" });
			const text = row.createDiv({ cls: "detail-text" });
			text.createEl("b", { text: it.title });
			// 收件箱视觉优化（2026-07-07）：meta 原为 "3d · 00-收件箱/web/xxx.md" 裸路径，
			// 现拆为结构化 data 属性供 CSS 渲染 chip（[web] 3d），不再裸露完整路径。
			const metaParts = (it.meta || "—").split(" · ");
			const daysPart = metaParts[0] || "";
			const folderPart = it.path?.split("/")[1] || "";
			const span = text.createEl("span");
			span.textContent = daysPart;
			if (folderPart) span.dataset.folder = folderPart;
			if (it.path) row.addEventListener("click", () => void openFile(this.app, it.path || ""));
		}
	}

	private fillCapabilityDistribution(
		parent: HTMLElement,
		groups: CapabilityGroup[]
	): void {
		if (groups.length === 0) {
			renderTalosEmptyState(
				parent,
				"暂无能力分组",
				"扫描到命令、Agent 或工作流后，这里会显示真实数量分布。"
			);
			return;
		}
		const maxCount = Math.max(
			...groups.map((group) => group.items.length),
			1
		);
		for (const group of groups) {
			const row = parent.createDiv({
				cls: "capability-v2-distribution-row",
			});
			const head = row.createDiv({
				cls: "capability-v2-distribution-row__head",
			});
			head.createEl("strong", { text: group.label });
			head.createEl("span", {
				text: String(group.items.length),
			});
			const track = row.createDiv({
				cls: "capability-v2-distribution-row__track",
			});
			track.setAttribute("role", "img");
			track.setAttribute(
				"aria-label",
				`${group.label}：${group.items.length} 个调用入口`
			);
			track.createSpan().style.width =
				`${(group.items.length / maxCount) * 100}%`;
		}
	}

	private fillGateStateChart(
		parent: HTMLElement,
		gates: GateItem[]
	): void {
		if (gates.length === 0) {
			renderTalosEmptyState(
				parent,
				"暂无闸门数据",
				"发布闸门出现后，这里会显示完成、就绪、阻塞和待办分布。"
			);
			return;
		}

		const states: Array<{
			key: GateItem["state"];
			label: string;
		}> = [
			{ key: "done", label: "完成" },
			{ key: "ready", label: "就绪" },
			{ key: "blocked", label: "阻塞" },
			{ key: "todo", label: "待办" },
		];
		const counts = states.map((state) => ({
			...state,
			count: gates.filter((gate) => gate.state === state.key).length,
		}));
		const track = parent.createDiv({
			cls: "talos-v2-gate-chart__track",
		});
		track.setAttribute("role", "img");
		track.setAttribute(
			"aria-label",
			`闸门状态分布：${counts
				.map((item) => `${item.label} ${item.count}`)
				.join("，")}`
		);
		for (const item of counts) {
			if (item.count === 0) continue;
			const segment = track.createSpan({
				cls: `talos-v2-gate-chart__segment state-${item.key}`,
			});
			segment.style.width = `${(item.count / gates.length) * 100}%`;
		}

		const legend = parent.createDiv({
			cls: "talos-v2-gate-chart__legend",
		});
		for (const item of counts) {
			const key = legend.createDiv({
				cls: `talos-v2-gate-chart__key state-${item.key}`,
			});
			key.createSpan({ cls: "talos-v2-gate-chart__dot" });
			key.createEl("strong", { text: String(item.count) });
			key.createEl("span", { text: item.label });
		}
	}

	private fillKnowledgeTreemap(
		parent: HTMLElement,
		metrics: MetricTile[]
	): void {
		const nodes = metrics
			.map((metric) => {
				const value = Number.parseFloat(
					metric.value.replace(/[^\d.]/g, "")
				);
				return {
					metric,
					value: Number.isFinite(value) ? Math.max(0, value) : 0,
				};
			})
			.sort((left, right) => right.value - left.value);
		const total = nodes.reduce((sum, node) => sum + node.value, 0);
		if (total <= 0) {
			renderTalosEmptyState(
				parent,
				"暂无知识资产统计",
				"MOC、洞察或素材出现后，这里会按真实数量形成树状占比。"
			);
			return;
		}

		for (const node of nodes) {
			const share = (node.value / total) * 100;
			const tile = parent.createEl("button", {
				cls: `metric-card knowledge-v2-treemap-node tone-${node.metric.tone || "default"}`,
				attr: {
					type: "button",
					"aria-label": `${node.metric.label}：${node.metric.value}，占 ${Math.round(share)}%`,
				},
			});
			tile.style.setProperty("--knowledge-share", `${share}%`);
			tile.createEl("small", { text: node.metric.label });
			tile.createEl("strong", { text: node.metric.value });
			tile.createEl("span", {
				text: `${Math.round(share)}% · ${node.metric.sub}`,
			});
			if (node.metric.path) {
				tile.addEventListener("click", () =>
					void openFile(this.app, node.metric.path || "")
				);
			} else {
				tile.disabled = true;
			}
		}
	}

	private fillOutputClosureChart(
		parent: HTMLElement,
		platforms: OutputCenter["platforms"]
	): void {
		if (platforms.length === 0) {
			renderTalosEmptyState(
				parent,
				"暂无平台稿件",
				"创建平台内容后，这里会显示发布、待闭环与未分类分布。"
			);
			return;
		}

		const legend = parent.createDiv({ cls: "output-v2-chart-legend" });
		for (const item of [
			{ label: "已发布", tone: "published" },
			{ label: "待闭环", tone: "pending" },
			{ label: "未分类", tone: "unclassified" },
		]) {
			const key = legend.createSpan({
				cls: `output-v2-chart-key tone-${item.tone}`,
			});
			key.createSpan({ cls: "output-v2-chart-key__dot" });
			key.createSpan({ text: item.label });
		}

		for (const platform of platforms) {
			const classified = platform.published + platform.pending;
			const total = Math.max(platform.count, classified);
			const unclassified = Math.max(0, total - classified);
			const row = parent.createDiv({ cls: "output-v2-bar-row" });
			const head = row.createDiv({ cls: "output-v2-bar-row__head" });
			head.createEl("strong", { text: platform.name });
			head.createEl("span", {
				text: `${platform.published}/${total} 已发布 · ${platform.pending} 待闭环`,
			});

			const track = row.createDiv({ cls: "output-v2-bar-track" });
			track.setAttribute("role", "img");
			track.setAttribute(
				"aria-label",
				`${platform.name}：已发布 ${platform.published}，待闭环 ${platform.pending}，未分类 ${unclassified}`
			);
			if (total === 0) track.addClass("is-empty");
			for (const segment of [
				{ tone: "published", value: platform.published },
				{ tone: "pending", value: platform.pending },
				{ tone: "unclassified", value: unclassified },
			]) {
				if (segment.value <= 0 || total === 0) continue;
				const fill = track.createSpan({
					cls: `output-v2-bar-segment tone-${segment.tone}`,
				});
				fill.style.width = `${(segment.value / total) * 100}%`;
			}
		}
	}

	private fillProjectPortfolioChart(
		parent: HTMLElement,
		projects: ProjectScene[]
	): void {
		if (projects.length === 0) {
			renderTalosEmptyState(
				parent,
				"暂无组合数据",
				"项目出现后，这里会显示优先级分布和真实任务完成率。"
			);
			return;
		}

		const tracked = projects.filter((project) => project.progress);
		const totalTasks = tracked.reduce(
			(sum, project) => sum + (project.progress?.total || 0),
			0
		);
		const doneTasks = tracked.reduce(
			(sum, project) => sum + (project.progress?.done || 0),
			0
		);
		const completion =
			totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

		const summary = parent.createDiv({
			cls: "project-v2-portfolio-summary",
		});
		const ring = summary.createDiv({
			cls: `project-v2-progress-ring${totalTasks === 0 ? " is-empty" : ""}`,
		});
		ring.style.setProperty("--project-progress", `${completion}%`);
		ring.setAttribute("role", "img");
		ring.setAttribute(
			"aria-label",
			totalTasks > 0
				? `已跟踪任务完成 ${doneTasks}/${totalTasks}，${completion}%`
				: "暂无可计算的项目任务"
		);
		ring.createSpan({ text: totalTasks > 0 ? `${completion}%` : "—" });
		const copy = summary.createDiv({
			cls: "project-v2-portfolio-summary__copy",
		});
		copy.createEl("strong", { text: "已跟踪任务完成率" });
		copy.createEl("span", {
			text:
				totalTasks > 0
					? `${doneTasks}/${totalTasks} · ${tracked.length} 个项目有任务清单`
					: "当前项目尚未提供可汇总的复选框任务",
		});

		const distribution = [
			{
				key: "p0",
				label: "P0 高频",
				count: projects.filter((project) => project.priority === "p0")
					.length,
			},
			{
				key: "p1",
				label: "P1 活跃",
				count: projects.filter((project) => project.priority === "p1")
					.length,
			},
			{
				key: "p2",
				label: "P2 长尾",
				count: projects.filter((project) => project.priority === "p2")
					.length,
			},
		];
		const maxCount = Math.max(
			...distribution.map((item) => item.count),
			1
		);
		const bars = parent.createDiv({
			cls: "project-v2-priority-bars",
		});
		for (const item of distribution) {
			const row = bars.createDiv({
				cls: `project-v2-priority-bar priority-${item.key}`,
			});
			const head = row.createDiv({
				cls: "project-v2-priority-bar__head",
			});
			head.createEl("strong", { text: item.label });
			head.createEl("span", { text: String(item.count) });
			const track = row.createDiv({
				cls: "project-v2-priority-bar__track",
			});
			track.setAttribute(
				"aria-label",
				`${item.label}：${item.count} 个项目`
			);
			track.setAttribute("role", "img");
			track.createSpan().style.width =
				`${(item.count / maxCount) * 100}%`;
		}
	}

	private fillPlatforms(parent: HTMLElement, platforms: OutputCenter["platforms"]): void {
		for (const platform of platforms) {
			const card = parent.createDiv({ cls: "platform-card" });
			card.createEl("b", { text: platform.name });
			card.createEl("span", { cls: "big", text: String(platform.count) });
			card.createEl("small", { text: `${platform.published} 已发布 · ${platform.pending} 待闭环` });
			const latest = card.createEl("small", { cls: "module-latest", text: `最新：${platform.latestTitle}` });
			if (platform.latestPath) {
				latest.addEventListener("click", (ev) => {
					ev.stopPropagation();
					void openFile(this.app, platform.latestPath || "");
				});
			}
			card.addEventListener("click", () => void openFile(this.app, platform.readme));
		}
	}

	private fillInboxClusters(parent: HTMLElement, clusters: InboxDigest["clusters"]): void {
		if (clusters.length === 0) {
			parent.createDiv({ cls: "empty", text: "暂无待消化主题" });
			return;
		}
		const total = clusters.reduce((sum, c) => sum + c.count, 0);
		const max = Math.max(...clusters.map((c) => c.count), 1);
		for (const cluster of clusters) {
			const card = parent.createDiv({ cls: "cluster-card" });
			card.createEl("b", { text: cluster.name });
			card.createEl("span", { cls: "big", text: String(cluster.count) });
			const hintRow = card.createDiv({ cls: "cluster-hint-row" });
			hintRow.createEl("small", { text: cluster.hint });
			if (total > 0) {
				hintRow.createEl("small", {
					cls: "cluster-pct",
					text: `${Math.round((cluster.count / total) * 100)}%`,
				});
			}
			const bar = card.createDiv({ cls: "cluster-bar" });
			const fill = bar.createDiv({ cls: "cluster-bar-fill" });
			if (cluster.name === "其他") fill.addClass("is-manual");
			fill.style.width = `${Math.max(2, Math.round((cluster.count / max) * 100))}%`;
		}
	}

	/** 积压年龄分布：design-system/talos/pages/inbox.md §组件规格 */
	private fillInboxAgeDist(parent: HTMLElement, inbox: InboxDigest): void {
		if (inbox.count === 0) return;
		const buckets = inbox.ageBuckets.filter((b) => b.count > 0);
		parent.createDiv({ cls: "age-dist-title", text: `积压年龄 · 共 ${inbox.count} 篇 · 最老 ${inbox.oldestDays}d` });
		const track = parent.createDiv({ cls: "age-dist-track" });
		for (const bucket of buckets) {
			const seg = track.createDiv({ cls: `age-seg tone-${bucket.tone}` });
			seg.style.width = `${Math.max(1.5, (bucket.count / inbox.count) * 100)}%`;
			seg.setAttr("aria-label", `${bucket.label}：${bucket.count} 篇`);
		}
		track.setAttr("role", "img");
		track.setAttr(
			"aria-label",
			`积压年龄分布：${buckets.map((b) => `${b.label} ${b.count} 篇`).join("，")}`
		);
		const legend = parent.createDiv({ cls: "age-dist-legend" });
		for (const bucket of buckets) {
			const item = legend.createDiv({ cls: "age-legend-item" });
			item.createSpan({ cls: `age-dot tone-${bucket.tone}` });
			item.createSpan({ text: `${bucket.label} · ${bucket.count} 篇` });
		}
	}

	private fillTalosModules(parent: HTMLElement, modules: TalosProduct["modules"]): void {
		for (const module of modules) {
			const card = parent.createDiv({ cls: "talos-module" });
			card.createEl("b", { text: module.name });
			card.createEl("span", { cls: "big", text: String(module.count) });
			const latest = card.createEl("small", { cls: "module-latest", text: `最新：${module.latestTitle}` });
			if (module.latestPath) {
				latest.addEventListener("click", (ev) => {
					ev.stopPropagation();
					void openFile(this.app, module.latestPath || "");
				});
			}
			card.addEventListener("click", () => void openFile(this.app, module.readme));
		}
	}

	private fillBanner(banner: HTMLElement, w: ReleaseWarRoom): void {
		banner.empty();
		banner.toggleClass("is-alert", w.stopTriggered);
		banner.createDiv({ cls: "banner-tag", text: w.stopTriggered ? "⛔ 重估期" : "发布状态" });
		const stats = banner.createDiv({ cls: "banner-stats" });
		const item = (label: string, value: string) => {
			const dd = stats.createDiv({ cls: "banner-item" });
			dd.createSpan({ cls: "banner-num", text: value });
			dd.createSpan({ cls: "banner-lab", text: label });
		};
		item("已发布", `${w.published}/${w.totalPub}`);
		item("冻结天数", String(w.frozenDays));
		item("停止条件", w.stopTriggered ? "已触发" : "正常");
	}


	private fillDist(el: HTMLElement, dist: DistBar[]): void {
		const max = Math.max(1, ...dist.map((d) => d.count));
		for (const d of dist) {
			const row = el.createDiv({ cls: "barrow" });
			row.createSpan({ cls: "bt", text: d.name });
			const wrap = row.createDiv({ cls: "bwrap" });
			const bar = wrap.createEl("i");
			bar.setCssProps({ "--talos-w": `${Math.round((d.count / max) * 100)}%` });
			row.createSpan({ cls: "bn", text: String(d.count) });
			row.addEventListener("click", () => void openFile(this.app, d.readme));
		}
	}

	private fillTrend(panel: HTMLElement, points: HealthPoint[]): void {
		if (points.length === 0) { panel.createDiv({ cls: "empty", text: "无健康分数据" }); return; }
		const last = points[points.length - 1];
		const prev = points.length > 1 ? points[points.length - 2] : undefined;
		const delta = last && prev ? last.score - prev.score : 0;
		const head = panel.createDiv({ cls: "trend-head" });
		head.createSpan({ cls: "score", text: last ? String(last.score) : "—" });
		head.createSpan({ cls: `delta ${delta < 0 ? "down" : "up"}`, text: delta === 0 ? "持平" : delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}` });
		head.createEl("small", { text: "满分 100" });
		const chart = panel.createDiv({ cls: "spark" });
		const max = Math.max(...points.map((p) => p.score), 100);
		for (const p of points) {
			const col = chart.createDiv({ cls: "spark-col" });
			const bar = col.createDiv({ cls: "spark-bar" });
			bar.setCssProps({ "--talos-h": `${Math.round((p.score / max) * 100)}%` });
			bar.setAttribute("title", `${p.label}: ${p.score}`);
			col.createSpan({ cls: "spark-lab", text: p.label });
		}
	}

	private fillGates(el: HTMLElement, gates: GateItem[]): void {
		if (gates.length === 0) { el.createDiv({ cls: "empty", text: "—" }); return; }
		for (const g of gates) {
			const chip = el.createDiv({ cls: `gate state-${g.state}` });
			chip.createSpan({ cls: "gate-id", text: g.id });
			chip.createSpan({ cls: "gate-title", text: g.title });
			if (g.path) chip.addEventListener("click", () => void openFile(this.app, g.path || ""));
		}
	}

	private async copyText(text: string): Promise<void> {
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
	// 文字对话使用独立 AI 对话页面；旧 Claudian ItemView 只保留为恢复入口。
	private async openQuyuan(): Promise<void> {
		this.activePage = "jarvis";
		this.renderNav();
		this.renderPage();
	}
}
