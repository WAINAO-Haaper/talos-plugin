import { evaluateActionRisk } from "../action-core/risk-policy";
import type { TalosActionRegistry } from "../action-core/registry";
import type { TalosActionDefinition } from "../action-core/types";
import type { RecoveryStore } from "./recovery-store";
import type { MemoryTaskStore } from "./task-store";
import type {
	TalosFileChange,
	TalosPartialTaskResult,
	TalosTaskRun,
	TalosTaskRunInput,
} from "./types";

let taskSequence = 0;

function nextTaskId(): string {
	taskSequence++;
	return `talos-task-${Date.now()}-${taskSequence}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface TaskTimerHost {
	schedule(callback: () => void, timeoutMs: number): unknown;
	cancel(handle: unknown): void;
}

export function createWindowTimerHost(host: Window): TaskTimerHost {
	return {
		schedule: (callback, timeoutMs) => host.setTimeout(callback, timeoutMs),
		cancel: (handle) => host.clearTimeout(handle as number),
	};
}

export function waitForAbortableDelay(
	signal: AbortSignal,
	delayMs: number,
	timers: TaskTimerHost
): Promise<void> {
	if (signal.aborted) {
		return Promise.reject(new DOMException("cancelled", "AbortError"));
	}
	return new Promise((resolve, reject) => {
		let handle: unknown;
		let settled = false;
		const cleanup = (): void => {
			signal.removeEventListener("abort", onAbort);
		};
		const onAbort = (): void => {
			if (settled) return;
			settled = true;
			if (handle !== undefined) timers.cancel(handle);
			cleanup();
			reject(new DOMException("cancelled", "AbortError"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		handle = timers.schedule(() => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		}, delayMs);
		if (signal.aborted) onAbort();
	});
}

export function partialTaskResult(input: {
	result?: unknown;
	error: string;
	changes?: TalosFileChange[];
}): TalosPartialTaskResult {
	return {
		taskOutcome: "partial",
		version: 1,
		result: input.result,
		error: input.error,
		changes: [...(input.changes ?? [])],
	};
}

function isPartialTaskResult(value: unknown): value is TalosPartialTaskResult {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<TalosPartialTaskResult>;
	return (
		candidate.taskOutcome === "partial" &&
		candidate.version === 1 &&
		typeof candidate.error === "string" &&
		Array.isArray(candidate.changes)
	);
}

export class TalosTaskRunner {
	private readonly controllers = new Map<string, AbortController>();

	constructor(
		private readonly registry: TalosActionRegistry,
		private readonly store: MemoryTaskStore,
		private readonly recoveryStore: RecoveryStore,
		private readonly timers: TaskTimerHost
	) {}

	canCancel(taskId: string): boolean {
		const task = this.store.get(taskId);
		if (!task || (task.state !== "queued" && task.state !== "running")) {
			return false;
		}
		return this.registry.get(task.actionId)?.cancelable === true;
	}

	cancel(taskId: string): boolean {
		if (!this.canCancel(taskId)) return false;

		const cancelled = this.store.transition(taskId, "cancelled", {
			finishedAt: new Date().toISOString(),
		});
		this.controllers.get(cancelled.id)?.abort();
		return true;
	}

	canRevert(taskId: string): boolean {
		const task = this.store.get(taskId);
		if (
			!task ||
			(task.state !== "completed" && task.state !== "partial") ||
			!task.recoveryId
		) {
			return false;
		}
		const definition = this.registry.get(task.actionId);
		if (!definition?.reversible || !this.recoveryStore.restore) return false;
		return this.recoveryStore.has?.(task.recoveryId) ?? true;
	}

	async revert(taskId: string): Promise<boolean> {
		if (!this.canRevert(taskId)) return false;
		const task = this.store.get(taskId);
		if (!task?.recoveryId || !this.recoveryStore.restore) return false;
		await this.recoveryStore.restore(task.recoveryId);
		this.store.transition(task.id, "reverted", {
			finishedAt: new Date().toISOString(),
		});
		return true;
	}

	async run<Input>(input: TalosTaskRunInput<Input>): Promise<TalosTaskRun> {
		const existing = this.store.findByIdempotencyKey(input.idempotencyKey);
		if (existing) return existing;

		const definition = this.registry.get(input.actionId);
		if (!definition) throw new Error(`未注册动作：${input.actionId}`);

		const risk = evaluateActionRisk(definition, input.request);
		const createdAt = new Date().toISOString();
		const task = this.store.create({
			id: nextTaskId(),
			idempotencyKey: input.idempotencyKey,
			actionId: definition.id,
			state: "ready",
			approvalRequired:
				risk.decision === "propose" && input.approvalGranted !== true,
			riskDecision: risk.decision,
			providerId: input.providerId,
			approvedAt: input.approvalGranted ? createdAt : undefined,
			createdAt,
			readPaths: [...input.request.readPaths],
			changes: [],
		});

		if (task.approvalRequired) return task;

		this.store.transition(task.id, "queued");
		let recoveryId: string | undefined;
		try {
			if (risk.decision === "snapshot-and-run" || definition.reversible) {
				recoveryId = await this.recoveryStore.capture({
					taskId: task.id,
					actionId: task.actionId,
					targetPaths: [...input.request.writePaths],
					createdAt,
				});
			}
		} catch (error) {
			return this.store.transition(task.id, "failed", {
				error: errorMessage(error),
				finishedAt: new Date().toISOString(),
			});
		}

		const current = this.store.get(task.id);
		if (current?.state === "cancelled") return current;

		const startedAt = new Date().toISOString();
		this.store.transition(task.id, "running", { recoveryId, startedAt });
		const controller = new AbortController();
		this.controllers.set(task.id, controller);

		try {
			const result = await this.executeWithTimeout(
				definition,
				{
					signal: controller.signal,
					taskId: task.id,
					providerId: input.providerId,
				},
				input.input
			);
			const latest = this.store.get(task.id);
			if (latest?.state === "cancelled") return latest;
			if (isPartialTaskResult(result)) {
				return this.store.transition(task.id, "partial", {
					result: result.result,
					error: result.error,
					changes: [...result.changes],
					finishedAt: new Date().toISOString(),
				});
			}
			return this.store.transition(task.id, "completed", {
				result,
				finishedAt: new Date().toISOString(),
			});
		} catch (error) {
			const latest = this.store.get(task.id);
			if (latest?.state === "cancelled") return latest;
			return this.store.transition(task.id, "failed", {
				error: errorMessage(error),
				finishedAt: new Date().toISOString(),
			});
		} finally {
			this.controllers.delete(task.id);
		}
	}

	private async executeWithTimeout(
		definition: TalosActionDefinition,
		context: {
			signal: AbortSignal;
			taskId: string;
			providerId?: string;
		},
		input: unknown
	): Promise<unknown> {
		const controller = this.controllers.get(context.taskId);
		return new Promise((resolve, reject) => {
			const timeout = this.timers.schedule(() => {
				controller?.abort();
				reject(new Error(`执行超时：${definition.timeoutMs}ms`));
			}, definition.timeoutMs);

			void Promise.resolve(definition.execute(context, input)).then(
				(result) => {
					this.timers.cancel(timeout);
					resolve(result);
				},
				(error: unknown) => {
					this.timers.cancel(timeout);
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			);
		});
	}
}
