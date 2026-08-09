import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { describe, expect, it, vi } from "vitest";
import {
	createApprovalTaskRuntime,
	type ApprovalTaskRunInput,
} from "../src/approval-task-runtime";
import type { TaskTimerHost } from "../src/task-core/task-runner";

const nodeTimers: TaskTimerHost = {
	schedule: (callback, timeoutMs) => nodeSetTimeout(callback, timeoutMs),
	cancel: (handle) => nodeClearTimeout(handle as NodeJS.Timeout),
};

function input(
	execute: ApprovalTaskRunInput["execute"]
): ApprovalTaskRunInput {
	return {
		idempotencyKey: "approval:#QA-B3",
		title: "#QA-B3",
		pendingApprovalsPath: "System/pending-approvals.md",
		targetPath: "System/model-executor-test.md",
		execute,
	};
}

describe("approval task runtime", () => {
	it("routes an approved model execution through the shared task runner", async () => {
		const execute = vi.fn().mockResolvedValue({ message: "已写回" });
		const runtime = createApprovalTaskRuntime(nodeTimers);

		const result = await runtime.run(input(execute));

		expect(result.state).toBe("completed");
		expect(result.approvalRequired).toBe(false);
		expect(result.approvedAt).toBeTruthy();
		expect(result.recoveryId).toBeTruthy();
		expect(result.changes).toEqual([]);
		expect(execute).toHaveBeenCalledOnce();
	});

	it("does not repeat the write for the same approval idempotency key", async () => {
		const execute = vi.fn().mockResolvedValue({ message: "已写回" });
		const runtime = createApprovalTaskRuntime(nodeTimers);
		const request = input(execute);

		const first = await runtime.run(request);
		const second = await runtime.run(request);

		expect(second.id).toBe(first.id);
		expect(execute).toHaveBeenCalledOnce();
	});
});
