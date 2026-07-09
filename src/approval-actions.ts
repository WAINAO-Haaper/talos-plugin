export type PendingApprovalDecision = "approve" | "reject";

export interface PendingApprovalDecisionInput {
	title: string;
	decision: PendingApprovalDecision;
	date: string;
	operator?: string;
}

export interface PendingApprovalDecisionResult {
	ok: boolean;
	content: string;
	message: string;
	removedFromPending: boolean;
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

export function isPendingApprovalStatusLine(line: string): boolean {
	return /^\*\*状态\*\*[：:]\s*待审批\s*$/.test(line.trim());
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
	section: { start: number; end: number },
	title: string
): { start: number; end: number; block: string } | null {
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

function upsertLabeledLine(
	block: string,
	label: string,
	line: string,
	afterLabel = "状态"
): string {
	const ownLine = new RegExp(`\\*\\*${escapeRegExp(label)}\\*\\*[：:][^\\n]*`);
	if (ownLine.test(block)) return block.replace(ownLine, line);

	const afterLine = new RegExp(
		`(\\*\\*${escapeRegExp(afterLabel)}\\*\\*[：:][^\\n]*\\n)`
	);
	if (afterLine.test(block)) return block.replace(afterLine, `$1${line}\n`);

	return `${block.trimEnd()}\n\n${line}\n`;
}

export function applyPendingApprovalDecision(
	content: string,
	input: PendingApprovalDecisionInput
): PendingApprovalDecisionResult {
	const title = normalizeTitle(input.title);
	if (!title) {
		return {
			ok: false,
			content,
			message: "缺少审批标题",
			removedFromPending: false,
		};
	}

	const section = findCurrentSection(content);
	if (!section) {
		return {
			ok: false,
			content,
			message: "未找到「当前待审批」段",
			removedFromPending: false,
		};
	}

	const proposal = findProposalBlock(content, section, title);
	if (!proposal) {
		return {
			ok: false,
			content,
			message: `未找到审批项：${title}`,
			removedFromPending: false,
		};
	}

	const statusLine = /^\*\*状态\*\*[：:][^\n]*/m;
	if (!statusLine.test(proposal.block)) {
		return {
			ok: false,
			content,
			message: `审批项缺少状态行：${title}`,
			removedFromPending: false,
		};
	}

	const actionText = input.decision === "approve" ? "批准" : "拒绝";
	const status =
		input.decision === "approve"
			? `**状态**：✅ 已批准（${input.date}，界面按钮）`
			: `**状态**：❌ 已拒绝（${input.date}，界面按钮）`;
	const execution =
		input.decision === "approve"
			? "**执行结果**：🟡 已记录审批决策，具体变更尚未执行。"
			: "**执行结果**：❌ 已拒绝，未执行提案内容。";
	const actor = input.operator ? `${input.operator} ` : "";
	const operation = `**界面操作**：${input.date} ${actor}点击「${actionText}」。`;

	let nextBlock = proposal.block.replace(statusLine, status);
	nextBlock = upsertLabeledLine(nextBlock, "执行结果", execution);
	nextBlock = upsertLabeledLine(nextBlock, "界面操作", operation, "执行结果");

	return {
		ok: true,
		content:
			content.slice(0, proposal.start) + nextBlock + content.slice(proposal.end),
		message: `已${actionText}：${title}`,
		removedFromPending: true,
	};
}
