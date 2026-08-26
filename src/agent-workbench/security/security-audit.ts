import { createHash } from "node:crypto";
import type { ActionRequest, ApprovalDecision } from "../contracts/approval";

export interface SecurityAuditRecord {
	actionId: string;
	runtimeId: string;
	kind: string;
	targetDigests: string[];
	host?: string;
	decision: ApprovalDecision["decision"];
	ruleId?: string;
	timestamp: string;
}

export interface SecurityAuditSink { append(record: SecurityAuditRecord): Promise<void>; }

export function auditRecord(request: ActionRequest, decision: ApprovalDecision): SecurityAuditRecord {
	return {
		actionId: request.actionId,
		runtimeId: request.runtimeId,
		kind: request.kind,
		targetDigests: request.targets.map((target) => createHash("sha256").update(target.canonical ?? target.raw).digest("hex")),
		host: request.network?.host,
		decision: decision.decision,
		ruleId: decision.ruleId,
		timestamp: new Date().toISOString(),
	};
}
