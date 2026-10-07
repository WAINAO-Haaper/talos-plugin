import type { CapabilityGroup } from "../data/capabilities";
import type { DistBar, FocusItem, HealthDigest, HealthPoint, HeatMonth, InboxDigest, KnowledgeHub, ModuleTile, OutputCenter, ProjectScene, ReleaseWarRoom, SignalItem, StatCard, TalosProduct } from "../types";
import type { VaultPaths } from "../data/schema";

export type QuyuanVoicePanelLike = {
	mount(container: HTMLElement): void;
	unmount(): void;
};

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
export const SVG_NS = "http://www.w3.org/2000/svg";

export type TalosPageArchetype = "dashboard" | "execution" | "knowledge" | "workspace" | "settings";

export const PAGE_ARCHETYPES: Record<string, TalosPageArchetype> = {
	overview: "dashboard",
	health: "dashboard",
	vault: "dashboard",
	daily: "execution",
	inbox: "execution",
	output: "execution",
	projects: "execution",
	talos: "execution",
	knowledge: "knowledge",
	identity: "knowledge",
	capability: "knowledge",
	chat: "workspace",
	jarvis: "workspace",
	settings: "settings",
};
export const dailyRota = (P: VaultPaths, tasksPath: string) => [
	{ day: 1, code: "MON", label: "周一", project: "TALOS 系统", desc: "产品脊柱、交付包、控制台", path: `${P.talosProjectDir}/_README.md` },
	{ day: 2, code: "TUE", label: "周二", project: "输出器官 / 首发件", desc: "发布流程、首发件、承接口", path: P.readme("output") },
	{ day: 3, code: "WED", label: "周三", project: "B 端交付", desc: "样板项目与客户推进", path: P.readme("projects") },
	{ day: 4, code: "THU", label: "周四", project: "GEO 站点 + TALOS 支撑", desc: "公开资产、搜索入口、理论支撑", path: `${P.talosProjectDir}/_README.md` },
	{ day: 5, code: "FRI", label: "周五", project: "私域承接 / AI 社群", desc: "CTA、社群与模板包", path: P.opsCandidatesFile },
	{ day: 6, code: "SAT", label: "周六", project: "缓冲日", desc: "补阻塞、学习、修小破口", path: tasksPath },
	{ day: 0, code: "SUN", label: "周日", project: "休息 + 周重置", desc: "刷新上下文并摆好下周轨道", path: P.contextFile },
];
// 每日固定骨架时间轴（pageDaily 渲染与像素小人里程碑共用同一数据源）
export const dailyTimeline = (P: VaultPaths, tasksPath: string) => [
	{ time: "08:30", mins: 510, dur: 15, length: "15 min", title: "开工 · 接收系统指令", desc: "只确认焦点与 done_when，不重新规划人生。", starter: "复制「开工」，接今天第一步。", path: tasksPath, deep: false },
	{ time: "09:00", mins: 540, dur: 120, length: "120 min", title: "深度块① · 输出闭环", desc: "完成选、改、发、回填中的最短可验证闭环。", starter: "只处理统一出口今日待发的一条。", path: P.outletFile, deep: true },
	{ time: "11:00", mins: 660, dur: 45, length: "45 min", title: "分发回填 · 数据与消息", desc: "发布后立即回填链接、状态与运营观察。", starter: "检查 publish_url、signal 与 views。", path: P.opsCandidatesFile, deep: false },
	{ time: "14:00", mins: 840, dur: 120, length: "120 min", title: "深度块② · 当日轮值项目", desc: "", starter: "只做一个能留下痕迹的下一步。", path: P.readme("projects"), deep: true },
	{ time: "16:00", mins: 960, dur: 45, length: "45 min", title: "轻输入 · 客户沟通", desc: "最多处理 3 条，只捞能变成输出或交付的信号。", starter: "不做全库清仓。", path: P.readme("inbox"), deep: false },
	{ time: "17:00", mins: 1020, dur: 20, length: "20 min", title: "收工 · 关环并铺明天", desc: "记录实质碎片、更新任务池、留下明早第一步。", starter: "复制「收工」，写结果与阻塞。", path: `${P.workingMemoryDir}/_README.md`, deep: false },
];
export const SELECTABLE_MODULES = [
	".commands .command",
	".overview-card",
	".quick-card",
	".metric-card",
	".platform-card",
	".cluster-card",
	".project-card",
	".talos-module",
	".detail-row",
	".note",
	".focus",
	".gate",
	".signal-pill",
	".approval .item",
	".barrow",
	".stat",
	".daily-item",
].join(",");

export interface Collected {
	total: number;
	dist: DistBar[];
	modules: ModuleTile[];
	focus: FocusItem[];
	healthTrend: HealthPoint[];
	overview: { totalNotes: StatCard; inbox: StatCard; taskFlow: StatCard; health: StatCard };
	approvals: SignalItem[];
	candidates: SignalItem[];
	heatmap: { meta: string; months: HeatMonth[] };
	warRoom: ReleaseWarRoom;
	capGroups: CapabilityGroup[];
	output: OutputCenter;
	inbox: InboxDigest;
	healthDigest: HealthDigest;
	projects: ProjectScene[];
	knowledge: KnowledgeHub;
	talosProduct: TalosProduct;
}

export interface OverviewAttention {
	title: string;
	meta: string;
	detail: string;
	action: string;
	path: string;
	icon: string;
	tone: "hot" | "warn" | "default";
}

export interface ApprovalDecisionFeedback {
	title: string;
	decision: "approve" | "reject" | "execute";
	path?: string;
	at: string;
}

export interface CandidateDecisionFeedback {
	title: string;
	decision: "approve" | "reject";
	path?: string;
	at: string;
}

export interface ModuleHeroStat {
	label: string;
	value: string;
	sub?: string;
	path?: string;
	tone?: "default" | "warn" | "hot" | "good";
}

export interface ModuleHeroAction {
	label: string;
	icon: string;
	path?: string;
	command?: string;
}

export interface ModuleHeroOptions {
	ac: string;
	icon: string;
	eyebrow: string;
	title: string;
	desc: string;
	stats: ModuleHeroStat[];
	actions?: ModuleHeroAction[];
}
