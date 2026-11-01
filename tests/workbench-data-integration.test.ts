import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { Collected } from "../src/ui/talos-view-model";
import type { TalosView } from "../src/view";

vi.mock("../src/actions", () => ({ openFile: vi.fn() }));
vi.mock("../src/ui/view-modules", () => ({ moduleHero: vi.fn() }));
vi.mock("../src/ui/pages/workspace-pages", () => ({ renderInboxPage: vi.fn((_view, content: HTMLElement) => { content.createEl("header", { cls: "talos-ui-page-header" }); content.createEl("button", { text: "原分诊操作" }); }) }));
vi.mock("../src/ui/pages/knowledge-pages", () => ({ renderKnowledgePage: vi.fn((_view, content: HTMLElement) => { content.createEl("header", { cls: "talos-ui-page-header" }); content.createEl("button", { text: "原知识详情" }); }) }));
vi.mock("../src/ui/pages/project-pages", () => ({ renderOutputPage: vi.fn((_view, content: HTMLElement) => { content.createEl("header", { cls: "talos-ui-page-header" }); content.createEl("button", { text: "原输出详情" }); }) }));

import { openFile } from "../src/actions";
import { moduleHero } from "../src/ui/view-modules";
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
	const sendCommandToChat = vi.fn(); const copyText = vi.fn();
	const view = {
		app: { vault: { getAbstractFileByPath: (path: string) => missing.includes(path) ? null : { children: [] } } },
		plugin: { talosSettings: { inboxFolder: "inbox" } },
		paths: { dir: (key: string) => key, readme: (key: string) => `${key}/README.md`, mocDir: "moc", mocReadme: "moc/README.md", outletFile: "output.md" },
		panel: (host: HTMLElement, _color: string, title: string, description: string) => { const p = host.createEl("section", { attr: { "data-panel": title } }); p.createEl("h2", { text: title }); p.createEl("p", { text: description }); return p; },
		sendCommandToChat, copyText,
	} as unknown as TalosView;
	const data = {
		inbox: { count: 4, oldestDays: 9 },
		knowledge: { metrics: [{ label: "原创洞察", value: "2" }, { label: "外部素材", value: "3" }], recentInsights: [{ title: "洞察 A", path: "insights/a.md" }], recentMaterials: [{ title: "素材 A", path: "assets/a.md" }], mocs: [{ title: "MOC A", path: "moc/a.md" }] },
		output: { queueStatus: outputStatus, queueTotal: outputStatus === "ready" ? 10 : undefined, queue: [{ title: "输出 A", path: "output/a.md" }] },
	} as unknown as Collected;
	return { page: page as unknown as HTMLElement, view, data, sendCommandToChat, copyText, win };
}

describe("资料工作台综合模块", () => {
	it("同屏呈现三类内容并保留收件原操作，详情不重复旧页头", () => {
		const { page, view, data, sendCommandToChat, copyText, win } = fixture();
		renderWorkbenchData(view, page, data, "inbox");
		expect(Array.from(page.querySelectorAll("[data-panel]"), (el) => el.getAttribute("data-panel"))).toEqual(["收件与分诊", "知识与 MOC", "输出"]);
		expect(page.textContent).toContain("洞察 A"); expect(page.textContent).toContain("素材 A"); expect(page.textContent).toContain("MOC A"); expect(page.textContent).toContain("输出 A");
		expect(renderInboxPage).toHaveBeenCalledOnce(); expect(page.textContent).toContain("原分诊操作");
		expect(page.querySelector(".talos-ui-page-header")).toBeNull();
		const buttons = Array.from(page.querySelectorAll<HTMLButtonElement>("button"));
		buttons.find((b) => b.textContent === "开始归档")?.click();
		expect(sendCommandToChat).toHaveBeenCalledWith("/intake");
		buttons.find((b) => b.textContent === "消化偏好")?.dispatchEvent(new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		expect(copyText).toHaveBeenCalledWith("/digest");
		buttons.find((b) => b.textContent === "收件地图")?.click();
		expect(openFile).toHaveBeenCalledWith(view.app, "inbox/README.md");
	});
	it("旧知识和输出地址分别展开正确详情并保留原功能", () => {
		const first = fixture(); renderWorkbenchData(first.view, first.page, first.data, "knowledge");
		expect(first.page.querySelector<HTMLDetailsElement>('[data-workbench-data="knowledge"]')?.open).toBe(true);
		expect(renderKnowledgePage).toHaveBeenCalledOnce(); expect(first.page.textContent).toContain("原知识详情");
		const second = fixture(); renderWorkbenchData(second.view, second.page, second.data, "output");
		expect(second.page.querySelector<HTMLDetailsElement>('[data-workbench-data="output"]')?.open).toBe(true);
		expect(renderOutputPage).toHaveBeenCalledOnce(); expect(second.page.textContent).toContain("原输出详情");
		const opener = Array.from(second.page.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "打开输出"); opener?.click();
		expect(openFile).toHaveBeenCalledWith(second.view.app, "output.md");
	});
	it("缺失目录与旧输出格式显示待检查，不伪称零，仍允许浏览原内容", () => {
		const { page, view, data } = fixture(["inbox", "insights", "moc"], "format"); renderWorkbenchData(view, page, data, "inbox");
		expect(page.textContent).toContain("收件目录未配置或不存在"); expect(page.textContent).toContain("洞察目录未配置或不存在");
		expect(page.textContent).toContain("MOC 目录未配置或不存在"); expect(page.textContent).toContain("格式待检查"); expect(page.textContent).toContain("输出 A");
		const stats = vi.mocked(moduleHero).mock.calls.at(-1)?.[2].stats ?? [];
		expect(stats.find((s) => s.label === "收件积压")?.value).toBe("—"); expect(stats.find((s) => s.label === "待处理输出")?.value).toBe("—");
	});
	it("统计卡可打开对应详情，原生 details 可通过键盘操作", () => {
		const { page, view, data } = fixture(); renderWorkbenchData(view, page, data, "inbox");
		const stats = vi.mocked(moduleHero).mock.calls.at(-1)?.[2].stats ?? [];
		stats.find((s) => s.label === "待处理输出")?.onActivate?.();
		const detail = page.querySelector<HTMLDetailsElement>('[data-workbench-data="output"]');
		expect(detail?.open).toBe(true); expect(detail?.querySelector("summary")?.getAttribute("aria-label")).toBe("展开完整输出详情");
	});
});
