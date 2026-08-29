import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import { TalosAgentWorkbench } from "./talos-agent-workbench";

/** Stable legacy address retained so saved Obsidian layouts still reopen. */
export const VIEW_TYPE_TALOS_AGENT_RECOVERY = "talos-quyuan-view";

export class TalosAgentRecoveryView extends ItemView {
	private workbench: TalosAgentWorkbench | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly service: () => Promise<AgentWorkbenchService>,
	) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_TALOS_AGENT_RECOVERY; }
	getDisplayText(): string { return "TALOS AI 对话"; }
	getIcon(): string { return "bot-message-square"; }

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.workbench = new TalosAgentWorkbench({
			leaf: this.leaf,
			service: await this.service(),
		});
		await this.workbench.mount(this.contentEl, "chat");
	}

	async onClose(): Promise<void> {
		await this.workbench?.destroy();
		this.workbench = null;
		this.contentEl.empty();
	}
}
