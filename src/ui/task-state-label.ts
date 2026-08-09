import type { TalosTaskState } from "../task-core/types";

const TASK_STATE_LABELS: Record<TalosTaskState, string> = {
	ready: "可执行",
	queued: "排队",
	running: "执行中",
	completed: "已完成",
	partial: "部分完成",
	failed: "已失败",
	cancelled: "已取消",
	reverted: "已撤销",
};

export function taskStateLabel(state: TalosTaskState): string {
	return TASK_STATE_LABELS[state];
}
