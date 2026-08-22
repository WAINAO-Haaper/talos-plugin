/**
 * D-TLP-015：对话页双通道滑动切换器。
 * DeepSeek Harness（iframe 桌面界面）与 Codex 工作台（claudian codex 内核）
 * 双通道保活：切换只切可见性，不丢会话与进程；选中通道由调用方持久化。
 */

import type { ChatSurfaceWorkbench } from "../quyuan/chat-surface";

export interface HarnessChannel {
	id: string;
	label: string;
	workbench: ChatSurfaceWorkbench;
}

export interface HarnessSwitcherDeps {
	/** 恰好两个通道：dsh 与 codex。 */
	channels: HarnessChannel[];
	getActiveId(): string;
	/** 持久化由调用方负责（写设置并保存）。 */
	setActiveId(id: string): void;
}

export const HARNESS_SURFACE_IDS = ["dsh", "codex"] as const;
export type HarnessSurfaceId = (typeof HARNESS_SURFACE_IDS)[number];

export function normalizeHarnessSurface(value: unknown): HarnessSurfaceId {
	return value === "codex" ? "codex" : "dsh";
}

export class HarnessSwitcherWorkbench implements ChatSurfaceWorkbench {
	private root: HTMLElement | null = null;
	private thumb: HTMLElement | null = null;
	private readonly slots = new Map<string, HTMLElement>();
	private readonly mountedChannels = new Set<string>();
	private activeId: string;

	constructor(private readonly deps: HarnessSwitcherDeps) {
		if (deps.channels.length !== 2) {
			throw new Error("Harness 切换器需要恰好两个通道");
		}
		this.activeId = deps.getActiveId();
	}

	private channel(id: string): HarnessChannel {
		const found = this.deps.channels.find((c) => c.id === id);
		if (!found) throw new Error(`未知 Harness 通道：${id}`);
		return found;
	}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") {
			throw new Error("Harness 切换器只允许 chat 会话命名空间");
		}
		if (!this.root) this.buildShell(container.ownerDocument);
		if (this.root && this.root.parentElement !== container) {
			container.appendChild(this.root);
		}
		await this.ensureChannelMounted(this.activeId, namespace);
		this.renderActive();
	}

	private buildShell(doc: Document): void {
		const root = doc.createElement("div");
		root.className = "talos-harness-switcher";

		const bar = doc.createElement("div");
		bar.className = "talos-harness-switch";
		const thumb = doc.createElement("i");
		thumb.className = "talos-harness-switch__thumb";
		bar.appendChild(thumb);
		this.thumb = thumb;
		for (const channel of this.deps.channels) {
			const option = doc.createElement("button");
			option.className = "talos-harness-switch__option";
			option.dataset.channelId = channel.id;
			option.type = "button";
			option.textContent = channel.label;
			option.addEventListener("click", () => void this.switchTo(channel.id));
			bar.appendChild(option);
		}
		root.appendChild(bar);

		const body = doc.createElement("div");
		body.className = "talos-harness-switcher__body";
		for (const channel of this.deps.channels) {
			const slot = doc.createElement("div");
			slot.className = "talos-harness-switcher__slot";
			slot.dataset.channelId = channel.id;
			body.appendChild(slot);
			this.slots.set(channel.id, slot);
		}
		root.appendChild(body);
		this.root = root;
	}

	private async ensureChannelMounted(
		id: string,
		namespace: "chat"
	): Promise<void> {
		if (this.mountedChannels.has(id)) return;
		const slot = this.slots.get(id);
		if (!slot) throw new Error(`Harness 通道插槽缺失：${id}`);
		await this.channel(id).workbench.mount(slot, namespace);
		this.mountedChannels.add(id);
	}

	private async switchTo(id: string): Promise<void> {
		if (id === this.activeId) return;
		this.activeId = id;
		this.deps.setActiveId(id);
		try {
			await this.ensureChannelMounted(id, "chat");
		} finally {
			this.renderActive();
		}
		this.channel(id).workbench.focusComposer();
	}

	private renderActive(): void {
		const index = Math.max(
			0,
			this.deps.channels.findIndex((c) => c.id === this.activeId)
		);
		if (this.thumb) {
			this.thumb.style.transform = `translateX(${index * 100}%)`;
		}
		for (const channel of this.deps.channels) {
			const isActive = channel.id === this.activeId;
			this.slots.get(channel.id)?.classList.toggle("is-active", isActive);
		}
		this.root
			?.querySelectorAll<HTMLElement>(".talos-harness-switch__option")
			.forEach((el) => {
				el.classList.toggle(
					"is-active",
					el.dataset.channelId === this.activeId
				);
			});
	}

	async suspend(): Promise<void> {
		// 双通道保活：只摘外壳 DOM，两个通道的会话与进程都保留。
		this.root?.remove();
	}

	focusComposer(): void {
		this.channel(this.activeId).workbench.focusComposer();
	}

	async destroy(): Promise<void> {
		for (const channel of this.deps.channels) {
			if (this.mountedChannels.has(channel.id)) {
				await channel.workbench.destroy();
			}
		}
		this.mountedChannels.clear();
		this.root?.remove();
		this.root = null;
		this.thumb = null;
		this.slots.clear();
	}
}
