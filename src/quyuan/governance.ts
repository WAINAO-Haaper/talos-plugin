import { inspectToolTargetPaths } from "../ai/context/tool-path-policy";
export type QuyuanGovernanceDecision = "allow" | "ask" | "deny";

export interface QuyuanToolRequest {
	toolName: string;
	input: Record<string, unknown>;
	readPaths: ReadonlySet<string>;
	approvalGranted?: boolean;
	approvedWorkflow?: "digest" | "identity-change" | "persona-change";
	configDir?: string;
}

export interface QuyuanGovernanceResult {
	decision: QuyuanGovernanceDecision;
	reason: string;
	requiredReads: string[];
}

const MUTATION_TOOLS = new Set([
	"write",
	"edit",
	"multiedit",
	"notebookedit",
	"applypatch",
	"apply_patch",
	"delete",
	"move",
	"bash",
	"inline-edit",
]);

const DESTRUCTIVE_TOOLS = new Set(["delete", "move", "bash"]);
const READ_ONLY_TOOLS = new Set(["read", "glob", "grep", "search"]);

function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
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
	const normalizedTool = request.toolName.trim().toLowerCase();
	const pathInspection = inspectToolTargetPaths(
		request.toolName,
		request.input,
		{ configDir: request.configDir }
	);
	if (pathInspection.blocked) {
		return {
			decision: "deny",
			reason: pathInspection.reasons.includes("unclassified-path")
				? "操作缺少可验证的目标路径"
				: "目标路径属于永久禁区",
			requiredReads: [],
		};
	}

	if (!MUTATION_TOOLS.has(normalizedTool)) {
		return READ_ONLY_TOOLS.has(normalizedTool)
			? { decision: "allow", reason: "只读操作", requiredReads: [] }
			: {
				decision: "ask",
				reason: "未分类工具必须显式审批",
				requiredReads: [],
			};
	}

	if (DESTRUCTIVE_TOOLS.has(normalizedTool) && !request.approvalGranted) {
		return {
			decision: "ask",
			reason: "删除、移动或 Bash 属于高风险操作，必须显式审批",
			requiredReads: [],
		};
	}

	const paths = pathInspection.paths.map(normalizeVaultPath);
	if (paths.length === 0 && normalizedTool !== "bash") {
		return {
			decision: "deny",
			reason: "写操作缺少可验证的目标路径",
			requiredReads: [],
		};
	}

	const lowerPaths = paths.map((path) => path.toLowerCase());
	if (lowerPaths.includes("identity/profile.md")) {
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

	if (
		lowerPaths.some((path) => path.startsWith("identity/")) &&
		request.approvedWorkflow !== "identity-change"
	) {
		return {
			decision: "deny",
			reason: "Identity 变更必须先进入 B 类审批流程",
			requiredReads: ["System/pending-approvals.md"],
		};
	}

	if (
		lowerPaths.some((path) => path.startsWith("灵魂/")) &&
		request.approvedWorkflow !== "persona-change"
	) {
		return {
			decision: "deny",
			reason: "PERSONA/persona-memory 变更必须先进入 B 类审批流程",
			requiredReads: ["System/pending-approvals.md"],
		};
	}

	const requiredReads = [
		...new Set(
			paths
				.filter((path) => path.toLowerCase().endsWith(".md"))
				.map(nearestReadme)
				.filter((readme) => !hasRead(request.readPaths, readme))
		),
	];
	if (requiredReads.length > 0) {
			return {
				decision: "deny",
				reason: `改内容前必须读取目标目录 ${requiredReads.join("、")}`,
				requiredReads,
			};
	}

	return {
		decision: request.approvalGranted ? "allow" : "ask",
		reason: request.approvalGranted ? "已通过治理与审批" : "写操作等待用户审批",
		requiredReads: [],
	};
}
