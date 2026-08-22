/**
 * D-TLP-015：Codex 通道适配器。
 * 把 C-2 建成的 claudian 对话工作台（codex 内核）包成 ChatSurfaceWorkbench，
 * 供对话页双通道切换器挂载。构造隔离代理与 registerEmbeddedView 接线
 * 从 view.ts 迁入本适配器；独立恢复视图（open-quyuan-v2-recovery）不受影响。
 */

import type { WorkspaceLeaf } from "obsidian";
import type { ChatSurfaceWorkbench } from "../quyuan/chat-surface";
import type ClaudianPlugin from "../quyuan/claudian/main";
import type { ClaudianView } from "../quyuan/claudian/features/chat/ClaudianView";
import { createConstructorIsolatedProxy } from "../ui/constructor-isolated-proxy";

export interface ClaudianCodexWorkbenchDeps {
	leaf: WorkspaceLeaf;
	plugin: ClaudianPlugin;
}

export class ClaudianCodexWorkbench implements ChatSurfaceWorkbench {
	private view: ClaudianView | null = null;

	constructor(private readonly deps: ClaudianCodexWorkbenchDeps) {}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") {
			throw new Error("Codex 通道只允许 chat 会话命名空间");
		}
		if (!this.view) {
			const { ClaudianView: EmbeddedClaudianView } = await import(
				"../quyuan/claudian/features/chat/ClaudianView"
			);
			const constructorLeaf = createConstructorIsolatedProxy(
				this.deps.leaf,
				{ containerEl: container.ownerDocument.createElement("div") }
			);
			const view = new EmbeddedClaudianView(
				constructorLeaf,
				this.deps.plugin
			);
			view.leaf = this.deps.leaf;
			this.deps.plugin.registerEmbeddedView(view);
			this.view = view;
		}
		await this.view.mountEmbedded(container, namespace);
	}

	async suspend(): Promise<void> {
		// 非破坏性挂起：会话与流式任务保留（persistTabStateImmediate 路径）。
		await this.view?.suspendEmbedded();
	}

	focusComposer(): void {
		this.view?.focusComposer();
	}

	async destroy(): Promise<void> {
		if (!this.view) return;
		await this.view.destroyEmbedded();
		this.deps.plugin.unregisterEmbeddedView(this.view);
		this.view = null;
	}
}
