export type CandidateDecision = "approve" | "reject";

export interface CandidateDecisionInput {
	title: string;
	decision: CandidateDecision;
	date: string;
	operator?: string;
}

export interface CandidateDecisionResult {
	ok: boolean;
	content: string;
	message: string;
	removedFromPending: boolean;
}

interface SectionRange {
	header: number;
	end: number;
}

function normalizeCandidateTitle(value: string): string {
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

function findSection(lines: string[], label: string): SectionRange | null {
	const header = lines.findIndex((line) => line.trim() === `## ${label}`);
	if (header < 0) return null;
	const nextHeading = lines.findIndex(
		(line, index) => index > header && /^##\s+/.test(line.trim())
	);
	return {
		header,
		end: nextHeading >= 0 ? nextHeading : lines.length,
	};
}

function failure(content: string, message: string): CandidateDecisionResult {
	return {
		ok: false,
		content,
		message,
		removedFromPending: false,
	};
}

export function applyCandidateDecision(
	content: string,
	input: CandidateDecisionInput
): CandidateDecisionResult {
	const title = normalizeCandidateTitle(input.title);
	if (!title) return failure(content, "缺少偏好候选标题");

	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const hadFinalNewline = /\r?\n$/.test(content);
	const lines = content.split(/\r?\n/);
	const pending = findSection(lines, "待确认");
	if (!pending) return failure(content, "未找到「待确认」分区");

	let candidateIndex = -1;
	for (let index = pending.header + 1; index < pending.end; index++) {
		const match = lines[index]?.match(/^-\s+(.+?)\s*$/);
		if (!match) continue;
		if (normalizeCandidateTitle(match[1] || "") === title) {
			candidateIndex = index;
			break;
		}
	}
	if (candidateIndex < 0) {
		return failure(content, `未找到偏好候选：${title}`);
	}

	const candidateLine = lines[candidateIndex]?.trimEnd() || `- ${title}`;
	lines.splice(candidateIndex, 1);

	const approved = input.decision === "approve";
	const action = approved ? "批准" : "拒绝";
	const targetLabel = approved ? "已确认" : "已拒绝";
	const operator = input.operator?.trim() ? `${input.operator.trim()} ` : "";
	const auditLine = `  - **界面操作**：${input.date} ${operator}点击「${action}」。`;
	const target = findSection(lines, targetLabel);

	if (target) {
		let insertAt = target.end;
		while (insertAt > target.header + 1 && !lines[insertAt - 1]?.trim()) {
			insertAt--;
		}
		lines.splice(insertAt, 0, candidateLine, auditLine, "");
	} else {
		while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();
		if (lines.length > 0) lines.push("");
		lines.push(`## ${targetLabel}`, "", candidateLine, auditLine);
		if (hadFinalNewline) lines.push("");
	}

	return {
		ok: true,
		content: lines.join(newline),
		message: `已${action}偏好候选：${title}`,
		removedFromPending: true,
	};
}
