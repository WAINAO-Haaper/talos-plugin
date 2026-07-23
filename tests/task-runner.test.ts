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
