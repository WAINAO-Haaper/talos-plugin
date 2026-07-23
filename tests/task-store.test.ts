import { describe, expect, it } from "vitest";
import { MemoryTaskStore } from "../src/task-core/task-store";
import type { TalosTaskRun } from "../src/task-core/types";

function run(overrides: Partial<TalosTaskRun> = {}): TalosTaskRun {
	return {
		id: "task-1",
		idempotencyKey: "idem-1",
		actionId: "refresh-stats",
		state: "ready",
		approvalRequired: false,
		readPaths: [],
		changes: [],
		createdAt: "2026-07-24T00:00:00.000Z",
		...overrides,
	};
}

describe("MemoryTaskStore", () => {
	it("persists legal task transitions and notifies subscribers", () => {
		const store = new MemoryTaskStore();
		const observed: string[] = [];
		store.subscribe((task) => observed.push(task.state));

		store.create(run());
		store.transition("task-1", "queued");
		store.transition("task-1", "running");
		store.transition("task-1", "completed", {
			finishedAt: "2026-07-24T00:00:01.000Z",
		});

		expect(store.get("task-1")?.state).toBe("completed");
		expect(observed).toEqual(["ready", "queued", "running", "completed"]);
	});

	it("rejects an illegal terminal-to-running transition", () => {
		const store = new MemoryTaskStore([
			run({ state: "completed", finishedAt: "2026-07-24T00:00:01.000Z" }),
		]);

		expect(() => store.transition("task-1", "running")).toThrow(
			/非法任务状态转换/
		);
	});

	it("requires a new task ID for retries", () => {
		const store = new MemoryTaskStore([
			run({ state: "failed", error: "provider failed" }),
		]);

		expect(() => store.transition("task-1", "queued")).toThrow(
			/非法任务状态转换/
		);
	});
});
