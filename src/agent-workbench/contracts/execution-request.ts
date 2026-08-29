import type {
	RuntimeExecutionContext,
	RuntimeHistoryItem,
	RuntimeInputBlock,
	RuntimeTurn,
} from "./runtime-adapter";

export interface AgentExecutionRequest {
	conversationId: string;
	input: RuntimeInputBlock[];
	context?: RuntimeExecutionContext;
	history?: RuntimeHistoryItem[];
	model?: string;
	reasoning?: string;
	serviceTier?: string;
	workflow: RuntimeTurn["workflow"];
	permissionMode: NonNullable<RuntimeTurn["permissionMode"]>;
	toolPolicy: NonNullable<RuntimeTurn["toolPolicy"]>;
	signal?: AbortSignal;
}

export function executionText(input: RuntimeInputBlock[]): string {
	return input
		.flatMap((block) => block.type === "text" ? [block.text] : [])
		.join("\n\n")
		.trim();
}

export function imageBlocks(input: RuntimeInputBlock[]): Extract<RuntimeInputBlock, { type: "image" }>[] {
	return input.filter((block): block is Extract<RuntimeInputBlock, { type: "image" }> => block.type === "image");
}

function contextSection(context: RuntimeExecutionContext | undefined): string {
	if (!context) return "";
	const sections: string[] = [];
	if (context.linkedContent) {
		sections.push(`<linked_content path="${context.linkedContent.path}">\n${context.linkedContent.content ?? ""}\n</linked_content>`);
	}
	for (const selection of context.selections ?? []) {
		sections.push(`<selection source="${selection.source}"${selection.path ? ` path="${selection.path}"` : ""}>\n${selection.text}\n</selection>`);
	}
	if (context.externalContextPaths?.length) {
		sections.push(`<external_context_paths>\n${context.externalContextPaths.join("\n")}\n</external_context_paths>`);
	}
	if (context.enabledMcpServers?.length) {
		sections.push(`<enabled_mcp_servers>\n${context.enabledMcpServers.join("\n")}\n</enabled_mcp_servers>`);
	}
	return sections.join("\n\n");
}

export function runtimePrompt(turn: RuntimeTurn): string {
	const text = executionText(turn.input ?? [{ type: "text", text: turn.text }]) || turn.text;
	const context = contextSection(turn.context);
	return context ? `${context}\n\n${text}` : text;
}
