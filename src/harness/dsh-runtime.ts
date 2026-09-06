/**
 * D-TLP-014：DeepSeek Harness 嵌入面的纯逻辑层（无 Node/DOM 依赖，可单测）。
 *
 * 关键合同：
 * - loopback-only：`dsh --profile web --host 127.0.0.1 --no-open`，永不监听非回环地址。
 * - 工作区锁死：spawn cwd = 当前 vault 根，harness 沙箱可写根由会话 cwd 推导，
 *   因此可写范围即当前 Obsidian 仓库，不提供切换入口。
 * - 凭证出 vault：$DSH_HOME 固定在用户主目录下，API key 不进 vault、不进 data.json。
 */

export const DEFAULT_DSH_PORT = 3180;
export const DSH_HOST = "127.0.0.1";

export interface DshLaunchPlan {
	executable: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

export function normalizeDshPort(value: unknown): number {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string"
				? Number(value.trim())
				: NaN;
	if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
		return DEFAULT_DSH_PORT;
	}
	return parsed;
}

export function buildDshWebArgs(port: number): string[] {
	// 实证（2026-08-23，dsh 0.1.0-rc.8）：web 是 --profile 值而非子命令，
	// `dsh web` 会被当作未知参数立即退出。
	return [
		"--profile",
		"web",
		"--host",
		DSH_HOST,
		"--port",
		String(port),
		"--no-open",
	];
}

/** dsh >= 0.1.2 web 启动横幅里的 token 提取（纯逻辑，可单测）。
 * 横幅形如：`dsh web: http://127.0.0.1:<port>/?token=<token>`；旧版本横幅无 token，返回 null。
 * 只认 query 里的 token（cookie 交换入口），不解析后续日志行，避免误抓。
 */
export function parseDshWebToken(stdoutTail: string): string | null {
	const match = stdoutTail.match(/[?&]token=([A-Za-z0-9_\-~.]+)/);
	return match ? match[1] : null;
}

export function dshBaseUrl(port: number): string {
	return `http://${DSH_HOST}:${port}`;
}

/** $DSH_HOME 根：固定在用户主目录，独立于任何 vault。 */
export function dshHomeRoot(homeDir: string): string {
	const trimmed = homeDir.trim().replace(/[\\/]+$/, "");
	if (!trimmed) throw new Error("无法确定用户主目录，DSH_HOME 不可用");
	return `${trimmed}/.talos/dsh-home`;
}

/** 组装配料单：executable 与 vaultRoot 必须由调用方先验证存在。 */
export function buildDshLaunchPlan(input: {
	executable: string;
	port: number;
	dshHome: string;
	vaultRoot: string;
}): DshLaunchPlan {
	const executable = input.executable.trim();
	if (!executable) throw new Error("未配置 dsh 可执行路径");
	const vaultRoot = input.vaultRoot.trim();
	if (!vaultRoot) throw new Error("无法确定当前 Vault 路径，工作区锁死失败");
	return {
		executable,
		args: buildDshWebArgs(input.port),
		cwd: vaultRoot,
		env: { DSH_HOME: input.dshHome },
	};
}
