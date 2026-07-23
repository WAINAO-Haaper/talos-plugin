export interface ChatSurfaceHost {
	mount(container: HTMLElement, namespace: "chat"): Promise<void>;
	unmount(): Promise<void>;
	focusComposer(): void;
}

export interface ChatSurfaceWorkbench {
	mount(container: HTMLElement, namespace: "chat"): Promise<void>;
	suspend(): Promise<void>;
	focusComposer(): void;
	destroy(): Promise<void>;
}

export class TalosChatSurface implements ChatSurfaceHost {
	readonly namespace = "chat" as const;
	private mountedContainer: HTMLElement | null = null;
	private disposed = false;

	constructor(private readonly workbench: ChatSurfaceWorkbench) {}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (this.disposed) throw new Error("AI 对话 surface 已释放");
		if (namespace !== this.namespace) {
			throw new Error("AI 对话 surface 只允许 chat 会话命名空间");
		}
		if (this.mountedContainer === container) return;
		if (this.mountedContainer) await this.workbench.suspend();
		await this.workbench.mount(container, this.namespace);
		this.mountedContainer = container;
	}

	async unmount(): Promise<void> {
		if (!this.mountedContainer || this.disposed) return;
		this.mountedContainer = null;
		await this.workbench.suspend();
	}

	focusComposer(): void {
		if (this.disposed) return;
		this.workbench.focusComposer();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		await this.unmount();
		this.disposed = true;
		await this.workbench.destroy();
	}
}
