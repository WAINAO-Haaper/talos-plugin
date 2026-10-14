import { describe, expect, it, vi } from "vitest";
import { openSuperbrainCardLibrary, renderSuperbrainHomeSearch } from "../src/ui/superbrain-home-components";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

type MiniListener = Parameters<MiniElement["addEventListener"]>[1];

function createHost() {
	const host = createMiniHost();
	const document = host.element.ownerDocument as typeof host.element.ownerDocument & { activeElement: MiniElement | null };
	document.activeElement = null;
	const createElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation(tagName => {
		const element = createElement(tagName);
		Object.defineProperty(element, "childElementCount", { get: () => element.children.length });
		Object.assign(element, {
			focus() { document.activeElement = element; },
			removeEventListener(type: string, listener: MiniListener) {
				element.listeners.set(type, (element.listeners.get(type) ?? []).filter(candidate => candidate !== listener));
			},
		});
		if (tagName === "dialog") {
			Object.assign(element, {
				open: false,
				showModal() { Object.assign(element, { open: true }); },
				close() { Object.assign(element, { open: false }); element.dispatch("close"); },
			});
		}
		return element;
	});
	return { ...host, document };
}

function query(element: MiniElement, selector: string): MiniElement {
	const found = element.querySelector<MiniElement>(selector);
	if (!found) throw new Error(`Missing ${selector}`);
	return found;
}

function key(element: MiniElement, value: string, extras: Record<string, unknown> = {}): void {
	const event = { key: value, preventDefault() {}, stopPropagation() {}, ...extras };
	for (const listener of element.listeners.get("keydown") ?? []) listener(event);
}

const icon = (_element: HTMLElement, _name: string) => {};

describe("superbrain home search", () => {
	it("filters real names and paths, matches actions, and limits results to six", () => {
		const { host, element } = createHost();
		const openFile = vi.fn();
		const openAction = vi.fn();
		renderSuperbrainHomeSearch(host, {
			files: [
				{ path: "04-项目/读书/<笔记>.md", name: "<笔记>" },
				...Array.from({ length: 8 }, (_, index) => ({ path: `资料/记录${index}.md`, name: `记录${index}` })),
			],
			actions: [{ id: "C03", label: "检索", icon: "search" }], openFile, openAction, icon,
		});
		const input = query(element, ".talos-home-search__input");
		const results = query(element, ".talos-home-search__results");
		expect(results.hidden).toBe(true);
		input.value = "读书";
		input.dispatch("input");
		expect(results.children).toHaveLength(1);
		expect(results.textContent).toContain("<笔记>");
		results.children[0].click();
		expect(openFile).toHaveBeenCalledExactlyOnceWith("04-项目/读书/<笔记>.md");
		input.value = "c03";
		input.dispatch("input");
		key(input, "Enter");
		expect(openAction).toHaveBeenCalledExactlyOnceWith("C03");
		input.value = "记录";
		input.dispatch("input");
		expect(results.children).toHaveLength(6);
		input.value = "不存在";
		input.dispatch("input");
		expect(query(element, ".talos-home-search__empty").textContent).toContain("没有找到");
		input.value = " ";
		input.dispatch("input");
		expect(results.hidden).toBe(true);
		expect(results.children).toHaveLength(0);
	});

	it("never opens a result during Chinese composition and respects Escape", () => {
		const { host, element } = createHost();
		const openAction = vi.fn();
		renderSuperbrainHomeSearch(host, { files: [], actions: [{ id: "C02", label: "入库", icon: "inbox" }], openFile: vi.fn(), openAction, icon });
		const input = query(element, ".talos-home-search__input");
		const results = query(element, ".talos-home-search__results");
		input.value = "入";
		input.dispatch("input");
		key(input, "Enter", { isComposing: true });
		key(input, "Enter", { keyCode: 229 });
		input.dispatch("compositionstart");
		input.value = "入库";
		input.dispatch("input");
		key(input, "Enter");
		expect(openAction).not.toHaveBeenCalled();
		expect(results.hidden).toBe(true);
		input.dispatch("compositionend");
		expect(results.hidden).toBe(false);
		key(query(element, ".talos-home-search"), "Escape");
		key(input, "Enter");
		expect(openAction).not.toHaveBeenCalled();
		input.dispatch("input");
		key(input, "Enter");
		expect(openAction).toHaveBeenCalledExactlyOnceWith("C02");
	});

	it("removes previous result listeners and all listeners on cleanup", () => {
		const { host, element } = createHost();
		const openFile = vi.fn();
		const cleanup = renderSuperbrainHomeSearch(host, { files: [{ path: "资料/笔记.md", name: "笔记" }], actions: [], openFile, openAction: vi.fn(), icon });
		const input = query(element, ".talos-home-search__input");
		input.value = "笔记";
		input.dispatch("input");
		const previous = query(element, ".talos-home-search__result");
		input.dispatch("input");
		expect(previous.listeners.get("click")).toHaveLength(0);
		const current = query(element, ".talos-home-search__result");
		cleanup(); cleanup();
		expect(element.children).toHaveLength(0);
		for (const listeners of input.listeners.values()) expect(listeners).toHaveLength(0);
		expect(current.listeners.get("click")).toHaveLength(0);
		current.dispatch("click");
		input.dispatch("input");
		expect(openFile).not.toHaveBeenCalled();
	});
});

describe("superbrain card library", () => {
	it("blocks already added cards even for a dispatched disabled click", () => {
		const { host, element } = createHost();
		const onAdd = vi.fn();
		const cleanup = openSuperbrainCardLibrary(host, { added: ["focus"], onAdd, icon });
		const card = query(element, "button[data-card='focus']");
		expect(card.disabled).toBe(true);
		expect(card.textContent).toContain("已添加");
		card.dispatch("click");
		expect(onAdd).not.toHaveBeenCalled();
		cleanup();
	});

	it("combines category and description filtering without duplicating cards", () => {
		const { host, element } = createHost();
		const cleanup = openSuperbrainCardLibrary(host, { added: [], onAdd: vi.fn(), icon });
		const grid = query(element, ".talos-home-library-grid");
		expect(grid.children).toHaveLength(7);
		const filters = query(element, ".talos-home-library-filters");
		const category = filters.children.find(button => button.textContent === "资料");
		category?.click();
		expect(grid.children.map(card => card.dataset.card)).toEqual(["inbox", "recent"]);
		expect(category?.getAttribute("aria-pressed")).toBe("true");
		const search = query(element, ".talos-home-library-search");
		search.value = "最近修改";
		search.dispatch("input");
		expect(grid.children.map(card => card.dataset.card)).toEqual(["recent"]);
		search.value = "系统";
		search.dispatch("input");
		expect(query(element, ".talos-home-library-empty").textContent).toContain("没有匹配");
		cleanup();
	});

	it("closes and restores focus before adding, and cleans up native Escape", () => {
		const { host, element, document } = createHost();
		const trigger = document.createElement("button");
		element.appendChild(trigger);
		(trigger as unknown as HTMLElement).focus();
		const onAdd = vi.fn(() => {
			expect(element.querySelector("dialog")).toBeNull();
			expect(document.activeElement).toBe(trigger);
		});
		openSuperbrainCardLibrary(host, { added: [], onAdd, icon });
		const card = query(element, "button[data-card='recent']");
		card.click();
		expect(onAdd).toHaveBeenCalledExactlyOnceWith("recent");
		card.dispatch("click");
		expect(onAdd).toHaveBeenCalledTimes(1);
		const cleanup = openSuperbrainCardLibrary(host, { added: [], onAdd, icon });
		const dialog = query(element, "dialog");
		const close = query(element, ".talos-home-library-close");
		dialog.dispatch("cancel");
		cleanup();
		expect(element.querySelector("dialog")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(close.listeners.get("click")).toHaveLength(0);
		for (const listeners of dialog.listeners.values()) expect(listeners).toHaveLength(0);
	});
});
