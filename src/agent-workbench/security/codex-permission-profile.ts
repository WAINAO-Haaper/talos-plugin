function safeConfigDir(configDir: string): string {
	const value = configDir.trim().normalize("NFKC").replace(/\\/g, "/");
	if (!value || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Obsidian 配置目录不可验证");
	return value;
}

export function codexProtectedVaultSubpaths(configDir: string): string[] {
	return [safeConfigDir(configDir), ".talos/private", ".talos/secrets", ".talos/credentials"];
}
