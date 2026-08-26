import type { RuntimeId } from "./runtime-adapter";

export const AGENT_EVENT_SCHEMA_VERSION = 1;

export type AgentEventType =
	| "user.message"
	| "assistant.start"
	| "assistant.delta"
	| "assistant.final"
	| "thinking.delta"
	| "plan.updated"
	| "context.compacted"
	| "tool.started"
	| "tool.updated"
	| "tool.finished"
	| "file.diff"
	| "task.progress"
	| "subagent.updated"
	| "approval.requested"
	| "approval.resolved"
	| "user.question"
	| "usage.updated"
	| "session.bound"
	| "handoff.created"
	| "runtime.status"
	| "notice"
	| "error"
	| "turn.finished";

export interface AgentEvent<T = Record<string, unknown>> {
	schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
	eventId: string;
	conversationId: string;
	turnId: string;
	runtimeId: RuntimeId;
	type: AgentEventType;
	timestamp: string;
	nativeId?: string;
	payload: T;
}

export function createAgentEvent<T>(input: Omit<AgentEvent<T>, "schemaVersion">): AgentEvent<T> {
	return { schemaVersion: AGENT_EVENT_SCHEMA_VERSION, ...input };
}
