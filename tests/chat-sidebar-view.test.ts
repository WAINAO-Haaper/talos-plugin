import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pluginSource } from "./helpers/source-text";

const workbenchCalls = vi.hoisted(() => ({
	mount: vi.fn(), focus: vi.fn(), prefill: vi.fn(), destroy: vi.fn(),
}));

vi.mock("obsidian", () => {
	function element(): unknown {
		return { empty() {}, addClass() {}, createDiv: element, createEl: element };
	}
	return {
		ItemView: class {
			contentEl = element();
			constructor(public leaf: unknown) {}
		},
	};
});

vi.mock("../src/quyuan/deferred-chat-workbench", () => ({
	DeferredChatWorkbench: class {
		mount = workbenchCalls.mount;
		focusComposer = workbenchCalls.focus;
		prefillComposer = workbenchCalls.prefill;
		destroy = workbenchCalls.destroy;
	},
}));

const { revealChatSidebar, TalosChatSidebarView, VIEW_TYPE_TALOS_CHAT } = await import("../src/plugin/chat-sidebar-view");

function fakeLeaf() {
	const leaf = { view: null as InstanceType<typeof TalosChatSidebarView> | null, setViewState: vi.fn(async () => {
		leaf.view = new TalosChatSidebarView(leaf as never, { icon: "bot", waitForAgentWorkbench: vi.fn() });
		await leaf.view.onOpen();
	}) };
	return leaf;
}

describe("right sidebar chat", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		workbenchCalls.mount.mockResolvedValue(undefined);
		workbenchCalls.destroy.mockResolvedValue(undefined);
	});
	it("creates the chat view in the right sidebar the first time", async () => {
		const leaf = fakeLeaf();
		const workspace = { getLeavesOfType: vi.fn(() => []), getRightLeaf: vi.fn(() => leaf), revealLeaf: vi.fn() };
		await expect(revealChatSidebar(workspace as never)).resolves.toBe(leaf);
		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_TALOS_CHAT, active: true });
		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
	});

	it("reuses an existing chat leaf instead of opening another", async () => {
		const leaf = fakeLeaf();
		await leaf.setViewState();
		leaf.setViewState.mockClear();
		const workspace = { getLeavesOfType: vi.fn(() => [leaf]), getRightLeaf: vi.fn(), revealLeaf: vi.fn() };
		await expect(revealChatSidebar(workspace as never)).resolves.toBe(leaf);
		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(leaf.setViewState).not.toHaveBeenCalled();
	});

	it("returns null when the leaf opens but the workbench mount fails", async () => {
		workbenchCalls.mount.mockRejectedValue(new Error("runtime unavailable"));
		const leaf = fakeLeaf();
		const workspace = { getLeavesOfType: () => [], getRightLeaf: () => leaf, revealLeaf: vi.fn() };
		await expect(revealChatSidebar(workspace as never)).resolves.toBeNull();
		expect(workbenchCalls.focus).not.toHaveBeenCalled();
		expect(workbenchCalls.prefill).not.toHaveBeenCalled();
		await expect(revealChatSidebar({ ...workspace, getLeavesOfType: () => [leaf] } as never, "/intake"))
			.resolves.toBeNull();
		expect(workbenchCalls.prefill).not.toHaveBeenCalled();
	});

	it("waits for a reused view to finish mounting before focusing", async () => {
		let mounted!: () => void;
		workbenchCalls.mount.mockImplementation(() => new Promise<void>((resolve) => { mounted = resolve; }));
		const leaf = fakeLeaf();
		const opening = leaf.setViewState();
		const workspace = { getLeavesOfType: () => [leaf], getRightLeaf: vi.fn(), revealLeaf: vi.fn() };
		const result = revealChatSidebar(workspace as never);
		await Promise.resolve();
		expect(workbenchCalls.focus).not.toHaveBeenCalled();
		mounted();
		await opening;
		await expect(result).resolves.toBe(leaf);
		expect(workbenchCalls.focus).toHaveBeenCalledOnce();
	});

	it("prefills only after a successful mount and does not focus separately", async () => {
		const leaf = fakeLeaf();
		const workspace = { getLeavesOfType: () => [], getRightLeaf: () => leaf, revealLeaf: vi.fn() };
		await expect(revealChatSidebar(workspace as never, "/intake")).resolves.toBe(leaf);
		expect(workbenchCalls.prefill).toHaveBeenCalledExactlyOnceWith("/intake");
		expect(workbenchCalls.focus).not.toHaveBeenCalled();
	});

	it("does not report readiness if the view closes during mount", async () => {
		let mounted!: () => void;
		workbenchCalls.mount.mockImplementation(() => new Promise<void>((resolve) => { mounted = resolve; }));
		const leaf = fakeLeaf();
		const opening = leaf.setViewState();
		const workspace = { getLeavesOfType: () => [leaf], getRightLeaf: vi.fn(), revealLeaf: vi.fn() };
		const result = revealChatSidebar(workspace as never);
		await leaf.view!.onClose();
		mounted();
		await opening;
		await expect(result).resolves.toBeNull();
		expect(workbenchCalls.focus).not.toHaveBeenCalled();
	});

	it("registers the view and routes every chat entry to the sidebar", () => {
		const main = pluginSource();
		expect(main).toContain("VIEW_TYPE_TALOS_CHAT,");
		expect(main).toContain('id: "open-chat-sidebar"');
		const view = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");
		const render = view.slice(view.indexOf("\trenderPage(): void {"), view.indexOf("\tprivate syncPixelScene"));
		expect(render.indexOf('if (this.activePage === "chat")')).toBeLessThan(render.indexOf("const page = this.pageEl;"));
		expect(render).toContain("void this.plugin.activateChatSidebar();");
	});
});
