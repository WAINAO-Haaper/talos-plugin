export interface StatCard {
	label: string;
	value: string;
	sub: string;
	tone?: "default" | "warn" | "hot" | "good";
	counts?: { open: number; inProgress: number; done: number; total: number };
}

export interface ModuleTile {
	name: string;
	count: number;
	lastChange: string; // 相对时间，如 "2d"
	readme: string; // _README 路径，点击跳转
	readmeExists: boolean;
	latestTitle: string;
	latestPath?: string;
}

export interface DistBar {
	name: string;
	count: number;
	readme: string;
}

export interface FocusItem {
	level: "hot" | "warn" | "normal";
	title: string;
	desc: string;
	doneWhen?: string;
	path?: string;
}

export interface SignalItem {
	title: string;
	meta: string;
	path?: string;
}

export interface HealthPoint {
	label: string;
	score: number;
}

export interface HeatCell {
	date: string;
	count: number;
	level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatMonth {
	label: string;
	weeks: HeatCell[][];
}

export interface GateItem {
	id: string;
	title: string;
	state: "done" | "ready" | "blocked" | "todo";
	path?: string;
}

export interface ReleaseWarRoom {
	published: number;
	totalPub: number;
	frozenDays: number;
	stopTriggered: boolean;
	gates: GateItem[];
	pubActions: GateItem[];
}


export interface MetricTile {
	label: string;
	value: string;
	sub: string;
	path?: string;
	tone?: "default" | "warn" | "hot" | "good";
	/** 右侧辅助信息徽章（填充式布局，2026-07-20）：趋势/状态等短文本，只用已有数据 */
	aux?: string;
}

export interface OutputPlatform {
	name: string;
	count: number;
	published: number;
	pending: number;
	readme: string;
	latestTitle: string;
	latestPath?: string;
}

export interface OutputCenter {
	metrics: MetricTile[];
	queue: SignalItem[];
	/** 明确可识别的未完成复选框总数；未配置或格式不识别时缺省。 */
	queueTotal?: number;
	queueStatus?: "ready" | "missing" | "format";
	platforms: OutputPlatform[];
	opsCandidates: SignalItem[];
}

export interface InboxCluster {
	name: string;
	count: number;
	hint: string;
}

export interface InboxAgeBucket {
	label: string;
	count: number;
	tone: "info" | "good" | "warn" | "hot";
}

/** 待分诊队列中的一条收件箱笔记。 */
export interface InboxQueueItem {
	path: string;
	title: string;
	ageDays: number;
	/** 笔记 frontmatter / 正文已有的标签。 */
	tags: string[];
	/** 与这条笔记互相链接的已有笔记（收件箱外，最多 3 条）。 */
	linked: string[];
}

export interface InboxDigest {
	count: number;
	oldestDays: number;
	clusters: InboxCluster[];
	recent: SignalItem[];
	ageBuckets: InboxAgeBucket[];
	/** 待分诊队列，按进入时间从早到晚，最多 INBOX_QUEUE_LIMIT 条。 */
	queue: InboxQueueItem[];
}

export interface HealthDigest {
	metrics: MetricTile[];
	errors: SignalItem[];
	loopStatus: SignalItem[];
}

export interface ProjectScene {
	name: string;
	count: number;
	status: string;
	readme: string;
	latestTitle: string;
	latestPath?: string;
	latestMtime?: number;
	priority: "p0" | "p1" | "p2";
	/** 任务进度：文件夹内 Markdown 复选框完成/总数；无复选框时缺省 */
	progress?: { done: number; total: number; sampled?: boolean; scannedFiles?: number; totalFiles?: number };
}

export interface KnowledgeHub {
	metrics: MetricTile[];
	mocs: SignalItem[];
	recentInsights: SignalItem[];
	recentMaterials: SignalItem[];
}

export interface TalosModule {
	name: string;
	count: number;
	readme: string;
	latestTitle: string;
	latestPath?: string;
}

export interface TalosProduct {
	metrics: MetricTile[];
	modules: TalosModule[];
}
