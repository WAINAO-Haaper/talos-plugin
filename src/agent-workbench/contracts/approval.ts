import type { RuntimeId } from "./runtime-adapter";

export type ActionKind = "read" | "write" | "delete" | "shell" | "network" | "export" | "mcp";
export type WorkflowMode = "plan" | "execute";
export type PermissionMode = "ask" | "scoped" | "vault-full";

export interface ActionTarget {
	raw: string;
	canonical?: string;
	role: "source" | "destination";
}

export interface ActionRequest {
	actionId: string;
	runtimeId: RuntimeId;
	kind: ActionKind;
	targets: ActionTarget[];
	command?: { executable: string; args: string[]; cwd: string };
	network?: { protocol: string; host: string; port?: number };
	reason?: string;
	destructive: boolean;
}

export interface ApprovalDecision {
	actionId: string;
	decision: "allow" | "deny" | "ask";
	reason: string;
	ruleId?: string;
}
