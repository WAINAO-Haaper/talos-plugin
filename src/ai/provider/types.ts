export type TalosProviderKind = "api" | "cli" | "mock";

export type ProviderCapability =
	| "chat"
	| "stream"
	| "tools"
	| "usage"
	| "cancel"
	| "resume"
	| "fork";

export interface AskRequest {
	runId: string;
	turnId: string;
	text: string;
	sessionId?: string;
	historyRef?: unknown;
	providerStateRef?: Record<string, unknown>;
	toolsAllowed?: boolean;
	executedToolIds?: ReadonlySet<string>;
	reviewOfTurnId?: string;
}

export type AskEvent =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| {
			type: "tool-request";
			toolCallId: string;
			name: string;
			input: Record<string, unknown>;
		}
	| {
			type: "tool-result";
			toolCallId: string;
			output: unknown;
			isError: boolean;
		}
	| {
			type: "tool-skipped";
			toolCallId: string;
			reason: "already-executed" | "review-mode";
		}
	| { type: "usage"; inputTokens: number; outputTokens: number }
	| { type: "error"; message: string; retryable: boolean }
	| { type: "done"; sessionId?: string };

export interface TalosProvider {
	readonly id: string;
	readonly kind: TalosProviderKind;
	capabilities(): ReadonlySet<ProviderCapability>;
	chat(request: AskRequest): AsyncIterable<AskEvent>;
	cancel(runId: string): Promise<void>;
	resume(sessionId: string): Promise<void>;
}

export interface ProviderSwitchPoint {
	fromProviderId: string;
	toProviderId: string;
	atTurnId: string;
	changedAt: number;
}

export interface ProviderReviewTurn {
	providerId: string;
	turnId: string;
	reviewOfTurnId: string;
}

export interface ProviderSessionSnapshot {
	sessionId: string;
	providerId: string;
	switchPoints: ProviderSwitchPoint[];
	completedToolIds: string[];
	reviews: ProviderReviewTurn[];
	forkedFrom?: {
		sessionId: string;
		atTurnId: string;
	};
}
