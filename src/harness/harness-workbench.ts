/**
 * D-TLP-014：DeepSeek Harness 嵌入面。
 * 以 iframe 加载 loopback dsh web UI，实现 ChatSurfaceWorkbench 契约，
 * 经 TalosChatSurface 挂进对话页；API 与模型配置由 harness 自带设置承载。
 */

import type { ChatSurfaceWorkbench } from "../quyuan/chat-surface";
import type { DshProcessManager } from "./dsh-process-manager";

export const HARNESS_IFRAME_SANDBOX =
	"allow-scripts allow-forms allow-same-origin allow-downloads";

export interface HarnessWorkbenchDeps {
	manager: DshProcessManager;
}

export class HarnessWorkbench implements ChatSurfaceWorkbench {
	private root: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private frame: HTMLIFrameElement | null = null;
	private detachStateListener: (() => void) | null = null;

	constructor(private readonly deps: HarnessWorkbenchDeps) {}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") {
			throw new Error("Harness 嵌入面只允许 chat 会话命名空间");
		}
		const doc = container.ownerDocument;
		if (!this.root) {
			this.buildShell(doc);
		}
		if (this.root && this.root.parentElement !== container) {
			container.appendChild(this.root);
		}
		await this.attach();
	}

	private buildShell(doc: Document): void {
		const root = doc.createElement("div");
		root.className = "talos-harness";

		const status = doc.createElement("div");
		status.className = "talos-harness__status";
		root.appendChild(status);
		this.statusEl = status;

		const frame = doc.createElement("iframe");
		frame.className = "talos-harness__frame";
		frame.setAttribute("sandbox", HARNESS_IFRAME_SANDBOX);
		frame.setAttribute("referrerpolicy", "no-referrer");
		root.appendChild(frame);
		this.frame = frame;

		this.detachStateListener = this.deps.manager.onStateChange(() =>
			this.renderStatus()
		);
		this.root = root;
	}

	private renderStatus(): void {
		if (!this.statusEl) return;
		const manager = this.deps.manager;
		const state = manager.getState();
		if (state === "ready") {
			this.statusEl.setAttribute("hidden", "");
			this.statusEl.textContent = "";
			return;
		}
		this.statusEl.removeAttribute("hidden");
		this.statusEl.empty();
		if (state === "error") {
			const panel = this.statusEl.createDiv({ cls: "talos-harness__error" });
			panel.createEl("strong", { text: "Harness 未运行" });
			panel.createEl("p", { text: manager.getLastError() });
			panel.createEl("small", {
				text: "API 与模型在嵌入界面的「设置 → Models」里配置；工作区已锁死到当前仓库。",
			});
			const retry = panel.createEl("button", { text: "重试启动" });
			retry.addEventListener("click", () => void this.attach(true));
			return;
		}
		this.statusEl.createEl("p", {
			text: state === "starting" ? "正在启动 Harness…" : "Harness 已停止",
		});
	}

	private async attach(restart = false): Promise<void> {
		const manager = this.deps.manager;
		this.renderStatus();
		try {
			if (restart) await manager.restart();
			else await manager.ensureStarted();
		} catch {
			this.renderStatus();
			return;
		}
		const baseUrl = manager.getBaseUrl();
		if (this.frame && this.frame.getAttribute("src") !== baseUrl) {
			this.frame.setAttribute("src", baseUrl);
		}
		this.renderStatus();
	}

	async suspend(): Promise<void> {
		// 只摘 DOM，不停进程：会话与 Web UI 状态保留，重新挂载时原样恢复。
		this.root?.remove();
	}

	focusComposer(): void {
		this.frame?.focus();
	}

	async destroy(): Promise<void> {
		this.detachStateListener?.();
		this.detachStateListener = null;
		this.root?.remove();
		this.root = null;
		this.statusEl = null;
		this.frame = null;
	}
}
