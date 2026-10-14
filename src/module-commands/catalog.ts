/** Shared action metadata for the Obsidian module UI and command router. */
export const MODULE_COMMAND_GROUP_IDS = [
	"setup", "capture", "library", "search", "project", "profile", "flow", "media", "convert", "system",
] as const;

export type ModuleCommandGroupId = typeof MODULE_COMMAND_GROUP_IDS[number];
export type ModuleActionEffect = "read" | "write";
export type ModuleActionAvailability = "local" | "capability-required";

export interface ModuleActionInputField {
	name: string;
	label: string;
	description: string;
	type: "text" | "textarea" | "path" | "select" | "file" | "files";
	required: boolean;
	options?: readonly string[];
}

export interface ModuleCommandGroup {
	id: ModuleCommandGroupId;
	label: string;
	description: string;
	pages: readonly string[];
}

export const MODULE_ACTION_IDS = [
	"setup.inspect", "setup.initialize",
	"capture.note", "capture.journal", "capture.task",
	"library.import", "library.organize", "library.archive", "library.export", "library.backup", "library.restore",
	"search.find", "search.ask",
	"project.new", "project.status", "project.update",
	"profile.show", "profile.update",
	"flow.morning", "flow.review", "flow.weekly", "flow.cycle",
	"media.browse", "media.info", "media.ocr", "media.transcribe",
	"convert.inspect", "convert.convert",
	"system.status", "system.check", "system.repair", "system.help",
] as const;

export type ModuleActionId = typeof MODULE_ACTION_IDS[number];

export interface ModuleAction {
	id: ModuleActionId;
	group: ModuleCommandGroupId;
	label: string;
	description: string;
	pages: readonly string[];
	inputs: readonly ModuleActionInputField[];
	effect: ModuleActionEffect;
	/** Requirements describe routing prerequisites, never proof that a handler exists. */
	availability: ModuleActionAvailability;
	requiresCapabilities: readonly string[];
	/** Additional format support beyond the built-in text conversion. */
	advancedCapabilities?: readonly { capability: string; formats: readonly string[]; description: string }[];
}

export const MODULE_COMMAND_GROUPS: readonly ModuleCommandGroup[] = [
	{ id: "setup", label: "开始使用", description: "检查环境并初始化个人数据基座", pages: ["overview", "settings"] },
	{ id: "capture", label: "记录", description: "保存笔记、日志与任务", pages: ["inbox", "daily"] },
	{ id: "library", label: "资料管理", description: "导入、整理、归档与恢复资料", pages: ["knowledge", "inbox", "vault", "output"] },
	{ id: "search", label: "检索问答", description: "查找资料并基于授权上下文问答", pages: ["knowledge", "chat", "vault"] },
	{ id: "project", label: "项目", description: "建立项目并记录当前进展", pages: ["projects"] },
	{ id: "profile", label: "身份", description: "查看和确认个人上下文", pages: ["identity"] },
	{ id: "flow", label: "日常流程", description: "晨间概览、复盘草稿与周度回顾", pages: ["daily", "capability"] },
	{ id: "media", label: "多媒体", description: "浏览媒体并调用可用提取能力", pages: ["knowledge", "vault"] },
	{ id: "convert", label: "格式转换", description: "检查格式并执行支持的转换", pages: ["knowledge", "output"] },
	{ id: "system", label: "系统", description: "查看状态、检查与受控修复", pages: ["health", "capability", "settings"] },
];

const field = (
	name: string,
	label: string,
	type: ModuleActionInputField["type"],
	required = true,
	description = label,
): ModuleActionInputField => ({ name, label, description, type, required });

const title = field("title", "标题", "text");
const content = field("content", "内容", "textarea");
const optionalContent = field("content", "补充内容", "textarea", false);
const path = field("path", "资料路径", "path", true, "当前 Vault 内的相对路径");
const query = field("query", "查找或提问内容", "text");
const selectionPath = field("path", "打包范围", "path", true, "明确选择当前 Vault 中的一个文件或数据模块目录");

function action(
	id: ModuleActionId,
	label: string,
	description: string,
	pages: readonly string[],
	inputs: readonly ModuleActionInputField[],
	effect: ModuleActionEffect,
	requiresCapabilities: readonly string[] = [],
): ModuleAction {
	return {
		id,
		group: id.split(".")[0] as ModuleCommandGroupId,
		label,
		description,
		pages,
		inputs,
		effect,
		availability: requiresCapabilities.length ? "capability-required" : "local",
		requiresCapabilities,
	};
}

export const MODULE_ACTIONS: readonly ModuleAction[] = [
	action("setup.inspect", "查看当前数据环境", "列出已配置的数据模块路径与文件数量", ["overview", "settings", "health"], [], "read"),
	action("setup.initialize", "初始化数据基座", "复核个人信息后初始化所需模块与身份文件", ["overview", "settings", "identity"], [
		field("owner_name", "称呼", "text"),
		field("primary_goal", "当前主要目标", "textarea"),
		field("important_context", "重要上下文", "textarea", false),
		field("communication_preferences", "沟通偏好", "textarea", false),
		field("hard_boundaries", "硬性边界", "textarea", false),
		field("sensitive_paths", "敏感路径", "textarea", false),
	], "write"),
	action("capture.note", "记录笔记", "将一条新笔记保存到收件箱", ["inbox", "knowledge"], [title, content], "write"),
	action("capture.journal", "记录日志", "保存一条带日期的个人日志", ["daily", "inbox"], [content], "write"),
	action("capture.task", "记录任务", "将待办事项保存到收件箱，记录不代表任务已执行", ["daily", "inbox", "projects"], [field("title", "任务内容", "text")], "write"),
	action("library.import", "导入资料", "读取用户选定的文件，复核导入预览后保存", ["inbox", "knowledge", "vault"], [field("files", "选择资料文件", "files")], "write"),
	action("library.organize", "整理资料", "预览后创建分类副本，保留原件与现有链接", ["inbox", "knowledge", "vault"], [path, field("destination", "目标模块目录", "path", true, "选择一个已配置的数据模块根目录；身份通过专用入口处理")], "write"),
	action("library.archive", "归档资料", "将选定Markdown标记为已归档，保留位置与引用", ["knowledge", "projects", "vault"], [path], "write"),
	action("library.export", "导出资料", "将选定资料打包到输出模块，不自动对外发送", ["knowledge", "output", "vault"], [selectionPath], "write"),
	action("library.backup", "备份资料", "打包明确选择的数据范围，不包含凭据和插件程序", ["vault", "health", "settings"], [selectionPath], "write"),
	action("library.restore", "恢复备份", "检查TALOS资料包并恢复到收件箱的新目录，不覆盖现有文件", ["vault", "health", "settings"], [field("file", "选择TALOS资料包", "file")], "write"),
	action("search.find", "查找资料", "在当前 Vault 中查找匹配的资料", ["knowledge", "vault", "projects"], [query], "read"),
	action("search.ask", "资料问答", "基于获授权的资料上下文回答问题，执行操作须另选动作", ["knowledge", "chat"], [query], "read", ["ai.ask"]),
	action("project.new", "新建项目", "创建包含目标与下一步的项目记录", ["projects"], [field("title", "项目名称", "text"), field("content", "项目目标", "textarea"), field("next", "下一步", "textarea", false)], "write"),
	action("project.status", "查看项目列表", "列出项目模块中的Markdown文件，选择文件查看进度", ["projects", "overview"], [], "read"),
	action("project.update", "更新项目进展", "向指定项目追加本次进展", ["projects"], [path, content], "write"),
	action("profile.show", "查看个人上下文", "列出身份与偏好文件，选择文件查看内容", ["identity"], [], "read"),
	action("profile.update", "更新个人上下文", "向个人档案追加本轮确认内容，保留已有信息", ["identity"], [field("content", "本轮确认的补充", "textarea")], "write"),
	action("flow.morning", "晨间概览", "查看近期文件活动并提示待确认事项", ["daily", "capability", "overview"], [], "read"),
	action("flow.review", "记录复盘", "生成带用户补充的活动复盘草稿，不自动宣布工作完成", ["daily", "capability"], [content], "write"),
	action("flow.weekly", "周度回顾", "汇总近7日文件活动并生成复盘草稿", ["daily", "capability"], [optionalContent], "write"),
	action("flow.cycle", "运行单文件确定性子链", "将选定收件箱文本入库、建立索引、保存用户确认的记忆并检查结构；完整语义循环请使用本机智能体工作流", ["capability", "daily"], [path, field("content", "本轮确认的记忆", "textarea", true, "只写入您明确确认的内容；不自动推断个人事实"), { ...field("memory_kind", "记忆类型", "select", true, "明确偏好先暂存，待偏好消化流程复核"), options: ["事实", "明确偏好"] }], "write"),
	action("media.browse", "浏览多媒体", "列出当前 Vault 中的媒体资料", ["knowledge", "vault"], [], "read"),
	action("media.info", "查看媒体信息", "读取指定媒体文件的格式与基础信息", ["knowledge", "vault"], [path], "read"),
	action("media.ocr", "提取图片文字", "通过可用 OCR 能力提取文字并展示结果", ["knowledge", "vault"], [path], "read", ["media.ocr"]),
	action("media.transcribe", "转录音视频", "通过可用转录能力提取文字并展示结果", ["knowledge", "vault"], [path], "read", ["media.transcribe"]),
	action("convert.inspect", "检查文件格式", "检查指定文件及可支持的转换方向", ["knowledge", "output", "vault"], [path], "read"),
	{
		...action("convert.convert", "转换文件", "转换基础文本并保留原文件；文档、图片、视频转换需要额外能力", ["knowledge", "output"], [path, {
			...field("format", "目标格式", "select", true, "TXT、MD、JSON、CSV可转MD或TXT；仅TXT和MD可转HTML"), options: ["md", "txt", "html"],
		}], "write"),
		advancedCapabilities: [
			{ capability: "convert.documents", formats: ["pdf", "doc", "docx", "odt", "pptx", "xlsx"], description: "复杂文档内容抽取与转换" },
			{ capability: "convert.images", formats: ["png", "jpg", "jpeg", "webp", "gif"], description: "图片格式与尺寸转换" },
			{ capability: "convert.video", formats: ["mp4", "mov", "webm", "mkv"], description: "视频格式与编码转换" },
		],
	},
	action("system.status", "查看系统状态", "查看当前数据模块映射与文件数量", ["health", "settings", "overview"], [], "read"),
	action("system.check", "检查笔记元数据", "检查最多500个Markdown文件是否具有元数据区块并报告缺口", ["health", "capability", "settings"], [], "read"),
	action("system.repair", "修复缺失的元数据区块", "仅给缺少元数据区块的普通 Markdown 添加空区块，保留正文；身份及规则文件需人工处理", ["health", "settings"], [field("scope", "检查范围", "path", false, "可选：数据模块目录或文件；留空扫描前500个 Markdown 文件")], "write"),
	action("system.help", "模块说明", "查看数据模块路径、文件数量与外部工具边界", ["capability", "settings", "overview"], [], "read"),
];

const actionById = new Map(MODULE_ACTIONS.map((entry) => [entry.id, entry]));

export function getModuleAction(id: string): ModuleAction | undefined {
	return actionById.get(id as ModuleActionId);
}

export function getModuleActionsForGroup(group: ModuleCommandGroupId): ModuleAction[] {
	return MODULE_ACTIONS.filter((entry) => entry.group === group);
}

export function getModuleActionsForPage(page: string): ModuleAction[] {
	const normalized = ({ workbench: "overview", voice: "chat", jarvis: "chat", system: "health", "talos-quyuan-view": "chat" } as Record<string, string>)[page] ?? page;
	return MODULE_ACTIONS.filter((entry) => entry.pages.includes(normalized));
}

export interface LegacyCommandAlias {
	command: string;
	actionId?: ModuleActionId;
	extension?: string;
	requiresAction?: ModuleCommandGroupId;
	capability?: string;
	format?: string;
	description: string;
}

/** Extensions deliberately carry no general-purpose action fallback. */
export const LEGACY_COMMAND_ALIASES: readonly LegacyCommandAlias[] = [
	{ command: "morning", actionId: "flow.morning", description: "晨间文件活动概览，不修改任务或项目状态" },
	{ command: "retrieval", actionId: "search.find", description: "查找资料" },
	{ command: "memory", requiresAction: "profile", description: "请选择查看或确认补充个人上下文；当前入口不代表完整记忆流程已执行" },
	{ command: "maintain", actionId: "system.check", description: "默认只检查；修复须明确选择 repair" },
	{ command: "intake", actionId: "library.organize", description: "整理资料；必须提供来源和目标" },
	{ command: "digest", actionId: "profile.update", description: "复核并确认个人上下文变更" },
	{ command: "export-okf", capability: "library.export.okf", format: "okf", description: "OKF 格式导出需要对应格式能力，不能替换为 JSON 导出" },
	{ command: "create", extension: "creation", description: "内容创作流程需要可选创作扩展，不降级为记录笔记" },
	{ command: "output", extension: "publishing", description: "输出发布流程需要可选发布扩展，不降级为资料打包" },
	{ command: "full-cycle", actionId: "flow.cycle", description: "受治理的完整流程" },
	{ command: "weekly-reset", actionId: "flow.weekly", description: "周度回顾" },
	{ command: "mine-rules", extension: "rules-mining", description: "规则挖掘需要可选扩展" },
	{ command: "brand", extension: "brand", description: "品牌工作需要可选扩展" },
	{ command: "log", extension: "business", description: "经营台账需要可选业务扩展，不等同个人日志" },
	{ command: "metrics", extension: "marketing", description: "营销统计需要可选营销扩展，不等同系统状态" },
	{ command: "capture", actionId: "capture.note", description: "记录笔记" },
	{ command: "ingest-customer", requiresAction: "profile", description: "需要选择身份候选推断与确认动作；当前目录未登记 profile.infer，不自动导入或覆盖身份" },
	{ command: "review", actionId: "flow.review", description: "记录复盘" },
	{ command: "setup", actionId: "setup.inspect", description: "先检查环境，初始化须明确选择初始化动作" },
	{ command: "talos-ask", actionId: "search.ask", description: "问答；执行模式必须选择已登记动作" },
];

export interface ResolveLegacyCommandOptions {
	mode?: "ask" | "execute";
	actionId?: ModuleActionId;
}

export type LegacyCommandResolution =
	| { kind: "action"; command: string; actionId: ModuleActionId; action: ModuleAction; args: string }
	| { kind: "optional-extension"; command: string; extension: string; description: string; args: string }
	| { kind: "capability-required"; command: string; capability: string; format?: string; description: string; args: string }
	| { kind: "requires-action"; command: string; group?: ModuleCommandGroupId; description: string; args: string }
	| { kind: "unknown"; command: string; args: string };

/** Resolves metadata only. Every result still goes through the shared action executor. */
export function resolveLegacyCommand(
	input: string,
	options: ResolveLegacyCommandOptions = {},
): LegacyCommandResolution {
	const match = input.trim().match(/^\/?([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
	if (!match) return { kind: "unknown", command: input.trim(), args: "" };
	const command = match[1].toLowerCase();
	const args = (match[2] ?? "").trim();
	const alias = LEGACY_COMMAND_ALIASES.find((entry) => entry.command === command);
	if (!alias) return { kind: "unknown", command, args };
	if (alias.extension) return { kind: "optional-extension", command, extension: alias.extension, description: alias.description, args };
	if (alias.capability) return { kind: "capability-required", command, capability: alias.capability, format: alias.format, description: alias.description, args };
	if (alias.requiresAction) return { kind: "requires-action", command, group: alias.requiresAction, description: alias.description, args };
	const executionRequest = options.mode === "execute" || /^(?:--execute|execute|执行)(?:\s|$)/i.test(args);
	if (command === "talos-ask" && executionRequest) {
		const selected = options.actionId && getModuleAction(options.actionId);
		if (!selected) return { kind: "requires-action", command, description: "请选择一个已登记的模块动作，执行仍须经过能力检查与写入确认。", args };
		return { kind: "action", command, actionId: selected.id, action: selected, args };
	}
	const actionId = command === "maintain" && /^(?:repair|修复)(?:\s|$)/i.test(args)
		? "system.repair" : alias.actionId;
	const resolved = actionId && getModuleAction(actionId);
	if (!resolved) return { kind: "unknown", command, args };
	return { kind: "action", command, actionId: resolved.id, action: resolved, args };
}
