import type { ActionKind, ActionRequest, ActionTarget } from "../contracts/approval";
import type { RuntimeId } from "../contracts/runtime-adapter";

const PATH_KEY = /(?:^|_)(?:path|file|filename|cwd|directory|source|destination|target)$/i;
const URL_KEY = /(?:url|uri|endpoint|host)$/i;

function strings(value: unknown): string[] {
	if (typeof value === "string") return value.trim() ? [value.trim()] : [];
	if (Array.isArray(value)) return value.flatMap(strings);
	return [];
}

function kindFor(toolName: string): ActionKind {
	const name = toolName.toLowerCase();
	if (/delete|remove|unlink|trash/.test(name)) return "delete";
	if (/export|download/.test(name)) return "export";
	if (/web|fetch|http|network|browse/.test(name)) return "network";
	if (/mcp/.test(name)) return "mcp";
	if (/bash|shell|command|terminal|exec/.test(name)) return "shell";
	if (/write|edit|patch|create|move|rename|copy/.test(name)) return "write";
	return "read";
}

function targetsFor(input: Record<string, unknown>, kind: ActionKind): ActionTarget[] {
	const targets: ActionTarget[] = [];
	for (const [key, value] of Object.entries(input)) {
		if (!PATH_KEY.test(key)) continue;
		for (const raw of strings(value)) {
			targets.push({ raw, role: /destination|target|output/i.test(key) || kind === "write" || kind === "export" ? "destination" : "source" });
		}
	}
	return targets;
}

function networkFor(input: Record<string, unknown>): ActionRequest["network"] {
	for (const [key, value] of Object.entries(input)) {
		if (!URL_KEY.test(key) || typeof value !== "string") continue;
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
	vaultRoot: string;
	actionId?: string;
}): ActionRequest {
	const kind = kindFor(input.toolName);
	const commandText = typeof input.toolInput.command === "string" ? input.toolInput.command.trim() : "";
	const commandParts = commandText ? commandText.split(/\s+/) : [];
	const cwd = typeof input.toolInput.cwd === "string" && input.toolInput.cwd.trim() ? input.toolInput.cwd.trim() : input.vaultRoot;
	const targets = targetsFor(input.toolInput, kind);
	if ((kind === "shell" || kind === "mcp") && !targets.some((target) => target.raw === cwd)) targets.push({ raw: cwd, role: "source" });
	return {
		actionId: input.actionId ?? crypto.randomUUID(),
		runtimeId: input.runtimeId,
		kind,
		targets,
		...(commandText ? { command: { executable: commandParts[0] ?? commandText, args: commandParts.slice(1), cwd } } : {}),
		...(kind === "network" ? { network: networkFor(input.toolInput) } : {}),
		reason: input.toolName,
		destructive: kind === "delete" || /(?:^|\s)(?:rm|rmdir|git\s+(?:reset|clean)|chmod|chown)(?:\s|$)/i.test(commandText),
	};
}
