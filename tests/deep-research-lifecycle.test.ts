import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notices: string[] = [];

vi.mock("obsidian", () => {
	class MockTFile {
		constructor(readonly path: string) {}
		get basename(): string { return this.path.split("/").at(-1)?.replace(/\.md$/, "") || ""; }
	}
	return {
		App: class {},
		ItemView: class {},
		Modal: class {
			constructor(readonly app: unknown) {}
			close(): void {}
		},
		Notice: class { constructor(message: string) { notices.push(message); } },
		Setting: class {},
		TFile: MockTFile,
		TFolder: class {},
		normalizePath: (path: string) => path,
	};
});

import { TFile } from "obsidian";
import { CreateModal, openResearchWorkbench, vaultLint } from "../src/actions";
import { revealChatSidebar, TalosChatSidebarView } from "../src/plugin/chat-sidebar-view";
import type { TalosSettings } from "../src/settings";

function vaultHarness(initial: Record<string, string> = {}) {
	const bodies = new Map(Object.entries(initial));
	const files = new Map([...bodies.keys()].map((path) => [path, new TFile(path)]));
	const openFile = vi.fn().mockResolvedValue(undefined);
	const vault = {
		configDir: ".test-config",
		getAbstractFileByPath: (path: string) => files.get(path) || null,
		getMarkdownFiles: () => [...files.values()],
		createFolder: vi.fn().mockResolvedValue(undefined),
		create: vi.fn(async (path: string, body: string) => {
			if (files.has(path)) throw new Error("File already exists");
			const file = new TFile(path);
			files.set(path, file);
			bodies.set(path, body);
			return file;
		}),
		modify: vi.fn(),
	};
	const app = {
		vault,
		metadataCache: { getFileCache: vi.fn(() => null) },
		workspace: { getLeaf: () => ({ openFile }) },
	};
	return { app, vault, bodies, openFile };
}

describe("console action safety", () => {
	beforeEach(() => { notices.length = 0; });
	afterEach(() => { vi.useRealTimers(); });

	it("opens research without supplying a draft or send payload", async () => {
		const open = vi.fn().mockResolvedValue({});
		await expect(openResearchWorkbench(open)).resolves.toEqual({ workbenchOpened: true, sent: false });
		expect(open).toHaveBeenCalledExactlyOnceWith();
	});

	it("reuses the real chat leaf without prefilling or sending the existing draft", async () => {
		const draft = "existing research draft";
		const prefill = vi.fn();
		const send = vi.fn();
		const view = Object.assign(Object.create(TalosChatSidebarView.prototype), {
			workbench: { focusComposer: vi.fn(), prefillComposer: prefill, send }, mountError: null, draft,
		}) as InstanceType<typeof TalosChatSidebarView> & { draft: string };
		const leaf = { view, setViewState: vi.fn() };
		const workspace = { getLeavesOfType: () => [leaf], getRightLeaf: vi.fn(), revealLeaf: vi.fn() };
		await expect(openResearchWorkbench(() => revealChatSidebar(workspace as never)))
			.resolves.toEqual({ workbenchOpened: true, sent: false });
		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect(leaf.view.draft).toBe(draft);
		expect(prefill).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("does not report success when the real workspace cannot create a chat leaf", async () => {
		const workspace = { getLeavesOfType: () => [], getRightLeaf: () => null, revealLeaf: vi.fn() };
		await expect(openResearchWorkbench(() => revealChatSidebar(workspace)))
			.rejects.toThrow("无法在右侧边栏打开 AI 工作台");
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
		expect(notices).toEqual([]);
	});

	it("does not report an opened workbench when opening fails", async () => {
		await expect(openResearchWorkbench(vi.fn().mockRejectedValue(new Error("workspace unavailable")))).rejects.toThrow("workspace unavailable");
		expect(notices).toEqual([]);
	});

	it("does not open the workbench for an already cancelled action", async () => {
		const open = vi.fn();
		const controller = new AbortController();
		controller.abort();
		await expect(openResearchWorkbench(open, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
		expect(open).not.toHaveBeenCalled();
	});

	it("uses one read-only lint result without creating folders or overwriting reports", () => {
		const { app, vault } = vaultHarness({
			"00 收件箱/a.md": "draft",
			"30 洞察/b.md": "complete",
			"System/config.md": "system",
			"30 洞察/_README.md": "index",
		});
		app.metadataCache.getFileCache = vi.fn((file?: TFile) => file?.path.endsWith("b.md")
			? { frontmatter: { tags: ["knowledge"], status: "active" } } : null) as typeof app.metadataCache.getFileCache;
		expect(vaultLint(app as never)).toEqual({ notes: 2, missingFrontmatter: 1, missingTags: 0, missingStatus: 0 });
		expect(vault.createFolder).not.toHaveBeenCalled();
		expect(vault.create).not.toHaveBeenCalled();
		expect(vault.modify).not.toHaveBeenCalled();
	});

	it("creates a distinct weekly report and preserves same-day reports", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 28, 12));
		const original = "original weekly report";
		const { app, vault, bodies, openFile } = vaultHarness({
			"70 输出/weekly-2026-10-28.md": original,
			"70 输出/weekly-2026-10-28-2.md": "second report",
		});
		const onDone = vi.fn();
		const modal = new CreateModal(app as never, { reportsFolder: "70 输出" } as TalosSettings, onDone);
		modal.kind = "weekly";
		modal.content = "new progress";
		await modal.submit();
		expect(bodies.get("70 输出/weekly-2026-10-28.md")).toBe(original);
		expect(bodies.get("70 输出/weekly-2026-10-28-2.md")).toBe("second report");
		expect(bodies.get("70 输出/weekly-2026-10-28-3.md")).toContain("new progress");
		expect(vault.modify).not.toHaveBeenCalled();
		expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "70 输出/weekly-2026-10-28-3.md" }));
		expect(onDone).toHaveBeenCalledOnce();
	});
});
