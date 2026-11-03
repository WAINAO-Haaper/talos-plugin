import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { TalosView } from "../src/view";
import type { Collected } from "../src/ui/talos-view-model";

vi.mock("../src/actions", () => ({ openFile: vi.fn() }));
vi.mock("../src/ui/charts/talos-view-charts", () => ({ fillProjectPortfolioChart: vi.fn() }));
vi.mock("../src/ui/pages/today-page", () => ({ renderTodayActions: vi.fn(), renderTodayQuickNote: vi.fn() }));

import { openFile } from "../src/actions";
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
	const navigateToPage = vi.fn();
	const view = {
		app: { vault: { getAbstractFileByPath: vi.fn().mockReturnValue(projectReady ? { children: [] } : null) } },
		paths: { dir: () => "项目", readme: () => "项目/README.md", sceneIndexFile: "项目/索引.md" },
		plugin: { talosSettings: { tasksPath: "tasks.md" } },
		renderDecisionWorkspace, sendCommandToChat, copyText, navigateToPage, fillOverviewKanban: vi.fn(),
	} as unknown as TalosView;
	const data = {
		setup: { tasksPath: taskReady ? "ok" : "missing", pendingApprovalsPath: "ok", candidatesPath: "missing" },
		projects: [{ name: "项目A", count: 45, latestMtime: Date.now(), readme: "项目/A/README.md", priority: "p1", progress: { done: 3, total: 5, sampled: true, scannedFiles: 40, totalFiles: 45 } }],
		focus: [{ title: "焦点A", level: "normal", path: "focus.md", doneWhen: "完成 A" }], focusTotal: 1,
		approvals: [{ title: "待审批", meta: "" }], candidates: [],
		overview: { taskFlow: { value: "50%", sub: "已完成1/2" } },
	} as unknown as Collected;
	return { page: page as unknown as HTMLElement, view, data, renderDecisionWorkspace, sendCommandToChat, copyText, navigateToPage, win };
}

function openDetail(page: HTMLElement, key: string, win: Window): void {
	const detail = page.querySelector<HTMLDetailsElement>(`[data-workbench-data="${key}"]`);
	expect(detail).not.toBeNull();
	detail!.open = true;
	detail!.dispatchEvent(new win.Event("toggle"));
}

describe("项目与任务工作台", () => {
	it("renders the unified skeleton with one project block and one decision block", () => {
		const { page, view, data, renderDecisionWorkspace } = fixture();
		renderWorkbenchProjects(view, page, data, "projects");
		expect(page.dataset.workbenchFocus).toBe("projects");
		expect(page.querySelectorAll(".talos-wb-block")).toHaveLength(2);
		expect(page.querySelectorAll('[data-workbench-section="projects"]')).toHaveLength(1);
		expect(page.querySelectorAll('[data-workbench-section="decisions"]')).toHaveLength(1);
		expect(renderDecisionWorkspace).toHaveBeenCalledExactlyOnceWith(expect.anything(), data, 3);
		expect(page.querySelector(".talos-wb-focus-title")?.textContent).toBe("焦点A");
		expect(page.textContent).toContain("项目A");
		const projectButton = Array.from(page.querySelectorAll<HTMLButtonElement>(".talos-wb-row")).find((button) => button.textContent?.includes("项目A"));
		projectButton?.click();
		expect(openFile).toHaveBeenCalledWith(view.app, "项目/A/README.md");
	});

	it("does not claim zero for missing project or task sources", () => {
		const { page, view, data } = fixture(false, false);
		renderWorkbenchProjects(view, page, data, "tasks");
		expect(page.textContent).toContain("项目目录未配置或不存在");
		expect(page.textContent).toContain("任务池未配置或格式待检查");
		expect(page.textContent).not.toContain("项目A");
		const values = Array.from(page.querySelectorAll(".talos-wb-kpi-value"), (node) => node.textContent);
		expect(values[0]).toBe("—个");
		expect(values[1]).toBe("—个");
	});

	it("keeps retrieval and morning as prefill commands with copy on secondary action", () => {
		const { page, view, data, sendCommandToChat, copyText, win } = fixture();
		renderWorkbenchProjects(view, page, data, "projects");
		const buttons = Array.from(page.querySelectorAll<HTMLButtonElement>(".talos-wb-link"));
		const retrieval = buttons.find((button) => button.textContent === "检索项目");
		const morning = buttons.find((button) => button.textContent === "晨间");
		retrieval?.click(); morning?.click();
		expect(sendCommandToChat.mock.calls).toEqual([["/retrieval"], ["/morning"]]);
		retrieval?.dispatchEvent(new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		expect(copyText).toHaveBeenCalledExactlyOnceWith("/retrieval");
	});

	it("mounts the heavy panels only when their details are expanded", () => {
		const { page, view, data, win } = fixture();
		renderWorkbenchProjects(view, page, data, "projects");
		expect(fillProjectPortfolioChart).not.toHaveBeenCalled();
		expect(renderTodayQuickNote).not.toHaveBeenCalled();
		expect(renderTodayActions).not.toHaveBeenCalled();
		openDetail(page, "portfolio", win);
		expect(fillProjectPortfolioChart).toHaveBeenCalledOnce();
		openDetail(page, "quick-note", win);
		expect(renderTodayQuickNote).toHaveBeenCalledOnce();
		openDetail(page, "runtime", win);
		expect(renderTodayActions).toHaveBeenCalledOnce();
	});
});
