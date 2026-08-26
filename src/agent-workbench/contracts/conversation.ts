import type { AgentEvent } from "./agent-events";
import type { NativeSessionBinding, RuntimeId } from "./runtime-adapter";

export type ConversationLifecycle = "active" | "archived" | "deleted";

export interface ConversationSelection {
	runtimeId: RuntimeId;
	providerProfileId?: string;
	model?: string;
	reasoning?: string;
	serviceTier?: string;
}

export interface ConversationManifest {
	schemaVersion: 1;
	conversationId: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	lifecycle: ConversationLifecycle;
	selection: ConversationSelection;
	importedFrom?: {
		kind: "claudian";
		sourceDigest: string;
		transcript: "full" | "partial";
	};
}

export interface ConversationProjection {
	manifest: ConversationManifest;
	events: AgentEvent[];
	lastEventId?: string;
	lastTurnId?: string;
	nativeBindings: Partial<Record<RuntimeId, NativeSessionBinding>>;
}

export interface HandoffEnvelope {
	schemaVersion: 1;
	conversationId: string;
	fromRuntimeId: RuntimeId;
	toRuntimeId: RuntimeId;
	goal: string;
	recentMessages: Array<{ role: "user" | "assistant"; text: string }>;
	incompleteTasks: string[];
	toolResultSummaries: string[];
	vaultRelativeReferences: string[];
	lastSyncedEventId?: string;
}
