// Lens 界面语言外壳：DOM 结构对照 TALOS Lens workspace.js——
// #talos-data-app-preview > .ta-window > header.lens-titlebar + .ta-shell(nav.lens-rail, aside.ta-sidebar, .lens-main > main.ta-page)。
// 历史前进后退、可收起侧栏、「打开的模块」菜单、图标栏「更多模块」、模块页签与右侧摘要栏都在这里。
import { setIcon, type App } from "obsidian";
import type { Collected } from "../talos-view-model";
import type { VaultPaths } from "../../data/schema";
import type { TalosPeerStatusState } from "../../peer-status/talos-peer-status";
import { append, el, icon, type LensChild } from "./lens-dom";
import { buildLensData, type LensData } from "./lens-data";
import { LensDrawer } from "./lens-drawer";
import { LENS_MODULES, LENS_RAIL_SHORTCUTS, defaultTab, lensModule, type LensContext, type LensModuleId, type LensState } from "./lens-pages";
import { renderPreferences } from "./lens-system";
import { renderVoice } from "./lens-voice";

export const LENS_ROOT_ID = "talos-data-app-preview";

export interface LensHost {
	app: App;
	paths(): VaultPaths;
	tasksPath(): string;
	profileName(): string;
	appearance(): "light" | "dark";
	openNote(path: string, newTab: boolean): void;
	openChat(): void;
	invokeCommand(command: string): void;
	openHarness(): void;
	renderDecisions(host: HTMLElement): void;
	renderInbox(host: HTMLElement): void;
	renderWorkbench(host: HTMLElement, pageKey: string): void;
	renderOverview(host: HTMLElement): void;
	/** 卸载上一页面的订阅；语音单独管理，刷新语音页不触发。 */
	cleanupPage?(): void;
	onNavigate?(module: LensModuleId, tab: string | null): void;
	renderSettings(host: HTMLElement): void;
	/** 屈原语音面板挂载 / 卸载（离开语音模块即释放麦克风）。 */
	mountVoice(host: HTMLElement): void;
	unmountVoice(): void;
	refresh(): void;
}

interface Location { module: LensModuleId; tab: string | null }
type Popover = "tabs" | "more" | "help" | "profile" | null;

/** Map saved locations and old page commands to the current six workspaces. */
function normalizeLocation(module: LensModuleId, tab?: string): Location {
	if (module === "collect") return { module: "workbench", tab: "inbox" };
	if (module === "knowledge") return { module: "workbench", tab: tab === "output" ? "output" : tab === "inbox" ? "inbox" : "knowledge" };
	if (module === "output") return { module: "workbench", tab: "output" };
	if (module === "projects") return { module: "workbench", tab: "projects" };
	if (module === "identity") return { module: "workbench", tab: "identity" };
	if (module === "voice") return { module: "assistant", tab: "voice" };
	if (module === "overview" && tab === "rhythm") return { module: "overview", tab: "today" };
	if (module === "system") return { module: "workbench", tab: tab === "vault" ? "knowledge" : tab === "approvals" ? "tasks" : tab === "capability" || tab === "identity" ? tab : "health" };
	if (module === "workbench" && tab && !["inbox", "knowledge", "output", "projects", "tasks", "health", "capability", "identity"].includes(tab)) return { module, tab: "inbox" };
	return { module, tab: tab ?? null };
}

function workbenchCategory(tab: string | null): "inbox" | "projects" | "health" {
	return tab === "projects" || tab === "tasks" ? "projects" : tab === "health" || tab === "capability" || tab === "identity" ? "health" : "inbox";
}

/** 在 Lens 页面内部隔离复用经典面板样式和容器查询，不改变 Lens 外壳。 */
function nativeSurface(doc: Document, appearance: "light" | "dark", label: string): HTMLElement {
	return el(doc, "div", { class: "talos-lens-native talos-console talos-scope talos-ui-page", "aria-label": label, "data-talos-theme": appearance });
}

function isVoice(location: Location): boolean {
	return location.module === "assistant" && location.tab === "voice";
}

export class LensConsole {
	readonly root: HTMLElement;
	private readonly titlebar: HTMLElement;
	private readonly rail: HTMLElement;
	private readonly sidebar: HTMLElement;
	private readonly page: HTMLElement;
	private readonly drawer: LensDrawer;
	private data: LensData | null = null;
	private location: Location = { module: "overview", tab: "today" };
	private readonly tabsByModule = new Map<LensModuleId, string>();
	private back: Location[] = [];
	private forward: Location[] = [];
	private openModules: LensModuleId[] = ["overview"];
	private sidebarOpen = false;
	private popover: Popover = null;
	private readonly scroll = new Map<string, number>();
	private readonly state: LensState = { projectView: "board", projectFilter: "all", queries: {}, deckPages: {}, ovExpand: null };

	constructor(private readonly host: LensHost, container: HTMLElement) {
		const doc = container.ownerDocument;
		this.titlebar = el(doc, "header", { class: "lens-titlebar", "aria-label": "工作区控制栏" });
		this.rail = el(doc, "nav", { class: "lens-rail", "aria-label": "快捷模块" });
		this.sidebar = el(doc, "aside", { class: "ta-sidebar", id: "lens-sidebar", "aria-label": "工作区导航" });
		this.page = el(doc, "main", { class: "ta-page" });
		const windowEl = el(doc, "div", { class: "ta-window" },
			this.titlebar,
			el(doc, "div", { class: "ta-shell" }, this.rail, this.sidebar, el(doc, "div", { class: "lens-main" }, this.page)));
		this.root = el(doc, "div", { id: LENS_ROOT_ID, "data-motion": "on" }, windowEl);
		container.appendChild(this.root);
		this.drawer = new LensDrawer(host.app, this.root, windowEl, (path, newTab) => host.openNote(path, newTab));
		doc.addEventListener("pointerdown", this.onOutsidePointer, true);
		this.applyAppearance();
		this.renderChrome();
		this.renderPage();
	}

	applyAppearance(): void {
		this.root.dataset.theme = this.host.appearance();
		// Lens 令牌在系统深色模式下默认切深色；显式标注外观，令牌只跟随 Lens 外观设置
		this.root.dataset.talosTheme = this.host.appearance();
		this.root.dataset.sidebar = this.sidebarOpen ? "open" : "closed";
		this.root.dataset.workspace = this.location.module;
		this.root.dataset.view = this.location.tab ?? this.location.module;
	}

	setData(collected: Collected, peer: TalosPeerStatusState | null): void {
		const first = this.data === null;
		this.data = buildLensData(this.host.app, collected, peer);
		this.renderChrome();
		// 语音进行中不因库变动重绘（否则会打断对话、释放麦克风）
		if (isVoice(this.location) && !first) return;
		this.renderPage({ keepScroll: true });
	}

	navigate(module: LensModuleId, tab?: string, record = true): void {
		const normalized = normalizeLocation(module, tab);
		module = normalized.module;
		tab = normalized.tab ?? undefined;
		const target = lensModule(module);
		if (target.external) {
			this.popover = null;
			this.host.openChat();
			this.renderChrome();
			return;
		}
		// 第二个主入口始终进入语音；文字对话与 Harness 只有明确选择时打开。
		const nextTab = tab ?? (module === "assistant" ? "voice" : this.tabsByModule.get(module) ?? defaultTab(module));
		const next: Location = { module, tab: nextTab };
		// Clicking the already open voice tab must not replace a live microphone host.
		if (isVoice(this.location) && isVoice(next)) return;
		if (record && (next.module !== this.location.module || next.tab !== this.location.tab)) {
			this.back.push(this.location);
			this.forward = [];
		}
		this.scroll.set(this.locationKey(this.location), this.page.scrollTop);
		if (isVoice(this.location) && !isVoice(next)) this.host.unmountVoice();
		this.location = next;
		this.host.onNavigate?.(next.module, next.tab);
		if (nextTab) this.tabsByModule.set(module, nextTab);
		if (!this.openModules.includes(module)) this.openModules.push(module);
		this.popover = null;
		this.drawer.close();
		this.applyAppearance();
		this.renderChrome();
		this.renderPage();
	}

	private locationKey(location: Location): string {
		return `${location.module}/${location.tab ?? ""}`;
	}

	private go(direction: "back" | "forward"): void {
		const from = direction === "back" ? this.back : this.forward;
		const to = direction === "back" ? this.forward : this.back;
		const target = from.pop();
		if (!target) return;
		to.push(this.location);
		this.navigate(target.module, target.tab ?? undefined, false);
	}

	// ---------- 外壳 ----------
	private shellButton(symbol: string, labelText: string, attrs: Record<string, string | boolean>, onClick: () => void, extra = ""): HTMLButtonElement {
		const doc = this.root.ownerDocument;
		const node = el(doc, "button", { type: "button", class: `lens-icon-button talos-focusable ${extra}`.trim(), title: labelText, "aria-label": labelText, ...attrs }, icon(doc, symbol));
		node.addEventListener("click", (event) => {
			event.stopPropagation();
			onClick();
		});
		return node;
	}

	private togglePopover(name: Exclude<Popover, null>): void {
		this.popover = this.popover === name ? null : name;
		this.renderChrome();
	}

	private menuItem(text: LensChild, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
		const node = el(this.root.ownerDocument, "button", { type: "button", class: "lens-menu-item", ...attrs }, text);
		node.addEventListener("click", (event) => {
			event.stopPropagation();
			onClick();
		});
		return node;
	}

	private shellPopover(name: string, labelText: string, content: LensChild[]): HTMLElement {
		const doc = this.root.ownerDocument;
		return el(doc, "div", { class: `lens-shell-popover lens-${name}-popover`, "data-shell-popover": name, role: "dialog", "aria-label": labelText },
			el(doc, "h2", {}, labelText), ...content);
	}

	private title(): string {
		const module = lensModule(this.location.module);
		const tab = module.tabs?.find(([id]) => id === this.location.tab)?.[1];
		return `${module.title} · ${tab ?? module.title}`;
	}

	private renderChrome(): void {
		const doc = this.root.ownerDocument;
		const tabs = this.openModules.map((id) => {
			const selected = this.location.module === id;
			const row = el(doc, "div", { class: "lens-open-tab-row", "data-selected": String(selected) },
				this.menuItem(lensModule(id).title, () => this.navigate(id), selected ? { "aria-current": "page" } : {}));
			if (id !== "overview") {
				row.appendChild(this.shellButton("x", `关闭 ${lensModule(id).title}`, {}, () => {
					this.openModules = this.openModules.filter((m) => m !== id);
					if (this.location.module === id) this.navigate("overview");
					else this.renderChrome();
				}, "lens-tab-close"));
			}
			return row;
		});
		this.titlebar.replaceChildren(
			el(doc, "div", { class: "lens-titlebar-controls" },
				this.shellButton("arrow-left", "后退", { disabled: this.back.length === 0 }, () => this.go("back")),
				this.shellButton("arrow-right", "前进", { disabled: this.forward.length === 0 }, () => this.go("forward")),
				this.shellButton("panel-left", this.sidebarOpen ? "收起导航" : "展开导航", { "aria-controls": "lens-sidebar", "aria-expanded": String(this.sidebarOpen) }, () => {
					this.sidebarOpen = !this.sidebarOpen;
					this.applyAppearance();
					this.renderChrome();
				})),
			el(doc, "div", { class: "lens-titlebar-title" }, el(doc, "span", {}, this.title())),
			el(doc, "div", { class: "lens-titlebar-actions" },
				this.shellButton("list", "打开的模块", { "aria-haspopup": "dialog", "aria-expanded": String(this.popover === "tabs") }, () => this.togglePopover("tabs")),
				this.popover === "tabs" ? this.shellPopover("tabs", "打开的模块", tabs) : null),
		);

		const railButton = (id: LensModuleId) => this.shellButton(lensModule(id).icon, lensModule(id).title,
			this.location.module === id ? { "aria-current": "page" } : {}, () => this.navigate(id), "lens-rail-button");
		const more = LENS_MODULES.filter((m) => !LENS_RAIL_SHORTCUTS.includes(m.id));
		const profile = el(doc, "button", {
			type: "button", class: "lens-icon-button lens-rail-button lens-profile-button", title: `${this.host.profileName()} · 个人设置`,
			"aria-label": `${this.host.profileName()} · 个人设置`, "aria-haspopup": "dialog", "aria-expanded": String(this.popover === "profile"),
		});
		setIcon(profile, "talos-logo");
		profile.addEventListener("click", (event) => {
			event.stopPropagation();
			this.togglePopover("profile");
		});
		this.rail.replaceChildren(
			el(doc, "div", { class: "lens-rail-main" },
				...LENS_RAIL_SHORTCUTS.map(railButton),
				el(doc, "div", { class: "lens-rail-menu-anchor" },
					this.shellButton("ellipsis", "更多模块", { "aria-haspopup": "dialog", "aria-expanded": String(this.popover === "more") }, () => this.togglePopover("more"), "lens-rail-button"),
					this.popover === "more" ? this.shellPopover("more", "更多模块", more.map((m) => this.menuItem(m.title, () => this.navigate(m.id)))) : null)),
			el(doc, "div", { class: "lens-rail-bottom" },
				el(doc, "div", { class: "lens-rail-menu-anchor" },
					this.shellButton("circle-help", "帮助", { "aria-haspopup": "dialog", "aria-expanded": String(this.popover === "help") }, () => this.togglePopover("help"), "lens-rail-button"),
					this.popover === "help" ? this.shellPopover("help", "帮助", [
						this.menuItem("刷新数据", () => { this.popover = null; this.host.refresh(); }),
						this.menuItem("数据来源", () => this.navigate("preferences")),
					]) : null),
				el(doc, "div", { class: "lens-rail-menu-anchor" }, profile,
					this.popover === "profile" ? this.shellPopover("profile", "个人设置", [
						el(doc, "p", { class: "lens-menu-profile" }, this.host.profileName()),
						this.menuItem("应用设置", () => this.navigate("preferences")),
					]) : null)),
		);

		const brand = el(doc, "span", { class: "lens-sidebar-brand" });
		const logo = el(doc, "span", { class: "ta-approved-logo" });
		setIcon(logo, "talos-logo");
		brand.append(logo, el(doc, "strong", {}, "TALOS"));
		const settingsLink = el(doc, "button", { type: "button", class: "lens-settings-link", ...(this.location.module === "preferences" ? { "aria-current": "page" } : {}) },
			icon(doc, "settings"), el(doc, "span", {}, "设置"));
		settingsLink.addEventListener("click", () => this.navigate("preferences"));
		this.sidebar.replaceChildren(
			el(doc, "div", { class: "lens-sidebar-header" }, brand),
			el(doc, "div", { class: "lens-nav-area" },
				el(doc, "nav", { class: "v-nav", "aria-label": "主导航" }, ...LENS_MODULES.filter((m) => !m.bottom).map((m) => {
					const node = el(doc, "button", { type: "button", class: "ta-nav lens-overview-link talos-focusable", ...(this.location.module === m.id ? { "aria-current": "page" } : {}) },
						icon(doc, m.icon), el(doc, "span", {}, m.title));
					node.addEventListener("click", () => this.navigate(m.id));
					return node;
				}))),
			el(doc, "div", { class: "v-side-bottom" }, settingsLink),
		);
	}

	// ---------- 页面 ----------
	private context(): LensContext | null {
		if (!this.data) return null;
		return {
			doc: this.root.ownerDocument,
			app: this.host.app,
			data: this.data,
			paths: this.host.paths(),
			tasksPath: this.host.tasksPath(),
			profileName: this.host.profileName(),
			state: this.state,
			tab: this.location.tab,
			navigate: (module, tab) => this.navigate(module, tab),
			rerender: () => this.renderPage({ keepScroll: true }),
			openNote: (path, newTab = false) => this.host.openNote(path, newTab),
			openDrawer: (path) => void this.drawer.open(path),
			drawerPath: () => this.drawer.selectedPath,
			openChat: () => this.host.openChat(),
			invokeCommand: (command) => this.host.invokeCommand(command),
			openHarness: () => this.host.openHarness(),
			renderDecisions: (host) => this.host.renderDecisions(host),
			renderInbox: (host) => this.host.renderInbox(host),
			renderSettings: (host) => this.host.renderSettings(host),
			mountVoice: (host) => this.host.mountVoice(host),
			refresh: () => this.host.refresh(),
		};
	}

	private content(ctx: LensContext): LensChild[] {
		switch (this.location.module) {
			case "overview": {
				const host = nativeSurface(ctx.doc, this.host.appearance(), "系统总览");
				this.host.renderOverview(host);
				return [host];
			}
			case "workbench": {
				const active = this.location.tab ?? "inbox";
				const host = nativeSurface(ctx.doc, this.host.appearance(), "工作台");
				this.host.renderWorkbench(host, active);
				return [host];
			}
			case "assistant": {
				if (this.location.tab === "voice") return renderVoice(ctx);
				const button = el(ctx.doc, "button", { type: "button", class: "talos-focusable" }, this.location.tab === "harness" ? "打开 Harness" : "打开 AI 对话");
				button.addEventListener("click", () => this.location.tab === "harness" ? ctx.openHarness() : ctx.openChat());
				return [el(ctx.doc, "section", { class: "ov-card" }, el(ctx.doc, "h1", {}, this.location.tab === "harness" ? "DeepSeek Harness" : "AI 对话"), el(ctx.doc, "p", {}, this.location.tab === "harness" ? "在独立工作区使用 Harness。" : "在右侧边栏打开对话工作区。"), button)];
			}
			case "preferences": return renderPreferences(ctx);
			default: return [];
		}
	}

	private workspaceTabs(): HTMLElement | null {
		const doc = this.root.ownerDocument;
		const module = lensModule(this.location.module);
		if (!module.tabs?.length) return null;
		return el(doc, "nav", { class: "lens-workspace-tabs", role: "tablist", "aria-label": `${module.title}内容` },
			...module.tabs.map(([id, title]) => {
				const selected = this.location.module === "workbench" ? workbenchCategory(this.location.tab) === id : this.location.tab === id;
				const node = el(doc, "button", { type: "button", class: "talos-focusable", id: `lens-subview-${id}`, role: "tab", "aria-selected": String(selected), "aria-controls": "lens-workspace-panel", tabindex: selected ? "0" : "-1" }, title);
				node.addEventListener("click", () => this.navigate(module.id, id));
				return node;
			}));
	}

	renderPage(options: { keepScroll?: boolean } = {}): void {
		const doc = this.root.ownerDocument;
		const focused = doc.activeElement instanceof HTMLInputElement && this.root.contains(doc.activeElement) ? doc.activeElement : null;
		const focusId = focused?.id;
		const caret = focused?.selectionStart ?? null;
		const scrollTop = options.keepScroll ? this.page.scrollTop : this.scroll.get(this.locationKey(this.location)) ?? 0;
		const ctx = this.context();
		if (!ctx) {
			this.page.replaceChildren(el(doc, "p", { class: "lens-query-error", role: "status" }, "正在读取当前库…"));
			return;
		}
		this.host.cleanupPage?.();
		const tabs = this.workspaceTabs();
		const body = this.content(ctx);
		this.page.replaceChildren();
		append(this.page, tabs
			? [tabs, el(doc, "section", { id: "lens-workspace-panel", role: "tabpanel", "aria-labelledby": `lens-subview-${this.location.module === "workbench" ? workbenchCategory(this.location.tab) : this.location.tab}` }, ...body)]
			: body);
		this.page.scrollTop = scrollTop;
		this.drawer.markSelection();
		if (focusId) {
			const next = this.root.querySelector<HTMLInputElement>(`#${focusId}`);
			next?.focus({ preventScroll: true });
			if (next && caret !== null) next.setSelectionRange(caret, caret);
		}
	}

	private onOutsidePointer = (event: PointerEvent): void => {
		if (!this.popover) return;
		const target = event.target as Node | null;
		if (target && this.root.contains(target) && (target as Element).closest?.(".lens-shell-popover, .lens-rail-menu-anchor, .lens-titlebar-actions")) return;
		this.popover = null;
		this.renderChrome();
	};

	dispose(): void {
		if (isVoice(this.location)) this.host.unmountVoice();
		this.host.cleanupPage?.();
		this.root.ownerDocument.removeEventListener("pointerdown", this.onOutsidePointer, true);
		this.drawer.dispose();
		this.root.remove();
	}
}
