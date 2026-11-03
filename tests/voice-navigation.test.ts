import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { TalosPageRouter } from "../src/ui/page-router";

const panelCalls = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("obsidian", () => {
	class Stub {}
	return new Proxy({ __esModule: true, Notice: vi.fn(), setIcon: vi.fn() }, {
		get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : Stub,
		has: () => true,
	});
});
vi.mock("../src/actions", () => new Proxy({ __esModule: true }, {
	get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : vi.fn(),
	has: () => true,
}));
vi.mock("../src/quyuan/voice-panel", () => ({
	QuyuanVoicePanel: class {
		private root: HTMLElement | null = null;
		mount(host: HTMLElement) {
			panelCalls.mount();
			this.root = host.createDiv({ cls: "tq-voice" });
			this.root.textContent = "语音控制";
		}
		unmount() { panelCalls.unmount(); this.root?.remove(); }
	},
}));

const { TalosView } = await import("../src/view");
const { renderNav } = await import("../src/ui/view-chrome");
const { renderJarvisPage } = await import("../src/ui/pages/workspace-pages");

type Options = { text?: string; cls?: string; attr?: Record<string, string> };
const windows: Window[] = [];
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.close(); });
beforeEach(() => { vi.clearAllMocks(); });

function fixture(initialPage = "settings", catalog = false) {
	const win = new Window(); windows.push(win);
	function createEl(this: HTMLElement, tag: string, options: Options = {}) {
		const element = this.ownerDocument.createElement(tag);
		if (options.text !== undefined) element.textContent = options.text;
		if (options.cls) element.className = options.cls;
		for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
		this.appendChild(element);
		return element;
	}
	Object.defineProperties(win.HTMLElement.prototype, {
		createEl: { configurable: true, value: createEl },
		createDiv: { configurable: true, value(this: HTMLElement, o?: Options) { return createEl.call(this, "div", o); } },
		createSpan: { configurable: true, value(this: HTMLElement, o?: Options) { return createEl.call(this, "span", o); } },
		empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
		toggleClass: { configurable: true, value(this: HTMLElement, name: string, on: boolean) { this.classList.toggle(name, on); } },
		setCssProps: { configurable: true, value() {} },
	});
	const activeDocument = win.document;
	const shell = activeDocument.createElement("section");
	shell.className = "talos-console section-settings theme-geometric-modern";
	const app = activeDocument.createElement("div");
	app.className = "app";
	const sidebar = activeDocument.createElement("aside");
	sidebar.className = "sidebar";
	const root = activeDocument.createElement("main") as unknown as HTMLElement;
	root.className = "main";
	app.appendChild(sidebar);
	app.appendChild(root as never);
	shell.appendChild(app);
	activeDocument.body.appendChild(shell);
	const view = Object.assign(Object.create(TalosView.prototype), {
		plugin: { hasSuperbrainCatalog: catalog, talosSettings: { consoleMode: "personal", uiLanguage: "classic" }, activateChatSidebar: vi.fn().mockResolvedValue(undefined), waitForAgentWorkbench: vi.fn().mockResolvedValue({}), saveTalosSettings: vi.fn() },
		app: { workspace: { requestSaveLayout: vi.fn() } },
		pageRouter: new TalosPageRouter(initialPage), assistantNavigationOpen: false,
		contentEl: shell,
		pageEl: root.createDiv({ cls: "page-content" }), pageNavEl: (sidebar as unknown as HTMLElement).createEl("nav"), pageTabsEl: root.createDiv({ cls: "talos-page-tabs is-hidden" }), canvasNavEl: null,
		data: null, lens: null, voiceMountRevision: 0, jarvis: null, jarvisMounted: false,
		superbrainPages: { activeDetailId: "C01" }, syncActionButtonTheme: vi.fn(), renderPage: vi.fn(),
	}) as InstanceType<typeof TalosView>;
	return { view, root, win, app, sidebar };
}

function useRealPageRendering(view: InstanceType<typeof TalosView>) {
	Object.assign(view, {
		pageScroll: new Map(), renderedPage: view.activePage,
		updateCosmosHeader: vi.fn(), mountSetupHint: vi.fn(),
		wireModuleSelection: vi.fn(), syncPixelScene: vi.fn(),
	});
	Object.assign(view.superbrainPages, { teardown: vi.fn() });
	view.renderPage = vi.fn(() => {
		view.data = {} as never;
		TalosView.prototype.renderPage.call(view);
	});
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

describe("assistant voice navigation and mounting", () => {
	it.each(["today", "settings"])("opens voice directly from %s after one assistant click", async (initialPage) => {
		const { view, win } = fixture(initialPage);
		const stylesheet = win.document.createElement("style");
		stylesheet.textContent = readFileSync(new URL("../styles.talos.css", import.meta.url), "utf8")
			+ readFileSync(new URL("../styles.quyuan-shell.css", import.meta.url), "utf8");
		win.document.head.appendChild(stylesheet);
		const previousDraft = { text: "未保存的便签草稿" };
		view.quickNote = previousDraft as never;
		const settings = structuredClone(view.plugin.talosSettings);
		useRealPageRendering(view);
		renderNav(view);
		(view.pageNavEl.querySelector('[aria-label="语音助手"]') as HTMLElement).click();
		await vi.waitFor(() => expect(panelCalls.mount).toHaveBeenCalledOnce());
		expect(view.activePage).toBe("jarvis");
		expect(view.assistantNavigationOpen).toBe(false);
		expect(view.pageEl.querySelector(".tq-voice")?.isConnected).toBe(true);
		expect(win.getComputedStyle(view.pageTabsEl as never).display).not.toBe("none");
		expect(view.pageTabsEl.getAttribute("aria-label")).toBe("语音助手二级页面");
		const buttons = Array.from(view.pageTabsEl.querySelectorAll<HTMLButtonElement>("button"));
		expect(buttons.map((button) => button.textContent)).toEqual(["语音AI", "AI 对话", "Harness"]);
		expect(buttons.find((button) => button.textContent?.startsWith("语音"))?.getAttribute("aria-pressed")).toBe("true");
		expect(vi.spyOn(view.plugin, "activateChatSidebar")).not.toHaveBeenCalled();
		expect(view.superbrainPages.activeDetailId).toBeNull();
		expect(view.quickNote).toBe(previousDraft);
		expect(view.plugin.talosSettings).toEqual(settings);
		expect(vi.spyOn(view.plugin, "saveTalosSettings")).not.toHaveBeenCalled();
	});

	it.each([false, true])("opens voice directly by keyboard when catalog=%s", async (catalog) => {
		const { view, win } = fixture("settings", catalog);
		useRealPageRendering(view);
		renderNav(view);
		expect(view.pageNavEl.querySelectorAll('[role="button"]').length).toBe(catalog ? 10 : 5);
		const assistant = view.pageNavEl.querySelector('[aria-label="语音助手"]') as HTMLElement;
		assistant.focus();
		assistant.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as never);
		await vi.waitFor(() => expect(panelCalls.mount).toHaveBeenCalledOnce());
		expect(view.activePage).toBe("jarvis");
		expect(view.pageEl.querySelector(".tq-voice")?.isConnected).toBe(true);
		expect(view.pageTabsEl.getAttribute("aria-label")).toBe("语音助手二级页面");
	});

	it("keeps an already mounted voice page connected when the assistant is clicked again", async () => {
		const { view } = fixture("today");
		useRealPageRendering(view);
		renderNav(view);
		(view.pageNavEl.querySelector('[aria-label="语音助手"]') as HTMLElement).click();
		await vi.waitFor(() => expect(panelCalls.mount).toHaveBeenCalledOnce());
		const voiceRoot = view.pageEl.querySelector(".tq-voice");
		(view.pageNavEl.querySelector('[aria-label="语音助手"]') as HTMLElement).click();
		await Promise.resolve();
		expect(view.activePage).toBe("jarvis");
		expect(view.pageEl.querySelector(".tq-voice")).toBe(voiceRoot);
		expect(voiceRoot?.isConnected).toBe(true);
		expect(panelCalls.mount).toHaveBeenCalledOnce();
		expect(panelCalls.unmount).not.toHaveBeenCalled();
	});

	it("keeps assistant sidebar layout independent of transient hover and focus state", () => {
		const css = postcss.parse(readFileSync(new URL("../styles.quyuan-shell.css", import.meta.url), "utf8"));
		const tracks: string[] = [];
		const widths: string[] = [];
		css.walkRules((rule) => {
			if (!rule.selector.includes("is-assistant-navigation") || rule.selector.includes(":not(")) return;
			rule.walkDecls("grid-template-columns", () => { tracks.push(rule.selector); });
			if (rule.selector.endsWith("> .sidebar")) rule.walkDecls("width", () => { widths.push(rule.selector); });
		});
		expect(tracks).toHaveLength(1);
		expect(widths).toHaveLength(1);
		for (const selector of [...tracks, ...widths]) expect(selector).not.toMatch(/:hover|:focus/);
	});

	it("returns from assistant voice to another primary page", () => {
		const { view } = fixture();
		renderNav(view);
		(view.pageNavEl.querySelector('[aria-label="语音助手"]') as HTMLElement).click();
		(view.pageNavEl.querySelector('[aria-label="系统总览"]') as HTMLElement).click();
		expect(view.assistantNavigationOpen).toBe(false);
		expect(view.activePage).toBe("today");
		expect(view.pageTabsEl.getAttribute("aria-label")).toBe("系统总览二级页面");
		expect(panelCalls.mount).not.toHaveBeenCalled();
	});

	it("ignores a pending successful voice load after navigating away", async () => {
		const { view } = fixture("jarvis"); const wait = deferred();
		vi.spyOn(view.plugin, "waitForAgentWorkbench").mockReturnValue(wait.promise as never);
		const opening = renderJarvisPage(view, view.pageEl);
		await vi.waitFor(() => expect(vi.spyOn(view.plugin, "waitForAgentWorkbench")).toHaveBeenCalledOnce());
		view.activePage = "settings";
		view.pageEl.textContent = "新设置页面";
		wait.resolve(); await opening;
		expect(view.pageEl.textContent).toBe("新设置页面");
		expect(panelCalls.mount).not.toHaveBeenCalled();
	});

	it("does not let an old rejection clear a newer mounted voice page", async () => {
		const { view } = fixture("jarvis"); const wait = deferred();
		vi.spyOn(view.plugin, "waitForAgentWorkbench").mockReturnValueOnce(wait.promise as never);
		const oldOpening = renderJarvisPage(view, view.pageEl);
		await vi.waitFor(() => expect(vi.spyOn(view.plugin, "waitForAgentWorkbench")).toHaveBeenCalledOnce());
		view.activePage = "today";
		view.activePage = "jarvis";
		await renderJarvisPage(view, view.pageEl);
		const voiceRoot = view.pageEl.querySelector(".tq-voice");
		wait.reject(new Error("过期加载失败")); await oldOpening;
		expect(view.pageEl.querySelector(".tq-voice")).toBe(voiceRoot);
		expect(voiceRoot?.isConnected).toBe(true);
		expect(view.jarvisMounted).toBe(true);
		expect(panelCalls.unmount).not.toHaveBeenCalled();
	});

	it("ignores a Lens load failure after its voice host was closed", async () => {
		const { view, root } = fixture("jarvis"); const wait = deferred();
		view.lens = {} as never;
		const host = root.createDiv();
		vi.spyOn(view.plugin, "waitForAgentWorkbench").mockReturnValue(wait.promise as never);
		const opening = (view as unknown as { mountLensVoice(host: HTMLElement): Promise<void> }).mountLensVoice(host);
		await vi.waitFor(() => expect(vi.spyOn(view.plugin, "waitForAgentWorkbench")).toHaveBeenCalledOnce());
		view.unmountJarvisSafely();
		host.remove();
		view.activePage = "settings";
		view.pageEl.textContent = "仍在设置页";
		wait.reject(new Error("已离开的 Lens 加载失败")); await opening;
		expect(view.pageEl.textContent).toBe("仍在设置页");
		expect(panelCalls.mount).not.toHaveBeenCalled();
	});

	it("does not attach an old load into a rebuilt host", async () => {
		const { view, root } = fixture("jarvis"); const wait = deferred();
		vi.spyOn(view.plugin, "waitForAgentWorkbench").mockReturnValue(wait.promise as never);
		const oldPage = view.pageEl;
		const opening = renderJarvisPage(view, oldPage);
		await vi.waitFor(() => expect(vi.spyOn(view.plugin, "waitForAgentWorkbench")).toHaveBeenCalledOnce());
		view.pageEl = root.createDiv(); oldPage.remove();
		view.pageEl.textContent = "新外壳";
		wait.resolve(); await opening;
		expect(view.pageEl.textContent).toBe("新外壳");
		expect(panelCalls.mount).not.toHaveBeenCalled();
	});
});
