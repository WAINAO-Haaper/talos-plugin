import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("obsidian", () => {
	class Base {
		contentEl = { empty() {}, addClass() {}, createDiv() { return {}; } };
		constructor(public leaf?: unknown) {}
	}
	return {
		ItemView: Base,
		Modal: Base,
		FuzzySuggestModal: Base,
		Component: Base,
		MarkdownRenderer: { render: async () => undefined },
		MarkdownView: Base,
		TFile: Base,
		Notice: class {},
		setIcon: () => undefined,
		normalizePath: (path: string) => path,
	};
});

const { DeferredChatWorkbench } = await import("../src/quyuan/deferred-chat-workbench");
const { revealChatSidebar, TalosChatSidebarView } = await import("../src/plugin/chat-sidebar-view");
const { NativeComposer } = await import("../src/agent-workbench/ui/native-composer");

function innerWorkbench() {
	return {
		mount: vi.fn(async () => undefined),
		suspend: vi.fn(async () => undefined),
		focusComposer: vi.fn(),
		prefillComposer: vi.fn(),
		destroy: vi.fn(async () => undefined),
	};
}

describe("console command → TALOS chat prefill", () => {
	it("queues a prefill until the deferred workbench is mounted, then fills it once", async () => {
		const inner = innerWorkbench();
		const deferred = new DeferredChatWorkbench(async () => inner);
		deferred.prefillComposer("/intake");
		expect(inner.prefillComposer).not.toHaveBeenCalled();
		await deferred.mount({} as HTMLElement, "chat");
		expect(inner.prefillComposer).toHaveBeenCalledTimes(1);
		expect(inner.prefillComposer).toHaveBeenCalledWith("/intake");
		deferred.prefillComposer("/digest");
		expect(inner.prefillComposer).toHaveBeenLastCalledWith("/digest");
		expect(inner.prefillComposer).toHaveBeenCalledTimes(2);
	});

	it("fills the composer without sending: text set, focused, cursor at end, onSend untouched", () => {
		const onSend = vi.fn();
		const textarea = { value: "", focus: vi.fn(), setSelectionRange: vi.fn() };
		const updateSuggestions = vi.fn();
		const composer = Object.assign(Object.create(NativeComposer.prototype), {
			textarea,
			updateSuggestions,
			options: { onSend },
		}) as InstanceType<typeof NativeComposer>;
		composer.prefill("/morning");
		expect(textarea.value).toBe("/morning");
		expect(textarea.focus).toHaveBeenCalledTimes(1);
		expect(textarea.setSelectionRange).toHaveBeenCalledWith(8, 8);
		expect(updateSuggestions).toHaveBeenCalledTimes(1);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("reveals the sidebar and prefills instead of only focusing", async () => {
		const view = Object.create(TalosChatSidebarView.prototype) as InstanceType<typeof TalosChatSidebarView>;
		const inner = innerWorkbench();
		Object.assign(view, { workbench: inner, mountError: null });
		const leaf = { view, setViewState: vi.fn() };
		const workspace = { getLeavesOfType: vi.fn(() => [leaf]), getRightLeaf: vi.fn(), revealLeaf: vi.fn() };
		await expect(revealChatSidebar(workspace as never, "开工")).resolves.toBe(leaf);
		expect(inner.prefillComposer).toHaveBeenCalledWith("开工");
		expect(inner.focusComposer).not.toHaveBeenCalled();
	});

	it("reports failure so the console can fall back to copying", async () => {
		const view = Object.create(TalosChatSidebarView.prototype) as InstanceType<typeof TalosChatSidebarView>;
		Object.assign(view, { workbench: innerWorkbench(), mountError: "加载失败" });
		const failing = { getLeavesOfType: vi.fn(() => [{ view }]), getRightLeaf: vi.fn(), revealLeaf: vi.fn() };
		await expect(revealChatSidebar(failing as never, "/intake")).resolves.toBeNull();
		const notLoaded = { getLeavesOfType: vi.fn(() => [{ view: {} }]), getRightLeaf: vi.fn(), revealLeaf: vi.fn() };
		await expect(revealChatSidebar(notLoaded as never, "/intake")).resolves.toBeNull();
	});

	it("routes every console command entry to the chat and keeps copy only as the right-click path", () => {
		const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
		const sources = [read("ui/view-modules.ts"), read("ui/pages/knowledge-pages.ts")];
		for (const source of sources) {
			expect(source).toContain("sendCommandToChat(");
			expect(source).not.toMatch(/addEventListener\("click", \(\) =>\s*void view\.copyText/);
		}
		expect(read("view.ts")).toContain("async sendCommandToChat(command: string)");
	});
});
