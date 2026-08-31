import type { ActionKind, ActionRequest, ActionRisk, ActionTarget } from "../contracts/approval";
import type { RuntimeId } from "../contracts/runtime-adapter";

const PATH_KEYS = new Set(["path", "file", "filepath", "file_path", "filename", "cwd", "directory", "source", "sourcepath", "source_path", "destination", "destinationpath", "destination_path", "target", "targetpath", "target_path", "notebook_path"]);
const URL_KEYS = new Set(["url", "uri", "endpoint", "host"]);

function strings(value: unknown): string[] {
	if (typeof value === "string") return value.trim() ? [value.trim()] : [];
	if (Array.isArray(value)) return value.flatMap(strings);
	return [];
}

function exactTool(toolName: string, metadata?: Record<string, unknown>): { kind: ActionKind; canonicalToolId: string } {
	const canonicalKind = metadata?.canonicalActionKind;
	const canonicalToolId = metadata?.canonicalToolId;
	if (typeof canonicalKind === "string" && ["read", "write", "delete", "shell", "network", "export", "mcp", "subagent", "unknown"].includes(canonicalKind)) {
		return {
			kind: canonicalKind as ActionKind,
			canonicalToolId: typeof canonicalToolId === "string" && canonicalToolId.trim() ? canonicalToolId.trim() : `adapter.${canonicalKind}`,
		};
	}
	return EXACT_TOOLS[toolName.trim().toLowerCase()] ?? { kind: "unknown", canonicalToolId: "talos.unknown" };
}

function targetsFor(input: Record<string, unknown>, kind: ActionKind): ActionTarget[] {
	const targets: ActionTarget[] = [];
	const visit = (value: unknown, key = "", depth = 0): void => {
		if (depth > 4) return;
		const normalizedKey = key.toLowerCase();
		if (PATH_KEYS.has(normalizedKey)) {
			for (const raw of strings(value)) targets.push({ raw, role: normalizedKey.includes("destination") || normalizedKey.includes("target") || kind === "write" || kind === "delete" || kind === "export" ? "destination" : "source" });
		}
		if (Array.isArray(value)) value.forEach((item) => visit(item, key, depth + 1));
		else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey, depth + 1));
	};
	visit(input);
	return targets;
}

function networkFor(input: Record<string, unknown>): ActionRequest["network"] {
	for (const [key, value] of Object.entries(input)) {
		if (!URL_KEYS.has(key.toLowerCase()) || typeof value !== "string") continue;
		try {
			const url = new URL(value.includes("://") ? value : `https://${value}`);
			return { protocol: url.protocol.slice(0, -1), host: url.hostname, port: url.port ? Number(url.port) : undefined };
		} catch {
			continue;
		}
	}
	return undefined;
}

export function normalizeToolAction(input: {
	runtimeId: RuntimeId;
	toolName: string;
	toolInput: Record<string, unknown>;
	toolMetadata?: Record<string, unknown>;
	vaultRoot: string;
	actionId?: string;
}): ActionRequest {
	const mapped = exactTool(input.toolName, input.toolMetadata);
	const kind = mapped.kind;
	const commandText = typeof input.toolInput.command === "string" ? input.toolInput.command.trim() : "";
	const commandParts = commandText ? commandText.split(/\s+/) : [];
	const cwd = typeof input.toolInput.cwd === "string" && input.toolInput.cwd.trim() ? input.toolInput.cwd.trim() : input.vaultRoot;
	const targets = targetsFor(input.toolInput, kind);
	if ((kind === "shell" || kind === "mcp" || kind === "subagent") && !targets.some((target) => target.raw === cwd)) targets.push({ raw: cwd, role: "source" });
	const destructive = kind === "delete" || /(?:^|\s)(?:rm|rmdir|git\s+(?:reset|clean)|chmod|chown)(?:\s|$)/i.test(commandText);
	const risk: ActionRisk = kind === "read"
		? "A"
		: kind === "unknown" ? "B" : kind === "write" && !destructive && targets.length > 0 ? "B" : "C";
	return {
		actionId: input.actionId ?? crypto.randomUUID(),
		runtimeId: input.runtimeId,
		canonicalToolId: mapped.canonicalToolId,
		kind,
		risk,
		targets,
		...(commandText ? { command: { executable: commandParts[0] ?? commandText, args: commandParts.slice(1), cwd } } : {}),
		...(kind === "network" ? { network: networkFor(input.toolInput) } : {}),
		reason: input.toolName,
		destructive,
	};
}

const EXACT_TOOLS: Record<string, { kind: ActionKind; canonicalToolId: string }> = {
	read: { kind: "read", canonicalToolId: "talos.read" },
	glob: { kind: "read", canonicalToolId: "talos.glob" },
	grep: { kind: "read", canonicalToolId: "talos.grep" },
	search: { kind: "read", canonicalToolId: "talos.search" },
	imageview: { kind: "read", canonicalToolId: "talos.image-view" },
	write: { kind: "write", canonicalToolId: "talos.write" },
	edit: { kind: "write", canonicalToolId: "talos.edit" },
	multiedit: { kind: "write", canonicalToolId: "talos.multi-edit" },
	notebookedit: { kind: "write", canonicalToolId: "talos.notebook-edit" },
	applypatch: { kind: "write", canonicalToolId: "talos.apply-patch" },
	apply_patch: { kind: "write", canonicalToolId: "talos.apply-patch" },
	"inline-edit": { kind: "write", canonicalToolId: "talos.inline-edit" },
	move: { kind: "write", canonicalToolId: "talos.move" },
	rename: { kind: "write", canonicalToolId: "talos.rename" },
	copy: { kind: "write", canonicalToolId: "talos.copy" },
	delete: { kind: "delete", canonicalToolId: "talos.delete" },
	remove: { kind: "delete", canonicalToolId: "talos.delete" },
	unlink: { kind: "delete", canonicalToolId: "talos.delete" },
	trash: { kind: "delete", canonicalToolId: "talos.delete" },
	bash: { kind: "shell", canonicalToolId: "talos.shell" },
	shell: { kind: "shell", canonicalToolId: "talos.shell" },
	command: { kind: "shell", canonicalToolId: "talos.shell" },
	terminal: { kind: "shell", canonicalToolId: "talos.shell" },
	exec: { kind: "shell", canonicalToolId: "talos.shell" },
	websearch: { kind: "network", canonicalToolId: "talos.web-search" },
	webfetch: { kind: "network", canonicalToolId: "talos.web-fetch" },
	fetch: { kind: "network", canonicalToolId: "talos.web-fetch" },
	networkrequest: { kind: "network", canonicalToolId: "talos.network" },
	export: { kind: "export", canonicalToolId: "talos.export" },
	download: { kind: "export", canonicalToolId: "talos.export" },
	mcp: { kind: "mcp", canonicalToolId: "talos.mcp" },
	mcptoolcall: { kind: "mcp", canonicalToolId: "talos.mcp" },
	task: { kind: "subagent", canonicalToolId: "talos.subagent" },
	agent: { kind: "subagent", canonicalToolId: "talos.subagent" },
	collabagenttoolcall: { kind: "subagent", canonicalToolId: "talos.subagent" },
};
