import type { TalosActionRequest } from "../action-core/types";
import type { ConsoleActionRuntime } from "../console-action-runtime";
import { ActionButton } from "./action-button";
import {
	ProposalPanel,
	type TalosProposalSummary,
} from "./proposal-panel";

export interface ConsoleActionSpec {
	actionId: string;
	idempotencyKey: string;
	input: unknown;
	request: TalosActionRequest;
	providerId?: string;
	proposal: TalosProposalSummary;
}

export interface ConsoleActionPanelOptions {
	parent: HTMLElement;
	runtime: ConsoleActionRuntime;
	actions: ConsoleActionSpec[];
}

export class ConsoleActionPanel {
	private root: HTMLElement | null = null;
	private proposalPanel: ProposalPanel | null = null;
	private readonly buttons: ActionButton[] = [];

	constructor(private readonly options: ConsoleActionPanelOptions) {}

	mount(): HTMLElement {
		if (this.root) return this.root;
		const root = this.options.parent.ownerDocument.createElement("section");
		root.className = "talos-console-actions";
		root.setAttribute("aria-label", "TALOS 可执行动作");
		this.options.parent.appendChild(root);
		this.root = root;

		for (const action of this.options.actions) {
			const button = new ActionButton({
				parent: root,
				registry: this.options.runtime.registry,
				runner: this.options.runtime.runner,
				store: this.options.runtime.store,
				actionId: action.actionId,
				idempotencyKey: action.idempotencyKey,
				input: action.input,
				request: action.request,
				providerId: action.providerId,
				onProposal: () => this.showProposal(action),
			});
			this.buttons.push(button);
			button.mount();
		}
		return root;
	}

	unmount(): void {
		for (const button of this.buttons.splice(0)) button.unmount();
		this.proposalPanel?.unmount();
		this.proposalPanel = null;
		this.root?.remove();
		this.root = null;
	}

	private showProposal(action: ConsoleActionSpec): void {
		if (!this.root) return;
		this.proposalPanel?.unmount();
		const diffStatus = this.options.parent.ownerDocument.createElement("p");
		diffStatus.className = "talos-proposal-panel__diff-status";
		diffStatus.setAttribute("aria-live", "polite");
		this.proposalPanel = new ProposalPanel({
			parent: this.root,
			proposal: action.proposal,
			onReject: () => {
				this.proposalPanel?.unmount();
				this.proposalPanel = null;
			},
			onViewDiff: () => {
				diffStatus.textContent = `差异已展开：${action.proposal.keyDiffs.join(
					"；"
				)}`;
			},
			onApprove: () => {
				void this.options.runtime.runner.run({
					actionId: action.actionId,
					idempotencyKey: action.idempotencyKey,
					input: action.input,
					request: action.request,
					providerId: action.providerId,
					approvalGranted: true,
				});
				this.proposalPanel?.unmount();
				this.proposalPanel = null;
			},
		});
		const panel = this.proposalPanel.mount();
		panel.appendChild(diffStatus);
	}
}
