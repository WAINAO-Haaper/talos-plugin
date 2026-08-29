import type { AgentEvent } from "./agent-events";
import type { RuntimeCapabilities } from "./runtime-capabilities";

export type RuntimeId = "claude" | "codex" | "ohmypi";
export type RuntimeHealth =
	| "unknown"
	| "probing"
	| "not-installed"
	| "incompatible"
	| "unauthenticated"
	| "ready"
	| "degraded"
	| "crashed";

export interface RuntimeProbe {
	runtimeId: RuntimeId;
	status: RuntimeHealth;
	version?: string;
	reason?: string;
	executable?: string;
}

export interface ModelDescriptor {
	id: string;
	label: string;
	providerProfileId?: string;
	description?: string;
	isDefault?: boolean;
	reasoningOptions?: Array<{ value: string; label: string; description?: string }>;
	defaultReasoning?: string;
	serviceTiers?: Array<{ id: string; label: string; description?: string }>;
	defaultServiceTier?: string;
}

export type RuntimeInputBlock =
	| { type: "text"; text: string }
	| {
			type: "image";
			id: string;
			name: string;
			mimeType: string;
			dataUrl: string;
		};

export interface RuntimeLinkedContent {
	path: string;
	content?: string;
}

export interface RuntimeSelectionContext {
	text: string;
	source: "editor" | "browser" | "canvas";
	path?: string;
}

export interface RuntimeExecutionContext {
	linkedContent?: RuntimeLinkedContent;
	selections?: RuntimeSelectionContext[];
	externalContextPaths?: string[];
	enabledMcpServers?: string[];
}

export interface RuntimeHistoryItem {
	role: "user" | "assistant";
	text: string;
	timestamp?: string;
}

export type RuntimeToolPolicy =
	| { kind: "passive" }
	| { kind: "read-only" }
	| { kind: "provider-default" }
	| { kind: "allow-list"; names: string[] };

export interface NativeSessionBinding {
	runtimeId: RuntimeId;
	sessionId: string;
	providerProfileId?: string;
	nativeResumeToken?: string;
	protocolVersion?: string;
	lastSyncedEventId?: string;
}

export interface CreateSessionInput {
	conversationId: string;
	vaultRoot: string;
	model?: string;
	providerProfileId?: string;
	initialContext?: string;
}

export interface RuntimeTurn {
	conversationId: string;
	turnId: string;
	/** Canonical structured input. `text` remains as a compatibility projection. */
	input?: RuntimeInputBlock[];
	text: string;
	context?: RuntimeExecutionContext;
	history?: RuntimeHistoryItem[];
	model?: string;
	reasoning?: string;
	serviceTier?: string;
	workflow: "plan" | "execute";
	permissionMode?: "ask" | "scoped" | "vault-full";
	toolPolicy?: RuntimeToolPolicy;
	signal?: AbortSignal;
}

export interface RuntimeSteer {
	turnId: string;
	text: string;
}

export interface AgentRuntimeAdapter {
	readonly id: RuntimeId;
	probe(signal?: AbortSignal): Promise<RuntimeProbe>;
	listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
	createSession(input: CreateSessionInput): Promise<NativeSessionBinding>;
	resumeSession(binding: NativeSessionBinding): Promise<void>;
	synchronizeContext?(input: { binding: NativeSessionBinding; context: string; lastEventId?: string }): Promise<void>;
	send(turn: RuntimeTurn): AsyncIterable<AgentEvent>;
	respondApproval?(input: { requestId: string | number; decision: "allow" | "allow-always" | "deny" | "cancel"; kind?: "command" | "file" | "permissions"; details?: Record<string, unknown> }): Promise<void>;
	respondUserInput?(input: { requestId: string | number; answers: Record<string, string | string[]> | null }): Promise<void>;
	steer?(input: RuntimeSteer): Promise<void>;
	cancel(reason?: string): Promise<void>;
	fork?(input: { binding: NativeSessionBinding }): Promise<NativeSessionBinding>;
	compact?(input: { binding: NativeSessionBinding }): Promise<void>;
	dispose(): Promise<void>;
	capabilities(): RuntimeCapabilities;
}
