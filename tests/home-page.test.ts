import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { Collected } from "../src/ui/talos-view-model";
import type { TalosView } from "../src/view";

vi.mock("obsidian", () => ({ setIcon: vi.fn(), Notice: class {} }));
vi.mock("../src/actions", () => ({ openFile: vi.fn() }));

import { renderHomePage } from "../src/ui/pages/home";

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
const windows: Window[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const win of windows.splice(0)) await win.happyDOM.close(); });

function fixture() {
	const win = new Window(); windows.push(win);
	function createEl(this: HTMLElement, tag: string, options: Options = {}) {
		const node = this.ownerDocument.createElement(tag);
		if (options.cls) node.className = options.cls;
		if (options.text !== undefined) node.textContent = options.text;
		for (const [key, value] of Object.entries(options.attr ?? {})) node.setAttribute(key, value);
		this.appendChild(node); return node;
	}
	Object.defineProperties(win.HTMLElement.prototype, {
		createEl: { configurable: true, value: createEl },
		createDiv: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "div", options); } },
		createSpan: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "span", options); } },
		empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
		setCssProps: { configurable: true, value(this: HTMLElement, props: Record<string, string>) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); } },
	});
	const page = win.document.createElement("main"); win.document.body.appendChild(page);
	const navigateToPage = vi.fn();
	const view = {
		app: { vault: { getAbstractFileByPath: () => ({ children: [] }) } },
		paths: {
			telosFile: "Identity/TELOS.md", contextFile: "Identity/CONTEXT.md", profileFile: "Identity/PROFILE.md",
			decisionsFile: "Identity/decisions.md", personaFile: "灵魂/PERSONA.md", personaMemoryFile: "灵魂/persona-memory.md",
			dir: (key: string) => key,
		},
		plugin: { talosSettings: { inboxFolder: "00-收件箱" } },
		navigateToPage,
	} as unknown as TalosView;
	const data = {
		total: 837,
		focus: [{ title: "焦点", level: "normal", path: "a.md" }],
		approvals: [{ title: "审批", meta: "" }],
		candidates: [{ title: "候选", meta: "" }],
		healthTrend: [{ label: "11-01", score: 87 }],
		healthDigest: { metrics: [], errors: [{ title: "e", meta: "" }], loopStatus: [] },
		inbox: {
			count: 17, oldestDays: 8, clusters: [], recent: [],
			ageBuckets: [{ label: "0-3d", count: 4, tone: "info" }, { label: "8-14d", count: 5, tone: "warn" }],
			queue: [{ path: "00-收件箱/a.md", title: "收件 A", ageDays: 8, tags: ["剪藏"], linked: [] }],
		},
		output: { metrics: [], queue: [], queueTotal: 4, queueStatus: "ready", platforms: [], opsCandidates: [] },
		knowledge: {
			metrics: [{ label: "原创洞察", value: "138" }, { label: "外部素材", value: "306" }, { label: "MOC 枢纽", value: "5" }],
			mocs: [{ title: "MOC", meta: "" }], recentInsights: [], recentMaterials: [],
		},
		projects: [{ name: "项目A", count: 10, readme: "x", status: "active", latestTitle: "" }],
		insights: {
			total: 837, tagCount: 126, topTags: [{ tag: "AI系统", count: 58 }],
			links: 1986, orphans: 26, broken: 12, density: 2.4, compliance: 96,
			months: Array.from({ length: 12 }, (_, index) => ({ label: String(index + 1).padStart(2, "0"), count: 20 + index, current: index === 11 })),
			folders: [{ name: "04-项目", count: 358 }, { name: "02-洞察", count: 138 }],
			untagged: 34, stale: 48, missingReadme: 3,
		},
		setup: {},
	} as unknown as Collected;
	return { page: page as unknown as HTMLElement, view, data, navigateToPage };
}

describe("首页三视图", () => {
	it("renders the three tabs and defaults to the organ panel", () => {
		const { page, view, data } = fixture();
		renderHomePage(view, page, data);
		const tabs = Array.from(page.querySelectorAll(".hm-tab"), (node) => node.textContent);
		expect(tabs).toEqual(["系统体检", "今日处理", "数据画像"]);
		expect(page.querySelectorAll(".hm-organ")).toHaveLength(8);
		expect(page.textContent).toContain("身份");
		expect(page.textContent).toContain("灵魂");
		expect(page.textContent).toContain("知识资产流动");
	});

	it("switches to the triage view and renders the submission queue", () => {
		const { page, view, data } = fixture();
		renderHomePage(view, page, data);
		Array.from(page.querySelectorAll<HTMLButtonElement>(".hm-tab")).find((b) => b.textContent === "今日处理")?.click();
		expect(page.querySelectorAll(".hm-qitem")).toHaveLength(1);
		expect(page.textContent).toContain("收件 A");
		expect(page.textContent).toContain("收下并归位");
		expect(page.textContent).toContain("打开原文");
	});

	it("switches to the insight view and renders keywords, growth and gaps", () => {
		const { page, view, data } = fixture();
		renderHomePage(view, page, data);
		Array.from(page.querySelectorAll<HTMLButtonElement>(".hm-tab")).find((b) => b.textContent === "数据画像")?.click();
		expect(page.querySelectorAll(".hm-kpi")).toHaveLength(4);
		expect(page.querySelectorAll(".hm-word").length).toBeGreaterThan(0);
		expect(page.querySelectorAll(".hm-month")).toHaveLength(12);
		expect(page.textContent).toContain("#AI系统");
		expect(page.textContent).toContain("孤儿笔记");
		expect(page.textContent).toContain("断链");
	});
});
