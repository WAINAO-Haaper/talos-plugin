export type TalosPrimaryPageKey =
	| "workbench"
	| "chat"
	| "voice"
	| "workflow"
	| "knowledge"
	| "system";

export type TalosSecondaryPageKey =
	| "daily"
	| "inbox"
	| "output"
	| "projects"
	| "knowledge"
	| "identity"
	| "talos"
	| "health"
	| "capability"
	| "vault"
	| "settings";

export interface TalosSecondaryPage {
	key: TalosSecondaryPageKey;
	label: string;
	icon: string;
}

export interface TalosPrimaryPage {
	key: TalosPrimaryPageKey;
	label: string;
	icon: string;
	subtitle: string;
	children: readonly TalosSecondaryPage[];
}

export interface TalosPageRoute {
	primary: TalosPrimaryPageKey;
	secondary?: TalosSecondaryPageKey;
}

export const PRIMARY_NAVIGATION: readonly TalosPrimaryPage[] = [
	{
		key: "workbench",
		label: "工作台",
		icon: "layout-dashboard",
		subtitle: "今日行动、系统概览与模块入口",
		children: [],
	},
	{
		key: "chat",
		label: "AI 对话",
		icon: "messages-square",
		subtitle: "多模型对话与全库操作",
		children: [],
	},
	{
		key: "voice",
		label: "语音助手",
		icon: "audio-lines",
		subtitle: "持续语音、字幕与任务审批",
		children: [],
	},
	{
		key: "workflow",
		label: "工作流",
		icon: "workflow",
		subtitle: "每日执行、收件、输出与项目",
		children: [
			{ key: "daily", label: "每日执行", icon: "calendar-check" },
			{ key: "inbox", label: "收件箱", icon: "inbox" },
			{ key: "output", label: "输出作战室", icon: "send" },
			{ key: "projects", label: "项目场景", icon: "folder-kanban" },
		],
	},
	{
		key: "knowledge",
		label: "知识资产",
		icon: "library",
		subtitle: "知识、身份与 TALOS 产品资产",
		children: [
			{ key: "knowledge", label: "知识枢纽", icon: "brain" },
			{ key: "identity", label: "身份上下文", icon: "fingerprint" },
			{ key: "talos", label: "TALOS 产品", icon: "filter" },
		],
	},
	{
		key: "system",
		label: "系统中心",
		icon: "settings-2",
		subtitle: "健康、能力、全库与设置",
		children: [
			{ key: "health", label: "系统健康", icon: "activity" },
			{ key: "capability", label: "能力中心", icon: "blocks" },
			{ key: "vault", label: "全库视图", icon: "database" },
			{ key: "settings", label: "设置", icon: "settings" },
		],
	},
] as const;

export const LEGACY_PAGE_KEYS = [
	"overview",
	"daily",
	"jarvis",
	"inbox",
	"output",
	"projects",
	"knowledge",
	"identity",
	"talos",
	"health",
	"capability",
	"vault",
] as const;

const PAGE_ROUTES: Readonly<Record<string, TalosPageRoute>> = {
	overview: { primary: "workbench" },
	workbench: { primary: "workbench" },
	chat: { primary: "chat" },
	"talos-quyuan-view": { primary: "chat" },
	jarvis: { primary: "voice" },
	voice: { primary: "voice" },
	workflow: { primary: "workflow", secondary: "daily" },
	daily: { primary: "workflow", secondary: "daily" },
	inbox: { primary: "workflow", secondary: "inbox" },
	output: { primary: "workflow", secondary: "output" },
	projects: { primary: "workflow", secondary: "projects" },
	knowledge: { primary: "knowledge", secondary: "knowledge" },
	identity: { primary: "knowledge", secondary: "identity" },
	talos: { primary: "knowledge", secondary: "talos" },
	system: { primary: "system", secondary: "health" },
	health: { primary: "system", secondary: "health" },
	capability: { primary: "system", secondary: "capability" },
	vault: { primary: "system", secondary: "vault" },
	settings: { primary: "system", secondary: "settings" },
};

export interface WorkbenchModuleEntry {
	key:
		| "inbox"
		| "identity"
		| "logs"
		| "insights"
		| "assets"
		| "projects"
		| "workflows"
		| "output"
		| "archive";
	label: string;
	pageKey: string;
	icon: string;
}

export const WORKBENCH_MODULES: readonly WorkbenchModuleEntry[] = [
	{ key: "inbox", label: "收件箱", pageKey: "inbox", icon: "inbox" },
	{ key: "identity", label: "身份", pageKey: "identity", icon: "fingerprint" },
	{ key: "logs", label: "日志", pageKey: "daily", icon: "notebook-pen" },
	{ key: "insights", label: "洞察", pageKey: "knowledge", icon: "lightbulb" },
	{ key: "assets", label: "素材", pageKey: "knowledge", icon: "library" },
	{ key: "projects", label: "项目", pageKey: "projects", icon: "folder-kanban" },
	{ key: "workflows", label: "工作流", pageKey: "workflow", icon: "workflow" },
	{ key: "output", label: "输出", pageKey: "output", icon: "send" },
	{ key: "archive", label: "归档", pageKey: "vault", icon: "archive" },
] as const;

export function resolvePageRoute(pageKey: string): TalosPageRoute | null {
	const route = PAGE_ROUTES[pageKey];
	return route ? { ...route } : null;
}

export function primaryPage(
	key: TalosPrimaryPageKey
): TalosPrimaryPage {
	const page = PRIMARY_NAVIGATION.find((item) => item.key === key);
	if (!page) throw new Error(`未知一级页面：${key}`);
	return page;
}

export function defaultRouteForPrimary(
	key: TalosPrimaryPageKey
): TalosPageRoute {
	const page = primaryPage(key);
	return page.children[0]
		? { primary: key, secondary: page.children[0].key }
		: { primary: key };
}
