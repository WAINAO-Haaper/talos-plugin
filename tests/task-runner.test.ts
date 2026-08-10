import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { describe, expect, it, vi } from "vitest";
import { TalosActionRegistry } from "../src/action-core/registry";
import type { TalosActionDefinition } from "../src/action-core/types";
import { MemoryRecoveryStore } from "../src/task-core/recovery-store";
import { MemoryTaskStore } from "../src/task-core/task-store";
import {
	TalosTaskRunner,
	partialTaskResult,
	waitForAbortableDelay,
	type TaskTimerHost,
} from "../src/task-core/task-runner";

const nodeTimers: TaskTimerHost = {
	schedule: (callback, timeoutMs) => nodeSetTimeout(callback, timeoutMs),
	cancel: (handle) => nodeClearTimeout(handle as NodeJS.Timeout),
};

function action(
	execute: TalosActionDefinition["execute"],
	overrides: Partial<TalosActionDefinition> = {}
): TalosActionDefinition {
	return {
		id: "organize-inbox",
		label: "整理收件箱",
		description: "整理固定范围内的收件箱内容",
		risk: "B",
		readScope: ["00 收件箱/**"],
		writeScope: ["00 收件箱/**", "30 洞察/**"],
		timeoutMs: 10_000,
		cancelable: true,
		reversible: true,
		execute,
		...overrides,
	};
}

describe("TalosTaskRunner", () => {
	it("aborts a cancellable safety window before the external action starts", async () => {
		let scheduled: (() => void) | null = null;
		const cancel = vi.fn();
		const timers: TaskTimerHost = {
			schedule: (callback) => {
				scheduled = callback;
				return 1;
			},
			cancel,
		};
		const controller = new AbortController();
		const pending = waitForAbortableDelay(
			controller.signal,
			10_000,
			timers
		);

		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledWith(1);
		expect(scheduled).not.toBeNull();
	});

	it("captures recovery before executing a B-class action", async () => {
		const events: string[] = [];
		const registry = new TalosActionRegistry([
			action(async () => {
				events.push("execute");
				return { moved: 1 };
			}),
		]);
		const recovery = new MemoryRecoveryStore(() => events.push("recovery"));
		const store = new MemoryTaskStore();
		const runner = new TalosTaskRunner(registry, store, recovery, nodeTimers);

		const result = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "inbox-2026-07-24",
			input: undefined,
			request: {
				readPaths: ["00 收件箱/想法.md"],
				writePaths: ["00 收件箱/想法.md", "30 洞察/想法.md"],
				effects: ["write"],
			},
		});

		expect(events).toEqual(["recovery", "execute"]);
		expect(result.state).toBe("completed");
		expect(result.recoveryId).toBeTruthy();
		expect(result.result).toEqual({ moved: 1 });
	});

	it("returns the existing task for the same idempotency key", async () => {
		const execute = vi.fn().mockResolvedValue({ moved: 1 });
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([action(execute)]),
			new MemoryTaskStore(),
			new MemoryRecoveryStore(),
			nodeTimers
		);
		const input = {
			actionId: "organize-inbox",
			idempotencyKey: "same-request",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: ["00 收件箱/想法.md"],
				effects: ["write" as const],
			},
		};

		const first = await runner.run(input);
		const second = await runner.run(input);

		expect(second.id).toBe(first.id);
		expect(execute).toHaveBeenCalledOnce();
	});

	it("does not execute a proposal-gated task before approval", async () => {
		const execute = vi.fn();
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([
				action(execute, {
					id: "publish",
					risk: "C",
					writeScope: ["<external>"],
					reversible: false,
				}),
			]),
			new MemoryTaskStore(),
			new MemoryRecoveryStore(),
			nodeTimers
		);

		const result = await runner.run({
			actionId: "publish",
			idempotencyKey: "publish-1",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: [],
				effects: ["external-publish"],
			},
		});

		expect(result.state).toBe("ready");
		expect(result.approvalRequired).toBe(true);
		expect(execute).not.toHaveBeenCalled();
	});

	it("marks an execution error as failed without retrying it", async () => {
		const execute = vi.fn().mockRejectedValue(new Error("write failed"));
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([action(execute)]),
			new MemoryTaskStore(),
			new MemoryRecoveryStore(),
			nodeTimers
		);

		const result = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "failing-request",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: ["00 收件箱/想法.md"],
				effects: ["write"],
			},
		});

		expect(result.state).toBe("failed");
		expect(result.error).toBe("write failed");
		expect(execute).toHaveBeenCalledOnce();
	});

	it("marks a recovery capture failure as failed before execution", async () => {
		const execute = vi.fn();
		const store = new MemoryTaskStore();
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([action(execute)]),
			store,
			{
				capture: vi.fn().mockRejectedValue(new Error("snapshot failed")),
			},
			nodeTimers
		);

		const result = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "snapshot-failure",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: ["00 收件箱/想法.md"],
				effects: ["write"],
			},
		});

		expect(result.state).toBe("failed");
		expect(result.error).toBe("snapshot failed");
		expect(execute).not.toHaveBeenCalled();
	});

	it("cancels a running cancelable task by aborting its signal", async () => {
		const store = new MemoryTaskStore();
		let runningTaskId = "";
		store.subscribe((task) => {
			if (task.state === "running") runningTaskId = task.id;
		});
		const execute = vi.fn(
			(context: { signal: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					context.signal.addEventListener("abort", () =>
						reject(new DOMException("cancelled", "AbortError"))
					);
				})
		);
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([action(execute)]),
			store,
			new MemoryRecoveryStore(),
			nodeTimers
		);

		const pending = runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "cancel-request",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: ["00 收件箱/想法.md"],
				effects: ["write"],
			},
		});
		await vi.waitFor(() => expect(runningTaskId).not.toBe(""));

		expect(runner.cancel(runningTaskId)).toBe(true);
		const result = await pending;

		expect(result.state).toBe("cancelled");
	});

	it("marks only an explicit structured execution result as partial", async () => {
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([
				action(async () =>
					partialTaskResult({
						result: { moved: 1, skipped: 1 },
						error: "1 个文件被占用",
						changes: [
							{ path: "30 洞察/想法.md", kind: "create" },
						],
					})
				),
			]),
			new MemoryTaskStore(),
			new MemoryRecoveryStore(),
			nodeTimers
		);

		const result = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "partial-request",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: ["30 洞察/想法.md"],
				effects: ["write"],
			},
		});

		expect(result).toMatchObject({
			state: "partial",
			result: { moved: 1, skipped: 1 },
			error: "1 个文件被占用",
			changes: [{ path: "30 洞察/想法.md", kind: "create" }],
		});
	});

	it("restores a completed reversible task and transitions it to reverted", async () => {
		const restored: string[] = [];
		const recovery = new MemoryRecoveryStore(
			undefined,
			(record) => restored.push(record.id)
		);
		const store = new MemoryTaskStore();
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([
				action(async () => ({ moved: 1 })),
			]),
			store,
			recovery,
			nodeTimers
		);
		const completed = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "revert-request",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: ["30 洞察/想法.md"],
				effects: ["write"],
			},
		});

		expect(runner.canRevert(completed.id)).toBe(true);
		expect(await runner.revert(completed.id)).toBe(true);
		expect(store.get(completed.id)?.state).toBe("reverted");
		expect(restored).toEqual([completed.recoveryId]);
		expect(runner.canRevert(completed.id)).toBe(false);
	});

	it("allows a failed reversible task to restore its captured snapshot", async () => {
		const restored: string[] = [];
		const recovery = new MemoryRecoveryStore(
			undefined,
			(record) => restored.push(record.id)
		);
		const store = new MemoryTaskStore();
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([
				action(async () => {
					throw new Error("write failed after mutation");
				}),
			]),
			store,
			recovery,
			nodeTimers
		);
		const failed = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "failed-revert-request",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: ["30 洞察/想法.md"],
				effects: ["write"],
			},
		});

		expect(failed.state).toBe("failed");
		expect(failed.recoveryId).toBeTruthy();
		expect(runner.canRevert(failed.id)).toBe(true);
		expect(await runner.revert(failed.id)).toBe(true);
		expect(store.get(failed.id)?.state).toBe("reverted");
		expect(restored).toEqual([failed.recoveryId]);
	});

	it("does not offer cancellation or recovery for unsupported actions", async () => {
		const store = new MemoryTaskStore();
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([
				action(async () => ({ ok: true }), {
					risk: "A",
					readScope: ["**"],
					writeScope: [],
					cancelable: false,
					reversible: false,
				}),
			]),
			store,
			new MemoryRecoveryStore(),
			nodeTimers
		);
		const task = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "no-controls",
			input: undefined,
			request: {
				readPaths: ["30 洞察/想法.md"],
				writePaths: [],
				effects: ["read"],
			},
		});

		expect(runner.canCancel(task.id)).toBe(false);
		expect(runner.canRevert(task.id)).toBe(false);
		expect(await runner.revert(task.id)).toBe(false);
	});

	it("fails a task when its declared timeout expires", async () => {
		const immediateTimers: TaskTimerHost = {
			schedule: (callback) => {
				queueMicrotask(callback);
				return 1;
			},
			cancel: vi.fn(),
		};
		const runner = new TalosTaskRunner(
			new TalosActionRegistry([
				action(
					() => new Promise(() => {}),
					{
						risk: "A",
						readScope: ["**"],
						writeScope: [],
						reversible: false,
						timeoutMs: 50,
					}
				),
			]),
			new MemoryTaskStore(),
			new MemoryRecoveryStore(),
			immediateTimers
		);

		const result = await runner.run({
			actionId: "organize-inbox",
			idempotencyKey: "timeout-request",
			input: undefined,
			request: {
				readPaths: ["30 洞察/想法.md"],
				writePaths: [],
				effects: ["read"],
			},
		});

		expect(result.state).toBe("failed");
		expect(result.error).toContain("执行超时");
	});
});
