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

const nodeTimers: TaskTimerHost = {
	schedule: (callback, timeoutMs) => nodeSetTimeout(callback, timeoutMs),
	cancel: (handle) => nodeClearTimeout(handle as NodeJS.Timeout),
};

function dependencies(): ConsoleActionDependencies {
	return {
		refreshStats: vi.fn().mockResolvedValue({ refreshed: true }),
		vaultLint: vi.fn().mockResolvedValue({ issues: 0 }),
		deepResearch: vi.fn().mockResolvedValue({ report: "synthetic.md" }),
		createNote: vi.fn().mockResolvedValue({ path: "00 收件箱/new.md" }),
		publishBackfill: vi.fn().mockResolvedValue({ published: true }),
		decideApproval: vi.fn(async (input: unknown) => {
			const task = input as { execute(): Promise<unknown> };
			return task.execute();
		}),
		decidePreference: vi.fn().mockResolvedValue({ decided: true }),
	};
}

describe("production console action runtime", () => {
	it("shares one registry, runner, task store and recovery store across console and approvals", async () => {
		const recoveryStore = new MemoryRecoveryStore();
		const runtime = createConsoleActionRuntime({
			dependencies: dependencies(),
			recoveryStore,
			timers: nodeTimers,
		});

		expect(runtime.registry.list()).toHaveLength(7);
		expect(runtime.recoveryStore).toBe(recoveryStore);
		expect(runtime.approvals.store).toBe(runtime.store);

		const task = await runtime.approvals.run({
			idempotencyKey: "production-approval",
			title: "合成审批",
			pendingApprovalsPath: "50 工作流/pending.md",
			targetPath: "70 输出/result.md",
			execute: vi.fn().mockResolvedValue({ ok: true }),
		});

		expect(task.state).toBe("completed");
		expect(runtime.store.get(task.id)).toBe(task);
	});

	it("records provider tool proposals in the shared console task store", () => {
		const runtime = createConsoleActionRuntime({
			dependencies: dependencies(),
			recoveryStore: new MemoryRecoveryStore(),
			timers: nodeTimers,
		});

		const first = runtime.proposeProviderTool({
			runId: "run-1",
			toolCallId: "tool-1",
			providerId: "mock-provider",
		});
		const second = runtime.proposeProviderTool({
			runId: "run-1",
			toolCallId: "tool-1",
			providerId: "mock-provider",
		});

		expect(second.taskId).toBe(first.taskId);
		expect(runtime.store.get(first.taskId)).toMatchObject({
			actionId: "provider-tool-proposal",
			state: "ready",
			approvalRequired: true,
		});
	});
});
