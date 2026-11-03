import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { TalosView } from "../src/view";
import type { Collected } from "../src/ui/talos-view-model";

vi.mock("../src/actions", () => ({ openFile: vi.fn().mockResolvedValue(undefined) }));
import { openFile } from "../src/actions";
import { renderWorkbenchSystem } from "../src/ui/pages/workbench-system";

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
const windows: Window[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const win of windows.splice(0)) await win.happyDOM.close(); });

function fixture() {
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
		createDiv: { configurable: true, value(this: HTMLElement, opts?: Options) { return createEl.call(this, "div", opts); } },
		empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
	});
	const page = win.document.createElement("main"); win.document.body.appendChild(page);
	const sendCommandToChat = vi.fn().mockResolvedValue(undefined);
	const copyText = vi.fn().mockResolvedValue(undefined);
	const navigateToPage = vi.fn();
	const openDecisions = vi.fn();
	const view = {
		app: {}, activeCap: "commands", sendCommandToChat, copyText, navigateToPage, openDecisions,
		plugin: { talosSettings: { tasksPath: "tasks.md", pendingApprovalsPath: "approvals.md", candidatesPath: "candidates.md", healthLogPath: "health.md" } },
		paths: { readme: (key: string) => `${key}/README.md`, errorPatternsFile: "errors.md", loopHealthFile: "loops.md", telosFile: "telos.md", contextFile: "context.md", profileFile: "profile.md", decisionsFile: "decisions.md", personaFile: "persona.md", personaMemoryFile: "persona-memory.md" },
	} as unknown as TalosView;
	const data = {
		setup: { healthLogPath: "ok", pendingApprovalsPath: "ok", candidatesPath: "missing", tasksPath: "ok", errorPatterns: "missing", loopHealth: "ok", context: "ok", persona: "ok" },
		healthDigest: { metrics: [{ label: "健康分", value: "88", sub: "2026-10-30" }], errors: [], loopStatus: [{ title: "循环记录", meta: "10-30", path: "loops.md" }] },
		approvals: [{ title: "审批", meta: "" }], candidates: [], focusTotal: 2,
		capGroups: [
			{ key: "commands", label: "命令", sourceStatus: "ready", items: [{ name: "/morning", invoke: "/morning", desc: "晨间", path: "morning.md", origin: "discovered" }] },
			{ key: "agents", label: "Agents", sourceStatus: "unavailable", items: [{ name: "推荐", invoke: "agent", desc: "", origin: "fallback" }] },
		],
	} as unknown as Collected;
	return { page: page as unknown as HTMLElement, view, data, sendCommandToChat, copyText, navigateToPage, openDecisions, win };
}

describe("系统与记忆工作台", () => {
	it("renders the unified skeleton and never claims zero for missing sources", () => {
		const { page, view, data } = fixture();
		renderWorkbenchSystem(view, page, data, "health");
		expect(page.querySelectorAll(".talos-wb-kpi")).toHaveLength(3);
		expect(page.querySelectorAll(".talos-wb-block")).toHaveLength(2);
		expect(page.querySelectorAll('[data-workbench-section="health"]')).toHaveLength(1);
		expect(page.querySelectorAll('[data-workbench-section="capability"]')).toHaveLength(1);
		expect(page.querySelector(".talos-wb-focus-title")?.textContent).toContain("健康分 88");
		expect(page.textContent).toContain("循环状态");
		expect(page.textContent).toContain("来源待检查");
	});

	it("opens the health detail for the health deep link with its original actions", () => {
		const { page, view, data, openDecisions, sendCommandToChat } = fixture();
		renderWorkbenchSystem(view, page, data, "health");
		const detail = page.querySelector<HTMLDetailsElement>('[data-workbench-data="health"]');
		expect(detail?.open).toBe(true);
		expect(page.textContent).toContain("循环记录");
		const click = (name: string) => {
			const item = Array.from(page.querySelectorAll<HTMLButtonElement>(".talos-wb-link")).find((node) => node.textContent === name);
			expect(item).toBeDefined(); item!.click();
		};
		click("处理待决策"); expect(openDecisions).toHaveBeenCalledOnce();
		click("快检 /maintain quick"); expect(sendCommandToChat).toHaveBeenCalledWith("/maintain quick");
	});

	it("keeps capability browsing with invoke, copy and source opening", () => {
		const { page, view, data, sendCommandToChat, copyText } = fixture();
		renderWorkbenchSystem(view, page, data, "capability");
		const capDetail = page.querySelector<HTMLDetailsElement>('[data-workbench-data="capability"]');
		expect(capDetail?.open).toBe(true);
		const click = (name: string) => {
			const item = Array.from(page.querySelectorAll<HTMLButtonElement>(".talos-wb-link")).find((node) => node.textContent === name);
			expect(item).toBeDefined(); item!.click();
		};
		click("填入对话"); expect(sendCommandToChat).toHaveBeenCalledWith("/morning");
		click("复制调用"); expect(copyText).toHaveBeenCalledWith("/morning");
		click("打开源文件"); expect(vi.mocked(openFile)).toHaveBeenCalledWith(view.app, "morning.md");
		click("Agents —");
		expect(page.textContent).toContain("推荐入口，未发现对应文件");
		expect(page.textContent).toContain("部分能力来源不可用");
	});

	it("exposes identity entries for the identity deep link", () => {
		const { page, view, data } = fixture();
		renderWorkbenchSystem(view, page, data, "identity");
		const detail = page.querySelector<HTMLDetailsElement>('[data-workbench-data="identity"]');
		expect(detail?.open).toBe(true);
		expect(page.textContent).toContain("PERSONA");
		const persona = Array.from(page.querySelectorAll<HTMLButtonElement>(".talos-wb-row")).find((node) => node.textContent?.includes("PERSONA"));
		persona?.click();
		expect(vi.mocked(openFile)).toHaveBeenCalledWith(view.app, "persona.md");
	});
});
