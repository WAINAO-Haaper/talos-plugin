import type { MemoryTaskStore } from "../task-core/task-store";
import type { TalosTaskRun } from "../task-core/types";
import { taskStateLabel } from "./task-state-label";

export interface TaskDrawerOptions {
	parent: HTMLElement;
	store: MemoryTaskStore;
	controller?: {
		canCancel(taskId: string): boolean;
		cancel(taskId: string): boolean;
		canRevert(taskId: string): boolean;
		revert(taskId: string): Promise<boolean>;
	};
}

export class TaskDrawer {
	private root: HTMLElement | null = null;
	private list: HTMLElement | null = null;
	private live: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(private readonly options: TaskDrawerOptions) {}

	mount(): HTMLElement {
		if (this.root) return this.root;
		const document = this.options.parent.ownerDocument;
		const root = document.createElement("aside");
		root.className = "talos-task-drawer";
		root.setAttribute("aria-label", "TALOS 任务抽屉");
		root.setAttribute("tabindex", "0");
		root.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			root.classList.add("is-collapsed");
		});

		const header = document.createElement("header");
		const heading = document.createElement("h2");
		heading.textContent = "任务";
		header.appendChild(heading);
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.textContent = "收起";
		toggle.setAttribute("aria-label", "收起或展开任务抽屉");
		toggle.addEventListener("click", () => {
			const collapsed = root.classList.toggle("is-collapsed");
			toggle.textContent = collapsed ? "展开" : "收起";
		});
		header.appendChild(toggle);
		root.appendChild(header);

		const live = document.createElement("p");
		live.className = "talos-task-drawer__live";
		live.setAttribute("aria-live", "polite");
		live.textContent = "当前没有任务";
		root.appendChild(live);

		const list = document.createElement("div");
		list.className = "talos-task-drawer__list";
		root.appendChild(list);

		this.root = root;
		this.list = list;
		this.live = live;
		this.options.parent.appendChild(root);
		this.render();
		this.unsubscribe = this.options.store.subscribe((task) => {
			this.render();
			if (this.live) {
				this.live.textContent = `${task.actionId}：${taskStateLabel(task.state)}`;
			}
		});
		return root;
	}

	unmount(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.root?.remove();
		this.root = null;
		this.list = null;
		this.live = null;
	}

	private render(): void {
		if (!this.list) return;
		this.list.replaceChildren();
		const tasks = [...this.options.store.list()].reverse();
		if (tasks.length === 0) {
			const empty = this.options.parent.ownerDocument.createElement("p");
			empty.className = "talos-task-drawer__empty";
			empty.textContent = "当前没有任务";
			this.list.appendChild(empty);
			return;
		}
		for (const task of tasks) this.list.appendChild(this.renderTask(task));
	}

	private renderTask(task: TalosTaskRun): HTMLElement {
		const document = this.options.parent.ownerDocument;
		const row = document.createElement("article");
		row.className = "talos-task-drawer__task";
		row.setAttribute("data-task-state", task.state);
		const title = document.createElement("strong");
		title.textContent = task.actionId;
		row.appendChild(title);
		const state = document.createElement("span");
		state.textContent = taskStateLabel(task.state);
		row.appendChild(state);
		if (task.error) {
			const error = document.createElement("small");
			error.textContent = task.error;
			row.appendChild(error);
		}
		const controller = this.options.controller;
		if (controller?.canCancel(task.id)) {
			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.setAttribute("data-task-control", "cancel");
			cancel.setAttribute("aria-label", `取消 ${task.actionId}`);
			cancel.textContent = "取消";
			cancel.addEventListener("click", () => controller.cancel(task.id));
			row.appendChild(cancel);
		}
		if (controller?.canRevert(task.id)) {
			const revert = document.createElement("button");
			revert.type = "button";
			revert.setAttribute("data-task-control", "revert");
			revert.setAttribute("aria-label", `撤销 ${task.actionId}`);
			revert.textContent = "撤销";
			revert.addEventListener("click", () => void controller.revert(task.id));
			row.appendChild(revert);
		}
		return row;
	}
}
