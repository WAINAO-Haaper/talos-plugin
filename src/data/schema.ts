import type { App } from "obsidian";
// 刻意只做 type-only 导入：本模块是纯逻辑单一真源，不依赖 obsidian 运行时，
// 这样单元测试可直接加载（目录判定改用鸭子类型，见 detectSchema）。

// ============================================================
// 库目录 Schema · 唯一真源
//   「标准库长什么样」只在这里定义一次；render / nav / stats / 人格层
//   全部从这里取路径，不再各写各的裸字面量。
//   客户库的目录命名与默认不同时，只需在设置页改这份映射（或用自动检测），
//   整个控制台随之适配——无需改代码。
//   起源：《TALOS 标准化方案》A 类·架构骨架（2026-07-14）落地。
// ============================================================

/** 十三个顶层模块的目录名映射。值为库内相对路径，不带首尾斜杠。 */
export interface TalosVaultSchema {
	inbox: string;
	logs: string;
	insights: string;
	assets: string;
	projects: string;
	archive: string;
	identity: string;
	soul: string;
	output: string;
	system: string;
	templates: string;
	automation: string;
	config: string;
}

export type TalosSchemaKey = keyof TalosVaultSchema;

/** 中文预设：外脑玩家 Haaper 的超级大脑结构（插件默认） */
export const SCHEMA_PRESET_CN: TalosVaultSchema = {
	inbox: "00-收件箱",
	logs: "01-日志",
	insights: "02-洞察",
	assets: "03-素材",
	projects: "04-项目",
	archive: "05-归档",
	identity: "Identity",
	soul: "灵魂",
	output: "输出",
	system: "System",
	templates: "模板",
	automation: "自动化",
	config: "配置",
};

/** 英文预设：TALOS Starter Kit 交付包的结构 */
export const SCHEMA_PRESET_EN: TalosVaultSchema = {
	inbox: "00-Inbox",
	logs: "01-Logs",
	insights: "02-Insights",
	assets: "03-Assets",
	projects: "04-Projects",
	archive: "05-Archive",
	identity: "Identity",
	soul: "灵魂",
	output: "Output",
	system: "System",
	templates: "Templates",
	automation: "Automation",
	config: "Config",
};

export const SCHEMA_PRESETS: Record<string, TalosVaultSchema> = {
	cn: SCHEMA_PRESET_CN,
	en: SCHEMA_PRESET_EN,
};

/** 各模块的中文显示名（与目录名解耦：目录可改名，界面标签不变） */
export const SCHEMA_LABELS: Record<TalosSchemaKey, string> = {
	inbox: "收件箱",
	logs: "日志",
	insights: "洞察",
	assets: "素材",
	projects: "项目",
	archive: "归档",
	identity: "Identity",
	soul: "灵魂",
	output: "输出",
	system: "System",
	templates: "模板",
	automation: "自动化",
	config: "配置",
};

/** 六大内容目录（知识笔记统计口径），顺序即分布图展示顺序 */
export const CONTENT_KEYS: TalosSchemaKey[] = [
	"projects",
	"assets",
	"insights",
	"archive",
	"logs",
	"inbox",
];

/** 全部顶层模块（模块地图口径） */
export const MODULE_KEYS: TalosSchemaKey[] = [
	"inbox",
	"logs",
	"insights",
	"assets",
	"projects",
	"archive",
	"identity",
	"soul",
	"output",
	"system",
	"templates",
	"automation",
	"config",
];

/**
 * 各模块的识别别名（小写匹配）。用于在客户库目录命名与预设都不同时，
 * 靠关键词把真实目录认出来——这是「部署即自适应」的核心词表。
 * 顺序无关；命中越多、越靠前的词权重越高（见 scoreFolder）。
 */
export const SCHEMA_ALIASES: Record<TalosSchemaKey, string[]> = {
	inbox: ["收件箱", "收集箱", "inbox", "收集", "捕获", "capture", "待处理", "暂存", "闪念"],
	logs: ["日志", "日记", "logs", "log", "journal", "daily", "每日", "diary"],
	insights: ["洞察", "insights", "insight", "想法", "思考", "notes", "笔记", "永久笔记", "zettel", "知识"],
	assets: ["素材", "assets", "asset", "资料", "resources", "resource", "剪藏", "clippings", "参考", "references"],
	projects: ["项目", "projects", "project", "工程", "areas", "领域"],
	archive: ["归档", "archive", "archives", "存档", "已完成", "done"],
	identity: ["identity", "身份", "自我", "我", "profile", "about-me", "关于我"],
	soul: ["灵魂", "soul", "人格", "persona", "ai", "agent"],
	output: ["输出", "output", "outputs", "发布", "publish", "内容", "content", "作品"],
	system: ["system", "系统", "meta", "元", "config-system"],
	templates: ["模板", "templates", "template", "模版"],
	automation: ["自动化", "automation", "scripts", "脚本", "auto"],
	config: ["配置", "config", "settings", "设置", "conf"],
};

/** 统计来源的关键文件识别规则（文件名关键词 → 设置项） */
export const DATA_SOURCE_HINTS = {
	tasksPath: ["tasks.md", "任务.md", "todo.md", "任务池.md"],
	pendingApprovalsPath: ["pending-approvals.md", "待审批.md", "approvals.md"],
	candidatesPath: ["candidates.md", "候选.md", "候选池.md"],
	healthLogPath: ["health-log.md", "健康日志.md", "health.md"],
} as const;

export type DataSourceKey = keyof typeof DATA_SOURCE_HINTS;

export interface SchemaDetectionEntry {
	key: TalosSchemaKey;
	/** 匹配到的实际目录名；未匹配到时为 null */
	matched: string | null;
	/** exact=与预设完全一致；alias=靠别名认出；none=未找到 */
	how: "exact" | "alias" | "none";
}

export interface SchemaDetectionResult {
	schema: TalosVaultSchema;
	entries: SchemaDetectionEntry[];
	/** 命中的模块数（how !== "none"） */
	matchedCount: number;
	/** 库内顶层目录总数（用于判断这个库是否值得自动接管） */
	folderCount: number;
	dataSources: Partial<Record<DataSourceKey, string>>;
}

function normalizeName(name: string): string {
	// 去掉 "00-" 这类序号前缀与空白，统一小写，便于别名比对
	return name.trim().toLowerCase().replace(/^\d+[\s._-]*/, "");
}

/** 给「目录名 ↔ 模块」打分：0 = 不匹配 */
function scoreFolder(folderName: string, key: TalosSchemaKey): number {
	const norm = normalizeName(folderName);
	if (!norm) return 0;
	for (const preset of Object.values(SCHEMA_PRESETS)) {
		if (preset[key].toLowerCase() === folderName.trim().toLowerCase()) return 100;
	}
	const aliases = SCHEMA_ALIASES[key];
	for (let i = 0; i < aliases.length; i++) {
		const alias = aliases[i].toLowerCase();
		// 越靠前的别名权重越高；完全相等 > 包含
		if (norm === alias) return 80 - i;
		if (norm.includes(alias) || alias.includes(norm)) return 50 - i;
	}
	return 0;
}

function clean(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
	return trimmed || fallback;
}

/** 把（可能残缺的）用户覆盖合并进默认 schema，产出完整可用的 schema */
export function resolveSchema(overrides?: Partial<TalosVaultSchema> | null): TalosVaultSchema {
	const base = SCHEMA_PRESET_CN;
	if (!overrides) return { ...base };
	const out = { ...base };
	for (const key of Object.keys(base) as TalosSchemaKey[]) {
		out[key] = clean(overrides[key], base[key]);
	}
	return out;
}

/** 列出库内顶层目录名（鸭子类型判定，避免运行时 import obsidian） */
export function listTopFolders(app: App): string[] {
	const root = app.vault.getRoot() as unknown as { children?: unknown[] };
	const children = Array.isArray(root?.children) ? root.children : [];
	return children
		.filter((c): c is { name: string } =>
			!!c && typeof c === "object" && "children" in c && typeof (c as { name?: unknown }).name === "string"
		)
		.map((c) => c.name)
		.filter((name) => !name.startsWith(".")); // 跳过 .obsidian 等隐藏目录
}

/**
 * 自动识别库结构（部署即自适应的核心）。
 *
 * 不再只比对两套预设，而是扫描库内真实的顶层目录，按别名词表打分做
 * **全局最优匹配**：每个目录最多认领一个模块、每个模块最多认领一个目录，
 * 按分数从高到低贪心分配，避免「洞察」和「笔记」抢同一个目录。
 * 未命中的模块保留默认名（不会把不存在的目录硬塞给它）。
 */
export function detectSchemaDetailed(app: App): SchemaDetectionResult {
	const folders = listTopFolders(app);
	const out = { ...SCHEMA_PRESET_CN };
	const entries: SchemaDetectionEntry[] = [];

	// 打全量分数表 → 贪心取最大值配对
	type Pair = { key: TalosSchemaKey; folder: string; score: number };
	const pairs: Pair[] = [];
	for (const key of MODULE_KEYS) {
		for (const folder of folders) {
			const score = scoreFolder(folder, key);
			if (score > 0) pairs.push({ key, folder, score });
		}
	}
	pairs.sort((a, b) => b.score - a.score);

	const usedKeys = new Set<TalosSchemaKey>();
	const usedFolders = new Set<string>();
	const matchedBy = new Map<TalosSchemaKey, { folder: string; score: number }>();
	for (const pair of pairs) {
		if (usedKeys.has(pair.key) || usedFolders.has(pair.folder)) continue;
		usedKeys.add(pair.key);
		usedFolders.add(pair.folder);
		matchedBy.set(pair.key, { folder: pair.folder, score: pair.score });
	}

	for (const key of MODULE_KEYS) {
		const hit = matchedBy.get(key);
		if (hit) {
			out[key] = hit.folder;
			entries.push({ key, matched: hit.folder, how: hit.score >= 100 ? "exact" : "alias" });
		} else {
			entries.push({ key, matched: null, how: "none" });
		}
	}

	return {
		schema: out,
		entries,
		matchedCount: entries.filter((e) => e.how !== "none").length,
		folderCount: folders.length,
		dataSources: detectDataSources(app, out),
	};
}

/** 兼容旧签名：只要 schema */
export function detectSchema(app: App): TalosVaultSchema {
	return detectSchemaDetailed(app).schema;
}

/**
 * 自动定位统计来源的关键文件（tasks / 待审批 / 候选池 / 健康日志）。
 * 在 System 模块下优先，找不到再全库找同名文件，避免误认到归档副本。
 */
export function detectDataSources(
	app: App,
	schema: TalosVaultSchema
): Partial<Record<DataSourceKey, string>> {
	const files = app.vault.getMarkdownFiles();
	const systemPrefix = `${schema.system}/`;
	const out: Partial<Record<DataSourceKey, string>> = {};

	for (const key of Object.keys(DATA_SOURCE_HINTS) as DataSourceKey[]) {
		const names = DATA_SOURCE_HINTS[key] as readonly string[];
		const candidates = files.filter((f) =>
			names.some((n) => f.path.toLowerCase().endsWith(n.toLowerCase()))
		);
		if (candidates.length === 0) continue;
		// 优先级：System 下 > 路径更短（更靠近根，通常是主文件）
		candidates.sort((a, b) => {
			const aSys = a.path.startsWith(systemPrefix) ? 0 : 1;
			const bSys = b.path.startsWith(systemPrefix) ? 0 : 1;
			if (aSys !== bSys) return aSys - bSys;
			return a.path.length - b.path.length;
		});
		const best = candidates[0];
		if (best) out[key] = best.path;
	}
	return out;
}

/** 由 schema 派生出全部具体路径。界面与数据层只用这里的方法，不拼裸字符串。 */
export class VaultPaths {
	constructor(readonly schema: TalosVaultSchema) {}

	/** 模块根目录 */
	dir(key: TalosSchemaKey): string {
		return this.schema[key];
	}

	/** 模块的 _README.md */
	readme(key: TalosSchemaKey): string {
		return `${this.schema[key]}/_README.md`;
	}

	/** 模块下的子路径 */
	join(key: TalosSchemaKey, ...parts: string[]): string {
		return [this.schema[key], ...parts.filter(Boolean)].join("/");
	}

	// —— 常用具体位置（集中在此，避免散落拼接）——
	get mocDir(): string { return this.join("insights", "MOC"); }
	get mocReadme(): string { return this.join("insights", "MOC", "_README.md"); }
	get outletFile(): string { return this.join("output", "统一出口.md"); }
	get opsCandidatesFile(): string { return this.join("output", "运营", "运营候选池.md"); }
	get personaFile(): string { return this.join("soul", "PERSONA.md"); }
	get personaMemoryFile(): string { return this.join("soul", "persona-memory.md"); }
	get contextFile(): string { return this.join("identity", "CONTEXT.md"); }
	get telosFile(): string { return this.join("identity", "TELOS.md"); }
	get profileFile(): string { return this.join("identity", "PROFILE.md"); }
	get decisionsFile(): string { return this.join("identity", "decisions.md"); }
	get workingMemoryDir(): string { return this.join("system", "working-memory"); }
	get errorPatternsFile(): string { return this.join("system", "working-memory", "error-patterns.md"); }
	get loopHealthFile(): string { return this.join("system", "working-memory", "loop-health-log.md"); }
	get talosProjectDir(): string { return this.join("projects", "TALOS系统"); }
	get sceneIndexFile(): string { return this.join("projects", "场景索引.md"); }

	/** 输出平台子目录（抖音 / 小红书 …） */
	outputPlatform(name: string): string { return this.join("output", name); }
}
