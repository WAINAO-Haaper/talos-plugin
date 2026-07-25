import {
	createBuiltinActionRegistry,
	type BuiltinActionDependencies,
	type BuiltinActionScopes,
} from "./action-core/builtin-actions";
import type {
	ApprovalTaskRunInput,
	ApprovalTaskRuntime,
} from "./approval-task-runtime";
import type { RecoveryStore } from "./task-core/recovery-store";
import { MemoryTaskStore } from "./task-core/task-store";
import {
	TalosTaskRunner,
	type TaskTimerHost,
} from "./task-core/task-runner";

export type ConsoleActionDependencies = BuiltinActionDependencies;

export interface ConsoleActionRuntime {
	readonly registry: ReturnType<typeof createBuiltinActionRegistry>;
	readonly store: MemoryTaskStore;
	readonly recoveryStore: RecoveryStore;
	readonly runner: TalosTaskRunner;
	readonly approvals: ApprovalTaskRuntime;
	proposeProviderTool(input: {
		runId: string;
		toolCallId: string;
		providerId: string;
	}): { taskId: string };
}

export function createConsoleActionRuntime(options: {
	dependencies: ConsoleActionDependencies;
	recoveryStore: RecoveryStore;
	timers: TaskTimerHost;
	scopes?: BuiltinActionScopes;
}): ConsoleActionRuntime {
	const registry = createBuiltinActionRegistry(
		options.dependencies,
		options.scopes
	);
	const store = new MemoryTaskStore();
	const runner = new TalosTaskRunner(
		registry,
		store,
		options.recoveryStore,
		options.timers
	);
	const approvals: ApprovalTaskRuntime = {
		store,
		run: (input: ApprovalTaskRunInput) =>
			runner.run({
				actionId: "decide-approval",
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

	return {
		registry,
		store,
		recoveryStore: options.recoveryStore,
		runner,
		approvals,
		proposeProviderTool(input) {
			const idempotencyKey =
				`canonical:${input.providerId}:${input.toolCallId}`;
			const existing = store.findByIdempotencyKey(idempotencyKey);
			if (existing) return { taskId: existing.id };
			const taskId = `talos-task-${input.runId}-${input.toolCallId}`;
			store.create({
				id: taskId,
				idempotencyKey,
				actionId: "provider-tool-proposal",
				state: "ready",
				approvalRequired: true,
				riskDecision: "propose",
				providerId: input.providerId,
				createdAt: new Date().toISOString(),
				readPaths: [],
				changes: [],
			});
			return { taskId };
		},
	};
}
