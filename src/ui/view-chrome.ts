// TALOS 控制台外壳、侧栏与导航；由 TalosView 委托调用。
import { CreateModal, PublishBackfillModal, openResearchWorkbench } from "../actions";
import { navigationFor, primaryPage, type TalosPageRoute, type TalosPrimaryPageKey } from "./navigation-model";
import { SVG_NS } from "./talos-view-model";
import { Notice, setIcon } from "obsidian";
import type { TalosView } from "../view";
import { buildPixelPatrol } from "./view-cosmos";
import { collectOverviewAttention } from "./pages/overview-page";
import { revealChatSidebar } from "../plugin/chat-sidebar-view";

// ---------- 外壳 ----------
export function buildShell(view: TalosView): void {
	const root = view.contentEl;
	if (view.chatMounted) {
		view.chatMounted = false;
		void view.chatSurface?.unmount();
	}
	view.actionPanel?.unmount();
	view.actionPanel = null;
	view.embeddedSettingsTab = null;
	root.empty();
	root.addClass("talos-console");
	view.applySettings();
	view.applyPageState();

	const bg = root.createDiv({ cls: "bg-fx" });
	for (const o of ["o1", "o2", "o3", "o4"]) bg.createEl("i", { cls: `orb ${o}` });
	buildThemeAtmosphere(view, bg);

	const app = root.createDiv({ cls: "app" });
	const sidebar = app.createEl("aside", { cls: "sidebar" });
	const main = app.createEl("main", { cls: "main" });

	buildSidebar(view, sidebar);
	buildMain(view, main);
}

export function buildThemeAtmosphere(view: TalosView, bg: HTMLElement): void {
	const rain = bg.createDiv({ cls: "data-rain" });
	rain.setAttribute("aria-hidden", "true");
	const streams = [
		"CTX\nSYS\nMEM",
		"TALOS\nDATA\nCORE",
		"SIGNAL\nSYNC\nINDEX",
		"NODE\nLINK\nTRACE",
		"FLOW\nGRAPH\nSTATE",
		"VAULT\nSCAN\nREADY",
		"AGENT\nLOOP\nSAFE",
		"01\n10\n11",
	];
	for (let i = 0; i < 8; i++) {
		const col = rain.createEl("i", { text: streams[i % streams.length] });
		col.setCssProps({
			"--rain-x": `${6 + i * 12}%`,
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

export function buildSidebar(view: TalosView, side: HTMLElement): void {
	// 时钟
	const clockCard = side.createEl("section", { cls: "card clock-card" });
	clockCard.setCssProps({ "--ac": "#38E1FF" });
	const clock = clockCard.createDiv({ cls: "clock" });
	const cl = clock.createDiv();
	view.timeEl = cl.createDiv({ cls: "time", text: "--:--" });
	cl.createDiv({ cls: "sub", text: "ASIA/SHANGHAI" });
	view.dateEl = clock.createDiv({ cls: "date" });
	view.weekEl = clockCard.createDiv({ cls: "week" });

	// 导航
	const navCard = side.createEl("section", { cls: "card pagenav-card" });
	navCard.setCssProps({ "--ac": "#4D8DFF" });
	view.secTitle(navCard, "导航", `${navigationFor(view.consoleMode, view.hasSuperbrainCatalog).length} SECTIONS`);
	view.pageNavEl = navCard.createEl("nav", { cls: "nav" });
	// 框架模式的图标导航栏（框架页隐藏上面的导航卡）；个人体系模式保持为空。
	view.canvasNavEl = side.createEl("nav", { cls: "talos-canvas-rail-nav", attr: { "aria-label": "TALOS 功能导航" } });
	renderNav(view);
	view.chatSwitchHostEl = navCard.createDiv({
		cls: "talos-chat-nav-switch-host",
	});
	view.chatSwitchHostEl.dataset.talosComponent = "chat-switch-host";

	// 快捷入口
	const quick = side.createEl("section", { cls: "card action-card" });
	quick.setCssProps({ "--ac": "#A78BFA" });
	view.secTitle(quick, "快捷入口", "ACTIONS");
	const qnav = quick.createEl("nav", { cls: "nav" });
	const act = (host: HTMLElement, mark: string, label: string, fn: () => void) => {
		const button = host.createEl("button", { cls: "command", attr: { type: "button" } });
		button.createDiv({ cls: "mark", text: mark });
		view.addActionButtonContent(button, label);
		button.addEventListener("click", fn);
	};
	act(qnav, "新", "新建记录", () =>
		new CreateModal(view.app, view.plugin.talosSettings, () => void view.refresh()).open());
	act(qnav, "研", "AI 研究", () => {
		void openResearchWorkbench(() => revealChatSidebar(view.app.workspace))
			.catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
	});
	const more = quick.createEl("details", { cls: "talos-secondary-tools" });
	more.createEl("summary", { text: "更多工具" });
	const tools = more.createEl("nav", { cls: "nav", attr: { "aria-label": "更多 TALOS 工具" } });
	act(tools, "刷", "刷新统计", () => void view.refresh());
	act(tools, "检", "只读检查", () => {
		void view.plugin.getConsoleActionRuntime().runner.run({
			actionId: "vault-lint",
			idempotencyKey: `sidebar-lint-${Date.now()}`,
			input: undefined,
			request: { readPaths: ["**"], writePaths: [], effects: ["read"] },
		});
	});
	act(tools, "声", "屈原语音", () => view.navigateToPage("jarvis"));
	act(tools, "H", "DeepSeek Harness", () => view.navigateToPage("harness"));
	act(tools, "发", "发布回填", () =>
		new PublishBackfillModal(view.app, view.plugin.talosSettings, () => void view.refresh()).open());

	// 待审批（无审批时整卡隐藏——健康时保持安静）
	const ap = side.createEl("section", { cls: "card approval-card is-hidden" });
	ap.setCssProps({ "--ac": "#FBBF24" });
	view.secTitle(ap, "待审批", "B/C 类变更");
	view.approvalCardEl = ap;
	view.approvalSideEl = ap.createDiv({ cls: "approval" });
}

function navigationRoute(view: TalosView): TalosPageRoute {
	return view.assistantNavigationOpen
		? { primary: "assistant", secondary: "chat" }
		: view.pageRouter.current();
}

export function renderNav(view: TalosView): void {
	view.pageNavEl.empty();
	const route = navigationRoute(view);
	const groupEl = view.pageNavEl.createDiv({ cls: "nav-group" });
	groupEl.setAttribute("data-nav-group", "primary");
	groupEl.createDiv({ cls: "nav-group-label", text: "主界面" });
	for (const page of navigationFor(view.consoleMode, view.hasSuperbrainCatalog)) {
		const active = page.key === route.primary;
		const item = groupEl.createDiv({
			cls: `command${page.key === "settings" ? " talos-settings-nav-command" : ""}${active ? " active" : ""}`,
		});
		const mark = item.createDiv({ cls: "mark" });
		setIcon(mark, page.icon);
		item.createSpan({ cls: "nav-label", text: page.label });
		item.dataset.talosActionButton = "true";
		item.dataset.talosActionVariant = "";
		view.syncActionButtonTheme(
			item,
			view.plugin.talosSettings.visualTheme || "aurora"
		);
		item.setAttribute("title", page.subtitle);
		item.setAttribute("aria-label", page.label);
		item.setAttribute("role", "button");
		item.setAttribute("tabindex", "0");
		if (active) item.setAttribute("aria-current", "page");
		const activate = () => activatePrimary(view, page.key);
		item.addEventListener("click", activate);
		item.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			activate();
		});
	}
	renderSecondaryTabs(view);
	renderCanvasRailNav(view);
}

function activatePrimary(view: TalosView, key: TalosPrimaryPageKey): void {
	// 助手主入口直接显示语音工作台；文字对话继续在右侧栏打开。
	if (key === "assistant") {
		view.navigateToPage("jarvis");
		return;
	}
	view.assistantNavigationOpen = false;
	view.superbrainPages.activeDetailId = null;
	view.pageRouter.selectPrimary(key);
	renderNav(view);
	view.renderPage();
}

const RAIL_LABELS: Record<string, string> = {
	"sb-loop": "首页", "sb-knowledge": "资料", "sb-memory": "记忆", "sb-output": "创作",
	"sb-system": "系统", assistant: "助手", settings: "设置",
};

/** 框架模式的图标导航栏：与导航卡同一张导航表、同一套切页逻辑。 */
export function renderCanvasRailNav(view: TalosView): void {
	const rail = view.canvasNavEl;
	if (!rail) return;
	rail.empty();
	if (view.consoleMode !== "superbrain") return;
	const current = navigationRoute(view).primary;
	for (const page of navigationFor("superbrain")) {
		const active = page.key === current;
		const button = rail.createEl("button", {
			cls: `talos-canvas-rail-item talos-focusable${active ? " is-active" : ""}`,
			attr: { type: "button", "aria-label": page.label, ...(active ? { "aria-current": "page" } : {}) },
		});
		setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), page.icon);
		button.createSpan({ text: RAIL_LABELS[page.key] ?? page.label });
		button.addEventListener("click", () => activatePrimary(view, page.key));
	}
}

export function navMeta(view: TalosView, key: string): { value: string; alert?: boolean } | null {
	const d = view.data;
	if (!d) return null;
	switch (key) {
		case "today": {
			const count = collectOverviewAttention(view, d).length + d.approvals.length + d.candidates.length;
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
		case "identity": return { value: String(view.moduleCount(d, "identity") + view.moduleCount(d, "soul")) };
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

export function renderSecondaryTabs(view: TalosView): void {
	if (!view.pageTabsEl) return;
	view.pageTabsEl.empty();
	const route = navigationRoute(view);
	const page = primaryPage(route.primary);
	// 设置主区保留时，也允许显示临时展开的助手二级入口。
	view.pageTabsEl.toggleClass("is-assistant-navigation", view.assistantNavigationOpen);
	// 隐藏单页签时也同步标签，避免保留上一个分区的无障碍名称。
	view.pageTabsEl.setAttribute("aria-label", `${page.label}二级页面`);
	// 工作台自身提供三个分类和分类内入口，不重复呈现八个旧页面标签。
	const hidden = page.key === "workbench" || page.children.length <= 1;
	view.pageTabsEl.toggleClass("is-hidden", hidden);
	if (hidden) return;
	for (const child of page.children) {
		const active = child.key === route.secondary;
		const button = view.pageTabsEl.createEl("button", {
			cls: `talos-page-tab${active ? " is-active" : ""}`,
			attr: {
				type: "button",
				"aria-pressed": String(active),
			},
		});
		const icon = button.createSpan({ cls: "talos-page-tab__icon" });
		setIcon(icon, child.icon);
		button.createSpan({ text: child.label });
		const meta = navMeta(view, child.key);
		if (meta) {
			button.createSpan({
				cls: `talos-page-tab__meta${meta.alert ? " is-alert" : ""}`,
				text: meta.value,
			});
		}
		button.addEventListener("click", () => {
			if (child.key === "chat") {
				view.assistantNavigationOpen = true;
				void view.plugin.activateChatSidebar();
				renderNav(view);
				return;
			}
			view.assistantNavigationOpen = false;
			view.navigateToPage(child.key);
		});
	}
}

export function buildMain(view: TalosView, main: HTMLElement): void {
	// Hero 仅服务总览页；子页面通过 data-talos-page 隐藏，直接展示自身内容。
	const hero = main.createEl("header", { cls: "hero talos-ui-overview-header" });
	const cosmos = hero.createDiv({ cls: "cosmos-scene" });
	const cosmosTop = cosmos.createDiv({ cls: "cosmos-top" });
	const cosmosTitle = cosmosTop.createDiv({ cls: "cosmos-title" });
	view.cosmosTitleEl = cosmosTitle.createEl("h1", { text: view.plugin.talosSettings.mainTitle });
	view.cosmosSubEl = cosmosTitle.createDiv({ cls: "cosmos-sub", text: "个人上下文宇宙" });
	const cosmosStatus = cosmosTop.createDiv({ cls: "cosmos-status" });
	cosmosStatus.createEl("i");
	view.cosmosStatusTextEl = cosmosStatus.createSpan({ text: "系统运行中" });
	view.cosmosClockEl = cosmosStatus.createSpan({ cls: "cosmos-clock", text: "—" });
	view.updateCosmosHeader();
	const orbit = cosmos.createDiv({ cls: "cosmos-orbit" });
	for (const ring of ["r1", "r2", "r3", "r4"]) orbit.createDiv({ cls: `cosmos-ring ${ring}` });
	const core = orbit.createDiv({ cls: "cosmos-core" });
	core.createEl("b", { text: "TALOS" });
	core.createSpan({ text: "核心引擎" });
	core.createEl("i", { text: "运行中" });
	view.cosmosNodesEl = orbit.createDiv({ cls: "cosmos-nodes" });

	const heroHead = hero.createDiv({ cls: "hero-head" });
	const brand = heroHead.createDiv({ cls: "brand brand-text" });
	const bt = brand.createDiv();
	const eye = bt.createDiv({ cls: "eyebrow" });
	eye.appendText(view.plugin.talosSettings.eyebrow);
	const live = eye.createSpan({ cls: "live" });
	live.createEl("i");
	live.appendText("ONLINE");
	const titleText = view.plugin.talosSettings.mainTitle;
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
	logoModule.setAttribute("aria-label", "打开语音工作台");
	logoModule.setAttribute("title", "打开语音工作台");
	logoModule.addEventListener("click", () => void view.openQuyuan());
	logoModule.addEventListener("keydown", (ev) => {
		if (ev.key === "Enter" || ev.key === " ") {
			ev.preventDefault();
			void view.openQuyuan();
		}
	});
	for (const ring of ["r1", "r2", "r3"]) logoModule.createEl("i", { cls: `logo-ping ${ring}` });
	const logo = logoModule.createDiv({ cls: "logo logo-heart" });
	buildLogo(view, logo);

	view.patrolEl = buildPixelPatrol(view, hero);

	// 二级页签和业务页共用当前 TALOS leaf，不为子页面创建新 leaf。
	view.pageTabsEl = main.createEl("nav", {
		cls: "talos-page-tabs is-hidden",
	});
	renderSecondaryTabs(view);
	view.pageEl = main.createDiv({ cls: "page-content talos-ui-page" });

	const commandBar = main.createDiv({ cls: "cosmos-commandbar" });
	const voice = commandBar.createDiv({ cls: "cosmos-command-voice" });
	setIcon(voice, "audio-lines");
	commandBar.createDiv({ cls: "cosmos-command-text", text: "向助手提问或执行命令..." });
	const keys = commandBar.createDiv({ cls: "cosmos-command-keys" });
	keys.createSpan({ text: "⌘ K" });
	const mic = keys.createSpan();
	setIcon(mic, "mic");
	const send = keys.createSpan({ cls: "cosmos-command-send" });
	setIcon(send, "send");
	commandBar.addEventListener("click", () => {
		view.activePage = "chat";
		renderNav(view);
		view.renderPage();
	});

	const footer = main.createDiv({ cls: "footer" });
	footer.appendText("TALOS CONSOLE · AURORA EDITION · 数据刷新 ");
	view.stampEl = footer.createSpan({ text: "—" });
	footer.appendText(" · 原生插件");
}

export function buildLogo(view: TalosView, host: HTMLElement): void {
	const doc = view.contentEl.ownerDocument;
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
