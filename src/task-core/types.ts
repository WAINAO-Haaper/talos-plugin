import type { RiskDecision, TalosActionRequest } from "../action-core/types";

export type TalosTaskState =
	| "ready"
	| "queued"
	| "running"
	| "completed"
	| "partial"
	| "failed"
	| "cancelled"
	| "reverted";

export interface TalosFileChange {
	path: string;
	kind: "create" | "modify" | "move" | "delete";
	fromPath?: string;
}

export interface TalosPartialTaskResult {
	taskOutcome: "partial";
	version: 1;
	result?: unknown;
	error: string;
	changes: TalosFileChange[];
}

export interface TalosTaskRun {
	id: string;
	idempotencyKey: string;
	actionId: string;
	state: TalosTaskState;
	approvalRequired: boolean;
	riskDecision?: RiskDecision["decision"];
	providerId?: string;
	approvedAt?: string;
	startedAt?: string;
	finishedAt?: string;
	createdAt: string;
	readPaths: string[];
	changes: TalosFileChange[];
	result?: unknown;
	error?: string;
	recoveryId?: string;
}

export interface TalosTaskRunInput<Input = unknown> {
	actionId: string;
	idempotencyKey: string;
	input: Input;
	request: TalosActionRequest;
	providerId?: string;
	approvalGranted?: boolean;
}
