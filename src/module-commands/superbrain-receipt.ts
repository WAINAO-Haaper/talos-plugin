import { safeSuperbrainPath, type SuperbrainWorkflowSlug } from "./superbrain-catalog";

export interface SuperbrainWorkflowResult {
	workflow_id: SuperbrainWorkflowSlug;
	host: "codex" | "claude" | "api";
	status: "completed" | "no_change" | "failed" | "unavailable";
	model_called: boolean;
	receipt_valid: boolean;
	evidence: string[];
	log: string | null;
	reason?: string;
	exit_code?: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作流未返回结构化结果");
	return value as Record<string, unknown>;
}

/** The CLI receipt proves files exist; recheck them in the active Obsidian vault. */
export async function validateSuperbrainResult(
	value: unknown,
	slug: SuperbrainWorkflowSlug,
	host: "codex" | "claude" | "api",
	exists: (path: string) => Promise<boolean>,
): Promise<SuperbrainWorkflowResult> {
	const data = asRecord(value);
	if (data.workflow_id !== slug || data.host !== host) throw new Error("工作流结果与本次请求不匹配");
	const status = data.status;
	if (status !== "completed" && status !== "no_change" && status !== "failed" && status !== "unavailable") throw new Error("工作流结果状态无效");
	const evidence = Array.isArray(data.evidence) ? data.evidence.map(safeSuperbrainPath) : [];
	if (evidence.some(path => path.startsWith("System/working-memory/workflow-runs/"))) throw new Error("运行日志不能作为资料成果证据");
	if ((status === "completed" || status === "no_change") && data.receipt_valid !== true) throw new Error("工作流缺少有效运行收据");
	if (status === "completed" && !evidence.length) throw new Error("工作流缺少资料成果文件");
	for (const path of evidence) if (!(await exists(path))) throw new Error(`工作流证据文件不存在：${path}`);
	const log = data.log === null || data.log === undefined ? null : safeSuperbrainPath(data.log);
	return {
		workflow_id: slug,
		host,
		status,
		model_called: data.model_called === true,
		receipt_valid: data.receipt_valid === true,
		evidence,
		log,
		...(typeof data.reason === "string" ? { reason: data.reason.slice(0, 500) } : {}),
		...(typeof data.exit_code === "number" || data.exit_code === null ? { exit_code: data.exit_code } : {}),
	};
}
