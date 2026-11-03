import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { Collected } from "../src/ui/talos-view-model";
import type { TalosView } from "../src/view";

vi.mock("../src/actions", () => ({ openFile: vi.fn() }));
vi.mock("../src/ui/pages/workspace-pages", () => ({ renderInboxPage: vi.fn((_view, content: HTMLElement) => { content.createEl("header", { cls: "talos-ui-page-header" }); content.createEl("button", { text: "原分诊操作" }); }) }));
vi.mock("../src/ui/pages/knowledge-pages", () => ({ renderKnowledgePage: vi.fn((_view, content: HTMLElement) => { content.createEl("header", { cls: "talos-ui-page-header" }); content.createEl("button", { text: "原知识详情" }); }) }));
vi.mock("../src/ui/pages/project-pages", () => ({ renderOutputPage: vi.fn((_view, content: HTMLElement) => { content.createEl("header", { cls: "talos-ui-page-header" }); content.createEl("button", { text: "原输出详情" }); }) }));

import { openFile } from "../src/actions";
import { renderInboxPage } from "../src/ui/pages/workspace-pages";
import { renderKnowledgePage } from "../src/ui/pages/knowledge-pages";
import { renderOutputPage } from "../src/ui/pages/project-pages";
import { renderWorkbenchData } from "../src/ui/pages/workbench-data";

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
const windows: Window[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const win of windows.splice(0)) await win.happyDOM.close(); });

function fixture(missing: string[] = [], outputStatus: "ready" | "format" | "missing" = "ready") {
	const win = new Window(); windows.push(win);
	function createEl(this: HTMLElement, tag: string, options: Options = {}) {
		const el = this.ownerDocument.createElement(tag);
		if (options.cls) el.className = options.cls;
		if (options.text !== undefined) el.textContent = options.text;
		for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
		this.appendChild(el); return el;
	}
	Object.defineProperties(win.HTMLElement.prototype, {
		createEl: { configurable: true, value: createEl },
		createDiv: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "div", options); } },
		scrollIntoView: { configurable: true, value: vi.fn() },
	});
	const page = win.document.createElement("main"); win.document.body.appendChild(page);
	const sendCommandToChat = vi.fn(); const copyText = vi.fn(); const openDecisions = vi.fn(); const navigateToPage = vi.fn();
	const view = {
		app: { vault: { getAbstractFileByPath: (path: string) => missing.includes(path) ? null : { children: [] } } },
		plugin: { talosSettings: { inboxFolder: "inbox" } },
		paths: { dir: (key: string) => key, readme: (key: string) => `${key}/README.md`, mocDir: "moc", mocReadme: "moc/README.md", outletFile: "output.md" },
		sendCommandToChat, copyText, openDecisions, navigateToPage,
	} as unknown as TalosView;
	const data = {
		inbox: {
			count: 4, oldestDays: 9,
			queue: [
				{ path: "inbox/a.md", title: "收件 A", ageDays: 9, tags: ["剪藏"], linked: [] },
				{ path: "inbox/b.md", title: "收件 B", ageDays: 6, tags: [], linked: [] },
			],
			ageBuckets: [{ label: "0-3 天", count: 2, tone: "good" }],
		},
		knowledge: { metrics: [{ label: "原创洞察", value: "2" }, { label: "外部素材", value: "3" }], recentInsights: [{ title: "洞察 A", path: "insights/a.md" }], recentMaterials: [{ title: "素材 A", path: "assets/a.md" }], mocs: [{ title: "MOC A", path: "moc/a.md" }] },
		output: { queueStatus: outputStatus, queueTotal: outputStatus === "ready" ? 10 : undefined, queue: [{ title: "输出 A", path: "output/a.md" }] },
		setup: { pendingApprovalsPath: "ok", candidatesPath: "ok" },
		approvals: [{ title: "审批", meta: "" }],
		candidates: [{ title: "候选", meta: "" }],
	} as unknown as Collected;
	return { page: page as unknown as HTMLElement, view, data, sendCommandToChat, copyText, openDecisions, navigateToPage, win };
}

describe("资料工作台首页", () => {
	it("renders the unified one-screen skeleton with one focus card and two work blocks", () => {
		const { page, view, data } = fixture();
		renderWorkbenchData(view, page, data, "inbox");
		expect(page.querySelector(".talos-wb-home")).not.toBeNull();
		expect(page.querySelectorAll(".talos-wb-kpi")).toHaveLength(3);
		expect(page.querySelectorAll(".talos-wb-block")).toHaveLength(2);
		expect(page.querySelector(".talos-wb-focus-card")?.textContent).toContain("收件 A");
		expect(page.querySelectorAll(".talos-wb-focus-row")).toHaveLength(3);
		const values = Array.from(page.querySelectorAll(".talos-wb-kpi-value"), (node) => node.textContent);
		expect(values).toEqual(["4条", "2篇", "3篇"]);
		expect(page.textContent).toContain("收件与分诊");
		expect(page.textContent).toContain("最近洞察");
		expect(page.textContent).toContain("洞察 A");
	});

	it("keeps inbox commands and file destinations on the home surface", () => {
		const { page, view, data, sendCommandToChat } = fixture();
		renderWorkbenchData(view, page, data, "inbox");
		const click = (name: string) => {
			const item = Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.includes(name));
			expect(item).toBeDefined(); item!.click();
		};
		click("开始归档 /intake"); expect(sendCommandToChat).toHaveBeenCalledWith("/intake");
		click("消化偏好 /digest"); expect(sendCommandToChat).toHaveBeenCalledWith("/digest");
		click("收件地图"); expect(openFile).toHaveBeenCalledWith(view.app, "inbox/README.md");
		click("去确认 →"); expect(view.openDecisions).toHaveBeenCalledOnce();
	});

	it("opens the matching full detail for old deep links and drops its duplicated header", () => {
		const first = fixture(); renderWorkbenchData(first.view, first.page, first.data, "knowledge");
		const knowledge = first.page.querySelector<HTMLDetailsElement>('[data-workbench-data="knowledge"]');
		expect(knowledge?.open).toBe(true);
		expect(renderKnowledgePage).toHaveBeenCalledOnce();
		expect(first.page.textContent).toContain("原知识详情");
		expect(first.page.querySelector(".talos-wb-detail-body .talos-ui-page-header")).toBeNull();

		const second = fixture(); renderWorkbenchData(second.view, second.page, second.data, "output");
		expect(second.page.querySelector<HTMLDetailsElement>('[data-workbench-data="output"]')?.open).toBe(true);
		expect(renderOutputPage).toHaveBeenCalledOnce();
		expect(second.page.textContent).toContain("原输出详情");
	});

	it("does not claim zero for missing sources and keeps format warnings visible", () => {
		const { page, view, data } = fixture(["inbox", "insights", "moc"], "format");
		renderWorkbenchData(view, page, data, "inbox");
		expect(page.textContent).toContain("收件目录未配置或不存在");
		expect(page.textContent).toContain("洞察目录未配置或不存在");
		const values = Array.from(page.querySelectorAll(".talos-wb-kpi-value"), (node) => node.textContent);
		expect(values[0]).toBe("—条");
		expect(page.textContent).toContain("格式待检查");
	});

	it("collapses details by default and opens them on demand", () => {
		const { page, view, data } = fixture();
		renderWorkbenchData(view, page, data, "inbox");
		const inboxDetail = page.querySelector<HTMLDetailsElement>('[data-workbench-data="inbox"]');
		expect(inboxDetail?.open).toBe(false);
		const knowledge = page.querySelector<HTMLDetailsElement>('[data-workbench-data="knowledge"]');
		expect(knowledge?.open).toBe(false);
		const knowledgeOpener = Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent === "打开知识库 →");
		knowledgeOpener?.click();
		expect(knowledge?.open).toBe(true);
		expect(renderKnowledgePage).toHaveBeenCalled();
		const inboxOpener = Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent === "查看全部分诊 →");
		inboxOpener?.click();
		expect(inboxDetail?.open).toBe(true);
		expect(renderInboxPage).toHaveBeenCalled();
	});
});
