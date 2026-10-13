// 授权卡的白话呈现：把 runtime 原始请求（标题里夹着整段代码、原始 JSON）
// 整理成一句标题 + 几个要点 + 可折叠的代码。只影响显示，不参与放行判断。

export interface ApprovalPresentationInput {
	runtimeId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
	reason: string;
	risk: string;
	phase: string;
}

export interface ApprovalCode {
	label: string;
	text: string;
	lines: number;
	firstLine: string;
}

export interface ApprovalPresentation {
	headline: string;
	facts: string[];
	riskText: string;
	code: ApprovalCode | null;
}

const RUNTIME_LABELS: Record<string, string> = { claude: "Claude", codex: "Codex", ohmypi: "OhMyPi" };
const DEFAULT_REASON = "智能体请求执行工具";
const CODE_KEYS = ["code", "command", "script", "cmd"];

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

interface ParsedRequest {
	tool: string;
	fields: Array<[string, string]>;
	code: string;
}

/** 解析 OhMyPi 一类「Allow tool: eval / Language: x / Code: ...」的整段请求文本。 */
function parseRequestText(raw: string): ParsedRequest | null {
	const match = /^\s*Allow tool:\s*([^\s]+)/i.exec(raw);
	if (!match) return null;
	const rest = raw.slice(match[0].length);
	const codeAt = rest.search(/(^|\s)Code:\s?/);
	const head = codeAt >= 0 ? rest.slice(0, codeAt) : rest;
	const code = codeAt >= 0 ? rest.slice(codeAt).replace(/^\s*Code:\s?/, "") : "";
	const fields: Array<[string, string]> = [];
	for (const part of head.split(/\n|(?=\s[A-Z][A-Za-z ]{1,20}:\s)/)) {
		const field = /^\s*([A-Za-z][A-Za-z ]{0,20}):\s*(.+?)\s*$/.exec(part);
		if (field?.[1] && field[2]) fields.push([field[1].trim().toLowerCase(), field[2]]);
	}
	return { tool: match[1] ?? "", fields, code: code.trim() };
}

function toCode(label: string, raw: string): ApprovalCode | null {
	const body = raw.replace(/\s+$/, "");
	if (!body.trim()) return null;
	const lines = body.split("\n");
	const firstLine = (lines.find((line) => line.trim()) ?? "").trim();
	return { label, text: body, lines: lines.length, firstLine: firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine };
}

function verbFor(tool: string, language: string): string {
	const name = tool.toLowerCase();
	if (name === "eval") return `运行一段${language ? ` ${language} ` : ""}代码`;
	if (["bash", "shell", "exec", "command"].includes(name)) return "运行一条命令";
	if (["edit", "write", "multiedit", "apply_patch"].includes(name)) return "修改文件";
	if (["read", "glob", "grep", "search"].includes(name)) return "读取库内文件";
	if (["fetch", "webfetch", "websearch"].includes(name)) return "访问网络";
	return `使用工具「${tool}」`;
}

function riskTextFor(risk: string, phase: string, reason: string): string {
	const base = phase === "proposal"
		? "先确认提案；确认后还会再请你批准执行"
		: risk === "C"
			? "高风险：批准后才执行，结果可能无法自动恢复"
			: risk === "A"
				? "低风险：只读或可恢复的操作"
				: "需要你确认：会在你的电脑上执行，范围受当前权限档限制";
	return reason && reason !== DEFAULT_REASON ? `${base} · ${reason}` : base;
}

export function describeApproval(input: ApprovalPresentationInput): ApprovalPresentation {
	const runtime = RUNTIME_LABELS[input.runtimeId] ?? input.runtimeId;
	const raw = [input.toolName, text(input.toolInput.title), text(input.toolInput.message)].find((value) => /Allow tool:/i.test(value)) ?? "";
	const parsed = parseRequestText(raw);
	if (parsed) {
		const language = parsed.fields.find(([key]) => key === "language")?.[1] ?? "";
		const code = toCode(language ? `${language} 代码` : "代码", parsed.code);
		const facts = [
			`工具 ${parsed.tool}`,
			...parsed.fields.map(([key, value]) => `${key === "language" ? "语言" : key} ${value.length > 40 ? `${value.slice(0, 39)}…` : value}`),
			...(code ? [`${code.lines} 行`] : []),
		];
		return { headline: `${runtime} 想${verbFor(parsed.tool, language)}`, facts, riskText: riskTextFor(input.risk, input.phase, input.reason), code };
	}
	const codeKey = CODE_KEYS.find((key) => text(input.toolInput[key]).trim());
	const code = codeKey ? toCode(codeKey === "code" ? "代码" : "命令", text(input.toolInput[codeKey])) : null;
	const tool = input.toolName.split("\n")[0]?.trim() || "工具";
	return {
		headline: `${runtime} 想${verbFor(tool.length > 40 ? "工具" : tool, "")}`,
		facts: [`工具 ${tool.length > 40 ? `${tool.slice(0, 39)}…` : tool}`, ...(code ? [`${code.lines} 行`] : [])],
		riskText: riskTextFor(input.risk, input.phase, input.reason),
		code,
	};
}
