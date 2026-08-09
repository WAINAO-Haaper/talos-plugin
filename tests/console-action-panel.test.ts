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
import { ConsoleActionPanel } from "../src/ui/console-action-panel";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

const nodeTimers: TaskTimerHost = {
	schedule: (callback, timeoutMs) => nodeSetTimeout(callback, timeoutMs),
	cancel: (handle) => nodeClearTimeout(handle as NodeJS.Timeout),
};

function runtimeWith(executions: string[]) {
	const dependency = (id: string) => vi.fn(async () => {
		executions.push(id);
		return { id };
	});
	const dependencies: ConsoleActionDependencies = {
		refreshStats: dependency("refresh-stats"),
		vaultLint: dependency("vault-lint"),
		deepResearch: dependency("deep-research"),
		createNote: dependency("create-note"),
		publishBackfill: dependency("publish-backfill"),
		decideApproval: dependency("decide-approval"),
		decidePreference: dependency("decide-preference"),
	};
	return createConsoleActionRuntime({
		dependencies,
		recoveryStore: new MemoryRecoveryStore(),
		timers: nodeTimers,
	});
}

describe("ConsoleActionPanel", () => {
	it("runs A and B actions from the production panel and captures B recovery", async () => {
		const executions: string[] = [];
		const runtime = runtimeWith(executions);
		const { host, element } = createMiniHost();
		new ConsoleActionPanel({
			parent: host,
			runtime,
			actions: [
				{
					actionId: "refresh-stats",
					idempotencyKey: "panel-a",
					input: undefined,
					request: { readPaths: ["**"], writePaths: [], effects: ["read"] },
					proposal: {
						title: "刷新统计",
						provider: "TALOS",
						steps: ["重新读取统计"],
						fileCount: 0,
						keyDiffs: ["只读，无文件变化"],
						reversible: false,
					},
				},
				{
					actionId: "create-note",
					idempotencyKey: "panel-b",
					input: { targetPath: "00 收件箱/new.md" },
					request: {
						readPaths: [],
						writePaths: ["00 收件箱/new.md"],
						effects: ["write"],
					},
					proposal: {
						title: "新建内容",
						provider: "TALOS",
						steps: ["创建笔记"],
						fileCount: 1,
						keyDiffs: ["新增 00 收件箱/new.md"],
						reversible: true,
					},
				},
			],
		}).mount();

		element
			.querySelector<MiniElement>("button[data-action-id='refresh-stats']")
			?.click();
		element
			.querySelector<MiniElement>("button[data-action-id='create-note']")
			?.click();

		await vi.waitFor(() =>
			expect(executions).toEqual(["refresh-stats", "create-note"])
		);
		expect(runtime.store.findByIdempotencyKey("panel-a")?.state).toBe(
			"completed"
		);
		expect(
			runtime.store.findByIdempotencyKey("panel-b")?.recoveryId
		).toBeTruthy();
	});

	it("keeps C execution at zero until the separate approve control is clicked", async () => {
		const executions: string[] = [];
		const runtime = runtimeWith(executions);
		const { host, element } = createMiniHost();
		new ConsoleActionPanel({
			parent: host,
			runtime,
			actions: [
				{
					actionId: "deep-research",
					idempotencyKey: "panel-c",
					input: { topic: "synthetic" },
					request: {
						readPaths: [],
						writePaths: ["<external>"],
						effects: ["external-publish"],
					},
					proposal: {
						title: "合成研究",
						provider: "Mock Provider",
						steps: ["读取合成输入", "生成报告"],
						fileCount: 1,
						keyDiffs: ["将新增 synthetic-report.md"],
						reversible: false,
					},
				},
			],
		}).mount();

		element
			.querySelector<MiniElement>("button[data-action-id='deep-research']")
			?.click();

		expect(executions).toEqual([]);
		expect(element.textContent).toContain("将新增 synthetic-report.md");
		const view = element.querySelector<MiniElement>(
			"button[data-action='view']"
		);
		const approve = element.querySelector<MiniElement>(
			"button[data-action='approve']"
		);
		expect(view).not.toBeNull();
		expect(approve).not.toBeNull();

		view?.click();
		expect(element.textContent).toContain("差异已展开");
		expect(executions).toEqual([]);

		approve?.click();
		await vi.waitFor(() => expect(executions).toEqual(["deep-research"]));
		await vi.waitFor(() =>
			expect(runtime.store.findByIdempotencyKey("panel-c")?.state).toBe(
				"completed"
			)
		);
	});
});
