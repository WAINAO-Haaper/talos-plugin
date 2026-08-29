import type { AgentEvent } from "../contracts/agent-events";

export interface ProjectedMessage {
	role: "user" | "assistant" | "system";
	text: string;
	eventId: string;
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }

function hasNonEmptyValue(value: unknown): boolean {
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.some(hasNonEmptyValue);
	if (value && typeof value === "object") return Object.values(value).some(hasNonEmptyValue);
	return false;
}

export function hasMeaningfulHandoffPayload(payload: unknown): boolean {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
	const value = payload as Record<string, unknown>;
	return [
		value.goal,
		value.recentMessages,
		value.incompleteTasks,
		value.toolResultSummaries,
		value.vaultRelativeReferences,
	].some(hasNonEmptyValue);
}

export function hasMeaningfulHandoffContext(event: AgentEvent): boolean {
	return event.type === "handoff.created" && hasMeaningfulHandoffPayload(event.payload);
}

export function projectMessages(events: AgentEvent[]): ProjectedMessage[] {
	const messages: ProjectedMessage[] = [];
	const assistantByTurn = new Map<string, ProjectedMessage>();
	for (const event of events) {
		if (event.type === "user.message") {
			messages.push({ role: "user", text: text(event.payload.text), eventId: event.eventId });
		}
		if (event.type === "assistant.delta" || event.type === "assistant.final") {
			let message = assistantByTurn.get(event.turnId);
			if (!message) {
				message = { role: "assistant", text: "", eventId: event.eventId };
				assistantByTurn.set(event.turnId, message);
				messages.push(message);
			}
			const content = text(event.payload.text);
			message.text = event.type === "assistant.final" ? content : `${message.text}${content}`;
		}
		if (event.type === "handoff.created" && hasMeaningfulHandoffContext(event)) {
			messages.push({ role: "system", text: "Runtime handoff", eventId: event.eventId });
		}
	}
	return messages;
}
