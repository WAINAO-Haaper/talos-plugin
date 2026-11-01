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
	const sendCommand = vi.fn().mockResolvedValue(undefined);
	const copyText = vi.fn().mockResolvedValue(undefined);
	const navigate = vi.fn();
	const openDecisions = vi.fn();
	const view = {
		app: {}, activeCap: "commands", sendCommandToChat: sendCommand, copyText, navigateToPage: navigate, openDecisions,
		panel: (host: HTMLElement, _accent: string, title: string, description: string) => {
			const node = host.createEl("section"); node.createEl("h2", { text: title }); node.createEl("p", { text: description }); return node;
		},
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
	return { page: page as unknown as HTMLElement, view, data, sendCommand, copyText, navigate, openDecisions };
}

describe("system workbench integration", () => {
	it("keeps health, capability and identity in one page with old destinations", () => {
		const { page, view, data } = fixture();
		renderWorkbenchSystem(view, page, data, "identity");
		expect(Array.from(page.querySelectorAll("[data-workbench-section]"), (node) => node.getAttribute("data-workbench-section"))).toEqual(["health", "capability", "identity"]);
		expect(page.textContent).toContain("最近健康记录：88");
		expect(page.textContent).toContain("错误模式 · 来源待检查");
		expect(page.textContent).toContain("循环记录");
		expect(page.textContent).toContain("PERSONA");
		expect(page.querySelector('[data-workbench-section="identity"]')?.getAttribute("data-focus-requested")).toBe("true");
	});

	it("preserves command invocation, source opening, and separate missing-source feedback", () => {
		const { page, view, data, sendCommand, copyText, navigate, openDecisions } = fixture();
		renderWorkbenchSystem(view, page, data, "capability");
		const click = (name: string) => {
			const item = Array.from(page.querySelectorAll("button")).find((node) => node.textContent === name);
			expect(item).toBeDefined(); item!.click();
		};
		click("填入对话"); expect(sendCommand).toHaveBeenCalledWith("/morning");
		click("复制调用"); expect(copyText).toHaveBeenCalledWith("/morning");
		click("打开源文件"); expect(vi.mocked(openFile)).toHaveBeenCalledWith(view.app, "morning.md");
		click("处理待决策"); expect(openDecisions).toHaveBeenCalledOnce();
		click("打开错误模式来源"); expect(navigate).toHaveBeenCalledWith("settings");
		click("Agents —");
		expect(page.textContent).toContain("推荐入口，未发现对应文件");
		expect(page.textContent).toContain("部分能力来源不可用");
	});
});
