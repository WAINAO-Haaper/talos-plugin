import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { TalosView } from "../src/view";
import type { Collected } from "../src/ui/talos-view-model";

vi.mock("../src/actions", () => ({ openFile: vi.fn() }));
vi.mock("../src/ui/view-modules", () => ({ moduleHero: vi.fn() }));
vi.mock("../src/ui/charts/talos-view-charts", () => ({ fillProjectPortfolioChart: vi.fn() }));
vi.mock("../src/ui/pages/today-page", () => ({ renderTodayActions: vi.fn(), renderTodayQuickNote: vi.fn() }));

import { openFile } from "../src/actions";
import { moduleHero } from "../src/ui/view-modules";
import { fillProjectPortfolioChart } from "../src/ui/charts/talos-view-charts";
import { renderTodayActions, renderTodayQuickNote } from "../src/ui/pages/today-page";
import { renderWorkbenchProjects } from "../src/ui/pages/workbench-projects";

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
const windows: Window[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const win of windows.splice(0)) await win.happyDOM.close(); });

function fixture(projectReady = true, taskReady = true) {
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
	const renderDecisionWorkspace = vi.fn();
	const sendCommandToChat = vi.fn();
	const copyText = vi.fn();
	const view = {
		app: { vault: { getAbstractFileByPath: vi.fn().mockReturnValue(projectReady ? { children: [] } : null) } },
		paths: { dir: () => "项目", readme: () => "项目/README.md", sceneIndexFile: "项目/索引.md" },
		plugin: { talosSettings: { tasksPath: "tasks.md" } },
		renderDecisionWorkspace, sendCommandToChat, copyText, fillOverviewKanban: vi.fn(),
		panel: (parent: HTMLElement, _accent: string, title: string) => parent.createEl("section", { attr: { "aria-label": title } }),
	} as unknown as TalosView;
	const data = {
		setup: { tasksPath: taskReady ? "ok" : "missing", pendingApprovalsPath: "ok", candidatesPath: "missing" },
		projects: [{ name: "项目A", count: 45, latestMtime: Date.now(), readme: "项目/A/README.md", priority: "p1", progress: { done: 3, total: 5, sampled: true, scannedFiles: 40, totalFiles: 45 } }],
		focus: [{ title: "焦点A", level: "normal", path: "focus.md" }], focusTotal: 1,
		approvals: [{ title: "待审批", meta: "" }], candidates: [],
		overview: { taskFlow: { value: "50%", sub: "已完成1/2" } },
	} as unknown as Collected;
	return { page: page as unknown as HTMLElement, view, data, renderDecisionWorkspace, sendCommandToChat, copyText };
}

describe("project and task workspace", () => {
	it.each(["projects", "tasks"])("renders the same combined work surface for %s without duplicating decisions", (key) => {
		const { page, view, data, renderDecisionWorkspace } = fixture();
		renderWorkbenchProjects(view, page, data, key);
		expect(page.dataset.workbenchFocus).toBe(key);
		expect(page.querySelectorAll('[data-workbench-section="projects"]')).toHaveLength(1);
		expect(page.querySelectorAll('[data-workbench-section="decisions"]')).toHaveLength(1);
		expect(renderDecisionWorkspace).toHaveBeenCalledExactlyOnceWith(expect.anything(), data, 3);
		expect(renderTodayQuickNote).toHaveBeenCalledOnce();
		expect(renderTodayActions).toHaveBeenCalledOnce();
		expect(fillProjectPortfolioChart).toHaveBeenCalledOnce();
		expect(page.textContent).toContain("焦点A");
		expect(page.textContent).toContain("最近 40/45 篇");
		const projectButton = Array.from(page.querySelectorAll("button")).find((button) => button.textContent?.includes("项目A"));
		expect(projectButton).toBeDefined();
		projectButton?.click();
		expect(openFile).toHaveBeenCalledWith(view.app, "项目/A/README.md");
	});
	it("shows unavailable sources without reporting an empty project list or focus as facts", () => {
		const { page, view, data, renderDecisionWorkspace } = fixture(false, false);
		renderWorkbenchProjects(view, page, data, "tasks");
		expect(page.textContent).toContain("项目目录未配置或不存在");
		expect(page.textContent).toContain("任务池未配置或格式待检查");
		expect(page.textContent).not.toContain("项目A");
		expect(page.textContent).not.toContain("焦点A");
		expect(fillProjectPortfolioChart).not.toHaveBeenCalled();
		expect(renderDecisionWorkspace).toHaveBeenCalledOnce();
		const hero = vi.mocked(moduleHero).mock.calls[0]?.[2];
		expect(hero?.stats[0]?.value).toBe("—");
		expect(hero?.stats[2]?.value).toBe("—");
	});
	it("retains project retrieval and morning as prefill commands with copy on secondary action", () => {
		const { page, view, data, sendCommandToChat, copyText } = fixture();
		renderWorkbenchProjects(view, page, data, "projects");
		const buttons = Array.from(page.querySelectorAll<HTMLButtonElement>(".workbench-projects-commands button"));
		expect(buttons.map((button) => button.textContent)).toEqual(["检索项目", "晨间"]);
		buttons[0].click(); buttons[1].click();
		expect(sendCommandToChat.mock.calls).toEqual([["/retrieval"], ["/morning"]]);
		buttons[0].dispatchEvent(new page.ownerDocument.defaultView!.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		expect(copyText).toHaveBeenCalledExactlyOnceWith("/retrieval");
	});
});
