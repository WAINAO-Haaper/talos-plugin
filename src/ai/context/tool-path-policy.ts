import {
	inspectVaultPath,
	type SecretBlockReason,
	type SecretPolicyOptions,
} from "./secret-policy.ts";

export interface ToolPathInspection {
	blocked: boolean;
	reasons: SecretBlockReason[];
	paths: string[];
}

const REQUIRED_TARGET_TOOLS = new Set([
	"read",
	"glob",
	"grep",
	"search",
	"write",
	"edit",
	"multiedit",
	"notebookedit",
	"applypatch",
	"apply_patch",
	"inline-edit",
	"delete",
	"move",
]);

const VAULT_PATH_TOOLS = new Set([
	...REQUIRED_TARGET_TOOLS,
	"glob",
	"grep",
	"search",
]);
const VAULT_ROOT_SCOPED_READ_TOOLS = new Set(["glob", "grep", "search"]);

const PATH_KEYS = [
	"file_path",
	"path",
	"target_path",
	"notebook_path",
	"directory",
	"root",
	"search_path",
	"cwd",
] as const;

function normalizeSeparators(value: string): string {
	return value.trim().replace(/\\/g, "/");
}

function isAbsoluteToolPath(value: string): boolean {
	return value.startsWith("/")
		|| /^[A-Za-z]:\//.test(value)
		|| value.startsWith("//");
}

export function relativizeVaultToolPath(
	value: string,
	options: {
		vaultRoot: string;
		mappedPath?: string;
		caseInsensitive?: boolean;
	}
): string {
	const normalizedValue = normalizeSeparators(value);
	if (!isAbsoluteToolPath(normalizedValue)) {
		return normalizedValue.replace(/^\.\//, "");
	}

	const candidate = normalizeSeparators(options.mappedPath ?? value).replace(/\/+$/, "");
	const root = normalizeSeparators(options.vaultRoot).replace(/\/+$/, "");
	if (!root) return normalizedValue;

	const comparableCandidate = options.caseInsensitive
		? candidate.toLowerCase()
		: candidate;
	const comparableRoot = options.caseInsensitive ? root.toLowerCase() : root;
	if (comparableCandidate === comparableRoot) return ".";
	if (comparableCandidate.startsWith(`${comparableRoot}/`)) {
		return candidate.slice(root.length + 1);
	}
	return normalizedValue;
}

function addString(target: string[], value: unknown): void {
	if (typeof value === "string" && value.trim()) target.push(value);
}

function addStringArray(target: string[], value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const entry of value) addString(target, entry);
}

function addChangePaths(target: string[], value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const entry of value) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const change = entry as Record<string, unknown>;
		for (const key of [
			"path",
			"movePath",
			"move_path",
			"target_path",
			"destinationPath",
		]) {
			addString(target, change[key]);
		}
	}
}

export function extractToolTargetPaths(
	toolName: string,
	input: Record<string, unknown>
): string[] {
	const normalizedTool = toolName.trim().toLowerCase();
	if (!VAULT_PATH_TOOLS.has(normalizedTool)) return [];

	const paths: string[] = [];
	for (const key of PATH_KEYS) addString(paths, input[key]);
	addStringArray(paths, input.paths);
	addStringArray(paths, input.files);
	addChangePaths(paths, input.changes);

	return [...new Set(paths.map((path) => path.trim()))];
}

export function inspectToolTargetPaths(
	toolName: string,
	input: Record<string, unknown>,
	options: SecretPolicyOptions = {}
): ToolPathInspection {
	const normalizedTool = toolName.trim().toLowerCase();
	const paths = extractToolTargetPaths(toolName, input);
	if (REQUIRED_TARGET_TOOLS.has(normalizedTool) && paths.length === 0) {
		return {
			blocked: true,
			reasons: ["unclassified-path"],
			paths,
		};
	}

	// "." is the canonical post-boundary marker for the Vault root. Only
	// directory-scoped read tools may consume it; file reads and mutations fail closed.
	const reasons = [
		...new Set(paths.flatMap((path) =>
			path === "." && VAULT_ROOT_SCOPED_READ_TOOLS.has(normalizedTool)
				? []
				: inspectVaultPath(path, options).reasons
		)),
	];
	return { blocked: reasons.length > 0, reasons, paths };
}
