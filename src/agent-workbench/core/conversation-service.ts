import { createAgentEvent, type AgentEvent } from "../contracts/agent-events";
import type { ConversationManifest } from "../contracts/conversation";
import type { RuntimeId } from "../contracts/runtime-adapter";
import { PortableConversationStore } from "../storage/portable-conversation-store";

export interface ConversationClock {
	now(): string;
	id(): string;
}

const ACTIVITY_EVENTS = new Set<AgentEvent["type"]>(["user.message", "assistant.final", "turn.finished", "handoff.created"]);

export class ConversationService {
	constructor(
		readonly store: PortableConversationStore,
		private readonly clock: ConversationClock = {
			now: () => new Date().toISOString(),
			id: () => crypto.randomUUID(),
		},
	) {}

	async create(title = "新会话", runtimeId: RuntimeId = "codex"): Promise<ConversationManifest> {
		const now = this.clock.now();
		const manifest: ConversationManifest = {
			schemaVersion: 1,
			conversationId: this.clock.id(),
			title,
			createdAt: now,
			updatedAt: now,
			lifecycle: "active",
			selection: { runtimeId },
		};
		await this.store.create(manifest);
		return manifest;
	}

	async append(input: Omit<AgentEvent, "schemaVersion" | "eventId" | "timestamp"> & {
		eventId?: string;
		timestamp?: string;
	}): Promise<AgentEvent> {
		const event = createAgentEvent({
			...input,
			eventId: input.eventId ?? this.clock.id(),
			timestamp: input.timestamp ?? this.clock.now(),
		});
		const result = await this.store.append(event);
		if (result === "written" && ACTIVITY_EVENTS.has(event.type)) await this.store.touch(event.conversationId, event.timestamp);
		return event;
	}

	async rename(id: string, title: string): Promise<void> {
		const current = await this.store.load(id);
		await this.store.updateManifest({
			...current.manifest,
			title: title.trim() || "未命名会话",
			updatedAt: this.clock.now(),
		});
	}

	archive(id: string): Promise<void> { return this.store.setLifecycle(id, "archived"); }
	restore(id: string): Promise<void> { return this.store.setLifecycle(id, "active"); }
	softDelete(id: string): Promise<void> { return this.store.setLifecycle(id, "deleted"); }
}
