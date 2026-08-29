import type { AgentEvent } from "../contracts/agent-events";
import { projectMessages } from "../storage/conversation-projection";

const DEFAULT_PREVIEW_LIMIT = 72;

/** Stable, local-only history preview derived from the first user request. */
export function conversationPreview(events: AgentEvent[], limit = DEFAULT_PREVIEW_LIMIT): string {
	const messages = projectMessages(events)
		.filter((message) => message.role !== "system")
		.map((message) => ({ ...message, text: message.text.replace(/\s+/g, " ").trim() }))
		.filter((message) => Boolean(message.text));
	const source = messages.find((message) => message.role === "user") ?? messages[0];
	if (!source) return "";
	if (source.text.length <= limit) return source.text;
	return `${source.text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}
