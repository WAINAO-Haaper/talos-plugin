export interface ApprovalExecutableSpec {
	title: string;
	executor: string;
	targetPath: string;
	instruction: string;
}

export interface MockModelAppendInput {
	title: string;
	targetPath: string;
	instruction: string;
	date: string;
	time: string;
	originalContent: string;
}

export interface ApprovalExecutionRecordInput {
	title: string;
	targetPath: string;
	date: string;
	time: string;
	executor: string;
}

export interface ApprovalExecutionResult {
	ok: boolean;
	content: string;
	message: string;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTitle(value: string): string {
	return value
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_match, path: string) => {
			const parts = path.split("/");
			return parts[parts.length - 1] || path;
		})
		.replace(/\*\*/g, "")
		.replace(/`/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function findCurrentSection(content: string): { start: number; end: number } | null {
	const section = /(^|\n)## 当前待审批\s*\n/.exec(content);
	if (!section || section.index === undefined) return null;
	const start = section.index + section[1].length;
	const bodyStart = start + section[0].length - section[1].length;
	const next = content.slice(bodyStart).search(/\n##\s+/);
	const end = next >= 0 ? bodyStart + next : content.length;
	return { start: bodyStart, end };
}

function findProposalBlock(
	content: string,
	title: string
): { start: number; end: number; block: string } | null {
	const section = findCurrentSection(content);
	if (!section) return null;
	const target = normalizeTitle(title);
	const sectionText = content.slice(section.start, section.end);
	const headingRe = /^###\s+(.+?)\s*$/gm;
	let heading: RegExpExecArray | null;
	while ((heading = headingRe.exec(sectionText))) {
		if (normalizeTitle(heading[1] || "") !== target) continue;
		const start = section.start + heading.index;
		const afterHeading = sectionText.slice(heading.index + heading[0].length);
		const next = afterHeading.search(/\n###\s+/);
		const end = next >= 0 ? start + heading[0].length + next : section.end;
		return { start, end, block: content.slice(start, end) };
	}
	return null;
}

function readField(block: string, label: string): string {
	const field = new RegExp(
		`^\\*\\*${escapeRegExp(label)}\\*\\*[：:]\\s*(.+?)\\s*$`,
		"m"
	).exec(block);
	return (field?.[1] || "").trim();
}

function upsertLabeledLine(
	block: string,
	label: string,
	line: string,
	afterLabel = "界面操作"
): string {
	const ownLine = new RegExp(`^\\*\\*${escapeRegExp(label)}\\*\\*[：:][^\\n]*`, "m");
	if (ownLine.test(block)) return block.replace(ownLine, line);

	const afterLine = new RegExp(
		`(^\\*\\*${escapeRegExp(afterLabel)}\\*\\*[：:][^\\n]*\\n)`,
		"m"
	);
	if (afterLine.test(block)) return block.replace(afterLine, `$1${line}\n`);

	return `${block.trimEnd()}\n\n${line}\n`;
}

export function parseApprovalExecutableSpec(
	content: string,
	title: string
): ApprovalExecutableSpec | null {
	const proposal = findProposalBlock(content, title);
	if (!proposal) return null;
	const executor = readField(proposal.block, "执行器");
	const targetPath = readField(proposal.block, "目标文件");
	const instruction = readField(proposal.block, "执行指令");
	if (!executor || !targetPath || !instruction) return null;
	return { title, executor, targetPath, instruction };
}

export function buildMockModelAppend(input: MockModelAppendInput): string {
	const existingWords = input.originalContent
		.replace(/---[\s\S]*?---/, "")
		.replace(/\s+/g, "")
		.length;
	return [
		"",
		`## TALOS 模型执行测试 ${input.date} ${input.time}`,
		"",
		`- 审批项：${input.title}`,
		`- 目标文件：${input.targetPath}`,
		`- 执行器：mock-model-file-append`,
		`- 执行指令：${input.instruction}`,
		`- 模型处理摘要：本地模拟模型已读取目标文件（正文约 ${existingWords} 字符），并按审批指令追加本回执。`,
		"- 安全边界：本次只写入此目标文件，不执行 shell，不访问网络，不修改其它库内文件。",
		"",
	].join("\n");
}

export function applyApprovalExecutionRecord(
	content: string,
	input: ApprovalExecutionRecordInput
): ApprovalExecutionResult {
	const proposal = findProposalBlock(content, input.title);
	if (!proposal) {
		return { ok: false, content, message: `未找到审批项：${input.title}` };
	}
	let nextBlock = proposal.block;
	nextBlock = upsertLabeledLine(
		nextBlock,
		"模型执行结果",
		`**模型执行结果**：✅ 已执行（${input.date} ${input.time}，${input.executor}）`
	);
	nextBlock = upsertLabeledLine(
		nextBlock,
		"模型执行目标",
		`**模型执行目标**：${input.targetPath}`,
		"模型执行结果"
	);
	nextBlock = upsertLabeledLine(
		nextBlock,
		"执行结果",
		"**执行结果**：✅ 已批准并完成模型执行测试。",
		"模型执行目标"
	);

	return {
		ok: true,
		content:
			content.slice(0, proposal.start) + nextBlock + content.slice(proposal.end),
		message: `模型执行测试已写回：${input.targetPath}`,
	};
}
