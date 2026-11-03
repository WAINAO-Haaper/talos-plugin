import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
vi.mock("obsidian", () => {
	class Stub {}
	return new Proxy({ __esModule: true, setIcon: vi.fn(), TFile: Stub }, {
		get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : Stub,
		has: () => true,
	});
});
vi.mock("../src/actions", () => new Proxy({ __esModule: true }, {
	get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : vi.fn(),
	has: () => true,
}));
vi.mock("../src/ui/view-modules", () => ({
	moduleHero: (_view: unknown, parent: HTMLElement) => parent.createEl("header", { cls: "talos-ui-page-header" }),
	commandActionHint: (value: string) => value,
}));
vi.mock("../src/ui/pages/today-page", () => ({ renderTodayActions: vi.fn(), renderTodayQuickNote: vi.fn() }));
vi.mock("../src/ui/lens/lens-data", () => ({ buildLensData: (_app: unknown, collected: unknown) => ({ collected, capturedAt: 0, projects: [], focus: null, peerState: "missing" }) }));
const { LensConsole } = await import("../src/ui/lens/lens-console");
const { renderSystem } = await import("../src/ui/lens/lens-system");
const { renderWorkbenchContent } = await import("../src/ui/pages/workbench-page");
const { renderDecisionWorkspace } = await import("../src/ui/view-approvals");
const { ConsoleActionPanel } = await import("../src/ui/console-action-panel");

function installObsidianDom(window: Window): void {
	type Options = { cls?: string; text?: string; attr?: Record<string, string> };
	function createEl(this: HTMLElement, tag: string, options: Options = {}) {
		const element = this.ownerDocument.createElement(tag);
		if (options.cls) element.className = options.cls;
		if (options.text !== undefined) element.textContent = options.text;
		for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
		this.appendChild(element);
		return element;
	}
	Object.defineProperties(window.HTMLElement.prototype, {
		createEl: { configurable: true, value: createEl },
		createDiv: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "div", options); } },
		createSpan: { configurable: true, value(this: HTMLElement, options?: Options) { return createEl.call(this, "span", options); } },
		addClass: { configurable: true, value(this: HTMLElement, ...names: string[]) { this.classList.add(...names); } },
		empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
	});
}

describe("Lens integrated workspaces", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("maps legacy locations into the compact workbench without losing their destinations", () => {
		const window = new Window();
		vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
		const onNavigate = vi.fn();
		const host = {
			app: {}, paths: () => ({}), tasksPath: () => "tasks.md", profileName: () => "TALOS", appearance: () => "light",
			openNote: vi.fn(), openChat: vi.fn(), openHarness: vi.fn(), renderSettings: vi.fn(), renderDecisions: vi.fn(), renderInbox: vi.fn(), renderWorkbench: vi.fn(), renderOverview: vi.fn(), mountVoice: vi.fn(),
			unmountVoice: vi.fn(), refresh: vi.fn(), onNavigate,
		};
		const console = new LensConsole(host as never, window.document.body as unknown as HTMLElement);
		for (const [module, tab, expectedModule, expectedTab] of [
			["collect", "backlog", "workbench", "inbox"], ["output", "queue", "workbench", "output"],
			["identity", "soul", "workbench", "identity"], ["system", "vault", "workbench", "knowledge"],
			["overview", "rhythm", "overview", "today"],
		] as const) {
			console.navigate(module, tab);
			expect(onNavigate).toHaveBeenLastCalledWith(expectedModule, expectedTab);
			expect(console.root.dataset.workspace).toBe(expectedModule);
			expect(console.root.dataset.view).toBe(expectedTab);
		}
		console.dispose();
		void window.happyDOM.abort();
	});

	it("keeps voice mounted during refresh and releases it when changing assistant tabs", () => {
		const window = new Window();
		vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
		const host = {
			app: {}, paths: () => ({}), tasksPath: () => "tasks.md", profileName: () => "TALOS", appearance: () => "light",
			openNote: vi.fn(), openChat: vi.fn(), openHarness: vi.fn(), renderSettings: vi.fn(), renderDecisions: vi.fn(), renderInbox: vi.fn(), renderWorkbench: vi.fn(), renderOverview: vi.fn(), mountVoice: vi.fn(),
			unmountVoice: vi.fn(), refresh: vi.fn(), onNavigate: vi.fn(),
		};
		const console = new LensConsole(host as never, window.document.body as unknown as HTMLElement);
		console.navigate("voice");
		console.setData({} as never, null);
		expect(host.mountVoice).toHaveBeenCalledTimes(1);
		console.setData({} as never, null);
		expect(host.mountVoice).toHaveBeenCalledTimes(1);
		console.navigate("assistant", "chat");
		expect(host.unmountVoice).toHaveBeenCalledTimes(1);
		expect(console.root.dataset.view).toBe("chat");
		console.navigate("overview", "today");
		console.navigate("assistant");
		expect(host.onNavigate).toHaveBeenLastCalledWith("assistant", "voice");
		expect(host.mountVoice).toHaveBeenCalledTimes(2);
		console.dispose();
		void window.happyDOM.abort();
	});

	it("cleans workbench action subscriptions before refresh, leaving and disposal", () => {
		const window = new Window();
		vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
		const listeners = new Set<() => void>();
		const subscribe = vi.fn((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; });
		const runtime = { registry: { get: () => ({ id: "refresh-stats", label: "刷新统计", risk: "A" }) }, runner: { run: vi.fn() }, store: { subscribe, findByIdempotencyKey: () => undefined } };
		let panel: InstanceType<typeof ConsoleActionPanel> | null = null;
		const mountWorkbench = vi.fn((parent: HTMLElement, key: string) => {
			if (key !== "tasks") return;
			panel = new ConsoleActionPanel({ parent, runtime: runtime as never, actions: [{ actionId: "refresh-stats", idempotencyKey: "check", input: undefined, request: { readPaths: [], writePaths: [], effects: ["read"] }, proposal: { title: "刷新统计", provider: "local", steps: [], fileCount: 0, keyDiffs: [], reversible: false } }] });
			panel.mount();
		});
		const cleanupPage = vi.fn(() => { panel?.unmount(); panel = null; });
		const host = {
			app: {}, paths: () => ({}), tasksPath: () => "tasks.md", profileName: () => "TALOS", appearance: () => "light",
			openNote: vi.fn(), openChat: vi.fn(), openHarness: vi.fn(), renderSettings: vi.fn(), renderDecisions: vi.fn(), renderInbox: vi.fn(),
			renderWorkbench: mountWorkbench, renderOverview: vi.fn(), cleanupPage, mountVoice: vi.fn(), unmountVoice: vi.fn(), refresh: vi.fn(), onNavigate: vi.fn(),
		};
		const console = new LensConsole(host as never, window.document.body as unknown as HTMLElement);
		console.setData({} as never, null);
		const overviewHost = console.root.querySelector('.talos-lens-native[aria-label="系统总览"]');
		expect(overviewHost?.classList.contains("talos-console")).toBe(true);
		expect(overviewHost?.classList.contains("talos-ui-page")).toBe(true);
		expect(overviewHost?.getAttribute("data-talos-theme")).toBe("light");
		console.navigate("workbench", "tasks");
		expect(console.root.querySelector('.talos-lens-native[aria-label="工作台"]')?.classList.contains("talos-console")).toBe(true);
		expect(mountWorkbench).toHaveBeenLastCalledWith(expect.anything(), "tasks");
		expect(listeners.size).toBe(1);
		console.setData({} as never, null);
		expect(listeners.size).toBe(1);
		expect(mountWorkbench).toHaveBeenCalledTimes(2);
		expect(subscribe).toHaveBeenCalledTimes(2);
		console.navigate("overview", "today");
		expect(listeners.size).toBe(0);
		console.navigate("workbench", "tasks");
		console.dispose();
		expect(listeners.size).toBe(0);
		void window.happyDOM.abort();
	});

	it("shows missing sources rather than false zeroes in overview and output", () => {
		const window = new Window();
		vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
		installObsidianDom(window);
		const paths = { dir: (key: string) => key, readme: (key: string) => `${key}/_README.md`, outletFile: "output.md", mocDir: "moc", mocReadme: "moc/README.md", sceneIndexFile: "projects/index.md" };
		const app = { vault: { getAbstractFileByPath: () => null } };
		const data = {
			total: 0, dist: [], modules: [], focus: [], focusTotal: 0, approvals: [], candidates: [],
			setup: { tasksPath: "missing", pendingApprovalsPath: "missing", candidatesPath: "missing" },
			healthDigest: { metrics: [], errors: [], loopStatus: [] },
			overview: { taskFlow: { label: "任务池完成占比", value: "—", sub: "任务池未配置" }, totalNotes: { sub: "六类目录" } },
			inbox: { count: 0, oldestDays: 0, ageBuckets: [], clusters: [], recent: [], queue: [] },
			knowledge: { metrics: [], recentInsights: [], recentMaterials: [], mocs: [] }, output: { queue: [], queueStatus: "missing" }, projects: [],
		};
		const view = {
			app, paths, activeCap: "commands", panelTabSelections: new Map(),
			plugin: { talosSettings: { tasksPath: "tasks.md", inboxFolder: "inbox", pendingApprovalsPath: "approvals.md", candidatesPath: "candidates.md" } },
			pageRouter: { current: () => ({ primary: "workbench", secondary: "tasks" }) },
			panel: (parent: HTMLElement, _accent: string, title: string, desc: string) => { const node = parent.createEl("section"); node.createEl("h2", { text: title }); node.createEl("small", { text: desc }); return node; },
			fillOverviewKanban: vi.fn(), navigateToPage: vi.fn(), sendCommandToChat: vi.fn(), copyText: vi.fn(),
			renderDecisionWorkspace: (parent: HTMLElement, items: unknown, limit: number) => renderDecisionWorkspace(view as never, parent, items as never, limit),
		};
		const renderWorkbench = vi.fn((parent: HTMLElement, key: string) => renderWorkbenchContent(view as never, parent, data as never, key));
		const host = {
			app, paths: () => paths, tasksPath: () => "tasks.md", profileName: () => "TALOS", appearance: () => "light",
			openNote: vi.fn(), openChat: vi.fn(), openHarness: vi.fn(), renderSettings: vi.fn(), renderDecisions: vi.fn(), renderInbox: vi.fn(), renderWorkbench, renderOverview: vi.fn(), mountVoice: vi.fn(),
			unmountVoice: vi.fn(), refresh: vi.fn(), onNavigate: vi.fn(),
		};
		const console = new LensConsole(host as never, window.document.body as unknown as HTMLElement);
		console.setData(data as never, null);
		expect(host.renderOverview).toHaveBeenCalled();
		console.navigate("workbench", "tasks");
		expect(console.root.textContent).toContain("变更审批");
		expect(console.root.textContent).toContain("偏好确认");
		expect(console.root.textContent).toContain("来源文件未找到");
		expect(renderWorkbench).toHaveBeenLastCalledWith(expect.anything(), "tasks");
		console.navigate("knowledge", "output");
		expect(renderWorkbench).toHaveBeenLastCalledWith(expect.anything(), "output");
		expect(console.root.textContent).toContain("待处理输出 · 来源待检查");
		expect(console.root.textContent).not.toContain("待处理 0 项");
		console.dispose();
		void window.happyDOM.abort();
	});

	it("offers both command prefill and source inspection for discovered capabilities", () => {
		const window = new Window();
		const invokeCommand = vi.fn();
		const openDrawer = vi.fn();
		const ctx = {
			doc: window.document, tab: "capability", app: { vault: { getAbstractFileByPath: () => null } },
			paths: { errorPatternsFile: "errors.md" }, invokeCommand, openDrawer,
			data: { capturedAt: 0, collected: { setup: {}, approvals: [], healthDigest: { metrics: [], errors: [] },
				capGroups: [{ label: "命令", meta: "", sourceStatus: "ready", items: [{ name: "/intake", invoke: "/intake", origin: "discovered", path: "commands/intake.md" }] }] } },
		};
		const host = window.document.createElement("div");
		for (const child of renderSystem(ctx as never)) if (child instanceof window.Node) host.appendChild(child);
		(host.querySelector('[aria-label="填入对话：/intake"]') as HTMLButtonElement).click();
		(host.querySelector('[aria-label="打开源文件：/intake"]') as HTMLButtonElement).click();
		expect(invokeCommand).toHaveBeenCalledWith("/intake");
		expect(openDrawer).toHaveBeenCalledWith("commands/intake.md");
		void window.happyDOM.abort();
	});
});
