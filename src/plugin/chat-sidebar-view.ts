// 右侧边栏的 TALOS 对话视图：与 Claudian 一样常驻右栏，主区页面保持不动。
// 工作台实例独立于控制台主视图，只在本视图内挂载，关闭视图即释放。
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { ChatSurfaceWorkbench } from "../quyuan/chat-surface";
import { DeferredChatWorkbench } from "../quyuan/deferred-chat-workbench";
import type { AgentWorkbenchService } from "../agent-workbench/core/agent-workbench-service";
import type { CustomApiHost } from "../agent-workbench/config/custom-api";

export const VIEW_TYPE_TALOS_CHAT = "talos-agent-chat";

export interface ChatSidebarHost {
	icon: string;
	waitForAgentWorkbench(): Promise<{ service: AgentWorkbenchService }>;
	customApi?: CustomApiHost;
}

export class TalosChatSidebarView extends ItemView {
	private workbench: ChatSurfaceWorkbench | null = null;
	private mountError: string | null = null;
	private mountReady: Promise<boolean> | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly host: ChatSidebarHost) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TALOS_CHAT;
	}

	getDisplayText(): string {
		return "TALOS 对话";
	}

	getIcon(): string {
		return this.host.icon;
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("talos-chat-sidebar");
		const surface = this.contentEl.createDiv({ cls: "talos-chat-sidebar__surface" });
		const workbench = new DeferredChatWorkbench(async () => {
			const { service } = await this.host.waitForAgentWorkbench();
			const { TalosAgentWorkbench } = await import("../agent-workbench/ui/talos-agent-workbench");
			return new TalosAgentWorkbench({ leaf: this.leaf, service, customApi: this.host.customApi });
		});
		this.workbench = workbench;
		this.mountError = null;
		this.mountReady = (async () => {
			try {
				await workbench.mount(surface, "chat");
				return this.workbench === workbench;
			} catch (error) {
				if (this.workbench !== workbench) return false;
				this.mountError = error instanceof Error ? error.message : String(error);
				surface.empty();
				const panel = surface.createDiv({ cls: "talos-chat-sidebar__error" });
				panel.createEl("strong", { text: "TALOS 对话加载失败" });
				panel.createEl("p", { text: this.mountError });
				return false;
			}
		})();
		await this.mountReady;
	}

	/** 叶子创建成功不代表工作台加载成功；所有打开入口共用这个结果。 */
	async waitUntilReady(): Promise<boolean> {
		const ready = this.mountReady;
		if (ready && !(await ready)) return false;
		return this.workbench !== null && this.mountError === null
			&& (!ready || this.mountReady === ready);
	}

	focusComposer(): void {
		if (!this.mountError) this.workbench?.focusComposer();
	}

	/** 预填输入框；对话加载失败时返回 false，由调用方降级。 */
	prefillComposer(text: string): boolean {
		if (this.mountError || !this.workbench?.prefillComposer) return false;
		this.workbench.prefillComposer(text);
		return true;
	}

	async onClose(): Promise<void> {
		const workbench = this.workbench;
		this.workbench = null;
		this.mountReady = null;
		await workbench?.destroy();
	}
}

interface SidebarWorkspace {
	getLeavesOfType(type: string): WorkspaceLeaf[];
	getRightLeaf(split: boolean): WorkspaceLeaf | null;
	revealLeaf(leaf: WorkspaceLeaf): Promise<void> | void;
}

/** 打开（或复用）右侧边栏对话视图并聚焦输入框；给出 prefill 时只填入不发送。 */
export async function revealChatSidebar(workspace: SidebarWorkspace, prefill?: string): Promise<WorkspaceLeaf | null> {
	let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE_TALOS_CHAT)[0];
	if (!leaf) {
		const created = workspace.getRightLeaf(false);
		if (!created) return null;
		await created.setViewState({ type: VIEW_TYPE_TALOS_CHAT, active: true });
		leaf = created;
	}
	await workspace.revealLeaf(leaf);
	if (!(leaf.view instanceof TalosChatSidebarView) || !(await leaf.view.waitUntilReady())) return null;
	if (prefill === undefined) leaf.view.focusComposer();
	else if (!leaf.view.prefillComposer(prefill)) return null;
	return leaf;
}
