import type { ChatSurfaceWorkbench } from "./chat-surface";

/**
 * Lazily resolves a chat workbench the first time its channel is mounted.
 *
 * A restored Obsidian view may render before an asynchronously initialized
 * runtime is ready. Keeping that wait inside the channel prevents a temporary
 * startup state from becoming a permanent page-level failure and lets the
 * other chat channel remain independent.
 */
export class DeferredChatWorkbench implements ChatSurfaceWorkbench {
	private workbench: ChatSurfaceWorkbench | null = null;
	private loading: Promise<ChatSurfaceWorkbench> | null = null;
	private destroyed = false;

	constructor(
		private readonly load: () => Promise<ChatSurfaceWorkbench>,
	) {}

	private resolve(): Promise<ChatSurfaceWorkbench> {
		if (this.workbench) return Promise.resolve(this.workbench);
		if (this.destroyed) {
			return Promise.reject(new Error("延迟工作台已释放"));
		}
		this.loading ??= this.load().then(async (workbench) => {
			if (this.destroyed) {
				await workbench.destroy();
				throw new Error("延迟工作台已释放");
			}
			this.workbench = workbench;
			return workbench;
		});
		return this.loading;
	}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") {
			throw new Error("延迟工作台只允许 chat 会话命名空间");
		}
		const workbench = await this.resolve();
		await workbench.mount(container, namespace);
	}

	async suspend(): Promise<void> {
		await this.workbench?.suspend();
	}

	focusComposer(): void {
		this.workbench?.focusComposer();
	}

	async destroy(): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.workbench) {
			await this.workbench.destroy();
			this.workbench = null;
		}
	}
}
