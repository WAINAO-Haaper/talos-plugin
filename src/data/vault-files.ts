// 资料库文件登记表：插件依赖的全部固定文件 / 目录的唯一来源。
// 同一份登记同时决定：默认位置、设置页覆盖、自动查找线索、插件需要的分区标记、
// 「补齐库结构」的新建模板与追加模板、页面缺失提示。不接触 App，可直接单测。
import type { TalosSchemaKey } from "./schema";

/** 由 VaultPaths 解析、原先写死在模块下的文件（现可在设置中覆盖）。 */
export type VaultFileKey =
	| "persona"
	| "personaMemory"
	| "context"
	| "telos"
	| "profile"
	| "errorPatterns"
	| "loopHealth"
	| "outlet"
	| "opsCandidates"
	| "sceneIndex"
	| "talosProjectDir"
	| "mocDir";

/** 原本就在设置页可配置的数据来源（存放在 TalosSettings 的同名字段）。 */
export type SettingsFileKey =
	| "tasksPath"
	| "pendingApprovalsPath"
	| "candidatesPath"
	| "healthLogPath"
	| "talosTasksPath";

export type AnyFileKey = VaultFileKey | SettingsFileKey;

export interface VaultFileSpec {
	key: AnyFileKey;
	label: string;
	kind: "file" | "dir";
	/** 默认位置：模块目录 + 相对路径；设置来源只给出说明用的默认值。 */
	module?: TalosSchemaKey;
	rel?: string[];
	/** 自动查找时比对的文件 / 目录名（不区分大小写）。 */
	hints: string[];
	/** 插件解析需要的分区或标记（与解析器同一规则）；缺任何一个算「格式不全」。 */
	markers: Marker[];
	/** 新建文件的完整内容。 */
	template: string;
	/** 分区块：文件已存在时只把缺少标记的分区追加到末尾（只追加，不改原文）。 */
	blocks?: Array<{ marker: Marker; text: string }>;
	/** 个人产品体系专用（如 TALOS 发布作战室）：不自动补齐，提示中标注可忽略。 */
	personal?: boolean;
	/** 在哪些页面提示缺失：只挂信息的主场页（D-TLP-069），其他页只显示数字 + 跳转。 */
	pages: string[];
}

/** 字符串按原样包含匹配；正则与对应解析器的识别规则保持一致。 */
export type Marker = string | RegExp;

export function hasMarker(content: string, marker: Marker): boolean {
	return typeof marker === "string" ? content.includes(marker) : marker.test(content);
}

// 与 stats.ts collectFocusAndFlow 一致：二级标题含「焦点」即为焦点分区。
const FOCUS_SECTION = /^##\s*.*焦点/m;
// 与 approval-actions.ts findCurrentSection 一致。
const APPROVAL_SECTION = /^## 当前待审批\s*$/m;
// 与 candidate-actions.ts findSection 一致：批准 / 拒绝要求三个分区标题完全一致。
const exactSection = (label: string) => new RegExp(`^## ${label}\\s*$`, "m");

const TASKS_BLOCKS = [
	{ marker: FOCUS_SECTION, text: "## 当前焦点\n\n<!-- 每行一个焦点（今日与执行节奏最多显示 3 个）：\n- [ ] 🔴 **标题** — 说明 | done_when: 完成条件\n-->\n" },
	{ marker: /^##\s*.*待办/m, text: "## 待办\n" },
	{ marker: /^##\s*.*已完成/m, text: "## 已完成\n" },
];

const APPROVAL_BLOCKS = [
	{ marker: APPROVAL_SECTION, text: "## 当前待审批\n\n<!-- 每个提案一个三级标题，下一行写状态（批准 / 拒绝后由插件改写）：\n### 提案标题\n**状态**：待审批\n-->\n" },
	{ marker: /^##\s*已解决/m, text: "## 已解决\n" },
];

const CANDIDATE_BLOCKS = [
	{ marker: exactSection("待确认"), text: "## 待确认\n\n<!-- 每行一条候选：- 候选内容（来源 · 适用范围） -->\n" },
	{ marker: exactSection("已确认"), text: "## 已确认\n" },
	{ marker: exactSection("已拒绝"), text: "## 已拒绝\n" },
];

const HEALTH_BLOCKS = [
	{ marker: "<!-- EVAL_HISTORY -->", text: "<!-- EVAL_HISTORY -->\n| 日期 | 健康分 | 说明 |\n|---|---|---|\n<!-- EVAL_HISTORY_END -->\n" },
];

const withBlocks = (title: string, blocks: Array<{ text: string }>) => [`# ${title}\n`, ...blocks.map((block) => block.text)].join("\n");

export const VAULT_FILE_SPECS: readonly VaultFileSpec[] = [
	{
		key: "tasksPath", label: "任务池", kind: "file", hints: ["tasks.md", "任务.md", "todo.md", "任务池.md"],
		markers: [FOCUS_SECTION], template: withBlocks("任务", TASKS_BLOCKS), blocks: TASKS_BLOCKS, pages: ["daily"],
	},
	{
		key: "pendingApprovalsPath", label: "待审批", kind: "file", hints: ["pending-approvals.md", "待审批.md", "approvals.md"],
		markers: [APPROVAL_SECTION], template: withBlocks("待审批", APPROVAL_BLOCKS), blocks: APPROVAL_BLOCKS, pages: ["today"],
	},
	{
		key: "candidatesPath", label: "偏好候选", kind: "file", hints: ["candidates.md", "候选.md", "候选池.md"],
		markers: [exactSection("待确认"), exactSection("已确认"), exactSection("已拒绝")], template: withBlocks("偏好候选", CANDIDATE_BLOCKS), blocks: CANDIDATE_BLOCKS, pages: ["today"],
	},
	{
		key: "healthLogPath", label: "健康日志", kind: "file", hints: ["health-log.md", "健康日志.md", "health.md"],
		markers: ["<!-- EVAL_HISTORY -->", "<!-- EVAL_HISTORY_END -->"], template: withBlocks("健康日志", HEALTH_BLOCKS), blocks: HEALTH_BLOCKS, pages: ["health"],
	},
	{
		key: "talosTasksPath", label: "TALOS 发布作战室", kind: "file", hints: [], markers: [], template: "",
		personal: true, pages: ["talos"],
	},
	{ key: "persona", label: "AI 人格（PERSONA）", kind: "file", module: "soul", rel: ["PERSONA.md"], hints: ["PERSONA.md"], markers: [], template: "# PERSONA\n", pages: ["identity"] },
	{ key: "personaMemory", label: "人格记忆", kind: "file", module: "soul", rel: ["persona-memory.md"], hints: ["persona-memory.md"], markers: [], template: "# persona-memory\n", pages: ["identity"] },
	{ key: "context", label: "当前上下文（CONTEXT）", kind: "file", module: "identity", rel: ["CONTEXT.md"], hints: ["CONTEXT.md"], markers: [], template: "# CONTEXT\n", pages: ["identity"] },
	{ key: "telos", label: "目标与使命（TELOS）", kind: "file", module: "identity", rel: ["TELOS.md"], hints: ["TELOS.md"], markers: [], template: "# TELOS\n", pages: ["identity"] },
	{ key: "profile", label: "偏好画像（PROFILE）", kind: "file", module: "identity", rel: ["PROFILE.md"], hints: ["PROFILE.md"], markers: [], template: "# PROFILE\n", pages: ["identity"] },
	{
		key: "errorPatterns", label: "错误模式", kind: "file", module: "system", rel: ["working-memory", "error-patterns.md"], hints: ["error-patterns.md", "错误模式.md"],
		markers: [], template: "# 错误模式\n\n<!-- 每条一行：- 现象 · 次数 · 根因 · 修复 -->\n", pages: ["health"],
	},
	{
		key: "loopHealth", label: "循环健康日志", kind: "file", module: "system", rel: ["working-memory", "loop-health-log.md"], hints: ["loop-health-log.md", "循环健康.md"],
		markers: [], template: "# 循环健康\n\n| 日期 | 状态 | 说明 |\n|---|---|---|\n", pages: ["health"],
	},
	{ key: "outlet", label: "统一出口", kind: "file", module: "output", rel: ["统一出口.md"], hints: ["统一出口.md"], markers: [], template: "# 统一出口\n\n<!-- 待发内容逐条列出 -->\n", pages: ["output"] },
	{ key: "opsCandidates", label: "运营候选池", kind: "file", module: "output", rel: ["运营", "运营候选池.md"], hints: ["运营候选池.md"], markers: [], template: "# 运营候选池\n\n<!-- 每行一条：- 候选选题 -->\n", pages: ["output"] },
	{ key: "sceneIndex", label: "项目场景索引", kind: "file", module: "projects", rel: ["场景索引.md"], hints: ["场景索引.md", "scene-index.md"], markers: [], template: "# 场景索引\n\n<!-- 按优先级列出项目场景与入口 -->\n", pages: ["projects"] },
	{ key: "talosProjectDir", label: "TALOS 系统项目目录", kind: "dir", module: "projects", rel: ["TALOS系统"], hints: ["TALOS系统"], markers: [], template: "", personal: true, pages: ["talos"] },
	{ key: "mocDir", label: "MOC 概念入口", kind: "dir", module: "insights", rel: ["MOC"], hints: ["MOC"], markers: [], template: "# MOC\n\n概念入口：每篇 MOC 汇总一个主题的相关笔记。\n", pages: ["knowledge"] },
];

export const VAULT_FILE_KEYS = VAULT_FILE_SPECS.filter((spec) => spec.module).map((spec) => spec.key as VaultFileKey);

export function specFor(key: AnyFileKey): VaultFileSpec {
	const spec = VAULT_FILE_SPECS.find((item) => item.key === key);
	if (!spec) throw new Error(`未登记的资料库文件：${key}`);
	return spec;
}

export function defaultLocation(spec: VaultFileSpec, moduleDir: (key: TalosSchemaKey) => string): string {
	if (!spec.module || !spec.rel) return "";
	return [moduleDir(spec.module), ...spec.rel].filter(Boolean).join("/");
}

export type FileStatus = "ok" | "missing" | "format";

/** 文件状态：不存在 / 存在但缺插件需要的分区 / 正常。目录只看是否存在。 */
export function fileStatus(spec: VaultFileSpec, content: string | null): FileStatus {
	if (content === null) return "missing";
	if (spec.kind === "dir") return "ok";
	return spec.markers.every((marker) => hasMarker(content, marker)) ? "ok" : "format";
}

export interface ScaffoldOp {
	kind: "mkdir" | "create" | "append";
	path: string;
	content: string;
	label: string;
}

/**
 * 「补齐库结构」计划：只新建缺失项、只向缺分区的已有文件末尾追加；从不覆盖或改写原文。
 * 个人体系专用项不进入计划。
 */
export function planScaffold(input: {
	moduleDirs: string[];
	files: Array<{ spec: VaultFileSpec; path: string; content: string | null }>;
	exists: (path: string) => boolean;
}): ScaffoldOp[] {
	const ops: ScaffoldOp[] = [];
	const planned = new Set<string>();
	const ensureDir = (dir: string, label: string) => {
		if (!dir || planned.has(dir) || input.exists(dir)) return;
		const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
		if (parent) ensureDir(parent, label);
		planned.add(dir);
		ops.push({ kind: "mkdir", path: dir, content: "", label });
	};
	for (const dir of input.moduleDirs) {
		if (!input.exists(dir)) {
			ensureDir(dir, "模块目录");
			ops.push({ kind: "create", path: `${dir}/_README.md`, content: `# ${dir.split("/").pop() ?? dir}\n`, label: "模块说明" });
		}
	}
	for (const { spec, path, content } of input.files) {
		if (spec.personal || !path) continue;
		const status = fileStatus(spec, content);
		if (status === "ok") continue;
		if (spec.kind === "dir") {
			ensureDir(path, spec.label);
			if (spec.template) ops.push({ kind: "create", path: `${path}/_README.md`, content: spec.template, label: spec.label });
			continue;
		}
		if (status === "missing") {
			const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			if (parent) ensureDir(parent, spec.label);
			ops.push({ kind: "create", path, content: spec.template, label: spec.label });
		} else {
			const missing = (spec.blocks ?? []).filter((block) => !hasMarker(content ?? "", block.marker));
			if (missing.length > 0) {
				ops.push({ kind: "append", path, content: `\n${missing.map((block) => block.text).join("\n")}`, label: `${spec.label} · 补充 ${missing.length} 个分区` });
			}
		}
	}
	return ops;
}
