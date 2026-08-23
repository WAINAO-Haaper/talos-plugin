import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
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
