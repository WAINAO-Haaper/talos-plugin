import type { EffectiveRuntimePolicy } from "./runtime-policy";

export const TALOS_CODEX_PERMISSION_PROFILE_ID = "talos-runtime-v1";

type CodexFileAccess = "read" | "write" | "deny";

type CodexProfilePath =
	| {
		type: "special";
		value: {
			kind: "minimal" | "project_roots";
			subpath?: string;
		};
	}
	| { type: "glob_pattern"; pattern: string };

export interface CodexPermissionProfileEntry {
	access: CodexFileAccess;
	path: CodexProfilePath;
}

export interface TalosCodexPermissionProfileConfig {
	file_system: {
		type: "restricted";
		entries: CodexPermissionProfileEntry[];
	};
	network: { enabled: false };
}

const STATIC_FORBIDDEN_SUBPATHS = [
	".claudian",
	".codex",
	".talos/private",
	".talos/secrets",
	".talos/credentials",
] as const;

const FORBIDDEN_GLOB_PATTERNS = [
	"**/.env",
	"**/.env.*",
] as const;

function normalizeConfigDir(configDir: string): string {
	let normalized = configDir.trim().normalize("NFKC").replace(/\\/g, "/");
	while (normalized.startsWith("./")) normalized = normalized.slice(2);
	const segments = normalized.split("/");
	const unsafe =
		!normalized ||
		normalized.startsWith("/") ||
		normalized.startsWith("~") ||
		/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized) ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f || "<>*?[]{}|".includes(character);
		}) ||
		segments.some((segment) => !segment || segment === "." || segment === "..");
	if (unsafe) {
		throw new Error("Obsidian 配置目录不是可验证的 Vault 相对路径，Codex 已失败关闭");
	}
	return normalized;
}

function specialEntry(
	access: CodexFileAccess,
	kind: "minimal" | "project_roots",
	subpath?: string
): CodexPermissionProfileEntry {
	return {
		access,
		path: {
			type: "special",
			value: { kind, ...(subpath ? { subpath } : {}) },
		},
	};
}

export function buildTalosCodexPermissionProfile(
	policy: EffectiveRuntimePolicy,
	configDir: string
): TalosCodexPermissionProfileConfig {
	const forbiddenSubpaths = [
		normalizeConfigDir(configDir),
		...STATIC_FORBIDDEN_SUBPATHS,
	];
	return {
		file_system: {
			type: "restricted",
			entries: [
				specialEntry("read", "minimal"),
				specialEntry(
					policy.allowMutations ? "write" : "read",
					"project_roots"
				),
				...forbiddenSubpaths.map((path) =>
					specialEntry("deny", "project_roots", path)
				),
				...FORBIDDEN_GLOB_PATTERNS.map((pattern) => ({
					access: "deny" as const,
					path: { type: "glob_pattern" as const, pattern },
				})),
			],
		},
		network: { enabled: false },
	};
}

function toTomlValue(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return `[${value.map(toTomlValue).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.map(([key, entry]) => `${key}=${toTomlValue(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Codex permission profile 含有无法序列化的值");
}

export function buildTalosCodexPermissionProfileArgs(
	policy: EffectiveRuntimePolicy,
	configDir: string
): string[] {
	const profile = buildTalosCodexPermissionProfile(policy, configDir);
	return [
		"-c",
		`permissions.${TALOS_CODEX_PERMISSION_PROFILE_ID}=${toTomlValue(profile)}`,
		"-c",
		`default_permissions=${JSON.stringify(TALOS_CODEX_PERMISSION_PROFILE_ID)}`,
	];
}

export function assertTalosCodexPermissionProfile(result: {
	activePermissionProfile?: { id?: string } | null;
}): void {
	if (result.activePermissionProfile?.id !== TALOS_CODEX_PERMISSION_PROFILE_ID) {
		throw new Error(
			"Codex 未确认 TALOS permission profile，已在 Provider 调用前失败关闭；请使用支持 named permissions 的 Codex CLI"
		);
	}
}
