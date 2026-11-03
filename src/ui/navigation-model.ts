export type TalosPrimaryPageKey =
	| "home"
	| "today"
	| "workbench"
	| "flow"
	| "projects"
	| "assistant"
	| "system"
	| "settings"
	| SuperbrainPageKey;

/** 超级大脑框架模式的五组页面（一级、二级同 key）；与个人体系的 knowledge / output / system 分开命名。 */
export type SuperbrainPageKey = "sb-loop" | "sb-knowledge" | "sb-memory" | "sb-output" | "sb-system";

export type TalosSecondaryPageKey =
	| "home"
	| "today"
	| "tasks"
	| "daily"
	| "inbox"
	| "knowledge"
	| "output"
	| "projects"
	| "talos"
	| "chat"
	| "jarvis"
	| "harness"
	| "health"
	| "vault"
	| "capability"
	| "identity"
	| "settings"
	| SuperbrainPageKey;

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

// 主导航按「工作台 → 助手 → 系统 → 设置」组织，
// 每项数据只有一个主场页面，其他页面只放带跳转的提醒。二级页 key 沿用原页面 key，
// 页面实现与样式不受分组变化影响。
export const PRIMARY_NAVIGATION: readonly TalosPrimaryPage[] = [
	{
		key: "home",
		label: "首页",
		icon: "house",
		subtitle: "系统体检、今日处理与数据画像",
		children: [
			{ key: "home", label: "首页", icon: "house" },
		],
	},
	{
		key: "workbench",
		label: "工作台",
		icon: "layout-dashboard",
		subtitle: "资料、项目与任务、系统与记忆",
		children: [
			{ key: "inbox", label: "收件箱", icon: "inbox" },
			{ key: "knowledge", label: "知识库", icon: "brain" },
			{ key: "output", label: "输出", icon: "send" },
			{ key: "projects", label: "项目", icon: "folder-kanban" },
			{ key: "tasks", label: "任务与待决策", icon: "list-checks" },
			{ key: "health", label: "系统健康", icon: "activity" },
			{ key: "capability", label: "能力中心", icon: "blocks" },
			{ key: "identity", label: "身份上下文", icon: "fingerprint" },
		],
	},
	{
		key: "assistant",
		label: "语音助手",
		icon: "audio-lines",
		subtitle: "AI 对话、语音与 DeepSeek Harness",
		children: [
			{ key: "jarvis", label: "语音", icon: "audio-lines" },
			{ key: "chat", label: "AI 对话", icon: "messages-square" },
			{ key: "harness", label: "Harness", icon: "square-terminal" },
		],
	},
	{
		key: "today",
		label: "系统总览",
		icon: "sun",
		subtitle: "资料、项目与系统状态统计",
		children: [
			{ key: "today", label: "系统总览", icon: "sun" },
		],
	},
	// 与 Lens 一致：设置单独放在导航底部，不混入业务分组。
	{
		key: "settings",
		label: "设置",
		icon: "settings",
		subtitle: "插件界面、目录、数据源与 AI 配置",
		children: [{ key: "settings", label: "设置", icon: "settings" }],
	},
] as const;

const ASSISTANT_NAVIGATION = PRIMARY_NAVIGATION.find((page) => page.key === "assistant") as TalosPrimaryPage;
const SETTINGS_NAVIGATION = PRIMARY_NAVIGATION.find((page) => page.key === "settings") as TalosPrimaryPage;

const superbrainGroup = (key: SuperbrainPageKey, label: string, icon: string, subtitle: string): TalosPrimaryPage => ({
	key, label, icon, subtitle, children: [{ key, label, icon }],
});

/** 超级大脑框架模式导航：五组工作流与机制 + 共用的助手与设置。 */
export const SUPERBRAIN_NAVIGATION: readonly TalosPrimaryPage[] = [
	superbrainGroup("sb-loop", "今日与循环", "layout-dashboard", "晨间、全量整理和周度复盘"),
	superbrainGroup("sb-knowledge", "资料与检索", "library", "资料入库、知识检索和资料库维护"),
	superbrainGroup("sb-memory", "记忆与规则", "brain", "工作记忆、偏好消化和规则发现"),
	superbrainGroup("sb-output", "创作与成果", "send", "创作、统一出口、署名与经营反馈"),
	superbrainGroup("sb-system", "导出与系统保障", "shield-check", "可移植导出、运行机制和本地工具"),
	ASSISTANT_NAVIGATION,
	SETTINGS_NAVIGATION,
];

/** 超级大脑页面 → 工作流目录中的核心分组（与 superbrain-catalog 的 SUPERBRAIN_CORE_GROUPS 键一致）。 */
export const SUPERBRAIN_PAGE_GROUP: Readonly<Record<SuperbrainPageKey, "overview" | "knowledge" | "memory" | "output" | "system">> = {
	"sb-loop": "overview",
	"sb-knowledge": "knowledge",
	"sb-memory": "memory",
	"sb-output": "output",
	"sb-system": "system",
};

export function isSuperbrainPage(key: string): key is SuperbrainPageKey {
	return Object.prototype.hasOwnProperty.call(SUPERBRAIN_PAGE_GROUP, key);
}

// 个人界面沿用原有页面与设置位置；有目录时复用框架的五组 C/M 入口。
const PERSONAL_CATALOG_NAVIGATION: readonly TalosPrimaryPage[] = [
	...PRIMARY_NAVIGATION.filter((page) => page.key !== "settings"),
	...SUPERBRAIN_NAVIGATION.filter((page) => isSuperbrainPage(page.key)),
	SETTINGS_NAVIGATION,
];

export function navigationFor(mode: "personal" | "superbrain", hasSuperbrainCatalog = false): readonly TalosPrimaryPage[] {
	if (mode === "superbrain") return SUPERBRAIN_NAVIGATION;
	return hasSuperbrainCatalog ? PERSONAL_CATALOG_NAVIGATION : PRIMARY_NAVIGATION;
}

export function homePageFor(mode: "personal" | "superbrain"): string {
	return mode === "superbrain" ? "sb-loop" : "home";
}

/** 页面是否属于该模式的导航（助手与设置两种模式共用）。 */
export function pageBelongsTo(mode: "personal" | "superbrain", pageKey: string, hasSuperbrainCatalog = false): boolean {
	return navigationFor(mode, hasSuperbrainCatalog).some((group) => group.children.some((child) => child.key === pageKey));
}

export const LEGACY_PAGE_KEYS = [
	"overview",
	"today",
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

// 旧页面 key（含已保存的视图状态与命令入口）统一映射到新分组。
const PAGE_ROUTES: Readonly<Record<string, TalosPageRoute>> = {
	home: { primary: "home", secondary: "home" },
	today: { primary: "today", secondary: "today" },
	overview: { primary: "today", secondary: "today" },
	workbench: { primary: "workbench", secondary: "inbox" },
	daily: { primary: "workbench", secondary: "tasks" },
	tasks: { primary: "workbench", secondary: "tasks" },
	flow: { primary: "workbench", secondary: "inbox" },
	workflow: { primary: "workbench", secondary: "inbox" },
	inbox: { primary: "workbench", secondary: "inbox" },
	knowledge: { primary: "workbench", secondary: "knowledge" },
	output: { primary: "workbench", secondary: "output" },
	projects: { primary: "workbench", secondary: "projects" },
	talos: { primary: "workbench", secondary: "projects" },
	assistant: { primary: "assistant", secondary: "jarvis" },
	chat: { primary: "assistant", secondary: "chat" },
	"talos-quyuan-view": { primary: "assistant", secondary: "chat" },
	voice: { primary: "assistant", secondary: "jarvis" },
	jarvis: { primary: "assistant", secondary: "jarvis" },
	harness: { primary: "assistant", secondary: "harness" },
	dsh: { primary: "assistant", secondary: "harness" },
	system: { primary: "workbench", secondary: "health" },
	health: { primary: "workbench", secondary: "health" },
	vault: { primary: "workbench", secondary: "knowledge" },
	capability: { primary: "workbench", secondary: "capability" },
	identity: { primary: "workbench", secondary: "identity" },
	settings: { primary: "settings", secondary: "settings" },
	"sb-loop": { primary: "sb-loop", secondary: "sb-loop" },
	"sb-knowledge": { primary: "sb-knowledge", secondary: "sb-knowledge" },
	"sb-memory": { primary: "sb-memory", secondary: "sb-memory" },
	"sb-output": { primary: "sb-output", secondary: "sb-output" },
	"sb-system": { primary: "sb-system", secondary: "sb-system" },
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
	{ key: "logs", label: "日志", pageKey: "today", icon: "notebook-pen" },
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
	const page = PRIMARY_NAVIGATION.find((item) => item.key === key)
		?? SUPERBRAIN_NAVIGATION.find((item) => item.key === key);
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

/** 页头上下文：「分组 · 页面」；分组只有一个同名页面时只显示一次。 */
export function routeContextLabel(route: TalosPageRoute): string {
	const group = primaryPage(route.primary);
	const page = group.children.find((child) => child.key === route.secondary);
	return page && page.label !== group.label ? `${group.label} · ${page.label}` : group.label;
}
