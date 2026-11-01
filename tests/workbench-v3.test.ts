import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { TalosView } from "../src/view";
import type { Collected } from "../src/ui/talos-view-model";

vi.mock("../src/ui/pages/workbench-data", () => ({ renderWorkbenchData: vi.fn() }));
vi.mock("../src/ui/pages/workbench-projects", () => ({ renderWorkbenchProjects: vi.fn() }));
vi.mock("../src/ui/pages/workbench-system", () => ({ renderWorkbenchSystem: vi.fn() }));

import { renderWorkbenchPage } from "../src/ui/pages/workbench-page";
import { renderWorkbenchData } from "../src/ui/pages/workbench-data";
import { renderWorkbenchProjects } from "../src/ui/pages/workbench-projects";
import { renderWorkbenchSystem } from "../src/ui/pages/workbench-system";

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
const windows: Window[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const win of windows.splice(0)) await win.happyDOM.close(); });

function fixture() {
	const win = new Window(); windows.push(win);
	function createEl(this: HTMLElement, tag: string, options: Options = {}) {
		const element = this.ownerDocument.createElement(tag);
		if (options.cls) element.className = options.cls;
		if (options.text !== undefined) element.textContent = options.text;
		for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
		this.appendChild(element); return element;
	}
	Object.defineProperties(win.HTMLElement.prototype, {
		createEl: { configurable: true, value: createEl },
		createDiv: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "div", options); } },
	});
	const page = win.document.createElement("main"); win.document.body.appendChild(page);
	const navigateToPage = vi.fn();
	return { page: page as unknown as HTMLElement, view: { navigateToPage } as unknown as TalosView, data: {} as Collected, navigateToPage };
}

describe("workbench integration", () => {
	it("offers three integrated categories with keyboard navigation", () => {
		const { page, view, data, navigateToPage } = fixture();
		renderWorkbenchPage(view, page, data, "inbox");
		const categories = page.querySelectorAll<HTMLButtonElement>(".workbench-category-nav button");
		expect(Array.from(categories, (button) => button.textContent)).toEqual(["资料", "项目与任务", "系统与记忆"]);
		expect(page.querySelector(".workbench-subnav")).toBeNull();
		expect(renderWorkbenchData).toHaveBeenCalledExactlyOnceWith(view, expect.anything(), data, "inbox");
		categories[1].click(); categories[2].click();
		expect(navigateToPage.mock.calls).toEqual([["projects"], ["health"]]);
		categories[0].dispatchEvent(new page.ownerDocument.defaultView!.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(navigateToPage).toHaveBeenLastCalledWith("projects");
	});

	it.each([
		["inbox", "data"], ["knowledge", "data"], ["output", "data"],
		["projects", "projects"], ["tasks", "projects"],
		["health", "system"], ["capability", "system"], ["identity", "system"],
	])("preserves %s as a deep link into the correct consolidated category", (key, group) => {
		const { page, view, data } = fixture();
		renderWorkbenchPage(view, page, data, key);
		const renderer = group === "data" ? renderWorkbenchData : group === "projects" ? renderWorkbenchProjects : renderWorkbenchSystem;
		expect(renderer).toHaveBeenCalledExactlyOnceWith(view, expect.anything(), data, key);
		expect(page.querySelector<HTMLElement>("[data-workbench-page]")?.dataset.workbenchPage).toBe(key);
	});
});
