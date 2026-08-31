import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from "node:timers";
import type { RuntimeId } from "../contracts/runtime-adapter";
import type { ProbeCommandResult, ProtocolHandshake, RuntimeProbeHost } from "./runtime-discovery-service";

async function executable(candidate: string): Promise<boolean> {
	try { await access(candidate, constants.X_OK); return true; } catch { return false; }
}

export type ProbeEnvironment = Partial<Pick<
	NodeJS.ProcessEnv,
	"PATH" | "HOME" | "TMPDIR" | "LANG" | "PATHEXT" | "ComSpec" | "SystemRoot" | "WINDIR" | "APPDATA" | "LOCALAPPDATA" | "USERPROFILE"
>>;

const WINDOWS_RUNTIME_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

export function runtimeCandidateNames(
	candidate: string,
	platform: NodeJS.Platform,
	pathext = "",
): string[] {
	if (platform !== "win32" || path.win32.extname(candidate)) return [candidate];
	const extensions = (pathext || WINDOWS_RUNTIME_EXTENSIONS.join(";"))
		.split(";")
		.map((extension) => extension.trim().toLowerCase())
		.filter(Boolean)
		.map((extension) => extension.startsWith(".") ? extension : `.${extension}`);
	return [candidate, ...extensions.map((extension) => `${candidate}${extension}`)];
}

export function runtimeProbeUsesShell(
	executablePath: string,
	platform: NodeJS.Platform,
): boolean {
	return platform === "win32" && /\.(?:cmd|bat)$/i.test(executablePath);
}

export function safeWindowsCommandShimPath(executablePath: string): boolean {
	return !/[\r\n"&|<>^%!()]/.test(executablePath);
}

export function desktopRuntimeSearchDirectories(
	environment: ProbeEnvironment = process.env,
	platform: NodeJS.Platform = process.platform,
): string[] {
	const directories = (environment.PATH ?? "").split(path.delimiter).filter(Boolean);
	const home = (environment.HOME ?? environment.USERPROFILE)?.trim();
	if (home) {
		directories.push(
			path.join(home, ".local", "bin"),
			path.join(home, ".bun", "bin"),
		);
	}
	if (platform === "win32") {
		if (environment.APPDATA) directories.push(path.join(environment.APPDATA, "npm"));
	} else {
		directories.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
	}
	return [...new Set(directories)];
}

export function desktopRuntimePath(
	executablePath: string,
	environment: ProbeEnvironment = process.env,
	platform: NodeJS.Platform = process.platform,
): string {
	return [...new Set([path.dirname(executablePath), ...desktopRuntimeSearchDirectories(environment, platform)])]
		.filter(Boolean)
		.join(path.delimiter);
}

export class NodeRuntimeProbeHost implements RuntimeProbeHost {
	constructor(
		private readonly environment: ProbeEnvironment = process.env,
		private readonly platform: NodeJS.Platform = process.platform,
	) {}

	private searchDirectories(): string[] {
		return desktopRuntimeSearchDirectories(this.environment, this.platform);
	}

	private childEnvironment(executablePath: string): NodeJS.ProcessEnv {
		const copied = ["HOME", "TMPDIR", "LANG", "PATHEXT", "ComSpec", "SystemRoot", "WINDIR", "APPDATA", "LOCALAPPDATA", "USERPROFILE"] as const;
		const environment: NodeJS.ProcessEnv = {
			PATH: desktopRuntimePath(executablePath, this.environment, this.platform),
		};
		for (const key of copied) {
			const value = this.environment[key];
			if (value) environment[key] = value;
		}
		return environment;
	}

	async resolve(candidates: string[]): Promise<string | null> {
		const directories = this.searchDirectories();
		for (const candidate of candidates) {
			for (const expanded of runtimeCandidateNames(candidate, this.platform, this.environment.PATHEXT)) {
				if (path.isAbsolute(expanded) && await executable(expanded)) return expanded;
				if (!path.isAbsolute(expanded)) {
					for (const directory of directories) {
						const resolved = path.join(directory, expanded);
						if (await executable(resolved)) return resolved;
					}
				}
			}
		}
		return null;
	}

	run(executablePath: string, args: string[], timeoutMs: number): Promise<ProbeCommandResult> {
		const shell = runtimeProbeUsesShell(executablePath, this.platform);
		if (shell && !safeWindowsCommandShimPath(executablePath)) {
			return Promise.reject(new Error("Windows runtime command shim 路径包含不安全 shell 元字符"));
		}
		return new Promise((resolve, reject) => {
			const child = spawn(executablePath, args, {
				shell,
				stdio: ["ignore", "pipe", "pipe"],
				env: this.childEnvironment(executablePath),
				windowsHide: true,
			});
			let stdout = ""; let stderr = ""; let settled = false;
			const timer = scheduleTimeout(() => { if (!settled) { child.kill("SIGTERM"); reject(new Error("运行时探测超时")); } }, timeoutMs);
			child.stdout.on("data", (chunk) => { stdout += String(chunk); });
			child.stderr.on("data", (chunk) => { stderr += String(chunk); });
			child.once("error", (error) => { settled = true; cancelTimeout(timer); reject(error); });
			child.once("close", (code) => { settled = true; cancelTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr }); });
		});
	}

	async handshake(runtimeId: RuntimeId, executablePath: string, timeoutMs: number): Promise<ProtocolHandshake> {
		const args = runtimeId === "codex" ? ["app-server", "--help"] : runtimeId === "ohmypi" ? ["--mode", "rpc", "--help"] : ["--help"];
		const result = await this.run(executablePath, args, timeoutMs);
		if (result.exitCode !== 0) return "degraded";
		return "ready";
	}
}
