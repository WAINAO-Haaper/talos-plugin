import type { AgentEvent } from "../contracts/agent-events";
import type { ConversationManifest } from "../contracts/conversation";
import type { NativeSessionBinding, RuntimeId } from "../contracts/runtime-adapter";
import type { ClaudianReadonlyImporter, LegacyImportReport } from "../legacy/claudian-readonly-importer";
import { RuntimeBindingStore } from "../storage/runtime-binding-store";
import { sanitizePortableValue } from "../storage/portable-conversation-store";
import { hasMeaningfulHandoffPayload } from "../storage/conversation-projection";
import { ContextHandoffService } from "./context-handoff-service";
import { ConversationService } from "./conversation-service";

export interface CompatibilityConversationIdentity {
	conversationId: string;
	title?: string;
	createdAt?: number | string;
	updatedAt?: number | string;
	runtimeId: RuntimeId;
}

function iso(value: number | string | undefined, fallback: string): string {
	if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
	if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
	return fallback;
}

function isPortablePolicyFailure(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith("portable 数据");
}

export class WorkbenchConversationCoordinator {
	private importReport: LegacyImportReport | null = null;
	private readonly handoffs = new ContextHandoffService();

	constructor(
		readonly conversations: ConversationService,
		readonly bindings: RuntimeBindingStore,
		private readonly importer?: ClaudianReadonlyImporter,
	) {}

	async initialize(): Promise<void> {
		await this.conversations.store.list();
		if (this.importer) this.importReport = await this.importer.import();
	}

	getImportReport(): LegacyImportReport | null {
		return this.importReport ? { ...this.importReport } : null;
	}

	async ensure(input: CompatibilityConversationIdentity): Promise<ConversationManifest> {
		const existing = (await this.conversations.store.list()).find((item) => item.conversationId === input.conversationId);
		if (existing) return existing;
		const now = new Date().toISOString();
		const manifest: ConversationManifest = {
			schemaVersion: 1,
			conversationId: input.conversationId,
			title: input.title?.trim() || "新会话",
			createdAt: iso(input.createdAt, now),
			updatedAt: iso(input.updatedAt, now),
			lifecycle: "active",
			selection: { runtimeId: input.runtimeId },
		};
		await this.conversations.store.create(manifest);
		return manifest;
	}

	async appendUser(input: {
		conversationId: string;
		turnId: string;
		runtimeId: RuntimeId;
		text: string;
		vaultRoot: string;
		metadata?: Record<string, unknown>;
	}): Promise<AgentEvent> {
		return this.conversations.append({
			conversationId: input.conversationId,
			turnId: input.turnId,
			runtimeId: input.runtimeId,
			type: "user.message",
			payload: sanitizePortableValue({
				text: input.text,
				...input.metadata,
			}, input.vaultRoot) as Record<string, unknown>,
		});
	}

	async appendRuntimeEvent(conversationId: string, event: AgentEvent, vaultRoot: string): Promise<AgentEvent> {
		const portable = sanitizePortableValue({
			...event,
			conversationId,
		}, vaultRoot) as AgentEvent;
		try {
			await this.conversations.store.append(portable);
			return portable;
		} catch (error) {
			if (!isPortablePolicyFailure(error)) throw error;
			const safeId = crypto.randomUUID();
			const omitted: AgentEvent = {
				schemaVersion: 1,
				eventId: `portable-omitted-${safeId}`,
				conversationId,
				turnId: `portable-omitted-${safeId}`,
				runtimeId: event.runtimeId,
				type: "notice",
				timestamp: new Date().toISOString(),
				payload: {
					message: "运行时事件已显示；不可移植元数据未保存",
					omittedEventType: event.type,
				},
			};
			await this.conversations.store.append(omitted);
			return omitted;
		}
	}

	async switchRuntime(conversationId: string, toRuntimeId: RuntimeId): Promise<boolean> {
		const projection = await this.conversations.store.load(conversationId);
		const fromRuntimeId = projection.manifest.selection.runtimeId;
		if (fromRuntimeId === toRuntimeId) return false;
		const envelope = this.handoffs.create({
			conversationId,
			fromRuntimeId,
			toRuntimeId,
			events: projection.events,
		});
		if (!hasMeaningfulHandoffPayload(envelope)) {
			await this.conversations.store.updateManifest({
				...projection.manifest,
				selection: { runtimeId: toRuntimeId },
				updatedAt: new Date().toISOString(),
			});
			return false;
		}
		await this.conversations.append({
			conversationId,
			turnId: "handoff-" + crypto.randomUUID(),
			runtimeId: fromRuntimeId,
			type: "handoff.created",
			payload: envelope as unknown as Record<string, unknown>,
		});
		await this.conversations.store.updateManifest({
			...projection.manifest,
			selection: { runtimeId: toRuntimeId },
			updatedAt: new Date().toISOString(),
		});
		return true;
	}

	getBinding(
		conversationId: string,
		runtimeId: RuntimeId,
		providerProfileId?: string
	): Promise<NativeSessionBinding | null> {
		return this.bindings.get(conversationId, runtimeId, providerProfileId);
	}

	setBinding(conversationId: string, binding: NativeSessionBinding): Promise<void> {
		return this.bindings.set(conversationId, binding);
	}

	clearBinding(
		conversationId: string,
		runtimeId: RuntimeId,
		providerProfileId?: string
	): Promise<void> {
		return this.bindings.remove(conversationId, runtimeId, providerProfileId);
	}
}
