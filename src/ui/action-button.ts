import type { TalosActionRegistry } from "../action-core/registry";
import type { TalosActionDefinition, TalosActionRequest } from "../action-core/types";
import type { MemoryTaskStore } from "../task-core/task-store";
import type { TalosTaskRun, TalosTaskRunInput } from "../task-core/types";
import { taskStateLabel } from "./task-state-label";

export interface ActionTaskRunner {
	run<Input>(input: TalosTaskRunInput<Input>): Promise<TalosTaskRun>;
}

export interface ActionButtonOptions<Input> {
	parent: HTMLElement;
	registry: TalosActionRegistry;
	runner: ActionTaskRunner;
	store: MemoryTaskStore;
	actionId: string;
	idempotencyKey: string;
	input: Input;
	request: TalosActionRequest;
	providerId?: string;
	onProposal(definition: TalosActionDefinition): void;
}

export class ActionButton<Input = unknown> {
	private root: HTMLElement | null = null;
	private button: HTMLButtonElement | null = null;
	private live: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(private readonly options: ActionButtonOptions<Input>) {}

	mount(): HTMLElement {
		if (this.root) return this.root;
		const definition = this.requireDefinition();
		const document = this.options.parent.ownerDocument;
		const root = document.createElement("div");
		root.className = "talos-action-button";

		const button = document.createElement("button");
		button.type = "button";
		button.className = "talos-action-button__control";
		button.setAttribute("data-action-id", definition.id);
		button.setAttribute("aria-label", `${definition.label}，可执行`);
		button.textContent = `${definition.label} · 可执行`;
		button.addEventListener("click", () => void this.activate(definition));
		root.appendChild(button);

		const live = document.createElement("span");
		live.className = "talos-action-button__status";
		live.setAttribute("aria-live", "polite");
		live.textContent = `${definition.label}：可执行`;
		root.appendChild(live);

		this.root = root;
		this.button = button;
		this.live = live;
		this.unsubscribe = this.options.store.subscribe((task) => {
			if (task.idempotencyKey === this.options.idempotencyKey) {
				this.renderTask(task, definition);
			}
		});
		const existing = this.options.store.findByIdempotencyKey(
			this.options.idempotencyKey
		);
		if (existing) this.renderTask(existing, definition);
		this.options.parent.appendChild(root);
		return root;
	}

	unmount(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.root?.remove();
		this.root = null;
		this.button = null;
		this.live = null;
	}

	private requireDefinition(): TalosActionDefinition {
		const definition = this.options.registry.get(this.options.actionId);
		if (!definition) throw new Error(`未注册动作：${this.options.actionId}`);
		return definition;
	}

	private async activate(definition: TalosActionDefinition): Promise<void> {
		if (definition.risk === "C") {
			this.options.onProposal(definition);
			return;
		}
		const task = await this.options.runner.run({
			actionId: definition.id,
			idempotencyKey: this.options.idempotencyKey,
			input: this.options.input,
			request: this.options.request,
			providerId: this.options.providerId,
		});
		if (task.approvalRequired) this.options.onProposal(definition);
		this.renderTask(task, definition);
	}

	private renderTask(
		task: TalosTaskRun,
		definition: TalosActionDefinition
	): void {
		if (!this.button || !this.live) return;
		const label = task.approvalRequired
			? "等待批准"
			: taskStateLabel(task.state);
		this.button.textContent = `${definition.label} · ${label}`;
		this.button.disabled = task.state === "queued" || task.state === "running";
		this.button.setAttribute("aria-label", `${definition.label}，${label}`);
		this.live.textContent = `${definition.label}：${label}`;
		this.root?.setAttribute("data-task-state", task.state);
	}
}
