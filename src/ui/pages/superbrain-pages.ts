// 超级大脑框架模式页面（D-TLP-072，移植自超级大脑分支线 branch-convergence-v0.5 的 view.ts）：
// 「今日与循环」首页画布（自定义页签与卡片）、其余四组核心页（重点工作流 + 状态侧栏 + C/M 卡片）与 C/M 详情页。
// 页面状态集中在本类，个人体系模式不创建、不渲染。
import { Notice, setIcon } from "obsidian";
import { openFile } from "../../actions";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { primaryPage, SUPERBRAIN_PAGE_GROUP, type SuperbrainPageKey } from "../navigation-model";
import { taskStateLabel } from "../task-state-label";
import { renderModuleCommandBar, type ModuleCommandBar } from "../module-command-bar";
import { parseSuperbrainCatalog, SUPERBRAIN_CATALOG_PATH, type SuperbrainEntry } from "../../module-commands/superbrain-catalog";
import { renderSuperbrainDetailPage } from "../superbrain-detail-page";
import { superbrainPageSpec } from "../superbrain-page-spec";
import { SUPERBRAIN_CANVAS_CARD_META, openSuperbrainCardLibrary, renderSuperbrainHomeSearch } from "../superbrain-home-components";
import {
	addSuperbrainCanvasCard,
	addSuperbrainCanvasTab,
	moveSuperbrainCanvasCard,
	reorderSuperbrainCanvasCard,
	moveSuperbrainCanvasTab,
	normalizeSuperbrainCanvasLayout,
	removeSuperbrainCanvasCard,
	removeSuperbrainCanvasTab,
	renameSuperbrainCanvasTab,
	selectSuperbrainCanvasTab,
	type SuperbrainCanvasCard,
	type SuperbrainCanvasLayout,
} from "../superbrain-canvas-layout";

const SUPERBRAIN_CORE_ACCENT = "var(--talos-action-current-bg)";

/** 工作流目录的核心分组：每组包含的 C / M 编号（与分支线 navigation-model 中的定义一致）。 */
export const SUPERBRAIN_CORE_GROUPS: Readonly<Record<"overview" | "knowledge" | "memory" | "output" | "system", readonly string[]>> = {
	overview: ["C01", "C10", "C11"],
	knowledge: ["C02", "C03", "C07"],
	memory: ["C04", "C05", "C06"],
	output: ["C08", "C09", "C12", "C13", "C14"],
	system: ["C15", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10"],
};

export class SuperbrainPages {
	activeDetailId: string | null = null;
	private detailDispose: (() => void) | null = null;
	private canvasEditing = false;
	private canvasDrag: { tabId: string; card: SuperbrainCanvasCard } | null = null;
	private homeSearchDispose: (() => void) | null = null;
	private homeLibraryDispose: (() => void) | null = null;
	private moduleCommandBar: ModuleCommandBar | null = null;

	constructor(private readonly view: TalosView) {}

	/** 离开当前页面或重绘前释放首页搜索、卡片库、详情页与扩展操作栏。 */
	teardown(): void {
		this.dispose();
		this.detailDispose?.();
		this.detailDispose = null;
		this.moduleCommandBar?.unmount();
		this.moduleCommandBar = null;
	}

	/** 按 C/M 编号打开详情页（命令面板与工作流面板入口）。 */
	openDetailPage(id: string): void {
		const group = (Object.entries(SUPERBRAIN_CORE_GROUPS) as Array<[keyof typeof SUPERBRAIN_CORE_GROUPS, readonly string[]]>)
			.find(([, ids]) => ids.includes(id))?.[0];
		if (!group) throw new Error(`功能 ${id} 未登记`);
		const pageKey = (Object.keys(SUPERBRAIN_PAGE_GROUP) as SuperbrainPageKey[]).find((key) => SUPERBRAIN_PAGE_GROUP[key] === group) as SuperbrainPageKey;
		this.view.navigateToPage(pageKey, id);
	}

	openSuperbrainDetail(id: string): void {
		this.activeDetailId = id;
		this.view.renderPage();
	}


	private canvasLayout(): SuperbrainCanvasLayout {
		return normalizeSuperbrainCanvasLayout(this.view.plugin.talosSettings.superbrainCanvasLayout);
	}


	private updateCanvasLayout(update: (layout: SuperbrainCanvasLayout) => SuperbrainCanvasLayout): void {
		const layout = update(this.canvasLayout());
		this.view.plugin.talosSettings.superbrainCanvasLayout = layout;
		void this.view.plugin.superbrain.saveSuperbrainCanvasLayout(layout).catch(error => {
			new Notice(`首页布局未保存：${error instanceof Error ? error.message : "请重试"}`);
		});
		this.view.renderPage();
	}


	private canvasButton(parent: HTMLElement, label: string, icon: string, action: () => void, primary = false): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: `talos-canvas-button talos-focusable${primary ? " is-primary" : ""}`,
			attr: { type: "button" },
		});
		setIcon(button.createSpan({ cls: "talos-canvas-button-icon", attr: { "aria-hidden": "true" } }), icon);
		button.createSpan({ text: label });
		button.addEventListener("click", action);
		return button;
	}



 dispose(): void {
  this.homeSearchDispose?.(); this.homeSearchDispose = null;
  this.homeLibraryDispose?.(); this.homeLibraryDispose = null;
  this.canvasDrag = null;
 }


 private superbrainRecentFiles() {
  return this.view.app.vault.getMarkdownFiles()
   .filter(file => file.path.includes("/") && !file.path.startsWith("System/") && file.basename !== "_README")
   .sort((a, b) => b.stat.mtime - a.stat.mtime);
 }


 private homeListRow(parent: HTMLElement, title: string, subtitle: string, icon: string, action?: () => void): HTMLElement {
  const row = parent.createEl(action ? "button" : "div", { cls: "talos-home-list-row" });
  if (action) { row.setAttribute("type", "button"); row.addClass("talos-focusable"); row.addEventListener("click", action); }
  setIcon(row.createSpan({ attr: { "aria-hidden": "true" } }), icon);
  const copy = row.createDiv({ cls: "talos-home-list-copy" });
  copy.createEl("strong", { text: title });
  if (subtitle) copy.createEl("small", { text: subtitle });
  if (action) setIcon(row.createSpan({ cls: "talos-home-list-meta", attr: { "aria-hidden": "true" } }), "chevron-right");
  return row;
 }


 private openCanvasCardLibrary(parent: HTMLElement, tabId: string, cards: readonly SuperbrainCanvasCard[]): void {
  this.homeLibraryDispose?.();
  this.homeLibraryDispose = openSuperbrainCardLibrary(parent, {
   added: cards,
   icon: setIcon,
   onAdd: card => {
    this.updateCanvasLayout(value => addSuperbrainCanvasCard(value, tabId, card));
    this.view.contentEl.querySelector<HTMLButtonElement>(".talos-home-add-content")?.focus();
   },
  });
 }


 private renderSuperbrainCanvasHome(page: HTMLElement, d: Collected, inboxFiles: number): void {
  const layout = this.canvasLayout();
  const current = layout.tabs.find(tab => tab.id === layout.activeTabId) ?? layout.tabs[0];
  const hero = page.createEl("header", { cls: "talos-home-hero" });
  const copy = hero.createDiv({ cls: "talos-home-hero-copy" });
  const now = new Date();
  copy.createEl("time", { cls: "talos-home-date", text: new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now), attr: { datetime: now.toISOString() } });
  const greeting = now.getHours() < 12 ? "早上好" : now.getHours() < 18 ? "下午好" : "晚上好";
  copy.createEl("h1", { text: `${greeting}，从这里继续。` });
  copy.createEl("p", { text: current.label === "主页" ? "留住想法，整理资料，完成今天的重点。" : current.label });
  const orbit = hero.createDiv({ cls: "talos-home-orbit", attr: { "aria-hidden": "true" } });
  for (const icon of ["inbox", "brain", "send"]) setIcon(orbit.createSpan({ cls: "talos-home-orbit-node" }), icon);

  const commandbar = page.createDiv({ cls: "talos-home-commandbar" });
  const searchActions = [
   { id: "C01", label: "晨间工作", icon: "sun" },
   { id: "C02", label: "资料入库", icon: "folder-input" },
   { id: "C03", label: "知识检索", icon: "search" },
   { id: "C08", label: "开始创作", icon: "pen-line" },
  ];
  this.homeSearchDispose = renderSuperbrainHomeSearch(commandbar, {
   files: this.superbrainRecentFiles().map(file => ({ path: file.path, name: file.basename })),
   actions: searchActions,
   openFile: path => { void openFile(this.view.app, path); },
   openAction: id => this.openSuperbrainDetail(id),
   icon: setIcon,
  });
  this.canvasButton(commandbar, "晨间", "sun", () => this.openSuperbrainDetail("C01"));
  this.canvasButton(commandbar, "对话", "messages-square", () => { void this.view.plugin.activateChatSidebar(); });

  const toolbar = page.createDiv({ cls: "talos-home-toolbar" });
  const tabs = toolbar.createDiv({ cls: "talos-canvas-tabs", attr: { role: "tablist", "aria-label": "自定义首页页签" } });
  layout.tabs.forEach((tab, index) => {
   const selected = tab.id === current.id;
   const button = tabs.createEl("button", {
    cls: `talos-canvas-tab talos-focusable${selected ? " is-current" : ""}`,
    text: tab.label,
    attr: { type: "button", role: "tab", "aria-selected": String(selected), "aria-controls": "talos-canvas-current-panel", tabindex: selected ? "0" : "-1" },
   });
   button.addEventListener("click", () => this.updateCanvasLayout(value => selectSuperbrainCanvasTab(value, tab.id)));
   button.addEventListener("keydown", event => {
    const key = event.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const target = key === "Home" ? 0 : key === "End" ? layout.tabs.length - 1 : (index + (key === "ArrowRight" ? 1 : -1) + layout.tabs.length) % layout.tabs.length;
    const next = layout.tabs[target];
    if (next) {
     this.updateCanvasLayout(value => selectSuperbrainCanvasTab(value, next.id));
     this.view.contentEl.querySelector<HTMLButtonElement>('.talos-canvas-tab[aria-selected="true"]')?.focus();
    }
   });
  });
  if (this.canvasEditing) {
   const add = tabs.createEl("button", { cls: "talos-canvas-tab-add talos-focusable", attr: { type: "button", "aria-label": "添加页签" } });
   setIcon(add, "plus"); add.addEventListener("click", () => this.updateCanvasLayout(addSuperbrainCanvasTab));
  }
  const addContent = this.canvasButton(toolbar, "添加内容", "plus", () => this.openCanvasCardLibrary(page, current.id, current.cards));
  addContent.addClass("talos-home-add-content");
  const edit = toolbar.createEl("button", {
   cls: `talos-canvas-icon-button talos-focusable${this.canvasEditing ? " is-selected" : ""}`,
   attr: { type: "button", "aria-label": this.canvasEditing ? "完成首页布置" : "布置首页", "aria-pressed": String(this.canvasEditing) },
  });
  setIcon(edit, this.canvasEditing ? "check" : "sliders-horizontal");
  edit.addEventListener("click", () => { this.canvasEditing = !this.canvasEditing; this.view.renderPage(); });

  if (this.canvasEditing) {
   const bar = page.createDiv({ cls: "talos-canvas-editbar" });
   const label = bar.createEl("label", { text: "页签名称" });
   const name = label.createEl("input", { cls: "talos-canvas-name talos-focusable", type: "text", value: current.label, attr: { maxlength: "24" } });
   name.addEventListener("change", () => this.updateCanvasLayout(value => renameSuperbrainCanvasTab(value, current.id, name.value)));
   for (const direction of [-1, 1] as const) {
    const button = bar.createEl("button", { cls: "talos-canvas-icon-button talos-focusable", attr: { type: "button", "aria-label": direction < 0 ? "页签左移" : "页签右移" } });
    setIcon(button, direction < 0 ? "arrow-left" : "arrow-right");
    button.addEventListener("click", () => this.updateCanvasLayout(value => moveSuperbrainCanvasTab(value, current.id, direction)));
   }
   const remove = bar.createEl("button", { cls: "talos-canvas-icon-button talos-focusable", attr: { type: "button", "aria-label": "移除当前页签" } });
   setIcon(remove, "trash-2"); remove.disabled = layout.tabs.length <= 1;
   remove.addEventListener("click", () => this.updateCanvasLayout(value => removeSuperbrainCanvasTab(value, current.id)));
   bar.createEl("small", { text: "拖动卡片左上角调整顺序，也可使用前后移动按钮。" });
  }
  const grid = page.createDiv({ cls: "talos-canvas-grid", attr: { id: "talos-canvas-current-panel", role: "tabpanel", "aria-label": current.label } });
  if (!current.cards.length) {
   const empty = grid.createDiv({ cls: "talos-canvas-empty" });
   setIcon(empty.createSpan({ attr: { "aria-hidden": "true" } }), "layout-dashboard");
   empty.createEl("h2", { text: "布置你的工作空间" });
   this.canvasButton(empty, "选择内容卡片", "plus", () => this.openCanvasCardLibrary(page, current.id, current.cards));
  }
  for (const card of current.cards) this.renderSuperbrainCanvasCard(grid, card, d, inboxFiles, current.id);
  const flows = page.createEl("section", { cls: "talos-home-workflows" });
  flows.createEl("h2", { text: "今日与循环" });
  const entries = flows.createDiv({ cls: "talos-superbrain-core-grid" });
  void this.loadSuperbrainCoreEntries(entries, SUPERBRAIN_CORE_GROUPS.overview, "overview", undefined, catalogEntries => {
   if (!commandbar.isConnected) return;
   searchActions.splice(0, searchActions.length, ...catalogEntries.map(entry => ({ id: entry.id, label: entry.title, icon: entry.icon })));
   commandbar.querySelector<HTMLInputElement>(".talos-home-search__input")?.dispatchEvent(new Event("input"));
  });
 }


 private renderSuperbrainCanvasCard(grid: HTMLElement, kind: SuperbrainCanvasCard, d: Collected, inboxFiles: number, tabId: string): void {
  const meta = SUPERBRAIN_CANVAS_CARD_META[kind];
  const card = grid.createEl("article", { cls: `talos-canvas-card talos-canvas-card-${kind}` });
  if (this.canvasEditing) {
   const tools = card.createDiv({ cls: "talos-canvas-card-tools" });
   const grip = tools.createSpan({ cls: "talos-home-drag-handle", attr: { draggable: "true", title: `拖动${meta.label}卡片`, "aria-hidden": "true" } });
   setIcon(grip, "grip-vertical");
   grip.addEventListener("dragstart", event => {
    this.canvasDrag = { tabId, card: kind };
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", kind); }
    card.addClass("is-dragging");
   });
   grip.addEventListener("dragend", () => {
    this.canvasDrag = null; card.removeClass("is-dragging");
    this.view.contentEl.querySelectorAll(".talos-canvas-card.is-drop-target").forEach(target => target.removeClass("is-drop-target"));
   });
   card.addEventListener("dragover", event => {
    if (this.canvasDrag?.tabId !== tabId) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    card.addClass("is-drop-target");
   });
   card.addEventListener("dragleave", () => card.removeClass("is-drop-target"));
   card.addEventListener("drop", event => {
    const drag = this.canvasDrag;
    if (!drag || drag.tabId !== tabId) return;
    event.preventDefault(); event.stopPropagation(); this.canvasDrag = null;
    const tab = this.canvasLayout().tabs.find(item => item.id === tabId);
    const targetIndex = tab?.cards.indexOf(kind) ?? -1;
    this.updateCanvasLayout(value => reorderSuperbrainCanvasCard(value, tabId, drag.card, targetIndex));
   });
   for (const direction of [-1, 1] as const) {
    const move = tools.createEl("button", { cls: "talos-canvas-icon-button talos-focusable", attr: { type: "button", "aria-label": `${direction < 0 ? "前移" : "后移"}${meta.label}卡片` } });
    setIcon(move, direction < 0 ? "arrow-left" : "arrow-right");
    move.addEventListener("click", () => {
     this.updateCanvasLayout(value => moveSuperbrainCanvasCard(value, tabId, kind, direction));
     const buttons = this.view.contentEl.querySelectorAll<HTMLButtonElement>(`.talos-canvas-card-${kind} .talos-canvas-card-tools button`);
     buttons[direction < 0 ? 0 : 1]?.focus();
    });
   }
   const remove = tools.createEl("button", { cls: "talos-canvas-icon-button talos-focusable", attr: { type: "button", "aria-label": `移除${meta.label}卡片` } });
   setIcon(remove, "x"); remove.addEventListener("click", () => this.updateCanvasLayout(value => removeSuperbrainCanvasCard(value, tabId, kind)));
  }
  const head = card.createDiv({ cls: "talos-canvas-card-label" });
  setIcon(head.createSpan({ attr: { "aria-hidden": "true" } }), meta.icon);
  head.createSpan({ text: meta.label });
  const open = (id: string) => this.openSuperbrainDetail(id);
  const list = () => card.createDiv({ cls: "talos-home-list" });
  const footer = () => card.createDiv({ cls: "talos-home-card-footer" });
  if (kind === "focus") {
   const focus = d.focus[0];
   card.createEl("h2", { text: focus?.title || "先选一件重要的事" });
   card.createEl("p", { cls: "talos-canvas-focus-condition", text: focus?.doneWhen || focus?.desc || "从晨间工作开始，确定今天的重点。" });
   const path = card.createDiv({ cls: "talos-canvas-path", attr: { role: "group", "aria-label": "资料工作路径" } });
   for (const step of [{ id: "C02", icon: "inbox", label: "收件" }, { id: "C02", icon: "folder-input", label: "整理" }, { id: "C03", icon: "search", label: "检索" }, { id: "C04", icon: "brain", label: "记忆" }]) {
    const button = path.createEl("button", { cls: "talos-canvas-path-step talos-focusable", attr: { type: "button", "aria-label": `打开${step.label}` } });
    setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), step.icon); button.createSpan({ text: step.label });
    button.addEventListener("click", () => open(step.id));
   }
   if (d.focus.length > 1) {
    const secondary = card.createDiv({ cls: "talos-home-focus-secondary" });
    for (const item of d.focus.slice(1, 3)) this.homeListRow(secondary, item.title, "", "circle", item.path ? () => { void openFile(this.view.app, item.path!); } : undefined);
   }
   const actions = footer();
   this.canvasButton(actions, focus ? "继续工作" : "晨间工作", "play", () => open("C01"), true);
   if (focus?.path) this.canvasButton(actions, "查看任务", "arrow-up-right", () => { void openFile(this.view.app, focus.path!); });
  } else if (kind === "inbox") {
   card.createEl("strong", { cls: "talos-canvas-count", text: String(inboxFiles) });
   const root = this.view.plugin.talosSettings.inboxFolder.replace(/\/$/, "");
   const files = this.view.app.vault.getFiles().filter(file => file.path.startsWith(`${root}/`) && file.basename !== "_README").sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 2);
   const rows = list();
   if (files.length) for (const file of files) this.homeListRow(rows, file.basename, "", "file-text", () => { void openFile(this.view.app, file.path); });
   else card.createEl("small", { text: "收件箱已清空" });
   this.canvasButton(footer(), "处理资料", "arrow-right", () => open("C02"));
  } else if (kind === "pending") {
   const items = [...d.candidates, ...d.approvals];
   card.createEl("strong", { cls: "talos-canvas-count", text: String(items.length) });
   const rows = list();
   for (const item of items.slice(0, 2)) this.homeListRow(rows, item.title, "", "circle-help", item.path ? () => { void openFile(this.view.app, item.path!); } : undefined);
   if (!items.length) card.createEl("small", { text: "暂无待确认事项" });
   this.canvasButton(footer(), "查看候选", "arrow-right", () => open("M04"));
  } else if (kind === "quick") {
   const actions = card.createDiv({ cls: "talos-canvas-quick" });
   for (const item of [{ id: "C02", icon: "folder-input", label: "入库" }, { id: "C03", icon: "search", label: "检索" }, { id: "C04", icon: "brain", label: "记忆" }, { id: "C08", icon: "pen-line", label: "创作" }, { id: "C07", icon: "activity", label: "检查" }, { id: "M09", icon: "rotate-ccw", label: "恢复" }]) {
    const button = actions.createEl("button", { cls: "talos-canvas-quick-button talos-focusable", attr: { type: "button", "aria-label": `打开${item.label}` } });
    setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), item.icon); button.createSpan({ text: item.label });
    button.addEventListener("click", () => open(item.id));
   }
  } else if (kind === "recent") {
   const recent = this.superbrainRecentFiles().slice(0, 5);
   const rows = list();
   for (const file of recent) {
    const folder = file.parent?.path || "资料库";
    this.homeListRow(rows, file.basename, folder, "file-text", () => { void this.view.app.workspace.getLeaf(true).openFile(file); });
   }
   if (!recent.length) card.createEl("p", { text: "最近资料会出现在这里" });
  } else if (kind === "runs") {
   const runs = this.view.plugin.getConsoleActionRuntime().store.list().slice(-3).reverse();
   const rows = list();
   for (const run of runs) this.homeListRow(rows, run.actionId, taskStateLabel(run.state), "history");
   if (!runs.length) card.createEl("p", { text: "还没有运行记录" });
   this.canvasButton(footer(), "查看系统记录", "arrow-right", () => { this.view.navigateToPage("sb-system"); });
  } else if (kind === "recovery") {
   const route = card.createEl("ol", { cls: "talos-core-route" });
   for (const [icon, title] of [["archive", "快照"], ["badge-check", "校验"], ["archive-restore", "恢复"]]) {
    const step = route.createEl("li"); setIcon(step.createSpan({ attr: { "aria-hidden": "true" } }), icon); step.createSpan({ text: title });
   }
   this.canvasButton(footer(), "核对恢复点", "arrow-right", () => open("M09"));
  }
 }


 private renderSuperbrainCoreSide(parent: HTMLElement, pageKey: string, d: Collected, inboxFiles: number): void {
  const stats = parent.createEl("section", { cls: "talos-core-status" });
  const items = pageKey === "memory" ? [{ label: "待确认", value: d.approvals.length + d.candidates.length }, { label: "当前焦点", value: d.focus.length }]
   : pageKey === "output" ? [{ label: "成果待办", value: d.output.queue.length }, { label: "最近资料", value: this.superbrainRecentFiles().length }]
   : pageKey === "system" ? [{ label: "运行记录", value: this.view.plugin.getConsoleActionRuntime().store.list().length }, { label: "待确认", value: d.approvals.length + d.candidates.length }]
   : [{ label: "知识笔记", value: d.total }, { label: "收件箱", value: inboxFiles }];
  for (const item of items) {
   const count = stats.createDiv(); count.createEl("strong", { text: String(item.value) }); count.createEl("small", { text: item.label });
  }
  const context = parent.createEl("section", { cls: "talos-core-status" });
  context.createEl("h2", { text: pageKey === "memory" ? "待确认事项" : pageKey === "output" ? "成果待办" : pageKey === "system" ? "最近运行" : "最近资料" });
  const rows = context.createDiv({ cls: "talos-home-list" });
  if (pageKey === "system") {
   const runs = this.view.plugin.getConsoleActionRuntime().store.list().slice(-3).reverse();
   for (const run of runs) this.homeListRow(rows, run.actionId, taskStateLabel(run.state), "history");
   if (!runs.length) context.createEl("p", { text: "还没有运行记录" });
  } else if (pageKey === "memory" || pageKey === "output") {
   const signals = (pageKey === "memory" ? [...d.candidates, ...d.approvals] : d.output.queue).slice(0, 3);
   for (const item of signals) this.homeListRow(rows, item.title, item.meta, "file-text", item.path ? () => { void openFile(this.view.app, item.path!); } : undefined);
   if (!signals.length) context.createEl("p", { text: "暂无待处理事项" });
  } else {
   const files = this.superbrainRecentFiles().slice(0, 3);
   for (const file of files) this.homeListRow(rows, file.basename, file.parent?.path || "资料库", "file-text", () => { void openFile(this.view.app, file.path); });
   if (!files.length) context.createEl("p", { text: "暂无资料" });
  }
 }


 render(page: HTMLElement, d: Collected): void {
  const pageKey = SUPERBRAIN_PAGE_GROUP[this.view.activePage as SuperbrainPageKey];
  const ids = SUPERBRAIN_CORE_GROUPS[pageKey];
  if (!ids) return;
  if (this.activeDetailId) {
   page.createDiv({ cls: "talos-superbrain-core-loading", text: "正在读取功能页面…" });
   void this.loadSuperbrainDetailPage(page, this.activeDetailId); return;
  }
  const section = primaryPage(this.view.pageRouter.current().primary);
  const inboxRoot = this.view.plugin.talosSettings.inboxFolder.replace(/\/$/, "");
  const inboxFiles = this.view.app.vault.getFiles().filter(file => file.path.startsWith(`${inboxRoot}/`) && file.basename !== "_README").length;
  if (pageKey === "overview") { this.renderSuperbrainCanvasHome(page, d, inboxFiles); return; }
  const heading = page.createEl("header", { cls: "talos-core-context" });
  heading.createEl("small", { text: this.view.app.vault.getName() });
  heading.createEl("h1", { text: section.label });
  heading.createEl("p", { text: section.subtitle });
  const workspace = page.createDiv({ cls: "talos-core-workspace" });
  const feature = workspace.createEl("section", { cls: "talos-core-feature" });
  feature.createDiv({ cls: "talos-superbrain-core-loading", text: "正在读取工作流…" });
  const side = workspace.createDiv({ cls: "talos-core-side" });
  this.renderSuperbrainCoreSide(side, pageKey, d, inboxFiles);
  const grid = page.createDiv({ cls: "talos-superbrain-core-grid" });
  void this.loadSuperbrainCoreEntries(grid, ids, pageKey, feature);
  if (pageKey === "system") {
   const advanced = page.createEl("details", { cls: "panel talos-ui-panel talos-superbrain-advanced" });
   advanced.createEl("summary", { text: "扩展本地操作 · 媒体、修复与兼容命令" });
   const host = advanced.createDiv({ cls: "talos-superbrain-advanced-actions" });
   this.moduleCommandBar = renderModuleCommandBar(host, this.view.plugin.getAdvancedModuleCommandEntries(), id => this.view.plugin.openModuleCommand(id));
  }
 }


	private async loadSuperbrainDetailPage(page: HTMLElement, id: string): Promise<void> {
		try {
			const catalog = parseSuperbrainCatalog(await this.view.app.vault.adapter.read(SUPERBRAIN_CATALOG_PATH));
			if (!page.isConnected || this.activeDetailId !== id) return;
			const entry = [...catalog.workflows, ...catalog.mechanisms].find(item => item.id === id);
			if (!entry) throw new Error(`功能 ${id} 不在当前资料库目录中`);
			this.detailDispose = renderSuperbrainDetailPage(page, entry, this.view.plugin.superbrain.getSuperbrainDetailPorts(), () => {
				this.activeDetailId = null;
				this.view.renderPage();
			});
		} catch (error) {
			if (!page.isConnected || this.activeDetailId !== id) return;
			page.empty();
			page.createEl("p", { cls: "talos-superbrain-core-error", text: `功能页面无法打开：${error instanceof Error ? error.message : "读取失败"}` });
			this.canvasButton(page, "返回", "arrow-left", () => { this.activeDetailId = null; this.view.renderPage(); });
		}
	}


	private async loadSuperbrainCoreEntries(
		grid: HTMLElement,
		ids: readonly string[],
		pageKey: keyof typeof SUPERBRAIN_CORE_GROUPS,
		featureHost?: HTMLElement,
		onCatalogReady?: (entries: readonly SuperbrainEntry[]) => void
	): Promise<void> {
		try {
			const raw = await this.view.app.vault.adapter.read(SUPERBRAIN_CATALOG_PATH);
			const catalog = parseSuperbrainCatalog(raw);
			if (!grid.isConnected || SUPERBRAIN_PAGE_GROUP[this.view.activePage as SuperbrainPageKey] !== pageKey) return;
			grid.empty();
			const entries = new Map<string, SuperbrainEntry>(
				[...catalog.workflows, ...catalog.mechanisms].map(item => [item.id, item])
			);
            onCatalogReady?.([...catalog.workflows, ...catalog.mechanisms]);

   if (featureHost) {
    featureHost.empty();
    const featured = entries.get(ids[0]);
    if (featured) {
     setIcon(featureHost.createSpan({ cls: "talos-core-feature-icon", attr: { "aria-hidden": "true" } }), featured.icon);
     featureHost.createEl("small", { text: `工作流 · ${featured.id}` });
     featureHost.createEl("h2", { text: featured.title });
     featureHost.createEl("p", { text: featured.summary });
     const route = featureHost.createEl("ol", { cls: "talos-core-route" });
     for (const step of superbrainPageSpec(featured).steps) {
      const item = route.createEl("li"); setIcon(item.createSpan({ attr: { "aria-hidden": "true" } }), step.icon); item.createSpan({ text: step.label });
     }
     this.canvasButton(featureHost, "打开工作流", "arrow-right", () => this.openSuperbrainDetail(featured.id), true);
    }
   }
			for (const id of ids) {
				const entry = entries.get(id);
				if (!entry || (featureHost && id === ids[0])) continue;
				if (id === "M01") grid.createEl("h2", { cls: "talos-superbrain-core-subheading", text: "系统机制 M01–M10" });
				const card = grid.createEl("article", { cls: "card talos-ui-panel talos-superbrain-core-card" });
				card.dataset.superbrainCoreId = id;
				card.setCssProps({ "--ac": SUPERBRAIN_CORE_ACCENT });
				const selectionScope = `superbrain:${pageKey}`;
				if (this.view.selectedModuleByScope.get(selectionScope) === id) card.addClass("is-module-selected");
				const heading = card.createDiv({ cls: "talos-superbrain-core-card-heading" });
				const icon = heading.createSpan({ cls: "talos-superbrain-core-card-icon" });
				setIcon(icon, entry.icon);
				const label = heading.createDiv();
				label.createEl("small", { cls: "talos-superbrain-core-card-id", text: id });
				label.createEl("h3", { text: entry.title });
                card.createEl("p", { cls: "talos-core-card-description", text: entry.summary });
				const open = card.createEl("button", {
					cls: "talos-superbrain-core-action talos-focusable",
					attr: { type: "button", "aria-label": `打开 ${id} ${entry.title}` },
				});
				open.createSpan({ text: "打开功能" });
				setIcon(open.createSpan({ attr: { "aria-hidden": "true" } }), "chevron-right");
				open.addEventListener("click", () => {
					for (const other of Array.from(grid.querySelectorAll<HTMLElement>(".talos-superbrain-core-card"))) other.removeClass("is-module-selected");
					card.addClass("is-module-selected");
					this.view.selectedModuleByScope.set(selectionScope, id);
					this.openSuperbrainDetail(id);
				});
			}
		} catch (error) {
			if (!grid.isConnected || SUPERBRAIN_PAGE_GROUP[this.view.activePage as SuperbrainPageKey] !== pageKey) return;
			grid.empty();
            featureHost?.empty();
            if (featureHost) featureHost.createEl("p", { text: "当前资料库尚未接入有效工作流目录" });
			grid.createDiv({ cls: "talos-superbrain-core-error", text: `当前资料库未接入有效工作流目录：${error instanceof Error ? error.message : "读取失败"}` });
		}
	}
}
