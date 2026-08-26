import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";

export interface SandboxLaunchSpec {
	executable: string;
	args: string[];
	cwd: string;
	environment?: Record<string, string>;
	readOnlyRoots?: string[];
	readWriteRoots?: string[];
	loopbackProxyPort?: number;
}

export interface SandboxProbeHost { available(executable: string): Promise<boolean>; }

export class NodeSandboxProbeHost implements SandboxProbeHost {
	async available(executable: string): Promise<boolean> { try { await access(executable, constants.X_OK); return true; } catch { return false; } }
}

export class ProcessSandbox {
	constructor(private readonly probe: SandboxProbeHost, private readonly platform = process.platform) {}

	async prepare(runtime: SandboxLaunchSpec, vaultRoot: string): Promise<SandboxLaunchSpec> {
		if (this.platform !== "darwin" || !(await this.probe.available("/usr/bin/sandbox-exec"))) {
			throw new Error("OS sandbox 不可用，Execute 已失败关闭");
		}
		if (!vaultRoot || !runtime.executable) throw new Error("sandbox 边界参数不完整");
		const quote = (value: string) => value.replace(/[\\"]/g, "\\$&");
		const requestedWriteRoots = [vaultRoot, ...(runtime.readWriteRoots ?? [])];
		const requestedReadRoots = [vaultRoot, ...requestedWriteRoots, "/System", "/usr", "/bin", "/sbin", "/dev", "/private/etc", "/Library/Apple", ...(runtime.readOnlyRoots ?? [])];
		if ([...requestedReadRoots, ...requestedWriteRoots].some((root) => !root.startsWith("/"))) throw new Error("sandbox 根目录必须是绝对路径");
		const writeRoots = await Promise.all(requestedWriteRoots.map((root) => realpath(root)));
		const readRoots = await Promise.all(requestedReadRoots.map((root) => realpath(root)));
		const canonicalVaultRoot = await realpath(vaultRoot);
		const clauses = (operation: string, roots: string[]) => roots.flatMap((root) => [`(${operation} (literal "${quote(root)}"))`, `(${operation} (subpath "${quote(root)}"))`]).join(" ");
		const ancestors = (root: string) => root.split("/").filter(Boolean).slice(0, -1).map((_part, index, parts) => `/${parts.slice(0, index + 1).join("/")}`);
		const metadata = [...new Set([...readRoots, ...writeRoots].flatMap(ancestors).concat(["/etc", "/var"]))].map((root) => `(allow file-read-metadata (literal "${quote(root)}"))`).join(" ");
		const proxyPort = runtime.loopbackProxyPort;
		if (proxyPort !== undefined && (!Number.isSafeInteger(proxyPort) || proxyPort < 1 || proxyPort > 65_535)) {
			throw new Error("sandbox loopback proxy 端口无效");
		}
		const network = proxyPort === undefined
			? ""
			: "(allow network-outbound (remote tcp \"localhost:" + proxyPort + "\"))";
		const platformServices = '(allow ipc-posix-shm-read-data (ipc-posix-name "apple.shm.notification_center")) (allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.notification_center") (global-name "com.apple.logd"))';
		const profile = "(version 1) (deny default) (allow process*) (allow sysctl-read) (allow file-read* (literal \"/\")) " + platformServices + " " + metadata + " " + clauses("allow file-read*", readRoots) + " " + clauses("allow file-write*", writeRoots) + " " + network;
		return {
			executable: "/usr/bin/sandbox-exec",
			args: ["-p", profile, runtime.executable, ...runtime.args],
			cwd: canonicalVaultRoot,
			environment: runtime.environment,
		};
	}
}
