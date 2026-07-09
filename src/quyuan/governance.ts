export type QuyuanGovernanceDecision = "allow" | "ask" | "deny";

export interface QuyuanToolRequest {
	toolName: string;
	input: Record<string, unknown>;
	readPaths: ReadonlySet<string>;
	approvalGranted?: boolean;
	approvedWorkflow?: "digest" | "identity-change" | "persona-change";
}

export interface QuyuanGovernanceResult {
	decision: QuyuanGovernanceDecision;
	reason: string;
	requiredReads: string[];
}

const MUTATION_TOOLS = new Set([
	"Write",
	"Edit",
	"MultiEdit",
	"NotebookEdit",
	"ApplyPatch",
	"apply_patch",
	"Delete",
	"Move",
	"Bash",
	"inline-edit",
]);

const DESTRUCTIVE_TOOLS = new Set(["Delete", "Move", "Bash"]);

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function targetPath(input: Record<string, unknown>): string {
	const raw =
		stringValue(input.file_path) ||
		stringValue(input.path) ||
		stringValue(input.target_path) ||
		stringValue(input.notebook_path);
	return normalizeVaultPath(raw);
}

function nearestReadme(path: string): string {
	const slash = path.lastIndexOf("/");
	if (slash < 0) return "_README.md";
	return `${path.slice(0, slash)}/_README.md`;
}

function hasRead(readPaths: ReadonlySet<string>, path: string): boolean {
	const normalized = normalizeVaultPath(path);
	for (const readPath of readPaths) {
		if (normalizeVaultPath(readPath) === normalized) return true;
	}
	return false;
}

export function evaluateQuyuanGovernance(
	request: QuyuanToolRequest
): QuyuanGovernanceResult {
	if (!MUTATION_TOOLS.has(request.toolName)) {
		return { decision: "allow", reason: "只读操作", requiredReads: [] };
	}

	if (DESTRUCTIVE_TOOLS.has(request.toolName) && !request.approvalGranted) {
		return {
			decision: "ask",
			reason: "删除、移动或 Bash 属于高风险操作，必须显式审批",
			requiredReads: [],
		};
	}

	const path = targetPath(request.input);
	if (!path && request.toolName !== "Bash") {
		return {
			decision: "deny",
			reason: "写操作缺少可验证的目标路径",
			requiredReads: [],
		};
	}

	if (path === "Identity/PROFILE.md") {
		const digestApproved =
			request.approvedWorkflow === "digest" && request.approvalGranted === true;
		if (!digestApproved) {
			return {
				decision: "deny",
				reason: "禁止直接写 PROFILE.md；必须经候选池、/digest 与用户确认",
				requiredReads: [
					"System/working-memory/candidates.md",
					"Identity/PROFILE.md",
				],
			};
		}
	}

	if (path.startsWith("Identity/") && request.approvedWorkflow !== "identity-change") {
		return {
			decision: "deny",
			reason: "Identity 变更必须先进入 B 类审批流程",
			requiredReads: ["System/pending-approvals.md"],
		};
	}

	if (path.startsWith("灵魂/") && request.approvedWorkflow !== "persona-change") {
		return {
			decision: "deny",
			reason: "PERSONA/persona-memory 变更必须先进入 B 类审批流程",
			requiredReads: ["System/pending-approvals.md"],
		};
	}

	if (path.endsWith(".md")) {
		const readme = nearestReadme(path);
		if (!hasRead(request.readPaths, readme)) {
			return {
				decision: "deny",
				reason: `改内容前必须读取目标目录 ${readme}`,
				requiredReads: [readme],
			};
		}
	}

	return {
		decision: request.approvalGranted ? "allow" : "ask",
		reason: request.approvalGranted ? "已通过治理与审批" : "写操作等待用户审批",
		requiredReads: [],
	};
}
