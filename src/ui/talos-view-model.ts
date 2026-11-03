import type { AnyFileKey, FileStatus } from "../data/vault-files";
import type { CapabilityGroup } from "../data/capabilities";
import type { DistBar, FocusItem, HealthDigest, HealthPoint, HeatMonth, InboxDigest, KnowledgeHub, ModuleTile, OutputCenter, ProjectScene, ReleaseWarRoom, SignalItem, StatCard, TalosProduct } from "../types";
import type { VaultPaths } from "../data/schema";
import type { InsightStats } from "../data/insights";

export type QuyuanVoicePanelLike = {
	mount(container: HTMLElement): void;
	unmount(): void;
};

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
export const SVG_NS = "http://www.w3.org/2000/svg";

export type TalosPageArchetype = "dashboard" | "execution" | "knowledge" | "workspace" | "settings";

export const PAGE_ARCHETYPES: Record<string, TalosPageArchetype> = {
	today: "dashboard",
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
	harness: "workspace",
	settings: "settings",
};
// Retain empty legacy adapters for callers that still render a historical view.
export const dailyRota = (_paths: VaultPaths, _tasksPath: string): Array<{day: number; code: string; label: string; project: string; desc: string; path: string}> => [];
export const dailyTimeline = (_paths: VaultPaths, _tasksPath: string): Array<{time: string; mins: number; dur: number; length: string; title: string; desc: string; starter: string; path: string; deep: boolean}> => [];
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
	/** 未截断的焦点数；缺失配置由 setup 状态区分。 */
	focusTotal?: number;
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
	/** 长期数据画像（标签、双链、月度增长、合规）。 */
	insights: InsightStats;
	/** 登记文件的状态（缺失 / 缺分区 / 正常），用于页面缺失提示。 */
	setup?: Partial<Record<AnyFileKey, FileStatus>>;
}

export interface OverviewAttention {
	title: string;
	meta: string;
	detail: string;
	action: string;
	path: string;
	icon: string;
	tone: "hot" | "warn" | "default";
	/** 审批与偏好条目：在今日页内切到「待决策」处理，不再打开文件。 */
	target?: "decisions";
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
	/** 点击指标时的动作；优先于 path（例如跳到今日页的待决策）。 */
	onActivate?: () => void;
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
	/** 完整覆盖页头小字；缺省时显示「分组 · 页面」。 */
	eyebrow?: string;
	/** 追加在「分组 · 页面」之后的补充信息，例如日期。 */
	eyebrowDetail?: string;
	title: string;
	desc: string;
	stats: ModuleHeroStat[];
	metricLimit?: 4 | 5;
	actions?: ModuleHeroAction[];
}
