import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";

export interface SandboxLaunchSpec {
	executable: string;
	args: string[];
	cwd: string;
	environment?: Record<string, string>;
	readOnlyRoots?: string[];
	readWriteRoots?: string[];
	loopbackProxyPort?: number;
	deniedVaultSubpaths?: string[];
	denyDotEnvFiles?: boolean;
}

export interface SandboxProbeHost { available(executable: string): Promise<boolean>; }

export type SandboxAvailability =
	| { available: true; backend: "macos-seatbelt"; platform: NodeJS.Platform }
	| {
		available: false;
		reason: "unsupported-platform" | "backend-missing";
		platform: NodeJS.Platform;
		message: string;
	};

export class NodeSandboxProbeHost implements SandboxProbeHost {
	async available(executable: string): Promise<boolean> { try { await access(executable, constants.X_OK); return true; } catch { return false; } }
}

export class ProcessSandbox {
	private availabilityPromise: Promise<SandboxAvailability> | null = null;

	constructor(
		private readonly probe: SandboxProbeHost,
		private readonly platform: NodeJS.Platform = process.platform,
	) {}

	availability(): Promise<SandboxAvailability> {
		this.availabilityPromise ??= this.inspectAvailability();
		return this.availabilityPromise;
	}

	private async inspectAvailability(): Promise<SandboxAvailability> {
		if (this.platform !== "darwin") {
			const message = this.platform === "win32"
				? "Windows 当前缺少可验证的 CLI 隔离，本机智能体 Execute 已失败关闭。请在“智能体与模型”中选择已配置的 API Provider。"
				: `${this.platform} 当前缺少可验证的 CLI 隔离，本机智能体 Execute 已失败关闭。`;
			return {
				available: false,
				reason: "unsupported-platform",
				platform: this.platform,
				message,
			};
		}
		if (!(await this.probe.available("/usr/bin/sandbox-exec"))) {
			return {
				available: false,
				reason: "backend-missing",
				platform: this.platform,
				message: "macOS Seatbelt sandbox 不可用，Execute 已失败关闭。请确认 /usr/bin/sandbox-exec 可执行。",
			};
		}
		return {
			available: true,
			backend: "macos-seatbelt",
			platform: this.platform,
		};
	}

	async assertAvailable(): Promise<void> {
		const availability = await this.availability();
		if (!availability.available) throw new Error(availability.message);
	}

	async prepare(runtime: SandboxLaunchSpec, vaultRoot: string): Promise<SandboxLaunchSpec> {
		await this.assertAvailable();
		if (!vaultRoot || !runtime.executable) throw new Error("sandbox 边界参数不完整");
		const quote = (value: string) => value.replace(/[\\"]/g, "\\$&");
		const requestedWriteRoots = [vaultRoot, ...(runtime.readWriteRoots ?? [])];
		const requestedReadRoots = [vaultRoot, ...requestedWriteRoots, "/System", "/usr", "/bin", "/sbin", "/dev", "/private/etc", "/Library/Apple", "/Library/Keychains", ...(runtime.readOnlyRoots ?? [])];
		if ([...requestedReadRoots, ...requestedWriteRoots].some((root) => !root.startsWith("/"))) throw new Error("sandbox 根目录必须是绝对路径");
		const writeRoots = await Promise.all(requestedWriteRoots.map((root) => realpath(root)));
		const readRoots = await Promise.all(requestedReadRoots.map((root) => realpath(root)));
		const canonicalVaultRoot = await realpath(vaultRoot);
		const protectedRoots: string[] = [];
		for (const requested of runtime.deniedVaultSubpaths ?? []) {
			const normalized = requested.trim().normalize("NFKC").replace(/\\/g, "/");
			if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
				throw new Error("sandbox 拒绝路径必须是 Vault 内相对路径");
			}
			const absolute = path.resolve(canonicalVaultRoot, normalized);
			if (!absolute.startsWith(canonicalVaultRoot + path.sep)) throw new Error("sandbox 拒绝路径越出 Vault");
			protectedRoots.push(absolute);
			try {
				const canonical = await realpath(absolute);
				if (!canonical.startsWith(canonicalVaultRoot + path.sep)) throw new Error("sandbox 拒绝路径解析到 Vault 外");
				protectedRoots.push(canonical);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
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
		const platformServices = '(allow ipc-posix-shm-read-data (ipc-posix-name "apple.shm.notification_center")) (allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.notification_center") (global-name "com.apple.logd") (global-name "com.apple.trustd.agent") (global-name "com.apple.trustd") (global-name "com.apple.SecurityServer"))';
		const protectedPaths = clauses("deny file-read* file-write*", [...new Set(protectedRoots)]);
		const regexQuote = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, '\\"');
		const dotEnvFiles = runtime.denyDotEnvFiles
			? `(deny file-read* file-write* (regex #"^${regexQuote(canonicalVaultRoot)}/(?:[^/]+/)*\\.env[^/]*(?:/|$)"))`
			: "";
		const profile = "(version 1) (deny default) (allow process*) (allow sysctl-read) (allow file-read* (literal \"/\")) " + platformServices + " " + metadata + " " + clauses("allow file-read*", readRoots) + " " + clauses("allow file-write*", writeRoots) + " " + network + " " + protectedPaths + " " + dotEnvFiles;
		return {
			executable: "/usr/bin/sandbox-exec",
			args: ["-p", profile, runtime.executable, ...runtime.args],
			cwd: canonicalVaultRoot,
			environment: runtime.environment,
		};
	}
}
