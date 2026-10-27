import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createMiniHost, MiniElement, MiniDocument } from "./helpers/mini-dom";
import { navigationFor, pageBelongsTo } from "../src/ui/navigation-model";
import { TalosPageRouter } from "../src/ui/page-router";

vi.mock("obsidian", () => {
	class Stub {}
	return new Proxy({ __esModule: true, Notice: vi.fn() }, {
		get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : Stub,
		has: () => true,
	});
});

vi.mock("../src/ui/view-chrome", () => ({
	buildShell: (view: { applyPageState(): void }) => view.applyPageState(),
	renderNav: vi.fn(),
	renderSecondaryTabs: vi.fn(),
}));

const { TalosView } = await import("../src/view");
const { SuperbrainPages, SUPERBRAIN_CORE_GROUPS } = await import("../src/ui/pages/superbrain-pages");
import { parseModuleInvocation } from "../src/ui/console-mode";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");

describe("Superbrain core entrypoints", () => {
	it("routes every fixed C/M id to its detail page", () => {
		const ids = [
			...Array.from({ length: 15 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`),
			...Array.from({ length: 10 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`),
		];
		for (const id of ids) expect(parseModuleInvocation(`superbrain:${id}`)).toEqual({ kind: "detail", id });
		expect(mainSource).toContain("leaf.view.openSuperbrainDetailPage(id)");
	});

	it("rejects malformed C/M identifiers before the module action router", () => {
		for (const invalid of ["C00", "C16", "M00", "M11", "C1", "C01\n", "../C01", ""]) {
			expect(parseModuleInvocation(`superbrain:${invalid}`)).toEqual({ kind: "invalid" });
		}
	});

	it("keeps the framework home and generic module actions", () => {
		expect(parseModuleInvocation("superbrain")).toEqual({ kind: "home" });
		expect(parseModuleInvocation("capture.note")).toEqual({ kind: "action", invocation: "capture.note" });
		expect(viewSource).toContain("this.renderDecisionWorkspace(host, this.data, 12)");
	});

	it("opens all 25 details through the personal page guard and preserves the classic shell", () => {
		const view = createView();
		const render = vi.spyOn(view.superbrainPages, "render").mockImplementation(() => {});
		const ids = [
			...Array.from({ length: 15 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`),
			...Array.from({ length: 10 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`),
		];
		for (const id of ids) {
			view.openSuperbrainDetailPage(id);
			expect(view.superbrainPages.activeDetailId, id).toBe(id);
			expect(pageBelongsTo("personal", view.activePage, true), id).toBe(true);
			expect(navigationFor("personal", true).some((page) => page.key === view.activePage), id).toBe(true);
			expect(view.contentEl.classList.contains("talos-canvas-shell"), id).toBe(false);
			expect(view.contentEl.classList.contains("talos-scope"), id).toBe(false);
		}
		expect(render).toHaveBeenCalledTimes(25);
		expect(Object.values(SUPERBRAIN_CORE_GROUPS).flat().sort()).toEqual([...ids].sort());
	});

	it("retains the framework shell and denies catalog pages in a personal vault without a catalog", () => {
		const framework = createView("superbrain", false);
		vi.spyOn(framework.superbrainPages, "render").mockImplementation(() => {});
		framework.openSuperbrainDetailPage("C01");
		expect(framework.activePage).toBe("sb-loop");
		expect(framework.contentEl.classList.contains("talos-canvas-shell")).toBe(true);
		const personal = createView("personal", false);
		const render = vi.spyOn(personal.superbrainPages, "render").mockImplementation(() => {});
		personal.openSuperbrainDetailPage("C01");
		expect(personal.activePage).toBe("today");
		expect(personal.superbrainPages.activeDetailId).toBeNull();
		expect(render).not.toHaveBeenCalled();
		expect(personal.contentEl.classList.contains("talos-canvas-shell")).toBe(false);
	});

	it("bridges Lens details to classic and restores Lens on a personal page without saving a preference", () => {
		const view = createView();
		view.plugin.talosSettings.uiLanguage = "lens";
		const lens = { navigate: vi.fn(), dispose: vi.fn(), setData: vi.fn() };
		view.lens = lens as unknown as typeof view.lens;
		vi.spyOn(view.superbrainPages, "render").mockImplementation(() => {});
		const restoredLens = { navigate: vi.fn(), dispose: vi.fn(), setData: vi.fn() };
		vi.spyOn(view as unknown as { buildLensShell(): void }, "buildLensShell").mockImplementation(() => {
			view.lens = restoredLens as unknown as typeof view.lens;
		});
		view.openSuperbrainDetailPage("M10");
		expect(view.activePage).toBe("sb-system");
		expect(view.superbrainPages.activeDetailId).toBe("M10");
		expect(lens.navigate).not.toHaveBeenCalled();
		expect(lens.dispose).toHaveBeenCalledOnce();
		expect(view.lens).toBeNull();
		view.navigateToPage("knowledge");
		expect(view.lens).toBe(restoredLens);
		expect(restoredLens.navigate).toHaveBeenCalledWith("knowledge");
		expect(view.plugin.talosSettings.uiLanguage).toBe("lens");
	});

	it("reuses the catalog group renderer inside personal content without rendering a second home canvas", () => {
		const view = createView();
		view.activePage = "sb-loop";
		const page = new HostDocument().createElement("div");
		const pages = view.superbrainPages as unknown as {
			renderSuperbrainCanvasHome(): void;
			renderSuperbrainCoreSide(): void;
			loadSuperbrainCoreEntries(): Promise<void>;
		};
		const canvas = vi.spyOn(pages, "renderSuperbrainCanvasHome").mockImplementation(() => {});
		vi.spyOn(pages, "renderSuperbrainCoreSide").mockImplementation(() => {});
		const load = vi.spyOn(pages, "loadSuperbrainCoreEntries").mockResolvedValue();
		view.superbrainPages.render(page as unknown as HTMLElement, view.data!);
		expect(canvas).not.toHaveBeenCalled();
		expect(load).toHaveBeenCalledWith(expect.anything(), ["C01", "C10", "C11"], "overview", expect.anything());
		const localScope = page.children[0];
		expect(localScope.classList.contains("talos-canvas-shell")).toBe(true);
		expect(localScope.getAttribute("data-talos-page")).toBe("sb-loop");
		expect(localScope.querySelector(".talos-core-context")).not.toBeNull();
		expect(localScope.querySelector(".app")).toBeNull();
		expect(localScope.querySelector(".sidebar")).toBeNull();
		expect(view.contentEl.classList.contains("talos-canvas-shell")).toBe(false);
	});

	it("does not leave Lens for unavailable C/M pages", () => {
		const view = createView("personal", false);
		view.plugin.talosSettings.uiLanguage = "lens";
		const lens = { navigate: vi.fn(), dispose: vi.fn(), setData: vi.fn() };
		view.lens = lens as unknown as typeof view.lens;
		view.openSuperbrainDetailPage("C01");
		expect(lens.navigate).toHaveBeenCalledWith("overview");
		expect(lens.dispose).not.toHaveBeenCalled();
		expect(view.superbrainPages.activeDetailId).toBeNull();
	});
});

function createView(mode: "personal" | "superbrain" = "personal", hasCatalog = true): InstanceType<typeof TalosView> {
	const { host } = createMiniHost();
	const contentEl = Object.assign(host, { scrollTop: 0, removeClass: (...classes: string[]) => host.classList.remove(...classes) });
	const view = Object.assign(Object.create(TalosView.prototype), {
		plugin: { hasSuperbrainCatalog: hasCatalog, talosSettings: { consoleMode: mode, uiLanguage: "classic", inboxFolder: "00-收件箱" } },
		app: { workspace: { requestSaveLayout: vi.fn() }, vault: { getFiles: () => [], getName: () => "测试资料库" } },
		pageRouter: new TalosPageRouter(),
		pageScroll: new Map<string, number>(),
		renderedPage: null,
		contentEl,
		pageEl: { empty: vi.fn() },
		pageNavEl: {},
		data: {},
		lens: null,
		peerStatus: null,
		renderNav: vi.fn(),
		renderSecondaryTabs: vi.fn(),
		updateCosmosHeader: vi.fn(),
		mountSetupHint: vi.fn(),
		wireModuleSelection: vi.fn(),
		syncPixelScene: vi.fn(),
		pageToday: vi.fn(),
	}) as InstanceType<typeof TalosView>;
	Object.assign(view, { superbrainPages: new SuperbrainPages(view) });
	return view;
}

class HostElement extends MiniElement {
	createEl(tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): HostElement {
		const child = this.ownerDocument.createElement(tag) as HostElement;
		if (options.cls) child.className = options.cls;
		if (options.text) child.textContent = options.text;
		for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, value);
		this.appendChild(child);
		return child;
	}
	createDiv(options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): HostElement {
		return this.createEl("div", options);
	}
}

class HostDocument extends MiniDocument {
	override createElement(tag: string): HostElement { return new HostElement(tag, this); }
}
