import { createAgentEvent, type AgentEvent, type AgentEventType } from "../../contracts/agent-events";
import type { RuntimeId } from "../../contracts/runtime-adapter";

export class RuntimeEventFactory {
	private sequence = 0;
	constructor(private readonly runtimeId: RuntimeId) {}
	create(input: { conversationId: string; turnId: string; type: AgentEventType; payload: Record<string, unknown>; nativeId?: string }): AgentEvent {
		this.sequence += 1;
		return createAgentEvent({
			eventId: `${this.runtimeId}:${input.turnId}:${String(this.sequence).padStart(6, "0")}`,
			conversationId: input.conversationId,
			turnId: input.turnId,
			runtimeId: this.runtimeId,
			type: input.type,
			timestamp: new Date().toISOString(),
			nativeId: input.nativeId,
			payload: input.payload,
		});
	}
}
