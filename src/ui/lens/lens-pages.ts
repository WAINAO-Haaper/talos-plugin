// Lens 界面语言的模块注册表：模块按超级大脑的功能划分，侧栏、图标栏、页签与标题共用一处定义
// （与 Lens 的 navigation-model 同理）。图标栏放 5 个快捷模块，其余收进「更多模块」。
import type { App } from "obsidian";
import type { VaultPaths } from "../../data/schema";
import type { LensData } from "./lens-data";

export type LensModuleId =
	| "overview"
	| "workbench"
	| "collect"
	| "knowledge"
	| "projects"
	| "output"
	| "identity"
	| "system"
	| "assistant"
	| "voice"
	| "preferences";

export interface LensModule {
	id: LensModuleId;
	title: string;
	icon: string;
	tabs?: ReadonlyArray<readonly [string, string]>;
	bottom?: boolean;
	/** 助手不占主区：点击后在右侧边栏打开对话。 */
	external?: boolean;
}

export const LENS_MODULES: readonly LensModule[] = [
	{ id: "workbench", title: "工作台", icon: "layout-dashboard", tabs: [["inbox", "资料"], ["projects", "项目与任务"], ["health", "系统与记忆"]] },
	{ id: "assistant", title: "语音助手", icon: "audio-lines", tabs: [["voice", "语音"], ["chat", "对话"], ["harness", "Harness"]] },
	{ id: "overview", title: "系统总览", icon: "house", tabs: [["today", "总览"]] },
	{ id: "preferences", title: "设置", icon: "settings", bottom: true },
];

export const LENS_RAIL_SHORTCUTS: readonly LensModuleId[] = ["workbench", "assistant", "overview"];

export function lensModule(id: LensModuleId): LensModule {
	const found = LENS_MODULES.find((module) => module.id === id);
	if (!found) throw new Error(`未知 Lens 模块：${id}`);
	return found;
}

export function defaultTab(id: LensModuleId): string | null {
	return lensModule(id).tabs?.[0]?.[0] ?? null;
}

export interface LensState {
	projectView: "board" | "list";
	projectFilter: string;
	queries: Record<string, string>;
	deckPages: Record<string, number>;
	ovExpand: string | null;
}

export interface LensContext {
	doc: Document;
	app: App;
	data: LensData;
	paths: VaultPaths;
	tasksPath: string;
	profileName: string;
	state: LensState;
	tab: string | null;
	navigate(module: LensModuleId, tab?: string): void;
	rerender(): void;
	openNote(path: string, newTab?: boolean): void;
	openDrawer(path: string): void;
	drawerPath(): string | null;
	openChat(): void;
	invokeCommand(command: string): void;
	openHarness(): void;
	renderDecisions(host: HTMLElement): void;
	renderInbox(host: HTMLElement): void;
	renderSettings(host: HTMLElement): void;
	mountVoice(host: HTMLElement): void;
	refresh(): void;
}
