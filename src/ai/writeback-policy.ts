import type { TalosActionRisk } from "../action-core/types";

export type WritebackIntent = "display-only" | "knowledge" | "output";

export interface AnswerWritebackInput {
	intent: WritebackIntent;
	title: string;
	content: string;
}

export interface AnswerWritebackProposal {
	targetPath: string;
	risk: TalosActionRisk;
	approvalRequired: true;
	diffPreview: string;
	content: string;
}

function safeTitle(title: string): string {
	const sanitized = title
		.replace(/\.\.+/g, "")
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^-+|-+$/g, "")
		.trim();
	return sanitized || "AI 回答";
}

export function proposeAnswerWriteback(
	input: AnswerWritebackInput
): AnswerWritebackProposal | null {
	if (input.intent === "display-only") return null;
	const folder = input.intent === "knowledge" ? "30 洞察" : "70 输出";
	const title = safeTitle(input.title);
	return {
		targetPath: `${folder}/${title}.md`,
		risk: "B",
		approvalRequired: true,
		diffPreview: input.content
			.split("\n")
			.map((line) => `+${line}`)
			.join("\n"),
		content: input.content,
	};
}
