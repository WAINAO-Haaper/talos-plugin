import type { ActionRequest, ApprovalDecision, PermissionMode, WorkflowMode } from "../contracts/approval";
import { ExternalAccessGrantStore } from "./external-access-grant";
import { PermissionRuleStore } from "./permission-rule-store";
import { auditRecord, type SecurityAuditSink } from "./security-audit";
import { VaultBoundary } from "./vault-boundary";

export interface ApprovalContext {
	workflow: WorkflowMode;
	permission: PermissionMode;
	conversationId: string;
	providerEgressHosts?: string[];
	providerEgressRequest?: boolean;
	approvalUiAttached: boolean;
}

const MUTATING = new Set(["write", "delete", "shell", "network", "export", "mcp"]);

function networkRuleTarget(request: ActionRequest): string | null {
	if (request.kind !== "network" || !request.network) return null;
	const rawHost = request.network.host.trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (!rawHost) return null;
	const defaultPort = request.network.protocol === "https" ? 443 : request.network.protocol === "http" ? 80 : undefined;
	const port = request.network.port ?? defaultPort;
	const host = rawHost.includes(":") ? `[${rawHost}]` : rawHost;
	return port ? `${host}:${port}` : host;
}

function isProviderEgress(request: ActionRequest, context: ApprovalContext): boolean {
	return request.kind === "network"
		&& context.providerEgressRequest === true
		&& Boolean(request.network)
		&& Boolean(context.providerEgressHosts?.includes(request.network!.host));
}

export class ApprovalBroker {
	constructor(
		private readonly boundary: VaultBoundary,
		private readonly rules: PermissionRuleStore,
		private readonly grants: ExternalAccessGrantStore,
		private readonly audit: SecurityAuditSink,
	) {}

	async evaluate(request: ActionRequest, context: ApprovalContext): Promise<ApprovalDecision> {
		let decision: ApprovalDecision;
		try {
			const boundary = await this.boundary.assess(request);
			if (boundary.hasPermanentDenial) {
				decision = { actionId: request.actionId, decision: "deny", reason: "永久禁区不可授权" };
			} else if (context.workflow === "plan" && MUTATING.has(request.kind) && !isProviderEgress(request, context)) {
				decision = { actionId: request.actionId, decision: "deny", reason: "Plan 模式禁止执行变更" };
			} else if (!context.approvalUiAttached && this.requiresApproval(request, boundary.hasExternalTarget, boundary.bulkDestructive) && !isProviderEgress(request, context)) {
				decision = { actionId: request.actionId, decision: "deny", reason: "审批界面不可用" };
			} else {
				decision = await this.decide(request, context, boundary.targets, boundary.hasExternalTarget, boundary.bulkDestructive);
			}
		} catch (error) {
			decision = { actionId: request.actionId, decision: "deny", reason: `边界检查失败：${error instanceof Error ? error.message : "unknown"}` };
		}
		try {
			await this.audit.append(auditRecord(request, decision));
			return decision;
		} catch {
			return { actionId: request.actionId, decision: "deny", reason: "审计写入失败，已失败关闭" };
		}
	}

	async rememberExactRule(request: ActionRequest, _context: ApprovalContext): Promise<string | null> {
		if (request.kind === "network" && request.network) {
			const target = networkRuleTarget(request);
			if (!target) return null;
			const id = crypto.randomUUID();
			await this.rules.add({
				id,
				runtimeId: request.runtimeId,
				kind: "network",
				target,
				scope: "persistent",
				createdAt: new Date().toISOString(),
			});
			return id;
		}
		if (request.kind !== "read" && request.kind !== "write") return null;
		const assessment = await this.boundary.assess(request);
		if (assessment.hasExternalTarget || assessment.hasPermanentDenial || assessment.targets.length !== 1) return null;
		const id = crypto.randomUUID();
		await this.rules.add({ id, runtimeId: request.runtimeId, kind: request.kind, target: assessment.targets[0].canonical, scope: "persistent", createdAt: new Date().toISOString() });
		return id;
	}

	private requiresApproval(request: ActionRequest, external: boolean, bulk: boolean): boolean {
		return request.destructive || external || bulk || MUTATING.has(request.kind);
	}

	private async decide(
		request: ActionRequest,
		context: ApprovalContext,
		targets: Array<{ canonical: string; insideVault: boolean }>,
		external: boolean,
		bulk: boolean,
	): Promise<ApprovalDecision> {
		if (request.kind === "network" && request.network) {
			if (isProviderEgress(request, context)) {
				return { actionId: request.actionId, decision: "allow", reason: "已确认 Provider endpoint" };
			}
			const target = networkRuleTarget(request);
			if (target) {
				const rule = await this.rules.match({ runtimeId: request.runtimeId, kind: "network", target, conversationId: context.conversationId });
				if (rule) return { actionId: request.actionId, decision: "allow", reason: "命中精确持久网络授权", ruleId: rule.id };
			}
			const grant = this.grants.consume({ type: "host", value: request.network.host, direction: "network", actionId: request.actionId, conversationId: context.conversationId });
			if (grant) return { actionId: request.actionId, decision: "allow", reason: "命中精确网络授权", ruleId: grant.id };
			return { actionId: request.actionId, decision: "ask", reason: "通用网络请求需要审批" };
		}
		if (external) {
			for (const target of targets.filter((item) => !item.insideVault)) {
				const direction = request.kind === "export" ? "export" : request.kind === "write" ? "write" : "read";
				const grant = this.grants.consume({ type: "path", value: target.canonical, direction, actionId: request.actionId, conversationId: context.conversationId });
				if (!grant) return { actionId: request.actionId, decision: "ask", reason: "Vault 外目标需要精确授权" };
			}
			return { actionId: request.actionId, decision: "allow", reason: "命中 Vault 外精确授权" };
		}
		if (request.destructive || bulk || request.kind === "delete" || request.kind === "export" || request.kind === "mcp" || request.kind === "shell") {
			return { actionId: request.actionId, decision: "ask", reason: "敏感动作需要审批" };
		}
		if (request.kind === "read") return { actionId: request.actionId, decision: "allow", reason: "Vault 内安全读取" };
		if (context.permission === "vault-full" && request.kind === "write") {
			return { actionId: request.actionId, decision: "allow", reason: "Vault Full 允许普通 Vault 内写入" };
		}
		if (context.permission === "scoped") {
			for (const target of targets) {
				const rule = await this.rules.match({ runtimeId: request.runtimeId, kind: request.kind, target: target.canonical, conversationId: context.conversationId });
				if (rule) return { actionId: request.actionId, decision: "allow", reason: "命中精确权限规则", ruleId: rule.id };
			}
		}
		return { actionId: request.actionId, decision: "ask", reason: "动作需要审批" };
	}
}
