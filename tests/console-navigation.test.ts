import { describe, expect, it, vi } from "vitest";
import { TalosPageRouter } from "../src/ui/page-router";

vi.mock("obsidian", () => {
	class Stub {}
	return new Proxy({ __esModule: true, Notice: vi.fn() }, {
		get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : Stub,
		has: () => true,
	});
});
vi.mock("../src/ui/view-chrome", () => ({ buildShell: vi.fn(), renderNav: vi.fn(), renderSecondaryTabs: vi.fn() }));
const { TalosView } = await import("../src/view");
const { buildShell } = await import("../src/ui/view-chrome");

function view(page: string, lens = false) {
	const result = Object.assign(Object.create(TalosView.prototype), {
		plugin: { hasSuperbrainCatalog: true, talosSettings: { consoleMode: "personal", uiLanguage: lens ? "lens" : "classic" }, activateChatSidebar: vi.fn() },
		app: { workspace: { requestSaveLayout: vi.fn() } },
		pageRouter: new TalosPageRouter(page),
		pageScroll: new Map(), renderedPage: page,
		contentEl: { scrollTop: 0 }, pageEl: { empty: vi.fn(), querySelector: vi.fn() }, pageNavEl: {}, data: {},
		lens: lens ? { navigate: vi.fn() } : null,
		applyPageState: vi.fn(), renderNav: vi.fn(), renderSecondaryTabs: vi.fn(),
		mountSetupHint: vi.fn(), wireModuleSelection: vi.fn(), syncPixelScene: vi.fn(),
		superbrainPages: { activeDetailId: "C01", teardown: vi.fn(), render: vi.fn() },
	}) as InstanceType<typeof TalosView>;
	return result;
}

describe("console refresh and navigation", () => {
	it("keeps a C/M form and operation mounted during background refresh", () => {
		const current = view("sb-loop");
		(current as unknown as { renderCurrentPage(background: boolean): void }).renderCurrentPage(true);
		expect(vi.spyOn(current.pageEl, "empty")).not.toHaveBeenCalled();
		expect(vi.spyOn(current.superbrainPages, "teardown")).not.toHaveBeenCalled();
	});

	it("remounts voice when its mounted marker outlives the connected content", () => {
		const current = view("jarvis");
		current.jarvisMounted = true;
		current.jarvis = { mount: vi.fn(), unmount: vi.fn() };
		current.pageJarvis = vi.fn();
		current.renderPage();
		expect(vi.spyOn(current.jarvis, "unmount")).toHaveBeenCalledOnce();
		expect(vi.spyOn(current, "pageJarvis")).toHaveBeenCalledWith(current.pageEl);
	});

	it("recovers a mounted voice page after rebuilding the console shell", async () => {
		const current = view("jarvis");
		let connected = true;
		const oldRoot = { get isConnected() { return connected; } };
		Object.assign(current.pageEl, { querySelector: vi.fn(() => oldRoot as never) });
		current.jarvisMounted = true;
		const unmount = vi.fn(() => { connected = false; });
		current.jarvis = { mount: vi.fn(), unmount };
		Object.assign(current, {
			clockTimer: null,
			contentEl: { scrollTop: 0, removeClass: vi.fn() },
			removeOrphanedEmbeddedWorkbenchContent: vi.fn(), updateClock: vi.fn(), registerInterval: vi.fn(),
			refresh: async () => current.renderPage(),
		});
		current.plugin.talosSettings.welcomeEasterEgg = false;
		vi.stubGlobal("window", { setInterval: () => 1, clearInterval: vi.fn() });
		vi.mocked(buildShell).mockImplementation(() => {
			current.pageEl = { empty: vi.fn(), querySelector: vi.fn() } as never;
		});
		current.pageJarvis = vi.fn((page: HTMLElement) => {
			const newRoot = { isConnected: true };
			Object.assign(page, { querySelector: vi.fn(() => newRoot as never) });
			current.jarvisMounted = true;
		});
		try {
			await current.recoverFromBlankView();
			expect(unmount).toHaveBeenCalledOnce();
			expect(oldRoot.isConnected).toBe(false);
			expect(vi.spyOn(current, "pageJarvis")).toHaveBeenCalledOnce();
			expect(current.pageEl.querySelector(".tq-voice")?.isConnected).toBe(true);
			expect(current.jarvisMounted).toBe(true);
		} finally {
			vi.unstubAllGlobals();
			vi.mocked(buildShell).mockReset();
		}
	});

	it("still disposes C/M operations when explicitly changing the page", () => {
		const current = view("sb-loop");
		current.renderPage();
		expect(vi.spyOn(current.superbrainPages, "teardown")).toHaveBeenCalledOnce();
		expect(vi.spyOn(current.pageEl, "empty")).toHaveBeenCalledOnce();
	});

	it.each([["daily", "workbench", "tasks"], ["vault", "workbench", "knowledge"], ["flow", "workbench", "inbox"], ["workflow", "workbench", "inbox"], ["inbox", "workbench", "inbox"], ["output", "workbench", "output"], ["identity", "workbench", "identity"], ["capability", "workbench", "capability"]])(
		"opens the exact Lens tab for %s", (page, module, tab) => {
			const current = view("today", true);
			current.navigateToPage(page);
			expect(vi.spyOn(current.lens!, "navigate")).toHaveBeenCalledWith(module, tab);
			expect(current.activePage).toBe(page === "daily" ? "tasks" : page === "vault" ? "knowledge" : page === "flow" || page === "workflow" ? "inbox" : page);
		}
	);

	it.each([
		["daily", '[data-workbench-section="decisions"]'],
		["vault", '[data-workbench-data="knowledge"]'],
		["output", '[data-workbench-data="output"]'],
		["identity", '[data-workbench-section="identity"]'],
		["capability", '[data-workbench-section="capability"]'],
	])("locates the retained destination for %s in Lens", (page, selector) => {
		const current = view("today", true);
		const scrollIntoView = vi.fn();
		const querySelector = vi.fn(() => ({ scrollIntoView }));
		Object.assign(current.contentEl, { querySelector });
		current.navigateToPage(page);
		expect(querySelector).toHaveBeenCalledWith(selector);
		expect(scrollIntoView).toHaveBeenCalledOnce();
	});

	it.each(["harness", "dsh"])("routes %s to its supported classic surface instead of Lens overview", (page) => {
		const current = view("today", true);
		current.renderPage = vi.fn();
		current.navigateToPage(page);
		expect(current.activePage).toBe("harness");
		expect(vi.spyOn(current.lens!, "navigate")).not.toHaveBeenCalled();
		expect(vi.spyOn(current, "renderPage")).toHaveBeenCalledOnce();
	});

	it("opens the AI sidebar for the legacy conversation address", () => {
		const current = view("today", true);
		const openSidebar = vi.spyOn(current.plugin, "activateChatSidebar");
		const navigate = vi.spyOn(current.lens!, "navigate");
		current.navigateToPage("talos-quyuan-view");
		expect(openSidebar).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("assistant", "chat");
	});
});
