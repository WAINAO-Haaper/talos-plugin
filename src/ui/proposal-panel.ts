export interface TalosProposalSummary {
	title: string;
	provider: string;
	steps: string[];
	fileCount: number;
	keyDiffs: string[];
	reversible: boolean;
}

export interface ProposalPanelOptions {
	parent: HTMLElement;
	proposal: TalosProposalSummary;
	onReject(): void;
	onViewDiff(): void;
	onApprove(): void;
}

export class ProposalPanel {
	private root: HTMLElement | null = null;

	constructor(private readonly options: ProposalPanelOptions) {}

	mount(): HTMLElement {
		if (this.root) return this.root;
		const document = this.options.parent.ownerDocument;
		const proposal = this.options.proposal;
		const root = document.createElement("section");
		root.className = "talos-proposal-panel";
		root.setAttribute("role", "dialog");
		root.setAttribute("aria-label", `执行提案：${proposal.title}`);

		const heading = document.createElement("h3");
		heading.textContent = proposal.title;
		root.appendChild(heading);

		const meta = document.createElement("p");
		meta.className = "talos-proposal-panel__meta";
		meta.textContent = `${proposal.provider} · ${proposal.fileCount} 个文件 · ${
			proposal.reversible ? "可恢复" : "不可恢复"
		}`;
		root.appendChild(meta);

		root.appendChild(this.renderList("执行步骤", proposal.steps));
		root.appendChild(this.renderList("关键差异", proposal.keyDiffs));

		const actions = document.createElement("div");
		actions.className = "talos-proposal-panel__actions";
		actions.appendChild(
			this.createButton("拒绝", "reject", () => this.options.onReject())
		);
		actions.appendChild(
			this.createButton("查看差异", "view", () => this.options.onViewDiff())
		);
		actions.appendChild(
			this.createButton("批准并执行", "approve", () =>
				this.options.onApprove()
			)
		);
		root.appendChild(actions);

		this.options.parent.appendChild(root);
		this.root = root;
		return root;
	}

	unmount(): void {
		this.root?.remove();
		this.root = null;
	}

	private renderList(label: string, items: string[]): HTMLElement {
		const document = this.options.parent.ownerDocument;
		const section = document.createElement("div");
		section.className = "talos-proposal-panel__section";
		const heading = document.createElement("h4");
		heading.textContent = label;
		section.appendChild(heading);
		const list = document.createElement("ol");
		for (const item of items) {
			const row = document.createElement("li");
			row.textContent = item;
			list.appendChild(row);
		}
		section.appendChild(list);
		return section;
	}

	private createButton(
		label: string,
		action: "reject" | "view" | "approve",
		onClick: () => void
	): HTMLButtonElement {
		const button = this.options.parent.ownerDocument.createElement("button");
		button.type = "button";
		button.setAttribute("data-action", action);
		button.textContent = label;
		button.addEventListener("click", onClick);
		return button;
	}
}
