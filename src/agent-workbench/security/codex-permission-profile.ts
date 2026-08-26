export const TALOS_AGENT_WORKBENCH_CODEX_PROFILE = "talos-agent-workbench-v1";

function safeConfigDir(configDir: string): string {
	const value = configDir.trim().normalize("NFKC").replace(/\\/g, "/");
	if (!value || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Obsidian 配置目录不可验证");
	return value;
}

function toml(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(",")}}`;
	throw new Error("Codex permission profile 无法序列化");
}

export function codexPermissionProfileArgs(configDir: string): string[] {
	const denied = [safeConfigDir(configDir), ".talos/private", ".talos/secrets", ".talos/credentials"];
	const workspacePermissions = Object.fromEntries(denied.map((subpath) => [subpath, "deny"]));
	const profile = {
		filesystem: {
			":minimal": "read",
			":workspace_roots": { ".": "write", ...workspacePermissions, ".env*": "deny", "**/.env*": "deny" },
		},
		network: { enabled: false },
	};
	return ["-c", `default_permissions=${toml(TALOS_AGENT_WORKBENCH_CODEX_PROFILE)}`, "-c", `permissions.${TALOS_AGENT_WORKBENCH_CODEX_PROFILE}=${toml(profile)}`];
}

export function assertCodexPermissionProfile(result: { activePermissionProfile?: { id?: string } | null }): void {
	if (result.activePermissionProfile?.id !== TALOS_AGENT_WORKBENCH_CODEX_PROFILE) throw new Error("Codex 未确认 TALOS named permission profile，已失败关闭");
}
