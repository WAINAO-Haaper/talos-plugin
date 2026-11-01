import { afterEach, describe, expect, it, vi } from "vitest";
import { Window, type HTMLElement as HappyElement, type HTMLButtonElement as HappyButton } from "happy-dom";
import type { TalosView } from "../src/view";
import type { Collected } from "../src/ui/talos-view-model";

vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../src/actions", () => ({ openFile: vi.fn() }));
vi.mock("../src/ui/console-action-panel", () => ({ ConsoleActionPanel: class {} }));
vi.mock("../src/ui/quick-note", () => ({ QuickNote: class {} }));
vi.mock("../src/ui/view-modules", () => ({ moduleHero: vi.fn() }));
import { moduleHero } from "../src/ui/view-modules";
import { openFile } from "../src/actions";
import { renderTodayPage } from "../src/ui/pages/today-page";
import { renderTalosPageHeader } from "../src/ui/page-primitives";

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
const windows: Window[] = [];
afterEach(async () => { vi.useRealTimers(); vi.clearAllMocks(); for (const w of windows.splice(0)) await w.happyDOM.close(); });
function setup(opts: { missing?: string[]; health?: "ok" | "missing" | "format"; tasks?: "ok" | "missing" | "format" } = {}) {
	vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1, 10));
	const w = new Window(); windows.push(w);
	function createEl(this: HTMLElement, tag: string, options: Options = {}) {
		const node = this.ownerDocument.createElement(tag);
		if (options.cls) node.className = options.cls;
		if (options.text !== undefined) node.textContent = options.text;
		for (const [key, value] of Object.entries(options.attr ?? {})) node.setAttribute(key, value);
		this.appendChild(node); return node;
	}
	Object.defineProperties(w.HTMLElement.prototype, {
		createEl: { configurable: true, value: createEl },
		createDiv: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "div", options); } },
		createSpan: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "span", options); } },
		addClass: { configurable: true, value(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); } },
		setCssProps: { configurable: true, value(this: HTMLElement, props: Record<string, string>) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); } },
	});
	const page = w.document.createElement("main"); w.document.body.appendChild(page);
	const navigate = vi.fn(), decisions = vi.fn();
	const view = {
		app: { vault: { getAbstractFileByPath: (path: string) => opts.missing?.includes(path) ? null : { children: [] } } },
		plugin: { talosSettings: { inboxFolder: "inbox", tasksPath: "tasks" } },
		paths: { dir: (key: string) => key }, navigateToPage: navigate, openDecisions: decisions,
		panel: (host: HTMLElement, _color: string, title: string, detail: string) => {
			const node = host.createEl("section", { attr: { "data-panel": title } }); node.createEl("h2", { text: title }); node.createEl("p", { text: detail }); return node;
		},
	} as unknown as TalosView;
	const data = {
		total: 15, dist: [
			{ name: "项目", count: 3, readme: "projects/_README.md" },
			{ name: "素材", count: 4, readme: "assets/_README.md" },
			{ name: "洞察", count: 2, readme: "insights/_README.md" },
			{ name: "归档", count: 1, readme: "archive/_README.md" },
			{ name: "日志", count: 2, readme: "logs/_README.md" },
			{ name: "收件箱", count: 3, readme: "inbox/_README.md" },
		],
		heatmap: { meta: "2 active days", months: [{ label: "11月", weeks: [[{ date: "2026-11-01", count: 2, level: 2 }, { date: "2026-11-02", count: 0, level: 0 }]] }] },
		inbox: { count: 3, oldestDays: 8, ageBuckets: [{ label: "0–3d", count: 1, tone: "info" }, { label: ">14d", count: 2, tone: "hot" }] },
		projects: [{ name: "项目甲", latestMtime: new Date(2026, 9, 30).getTime() }],
		focus: [{ title: "示例焦点内容" }], approvals: [{ title: "审批甲" }], candidates: [],
		healthTrend: [{ label: "10-01", score: 70 }, { label: "10-30", score: 90 }],
		overview: { taskFlow: { value: "50%", sub: "1/2" } },
		setup: { tasksPath: opts.tasks ?? "ok", healthLogPath: opts.health ?? "ok", pendingApprovalsPath: "ok", candidatesPath: "format" },
	} as unknown as Collected;
	renderTodayPage(view, page as unknown as HTMLElement, data);
	return { w, page, navigate, decisions };
}

describe("系统图形总览", () => {
	it("显示四张图形和有来源的关键指标，图表可键盘跳转", () => {
		const { w, page, navigate, decisions } = setup();
		expect(page.querySelectorAll(".talos-home-v3-chart")).toHaveLength(4);
		expect(page.querySelector(".talos-home-v3-line polyline")).not.toBeNull();
		expect(page.textContent).toContain("文件创建时间，迁移可能改变日期");
		expect(page.querySelectorAll(".talos-home-v3-cell.is-empty")).toHaveLength(1);
		const panels = [...page.querySelectorAll<HappyElement>(".talos-home-v3-chart")];
		expect(panels[0]?.getAttribute("role")).toBe("group");
		const rows = [...page.querySelectorAll<HappyButton>(".talos-home-v3-bar")];
		expect(rows).toHaveLength(6);
		for (const row of rows) { expect(row.tagName).toBe("BUTTON"); expect(row.tabIndex).toBe(0); }
		rows[0]?.click(); expect(navigate).toHaveBeenLastCalledWith("projects");
		rows[1]?.click(); expect(navigate).toHaveBeenLastCalledWith("knowledge");
		rows[2]?.click(); expect(navigate).toHaveBeenLastCalledWith("knowledge");
		rows[3]?.click(); expect(openFile).toHaveBeenLastCalledWith(expect.anything(), "archive/_README.md");
		rows[4]?.click(); expect(openFile).toHaveBeenLastCalledWith(expect.anything(), "logs/_README.md");
		rows[5]?.click(); expect(navigate).toHaveBeenLastCalledWith("inbox");
		expect(navigate).toHaveBeenCalledTimes(4);
		panels[1]?.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(navigate).toHaveBeenLastCalledWith("knowledge");
		panels[2]?.click(); expect(navigate).toHaveBeenCalledWith("inbox");
		const summary = [...page.querySelectorAll<HappyButton>(".talos-home-v3-summary-item")];
		summary[2]?.click(); expect(decisions).toHaveBeenCalledOnce();
		const stats = vi.mocked(moduleHero).mock.calls.at(-1)?.[2].stats ?? [];
		expect(stats.find((item) => item.label === "最近健康记录")?.sub).toContain("10-30");
	});
	it("对缺失或格式异常来源显示未知，不把它们画成零或展示过期数据", () => {
		const { page } = setup({ missing: ["inbox", "projects"], health: "format", tasks: "format" });
		expect(page.textContent).toContain("收件目录未配置");
		expect(page.textContent).toContain("健康日志未配置或格式待检查");
		expect(page.querySelector(".talos-home-v3-line")).toBeNull();
		const stats = vi.mocked(moduleHero).mock.calls.at(-1)?.[2].stats ?? [];
		for (const label of ["收件积压", "项目", "任务池完成", "最近健康记录"]) expect(stats.find((item) => item.label === label)?.value).toBe("—");
		expect(page.textContent).not.toContain("示例焦点内容");
	});
	it("首页明确启用第五张健康卡，真实页头渲染并可进入健康详情；其他页默认四张", () => {
		const { page, navigate } = setup();
		const config = vi.mocked(moduleHero).mock.calls.at(-1)?.[2];
		expect(config?.metricLimit).toBe(5);
		if (!config) throw new Error("首页配置缺失");
		const options = {
			accent: config.ac, icon: config.icon, eyebrow: config.eyebrow ?? "", title: config.title, description: config.desc,
			metrics: config.stats.map((item) => ({ label: item.label, value: item.value, detail: item.sub, onActivate: item.onActivate })),
		};
		const host = page.ownerDocument.createElement("div");
		const header = renderTalosPageHeader(host as unknown as HTMLElement, { ...options, metricLimit: config.metricLimit });
		const cards = header.querySelectorAll<HTMLElement>(".talos-ui-page-header__metric");
		expect(cards).toHaveLength(5);
		const health = cards[4];
		expect(health?.getAttribute("aria-label")).toBe("最近健康记录：90");
		health?.click();
		expect(navigate).toHaveBeenLastCalledWith("health");
		const ordinary = renderTalosPageHeader(host as unknown as HTMLElement, options);
		expect(ordinary.querySelectorAll(".talos-ui-page-header__metric")).toHaveLength(4);
	});
});
