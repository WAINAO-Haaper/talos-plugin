import type { TalosTaskRun, TalosTaskState } from "./types";

type TaskPatch = Partial<Omit<TalosTaskRun, "id" | "state">>;
type TaskSubscriber = (task: TalosTaskRun) => void;

const TRANSITIONS: Readonly<Record<TalosTaskState, readonly TalosTaskState[]>> = {
	ready: ["queued", "cancelled"],
	queued: ["running", "failed", "cancelled"],
	running: ["completed", "partial", "failed", "cancelled"],
	completed: ["reverted"],
	partial: ["reverted"],
	failed: [],
	cancelled: [],
	reverted: [],
};

export class MemoryTaskStore {
	private readonly tasks = new Map<string, TalosTaskRun>();
	private readonly subscribers = new Set<TaskSubscriber>();

	constructor(initial: TalosTaskRun[] = []) {
		for (const task of initial) this.create(task);
	}

	create(task: TalosTaskRun): TalosTaskRun {
		if (this.tasks.has(task.id)) throw new Error(`重复任务 ID：${task.id}`);
		if (this.findByIdempotencyKey(task.idempotencyKey)) {
			throw new Error(`重复幂等键：${task.idempotencyKey}`);
		}
		this.tasks.set(task.id, task);
		this.notify(task);
		return task;
	}

	get(id: string): TalosTaskRun | undefined {
		return this.tasks.get(id);
	}

	findByIdempotencyKey(key: string): TalosTaskRun | undefined {
		return Array.from(this.tasks.values()).find(
			(task) => task.idempotencyKey === key
		);
	}

	list(): readonly TalosTaskRun[] {
		return Object.freeze(Array.from(this.tasks.values()));
	}

	transition(
		id: string,
		nextState: TalosTaskState,
		patch: TaskPatch = {}
	): TalosTaskRun {
		const current = this.tasks.get(id);
		if (!current) throw new Error(`未找到任务：${id}`);
		if (!TRANSITIONS[current.state].includes(nextState)) {
			throw new Error(`非法任务状态转换：${current.state} → ${nextState}`);
		}
		const next: TalosTaskRun = { ...current, ...patch, state: nextState };
		this.tasks.set(id, next);
		this.notify(next);
		return next;
	}

	subscribe(subscriber: TaskSubscriber): () => void {
		this.subscribers.add(subscriber);
		return () => this.subscribers.delete(subscriber);
	}

	private notify(task: TalosTaskRun): void {
		for (const subscriber of this.subscribers) subscriber(task);
	}
}
