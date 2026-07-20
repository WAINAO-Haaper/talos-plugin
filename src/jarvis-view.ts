import { ItemView, WorkspaceLeaf } from "obsidian";
import type TalosPlugin from "./main";

// ============================================================
// 屈原 · 独立侧边栏视图（仿 Claudian）
//   只挂 JarvisAgentPanel，点侧边栏按钮即开，在右侧边栏常驻。
//   复用控制台「屈原」页同一个面板组件 + 同一份会话持久化。
// ============================================================
export const VIEW_TYPE_JARVIS = "talos-jarvis-view";

type JarvisAgentPanelLike = {
	mount(container: HTMLElement): void;
	unmount(): void;
};

const THEME_CLASSES = [
	"theme-aurora",
	"theme-cosmos-dark",
	"theme-animal-island",
	"theme-system-classic",
	"theme-data-stream",
	"theme-soft-relief",
	"theme-geometric-modern",
	"theme-executive-brief",
	"theme-paper-ink",
	"theme-swiss-modern",
];

export class JarvisView extends ItemView {
	private panel: JarvisAgentPanelLike | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: TalosPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_JARVIS;
	}

	getDisplayText(): string {
		return "屈原";
	}

	getIcon(): string {
		return "talos-logo";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("talos-console", "talos-jarvis-pane", "page-jarvis");
		this.applyTheme();
		root.createDiv({ cls: "empty", text: "屈原旧版加载中…" });
		try {
			const { JarvisAgentPanel } = await import("./jarvis/panel");
			root.empty();
			this.panel = new JarvisAgentPanel(this.app, this.plugin.talosSettings, () => this.plugin.saveTalosSettings());
			this.panel.mount(root);
		} catch (error) {
			root.empty();
			const panel = root.createDiv({ cls: "panel talos-view-error-panel" });
			panel.createEl("h2", { text: "屈原旧版加载失败" });
			panel.createEl("p", {
				text: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async onClose(): Promise<void> {
		this.panel?.unmount();
		this.panel = null;
		this.contentEl.empty();
	}

	applyTheme(): void {
		const root = this.contentEl;
		const theme = this.plugin.talosSettings.visualTheme || "aurora";
		root.classList.remove(...THEME_CLASSES);
		root.addClass(`theme-${theme}`);
		root.setAttribute("data-talos-theme", theme);
	}
}
