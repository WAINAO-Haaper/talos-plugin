import { readFileSync } from "node:fs";
import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { Window, type HTMLButtonElement as HappyButtonElement, type HTMLTextAreaElement as HappyTextAreaElement } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import {
	createConsoleActionRuntime,
	type ConsoleActionDependencies,
} from "../src/console-action-runtime";
import { MemoryRecoveryStore } from "../src/task-core/recovery-store";
import type { TaskTimerHost } from "../src/task-core/task-runner";
import { QuickNote } from "../src/ui/quick-note";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

const nodeTimers: TaskTimerHost = {
	schedule: (callback, timeoutMs) => nodeSetTimeout(callback, timeoutMs),
	cancel: (handle) => nodeClearTimeout(handle as NodeJS.Timeout),
};

describe("QuickNote", () => {
	it("keeps undo visually hidden until a saved note can be reverted under the console theme", async () => {
		const window = new Window();
		try {
			const doc = window.document;
			doc.body.setAttribute("data-talos-vault-theme", "geometric-modern");
			const style = doc.createElement("style");
			style.textContent = ["../styles.talos.css", "../styles.ui-v2.css"]
				.map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
			doc.head.appendChild(style);
			const parent = doc.createElement("div");
			parent.className = "talos-console";
			parent.setAttribute("data-talos-page", "today");
			parent.setAttribute("data-talos-theme", "geometric-modern");
			doc.body.appendChild(parent);
			const runtime = { runner: {
				run: vi.fn().mockResolvedValue({ id: "themed-note", state: "completed" }),
				canRevert: () => true,
				revert: vi.fn().mockResolvedValue(true),
			} } as unknown as ReturnType<typeof createConsoleActionRuntime>;
			new QuickNote({ parent: parent as unknown as HTMLElement, runtime, targetFolder: "收件箱" }).mount();
			const undo = parent.querySelector<HappyButtonElement>("button[data-talos-quick-note-action='undo']")!;
			const save = parent.querySelector<HappyButtonElement>("button[data-talos-quick-note-action='save']")!;
			expect(undo.hidden).toBe(true);
			expect(window.getComputedStyle(undo).display).toBe("none");
			expect(window.getComputedStyle(save).display).not.toBe("none");
			parent.querySelector<HappyTextAreaElement>("textarea")!.value = "主题下的便签";
			save.click();
			await vi.waitFor(() => expect(undo.hidden).toBe(false));
			expect(window.getComputedStyle(undo).display).not.toBe("none");
			undo.click();
			await vi.waitFor(() => expect(undo.hidden).toBe(true));
			expect(window.getComputedStyle(undo).display).toBe("none");
		} finally {
			await window.happyDOM.close();
		}
	});
	it("preserves a draft and an in-flight save when its host is rebuilt", async () => {
		let finish!: (value: unknown) => void;
		const run = vi.fn(() => new Promise(resolve => { finish = resolve; }));
		const runtime = { runner: { run, canRevert: () => false } } as unknown as ReturnType<typeof createConsoleActionRuntime>;
		const first = createMiniHost();
		const note = new QuickNote({ parent: first.host, runtime, targetFolder: () => "收件箱" });
		const root = note.mount();
		const textarea = first.element.querySelector<MiniElement>("textarea")!;
		textarea.value = "刷新时仍在编辑的想法";
		textarea.dispatch("input");
		const second = createMiniHost();
		first.element.replaceChildren();
		expect(note.mount(second.host)).toBe(root);
		expect(second.element.querySelector<MiniElement>("textarea")?.value).toBe("刷新时仍在编辑的想法");
		second.element.querySelector<MiniElement>("button[data-talos-quick-note-action='save']")!.click();
		expect(run).toHaveBeenCalledTimes(1);
		const third = createMiniHost();
		second.element.replaceChildren();
		note.mount(third.host);
		expect(third.element.querySelector<MiniElement>("button[data-talos-quick-note-action='save']")?.disabled).toBe(true);
		finish({ id: "saved-note", state: "completed" });
		await vi.waitFor(() => expect(third.element.textContent).toContain("已保存"));
		expect(third.element.querySelector<MiniElement>("textarea")?.value).toBe("");
	});
	it("saves through the recoverable B action and can undo", async () => {
		let executedInput: unknown;
		const execute = vi.fn(async (input: unknown) => {
			executedInput = input;
			return { created: true };
		});
		const noop = vi.fn().mockResolvedValue({});
		const dependencies: ConsoleActionDependencies = {
			refreshStats: noop,
			vaultLint: noop,
			deepResearch: noop,
			createNote: execute,
			publishBackfill: noop,
			decideApproval: noop,
			decidePreference: noop,
		};
		const runtime = createConsoleActionRuntime({
			dependencies,
			recoveryStore: new MemoryRecoveryStore(),
			timers: nodeTimers,
		});
		const { host, element } = createMiniHost();
		new QuickNote({
			parent: host,
			runtime,
			targetFolder: "00 收件箱",
			now: () => new Date(2026, 7, 23, 9, 8, 7),
		}).mount();

		const textarea = element.querySelector<MiniElement>("textarea");
		const save = element.querySelector<MiniElement>(
			"button[data-talos-quick-note-action='save']"
		);
		textarea!.value = "记录工作台重构验收结果";
		textarea!.dispatch("input");
		save!.click();

		await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
		expect(executedInput).toMatchObject({
			targetPath: "00 收件箱/talos-quick-note-20260823-090807.md",
		});
		const task = runtime.store.list()[0];
		if (!task) throw new Error("Quick note task was not recorded");
		expect(task.state).toBe("completed");
		expect(task.recoveryId).toBeTruthy();
		expect(element.textContent).toContain("已保存");

		const undo = element.querySelector<MiniElement>(
			"button[data-talos-quick-note-action='undo']"
		);
		expect(undo?.hidden).toBe(false);
		undo?.click();
		await vi.waitFor(() =>
			expect(runtime.store.get(task.id)?.state).toBe("reverted")
		);
		expect(element.textContent).toContain("已撤销");
	});
});
