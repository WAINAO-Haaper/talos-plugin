import type { AgentEvent } from "../contracts/agent-events";
import type { ConversationManifest } from "../contracts/conversation";
import type { RuntimeId, RuntimeTurn } from "../contracts/runtime-adapter";
import { RuntimeBindingStore } from "../storage/runtime-binding-store";
import { ContextHandoffService } from "./context-handoff-service";
import { ConversationService } from "./conversation-service";
import { RuntimeRegistry } from "./runtime-registry";

export type TurnState = "idle" | "running" | "awaiting-approval" | "cancelling";

export interface WorkbenchHostContext {
	vaultRoot(): Promise<string>;
}

export class WorkbenchController {
	private conversation: ConversationManifest | null = null;
	private currentRuntimeId: RuntimeId = "codex";
	private state: TurnState = "idle";
	private readonly seenEventIds = new Set<string>();

	constructor(
		private readonly conversations: ConversationService,
		private readonly runtimes: RuntimeRegistry,
		private readonly bindings: RuntimeBindingStore,
		private readonly host: WorkbenchHostContext,
		private readonly handoffs = new ContextHandoffService(),
	) {}

	getState(): TurnState { return this.state; }
	getRuntimeId(): RuntimeId { return this.currentRuntimeId; }

	async open(conversation: ConversationManifest): Promise<void> {
		if (this.state !== "idle") throw new Error("运行中的回合不能切换会话");
		this.conversation = conversation;
		this.currentRuntimeId = conversation.selection.runtimeId;
		await this.ensureRuntime(this.currentRuntimeId);
	}

	async switchRuntime(toRuntimeId: RuntimeId): Promise<void> {
		if (!this.conversation) throw new Error("尚未打开会话");
		if (this.state === "running" || this.state === "awaiting-approval") {
			throw new Error("运行或审批未决时不能切换智能体");
		}
		if (toRuntimeId === this.currentRuntimeId) return;
		const projection = await this.conversations.store.load(this.conversation.conversationId);
		const envelope = this.handoffs.create({
			conversationId: this.conversation.conversationId,
			fromRuntimeId: this.currentRuntimeId,
			toRuntimeId,
			events: projection.events,
		});
		await this.ensureRuntime(toRuntimeId, JSON.stringify(envelope), projection.lastEventId);
		await this.conversations.append({
			conversationId: this.conversation.conversationId,
			turnId: `handoff-${Date.now()}`,
			runtimeId: this.currentRuntimeId,
			type: "handoff.created",
			payload: envelope as unknown as Record<string, unknown>,
		});
		this.currentRuntimeId = toRuntimeId;
		this.conversation = {
			...this.conversation,
			selection: { ...this.conversation.selection, runtimeId: toRuntimeId },
			updatedAt: new Date().toISOString(),
		};
		await this.conversations.store.updateManifest(this.conversation);
	}

	private async ensureRuntime(runtimeId: RuntimeId, context?: string, lastEventId?: string): Promise<void> {
		if (!this.conversation) throw new Error("尚未打开会话");
		const runtime = this.runtimes.get(runtimeId);
		const existing = await this.bindings.get(this.conversation.conversationId, runtimeId);
		if (existing) {
			await runtime.resumeSession(existing);
			if (context && existing.lastSyncedEventId !== lastEventId) {
				await runtime.synchronizeContext?.({ binding: existing, context, lastEventId });
				await this.bindings.set(this.conversation.conversationId, { ...existing, lastSyncedEventId: lastEventId });
			}
			return;
		}
		const vaultRoot = await this.host.vaultRoot();
		if (!vaultRoot.trim()) throw new Error("Vault 根目录不可用");
		const binding = await runtime.createSession({
			conversationId: this.conversation.conversationId,
			vaultRoot,
			initialContext: context,
		});
		await this.bindings.set(this.conversation.conversationId, { ...binding, lastSyncedEventId: lastEventId });
	}

	async send(text: string, workflow: RuntimeTurn["workflow"]): Promise<AgentEvent[]> {
		if (!this.conversation) throw new Error("尚未打开会话");
		if (this.state !== "idle") throw new Error("已有回合正在执行");
		const runtime = this.runtimes.get(this.currentRuntimeId);
		const turnId = crypto.randomUUID();
		this.state = "running";
		const output: AgentEvent[] = [];
		try {
			await this.conversations.append({
				conversationId: this.conversation.conversationId,
				turnId,
				runtimeId: this.currentRuntimeId,
				type: "user.message",
				payload: { text },
			});
			for await (const event of runtime.send({
				conversationId: this.conversation.conversationId,
				turnId,
				text,
				workflow,
			})) {
				if (this.seenEventIds.has(event.eventId)) continue;
				this.seenEventIds.add(event.eventId);
				await this.conversations.store.append(event);
				output.push(event);
				if (event.type === "approval.requested") this.state = "awaiting-approval";
				if (event.type === "approval.resolved") this.state = "running";
			}
			return output;
		} finally {
			this.state = "idle";
		}
	}

	async cancel(reason = "user"): Promise<void> {
		if (this.state === "idle") return;
		this.state = "cancelling";
		await this.runtimes.get(this.currentRuntimeId).cancel(reason);
		this.state = "idle";
	}
}
