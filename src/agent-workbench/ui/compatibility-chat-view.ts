import type { WorkspaceLeaf } from "obsidian";
import type { ChatSurfaceWorkbench } from "../../quyuan/chat-surface";
import type { ClaudianView } from "../../quyuan/claudian/features/chat/ClaudianView";
import { createConstructorIsolatedProxy } from "../../ui/constructor-isolated-proxy";
import type { ClaudianCompatibilityHost } from "./claudian-compatibility-host";

export class CompatibilityChatView implements ChatSurfaceWorkbench {
	private view: ClaudianView | null = null;
	private runtimeCleanup: (() => void) | null = null;
	private runtimeListener: ((runtimeId: "claude" | "codex" | "ohmypi", modelId?: string) => void) | null = null;

	constructor(private readonly leaf: WorkspaceLeaf, private readonly plugin: ClaudianCompatibilityHost) {}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") throw new Error("兼容展示层只允许 chat 命名空间");
		if (!this.view) {
			const { ClaudianView: EmbeddedClaudianView } = await import("../../quyuan/claudian/features/chat/ClaudianView");
			const constructorLeaf = createConstructorIsolatedProxy(
				this.leaf,
				{ containerEl: container.ownerDocument.createElement("div") },
			);
			const view = new EmbeddedClaudianView(constructorLeaf, this.plugin);
			view.leaf = this.leaf;
			this.plugin.registerEmbeddedView(view);
			this.view = view;
			this.runtimeCleanup = view.onTalosRuntimeChanged((runtimeId, modelId) => this.runtimeListener?.(runtimeId, modelId));
		}
		await this.view.mountEmbedded(container, namespace);
	}

	async suspend(): Promise<void> { await this.view?.suspendEmbedded(); }
	focusComposer(): void { this.view?.focusComposer(); }
	async selectRuntime(runtimeId: "claude" | "codex" | "ohmypi", modelId?: string): Promise<void> {
		if (!this.view) throw new Error("TALOS 兼容视图尚未挂载");
		await this.view.selectTalosRuntime(runtimeId, modelId);
	}
	onRuntimeChanged(listener: (runtimeId: "claude" | "codex" | "ohmypi", modelId?: string) => void): void {
		this.runtimeListener = listener;
		const current = this.view?.getSelectedTalosRuntime();
		if (current) listener(current);
	}
	async destroy(): Promise<void> {
		if (!this.view) return;
		this.runtimeCleanup?.();
		this.runtimeCleanup = null;
		await this.view.destroyEmbedded();
		this.plugin.unregisterEmbeddedView(this.view);
		this.view = null;
	}
}
