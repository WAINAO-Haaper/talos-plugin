import type { AgentEvent } from "../contracts/agent-events";
import type { HandoffEnvelope } from "../contracts/conversation";
import type { RuntimeId } from "../contracts/runtime-adapter";
import { projectMessages } from "../storage/conversation-projection";

function relativeReferences(events: AgentEvent[]): string[] {
	const refs = new Set<string>();
	for (const event of events) {
		const value = event.payload.vaultPath;
		if (typeof value === "string" && !value.startsWith("/") && !value.includes("..")) refs.add(value);
	}
	return [...refs].slice(0, 20);
}

export class ContextHandoffService {
	create(input: {
		conversationId: string;
		fromRuntimeId: RuntimeId;
		toRuntimeId: RuntimeId;
		events: AgentEvent[];
		goal?: string;
	}): HandoffEnvelope {
		const messages = projectMessages(input.events)
			.filter((message) => message.role !== "system")
			.slice(-8)
			.map((message) => ({ role: message.role as "user" | "assistant", text: message.text.slice(0, 4000) }));
		return {
			schemaVersion: 1,
			conversationId: input.conversationId,
			fromRuntimeId: input.fromRuntimeId,
			toRuntimeId: input.toRuntimeId,
			goal: input.goal?.slice(0, 2000) ?? "",
			recentMessages: messages,
			incompleteTasks: [],
			toolResultSummaries: input.events
				.filter((event) => event.type === "tool.finished")
				.slice(-4)
				.map((event) => (typeof event.payload.summary === "string" ? event.payload.summary : "").slice(0, 1000)),
			vaultRelativeReferences: relativeReferences(input.events),
			lastSyncedEventId: input.events.at(-1)?.eventId,
		};
	}
}
