import { TalosActionRegistry } from "./action-core/registry";
import type { TalosActionDefinition } from "./action-core/types";
import { MemoryRecoveryStore } from "./task-core/recovery-store";
import { MemoryTaskStore } from "./task-core/task-store";
import {
	TalosTaskRunner,
	type TaskTimerHost,
} from "./task-core/task-runner";
import type { TalosTaskRun } from "./task-core/types";

const APPROVAL_ACTION_ID = "approve-and-execute-model";

export interface ApprovalTaskRunInput {
	idempotencyKey: string;
	title: string;
	pendingApprovalsPath: string;
	targetPath: string;
	execute(): Promise<unknown>;
}

export interface ApprovalTaskRuntime {
	readonly store: MemoryTaskStore;
	run(input: ApprovalTaskRunInput): Promise<TalosTaskRun>;
}

function createApprovalAction(): TalosActionDefinition<
	ApprovalTaskRunInput,
	unknown
> {
	return {
		id: APPROVAL_ACTION_ID,
		label: "批准并执行模型任务",
		description: "执行已由用户明确批准的模型写回任务",
		risk: "C",
		readScope: ["**"],
		writeScope: ["**"],
		timeoutMs: 120_000,
		cancelable: false,
		reversible: true,
		execute: async (_context, input) => input.execute(),
	};
}

export function createApprovalTaskRuntime(
	timers: TaskTimerHost
): ApprovalTaskRuntime {
	const store = new MemoryTaskStore();
	const runner = new TalosTaskRunner(
		new TalosActionRegistry([createApprovalAction()]),
		store,
		new MemoryRecoveryStore(),
		timers
	);

	return {
		store,
		run: (input) =>
			runner.run({
				actionId: APPROVAL_ACTION_ID,
				idempotencyKey: input.idempotencyKey,
				input,
				approvalGranted: true,
				request: {
					readPaths: [input.pendingApprovalsPath, input.targetPath],
					writePaths: [input.pendingApprovalsPath, input.targetPath],
					effects: ["write"],
				},
			}),
	};
}
