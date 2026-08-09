import { evaluateActionRisk } from "../action-core/risk-policy";
import type {
	RiskDecision,
	TalosActionDefinition,
	TalosActionEffect,
	TalosActionRequest,
	TalosActionRisk,
} from "../action-core/types";

export interface VoiceToolPolicy {
	decision: "allow" | "ask" | "deny";
	reason: string;
}

const READ_TOOLS = new Set([
	"read",
	"glob",
	"grep",
	"search",
	"websearch",
	"webfetch",
]);
const WRITE_TOOLS = new Set([
	"write",
	"edit",
	"multiedit",
	"notebookedit",
	"applypatch",
	"apply_patch",
	"inline-edit",
]);
const DESTRUCTIVE_TOOLS = new Set(["delete", "move", "bash"]);

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function targetPath(input: Record<string, unknown>): string {
	return (
		stringValue(input.file_path) ||
		stringValue(input.path) ||
		stringValue(input.target_path) ||
		stringValue(input.notebook_path)
	);
}

function toolClass(toolName: string): {
	risk: TalosActionRisk;
	effect: TalosActionEffect;
} {
	const normalized = toolName.toLowerCase();
	if (READ_TOOLS.has(normalized)) return { risk: "A", effect: "read" };
	if (WRITE_TOOLS.has(normalized)) return { risk: "B", effect: "write" };
	if (normalized === "delete") return { risk: "C", effect: "delete" };
	if (normalized === "move") return { risk: "C", effect: "move" };
	if (normalized === "bash") return { risk: "C", effect: "shell" };
	if (/publish|post|send|upload/.test(normalized)) {
		return { risk: "C", effect: "external-publish" };
	}
	return { risk: "C", effect: "external-publish" };
}

export function evaluateVoiceToolRisk(
	toolName: string,
	input: Record<string, unknown>
): RiskDecision {
	const classification = toolClass(toolName);
	const path = targetPath(input);
	const definition: TalosActionDefinition = {
		id: `model-tool:${toolName}`,
		label: toolName,
		description: "模型通过语音页面提出的工具动作",
		risk: classification.risk,
		readScope: ["**"],
		writeScope: ["**"],
		timeoutMs: 120_000,
		cancelable: true,
		reversible:
			classification.risk === "B" && !DESTRUCTIVE_TOOLS.has(toolName.toLowerCase()),
		execute: async () => undefined,
	};
	const request: TalosActionRequest = {
		readPaths: classification.effect === "read" && path ? [path] : [],
		writePaths: classification.effect === "write" && path ? [path] : [],
		effects: [classification.effect],
		touchesIdentity: /(^|\/)(identity|10 身份)(\/|$)/i.test(path),
		touchesTopLevelStructure:
			classification.effect === "move" && !path.includes("/"),
	};
	return evaluateActionRisk(definition, request);
}

export async function resolveVoiceToolApproval(
	policy: VoiceToolPolicy,
	confirm: () => Promise<boolean>
): Promise<"allow" | "deny"> {
	if (policy.decision === "deny") return "deny";
	if (policy.decision === "allow") return "allow";
	return (await confirm()) ? "allow" : "deny";
}
