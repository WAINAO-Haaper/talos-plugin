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

type ProbeEnvironment = Partial<Pick<NodeJS.ProcessEnv, "PATH" | "HOME" | "TMPDIR" | "LANG">>;

export class NodeRuntimeProbeHost implements RuntimeProbeHost {
	constructor(private readonly environment: ProbeEnvironment = process.env) {}

	private searchDirectories(): string[] {
		const directories = (this.environment.PATH ?? "").split(path.delimiter).filter(Boolean);
		const home = this.environment.HOME?.trim();
		if (home) {
			directories.push(
				path.join(home, ".local", "bin"),
				path.join(home, ".bun", "bin"),
			);
		}
		directories.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
		return [...new Set(directories)];
	}

	private childEnvironment(executablePath: string): NodeJS.ProcessEnv {
		const runtimePath = [
			path.dirname(executablePath),
			...this.searchDirectories(),
		].filter(Boolean).join(path.delimiter);
		return {
			PATH: runtimePath,
			...(this.environment.HOME ? { HOME: this.environment.HOME } : {}),
			...(this.environment.TMPDIR ? { TMPDIR: this.environment.TMPDIR } : {}),
			...(this.environment.LANG ? { LANG: this.environment.LANG } : {}),
		};
	}

	async resolve(candidates: string[]): Promise<string | null> {
		const directories = this.searchDirectories();
		for (const candidate of candidates) {
			if (path.isAbsolute(candidate) && await executable(candidate)) return candidate;
			if (!path.isAbsolute(candidate)) {
				for (const directory of directories) {
					const resolved = path.join(directory, candidate);
					if (await executable(resolved)) return resolved;
				}
			}
		}
		return null;
	}

	run(executablePath: string, args: string[], timeoutMs: number): Promise<ProbeCommandResult> {
		return new Promise((resolve, reject) => {
			const child = spawn(executablePath, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: this.childEnvironment(executablePath) });
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
