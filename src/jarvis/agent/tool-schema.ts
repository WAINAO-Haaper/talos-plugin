// ============================================================
// 一套工具定义，两套投影（Anthropic / OpenAI）
//   直连通道（无 SDK 帮忙）需自带工具 schema 喂给模型。
//   VaultToolHost 负责执行；本文件只描述「模型能调什么」。
// ============================================================

export interface ToolParam {
	type: "string" | "number" | "boolean";
	description: string;
	optional?: boolean;
}

export interface ToolDef {
	name: string;
	description: string;
	params: Record<string, ToolParam>;
}

export const TOOLS: ToolDef[] = [
	{
		name: "Read",
		description: "读取库内某个文件的全文。file_path 为库内相对路径。",
		params: { file_path: { type: "string", description: "库内相对路径，如 02-洞察/foo.md" } },
	},
	{
		name: "Write",
		description: "写入/覆盖一个文件（不存在则创建）。会触发权限审批。",
		params: {
			file_path: { type: "string", description: "库内相对路径" },
			content: { type: "string", description: "完整文件内容" },
		},
	},
	{
		name: "Edit",
		description: "把文件中的 old_string 替换为 new_string（首个匹配）。会触发权限审批。",
		params: {
			file_path: { type: "string", description: "库内相对路径" },
			old_string: { type: "string", description: "要被替换的原文（需唯一可定位）" },
			new_string: { type: "string", description: "替换后的新文本" },
		},
	},
	{
		name: "Glob",
		description: "按通配模式列出匹配的文件路径，如 **/*.md。",
		params: { pattern: { type: "string", description: "glob 模式" } },
	},
	{
		name: "Grep",
		description: "在库内按正则搜索内容，返回命中行（带文件与行号）。",
		params: {
			pattern: { type: "string", description: "正则表达式" },
			glob: { type: "string", description: "限定文件范围的 glob，可选", optional: true },
		},
	},
	{
		name: "Bash",
		description: "在库根目录执行 shell 命令（仅桌面端可用）。会触发权限审批。",
		params: { command: { type: "string", description: "要执行的命令" } },
	},
];

// —— Anthropic /v1/messages 的 tools 投影 ——
export interface AnthropicTool {
	name: string;
	description: string;
	input_schema: {
		type: "object";
		properties: Record<string, { type: string; description: string }>;
		required: string[];
	};
}

export const ANTHROPIC_TOOLS: AnthropicTool[] = TOOLS.map((t) => ({
	name: t.name,
	description: t.description,
	input_schema: {
		type: "object" as const,
		properties: Object.fromEntries(
			Object.entries(t.params).map(([k, v]) => [k, { type: v.type, description: v.description }])
		),
		required: Object.entries(t.params)
			.filter(([, v]) => !v.optional)
			.map(([k]) => k),
	},
}));

// —— OpenAI function calling 的 tools 投影（P2 Codex/GPT 用）——
export interface OpenAiTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: {
			type: "object";
			properties: Record<string, { type: string; description: string }>;
			required: string[];
		};
	};
}

export const OPENAI_TOOLS: OpenAiTool[] = TOOLS.map((t) => ({
	type: "function" as const,
	function: {
		name: t.name,
		description: t.description,
		parameters: {
			type: "object" as const,
			properties: Object.fromEntries(
				Object.entries(t.params).map(([k, v]) => [k, { type: v.type, description: v.description }])
			),
			required: Object.entries(t.params)
				.filter(([, v]) => !v.optional)
				.map(([k]) => k),
		},
	},
}));
