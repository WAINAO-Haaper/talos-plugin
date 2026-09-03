/**
 * D-TLP-014：DeepSeek Harness 进程管理（Obsidian 桌面端 Node 能力）。
 * 只信任带产品、版本、实例 nonce 与工作区身份的专用 loopback 健康接口。
 */

import {
	spawn,
	spawnSync,
	type ChildProcess,
} from "child_process";
import { createHash, randomUUID } from "crypto";
import {
	accessSync,
	chmodSync,
	constants as fsConstants,
	existsSync,
	mkdirSync,
	realpathSync,
} from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

import {
	assertDshHealthIdentity,
	DshLoopbackGateway,
	DSH_HEALTH_PRODUCT,
	DSH_HEALTH_PROTOCOL_VERSION,
	probeDshHealth,
	type DshGateway,
	type DshHealthIdentity,
	type DshHealthProbe,
} from "./dsh-gateway";
import {
	buildDshLaunchPlan,
	dshBaseUrl,
	dshHomeRoot,
	DSH_HOST,
	type DshLaunchPlan,
} from "./dsh-runtime";

export type DshRuntimeState = "stopped" | "starting" | "ready" | "error";

export interface DshProcessManagerOptions {
	getConfiguredExecutable(): string;
	getPort(): number;
	getVaultRoot(): string | null;
	readyTimeoutMs?: number;
	pollIntervalMs?: number;
	stopTimeoutMs?: number;
	runtime?: Partial<DshProcessRuntime>;
}

export interface DshGatewayInput {
	publicPort: number;
	backendPort: number;
	identity: Omit<DshHealthIdentity, "ready">;
}

export interface DshProcessRuntime {
	spawnProcess(plan: DshLaunchPlan, env: Record<string, string>): ChildProcess;
	probeHealth(baseUrl: string): Promise<DshHealthProbe>;
	probeBackend(baseUrl: string): Promise<boolean>;
	allocateBackendPort(): Promise<number>;
	createGateway(input: DshGatewayInput): DshGateway;
	resolveVersion(executable: string): string;
	createNonce(): string;
	workspaceIdentity(vaultRoot: string): string;
	prepareLaunchPlan(input: {
		executable: string;
		port: number;
		vaultRoot: string;
	}): DshLaunchPlan;
	wait(milliseconds: number): Promise<void>;
	now(): number;
}

type StateListener = (state: DshRuntimeState, error: string) => void;

// 官方 dsh rc.8 的 process-shutdown 合同最多保留 5 秒完成 dispose。
const DSH_UPSTREAM_SHUTDOWN_TIMEOUT_MS = 5000;
const DSH_SUPERVISOR_SHUTDOWN_GRACE_MS =
	DSH_UPSTREAM_SHUTDOWN_TIMEOUT_MS + 500;
const DSH_MANAGER_STOP_TIMEOUT_MS =
	DSH_SUPERVISOR_SHUTDOWN_GRACE_MS + 1000;

const INHERITED_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
	"TEMP",
	"TMP",
	"TMPDIR",
	"SystemRoot",
	"WINDIR",
	"ComSpec",
	"PATHEXT",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
] as const;

type ExecutableProbe = (candidate: string) => boolean;

function canExecute(candidate: string): boolean {
	try {
		accessSync(candidate, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Finder/LaunchServices 启动的 Obsidian 通常没有包管理器的 PATH，而官方 dsh
 * 入口使用 `#!/usr/bin/env node`。只探测已有 PATH 与固定的本机 Node 安装目录，
 * 不加载交互 shell 配置，也不继承额外环境变量。
 */
export function resolveNodeBinDirectory(
	inherited: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	isExecutable: ExecutableProbe = canExecute
): string | null {
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	const separator = platform === "win32" ? ";" : ":";
	const candidates = (inherited.PATH ?? inherited.Path ?? "")
		.split(separator)
		.filter(Boolean);

	if (platform === "darwin") {
		candidates.push("/opt/homebrew/bin", "/usr/local/bin");
	} else if (platform === "win32") {
		const programFiles = inherited.ProgramFiles?.trim();
		const localAppData = inherited.LOCALAPPDATA?.trim();
		if (programFiles) candidates.push(path.win32.join(programFiles, "nodejs"));
		if (localAppData) {
			candidates.push(path.win32.join(localAppData, "Programs", "nodejs"));
		}
	} else {
		candidates.push("/usr/local/bin", "/usr/bin");
	}

	const binaryName = platform === "win32" ? "node.exe" : "node";
	const seen = new Set<string>();
	for (const rawDirectory of candidates) {
		const directory = rawDirectory.trim();
		if (!directory || seen.has(directory)) continue;
		seen.add(directory);
		if (isExecutable(pathApi.join(directory, binaryName))) return directory;
	}
	return null;
}

export function buildDshChildEnvironment(
	planEnvironment: Record<string, string>,
	inherited: NodeJS.ProcessEnv = process.env,
	nodeBinDirectory: string | null = resolveNodeBinDirectory(inherited),
	platform: NodeJS.Platform = process.platform
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const key of INHERITED_ENV_ALLOWLIST) {
		const value = inherited[key];
		if (typeof value === "string" && value) result[key] = value;
	}
	if (nodeBinDirectory) {
		const separator = platform === "win32" ? ";" : ":";
		const entries = (result.PATH ?? "").split(separator).filter(Boolean);
		if (!entries.includes(nodeBinDirectory)) {
			result.PATH = [nodeBinDirectory, ...entries].join(separator);
		}
	}
	if (planEnvironment.DSH_HOME) {
		result.DSH_HOME = planEnvironment.DSH_HOME;
	}
	return result;
}

export function resolveNodeExecutable(
	inherited: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	isExecutable: ExecutableProbe = canExecute
): string {
	const directory = resolveNodeBinDirectory(
		inherited,
		platform,
		isExecutable
	);
	if (!directory) {
		throw new Error("无法启动 dsh：未找到可执行的 Node.js 运行时");
	}
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	return pathApi.join(
		directory,
		platform === "win32" ? "node.exe" : "node"
	);
}

/**
 * Electron 渲染进程退出时不保证 Obsidian 会等待插件的异步 onunload。
 * 由一个只持有 dsh 的轻量 Node 监护进程观察宿主 PID；宿主消失、插件显式
 * stop，或 dsh 自行退出时，监护进程都会收敛，不把随机端口服务留给 PID 1。
 */
export const DSH_PARENT_SUPERVISOR_SOURCE = String.raw`
"use strict";
const { spawn } = require("node:child_process");
const [hostPidRaw, pollIntervalRaw, shutdownGraceRaw, executable, ...args] =
	process.argv.slice(1);
const hostPid = Number(hostPidRaw);
const pollIntervalMs = Number(pollIntervalRaw);
const shutdownGraceMs = Number(shutdownGraceRaw);
if (
	!Number.isInteger(hostPid) ||
	hostPid <= 0 ||
	!Number.isFinite(pollIntervalMs) ||
	pollIntervalMs < 10 ||
	!Number.isFinite(shutdownGraceMs) ||
	shutdownGraceMs < 10 ||
	!executable
) {
	console.error("Invalid TALOS dsh supervisor arguments");
	process.exit(64);
}
const child = spawn(executable, args, {
	cwd: process.cwd(),
	env: process.env,
	stdio: ["ignore", "inherit", "inherit"],
	// Windows 上 npm 装出来的 dsh 是 .cmd 包装脚本，spawn 必须走 shell；
	// macOS / Linux 上 dsh 是带 shebang 的可执行文件，shell=false 即可。
	shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable),
});
let stopping = false;
let forceTimer = null;
let hostTimer = null;
const clearTimers = () => {
	if (hostTimer) clearInterval(hostTimer);
	if (forceTimer) clearTimeout(forceTimer);
	hostTimer = null;
	forceTimer = null;
};
const requestStop = () => {
	if (stopping) return;
	stopping = true;
	if (hostTimer) clearInterval(hostTimer);
	hostTimer = null;
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	forceTimer = setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
		}
	}, shutdownGraceMs);
};
const hostIsAlive = () => {
	if (process.ppid === 1) return false;
	try {
		process.kill(hostPid, 0);
		return true;
	} catch (error) {
		return error && error.code === "EPERM";
	}
};
child.once("error", (error) => {
	clearTimers();
	console.error("TALOS dsh supervisor spawn failed:", error.message);
	process.exit(1);
});
child.once("exit", (code, signal) => {
	clearTimers();
	process.exit(code ?? (signal === "SIGTERM" ? 0 : 1));
});
process.once("SIGTERM", requestStop);
process.once("SIGINT", requestStop);
hostTimer = setInterval(() => {
	if (!hostIsAlive()) requestStop();
}, pollIntervalMs);
`;

export interface DshSupervisorOptions {
	hostPid?: number;
	nodeExecutable?: string;
	pollIntervalMs?: number;
	shutdownGraceMs?: number;
}

export function spawnDshWithParentSupervisor(
	plan: DshLaunchPlan,
	env: Record<string, string>,
	options: DshSupervisorOptions = {}
): ChildProcess {
	const nodeExecutable =
		options.nodeExecutable ?? resolveNodeExecutable(env);
	return spawn(
		nodeExecutable,
		[
			"-e",
			DSH_PARENT_SUPERVISOR_SOURCE,
			"--",
			String(options.hostPid ?? process.pid),
			String(options.pollIntervalMs ?? 250),
			String(
				options.shutdownGraceMs ??
					DSH_SUPERVISOR_SHUTDOWN_GRACE_MS
			),
			plan.executable,
			...plan.args,
		],
		{
			cwd: plan.cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		}
	);
}

export function hasDshProductIdentity(output: string): boolean {
	return (
		/\bdsh\b/i.test(output) &&
		/\bdeepseek(?:\s+|-)harness\b/i.test(output)
	);
}

export function parseDshVersion(output: string): string | null {
	const normalized = output.trim();
	const exact = normalized.match(
		/^v?(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?)$/i
	);
	if (exact) return exact[1];
	if (!/\b(?:dsh|deepseek(?:\s+|-)?harness)\b/i.test(normalized)) return null;
	return normalized.match(
		/\bv?(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?)\b/i
	)?.[1] ?? null;
}

function probeDshOnPath(): string | null {
	try {
		const result =
			process.platform === "win32"
				? spawnSync("where", ["dsh"], { encoding: "utf8" })
				: spawnSync("sh", ["-c", "command -v dsh"], { encoding: "utf8" });
		if (result.status !== 0) return null;
		const first = (result.stdout ?? "").split(/\r?\n/)[0]?.trim() ?? "";
		return first || null;
	} catch {
		return null;
	}
}

/**
 * Windows 上 npm 装出来的 dsh 是 .cmd 包装脚本（不是真正的 .exe），
 * Node 的 spawn / spawnSync 直接调用 .cmd / .bat 会抛 EINVAL，
 * 必须显式走 shell；macOS / Linux 上 dsh 是带 shebang 的可执行文件。
 */
function needsShellOnWindows(executable: string): boolean {
	return (
		process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)
	);
}

function defaultResolveVersion(executable: string): string {
	const environment = buildDshChildEnvironment({});
	// Windows 上 npm 装出来的 dsh 是 .cmd 包装脚本（不是真正的 .exe），
	// Node 的 spawn / spawnSync 直接调用 .cmd / .bat 会抛 EINVAL，
	// 必须显式走 shell；macOS / Linux 上 dsh 是带 shebang 的可执行文件。
	const shell = needsShellOnWindows(executable);
	const versionResult = spawnSync(executable, ["--version"], {
		encoding: "utf8",
		env: environment,
		shell,
		timeout: 5000,
	});
	if (versionResult.status !== 0) {
		const diagnostic =
			`${versionResult.stdout ?? ""}\n${versionResult.stderr ?? ""}`;
		if (/env:.*node:.*(?:no such file|not found)/i.test(diagnostic)) {
			throw new Error("无法验证 dsh 产品版本：未找到 Node.js 运行时");
		}
		throw new Error("无法验证 dsh 产品版本");
	}
	const version = parseDshVersion(
		`${versionResult.stdout ?? ""}\n${versionResult.stderr ?? ""}`
	);
	if (!version) throw new Error("dsh --version 未返回有效语义版本");
	const helpResult = spawnSync(executable, ["--help"], {
		encoding: "utf8",
		env: environment,
		shell,
		timeout: 5000,
	});
	const helpOutput =
		`${helpResult.stdout ?? ""}\n${helpResult.stderr ?? ""}`;
	if (helpResult.status !== 0 || !hasDshProductIdentity(helpOutput)) {
		throw new Error("dsh --help 未返回可验证的 DeepSeek Harness 产品身份");
	}
	return version;
}

function defaultWorkspaceIdentity(vaultRoot: string): string {
	const canonical = realpathSync(vaultRoot);
	return createHash("sha256").update(canonical).digest("hex");
}

function defaultPrepareLaunchPlan(input: {
	executable: string;
	port: number;
	vaultRoot: string;
}): DshLaunchPlan {
	const home = dshHomeRoot(os.homedir());
	mkdirSync(home, { recursive: true, mode: 0o700 });
	try {
		chmodSync(home, 0o700);
	} catch {
		/* Windows 无 POSIX 权限位，忽略 */
	}
	return buildDshLaunchPlan({
		executable: input.executable,
		port: input.port,
		dshHome: home,
		vaultRoot: input.vaultRoot,
	});
}

function probeBackend(baseUrl: string): Promise<boolean> {
	return new Promise((resolve) => {
		const request = http.get(baseUrl, (response) => {
			response.resume();
			const status = response.statusCode ?? 500;
			resolve(status >= 200 && status < 400);
		});
		request.on("error", () => resolve(false));
		request.setTimeout(1500, () => {
			request.destroy();
			resolve(false);
		});
	});
}

function allocateBackendPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = http.createServer();
		server.once("error", reject);
		server.listen(0, DSH_HOST, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("无法分配 Harness 内部端口"));
				return;
			}
			const port = address.port;
			server.close((error) => {
				if (error) reject(error);
				else resolve(port);
			});
		});
	});
}

const DEFAULT_RUNTIME: DshProcessRuntime = {
	spawnProcess: (plan, env) =>
		spawnDshWithParentSupervisor(plan, env),
	probeHealth: (baseUrl) => probeDshHealth(baseUrl),
	probeBackend,
	allocateBackendPort,
	createGateway: (input) =>
		new DshLoopbackGateway(
			input.publicPort,
			input.backendPort,
			input.identity
		),
	resolveVersion: defaultResolveVersion,
	createNonce: () => randomUUID(),
	workspaceIdentity: defaultWorkspaceIdentity,
	prepareLaunchPlan: defaultPrepareLaunchPlan,
	wait: (milliseconds) =>
		new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
	now: () => Date.now(),
};

export class DshProcessManager {
	private child: ChildProcess | null = null;
	private gateway: DshGateway | null = null;
	private state: DshRuntimeState = "stopped";
	private lastError = "";
	private startPromise: Promise<void> | null = null;
	private lifecycleTail: Promise<void> = Promise.resolve();
	private generation = 0;
	private disposed = false;
	private readonly listeners = new Set<StateListener>();
	private readonly readyTimeoutMs: number;
	private readonly pollIntervalMs: number;
	private readonly stopTimeoutMs: number;
	private readonly runtime: DshProcessRuntime;

	constructor(private readonly options: DshProcessManagerOptions) {
		this.readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
		this.pollIntervalMs = options.pollIntervalMs ?? 400;
		this.stopTimeoutMs =
			options.stopTimeoutMs ?? DSH_MANAGER_STOP_TIMEOUT_MS;
		this.runtime = { ...DEFAULT_RUNTIME, ...options.runtime };
	}

	getState(): DshRuntimeState {
		return this.state;
	}

	getLastError(): string {
		return this.lastError;
	}

	getBaseUrl(): string {
		return dshBaseUrl(this.options.getPort());
	}

	onStateChange(listener: StateListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setState(state: DshRuntimeState, error = ""): void {
		this.state = state;
		this.lastError = error;
		for (const listener of this.listeners) listener(state, error);
	}

	private setStateFor(
		generation: number,
		state: DshRuntimeState,
		error = ""
	): void {
		if (generation === this.generation && !this.disposed) {
			this.setState(state, error);
		}
	}

	resolveExecutable(): string {
		const configured = this.options.getConfiguredExecutable().trim();
		if (configured) {
			if (!existsSync(configured)) {
				throw new Error(`设置的 dsh 路径不存在：${configured}`);
			}
			return configured;
		}
		const detected = probeDshOnPath();
		if (!detected) {
			throw new Error(
				"未找到 dsh CLI。请先安装 DeepSeek Harness，或在设置页填写 dsh 可执行路径。"
			);
		}
		return detected;
	}

	async ensureStarted(): Promise<void> {
		if (this.disposed) throw new Error("Harness 进程管理器已卸载");
		if (this.state === "ready") return;
		if (this.startPromise) return this.startPromise;
		const generation = ++this.generation;
		const task = this.enqueue(() => this.doStart(generation));
		this.startPromise = task;
		const clear = (): void => {
			if (this.startPromise === task) this.startPromise = null;
		};
		void task.then(clear, clear);
		return task;
	}

	async restart(): Promise<void> {
		if (this.disposed) throw new Error("Harness 进程管理器已卸载");
		const generation = ++this.generation;
		const task = this.enqueue(async () => {
			await this.stopManagedResources();
			if (generation === this.generation && !this.disposed) {
				await this.doStart(generation);
			}
		});
		this.startPromise = task;
		const clear = (): void => {
			if (this.startPromise === task) this.startPromise = null;
		};
		void task.then(clear, clear);
		return task;
	}

	async stop(): Promise<void> {
		const generation = ++this.generation;
		this.startPromise = null;
		return this.enqueue(async () => {
			await this.stopManagedResources();
			if (generation === this.generation && !this.disposed) {
				this.setState("stopped");
			}
		});
	}

	dispose(): Promise<void> {
		if (this.disposed) return this.lifecycleTail;
		this.disposed = true;
		++this.generation;
		this.startPromise = null;
		this.gateway?.setReady(false);
		void this.gateway?.close();
		if (this.child && this.child.exitCode === null) {
			this.child.kill("SIGTERM");
		}
		this.setState("stopped");
		return this.enqueue(() => this.stopManagedResources());
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const task = this.lifecycleTail.then(operation, operation);
		this.lifecycleTail = task.catch(() => {});
		return task;
	}

	private async doStart(generation: number): Promise<void> {
		if (generation !== this.generation || this.disposed) return;
		this.setStateFor(generation, "starting");
		let child: ChildProcess | null = null;
		let gateway: DshGateway | null = null;
		try {
			const vaultRoot = this.options.getVaultRoot();
			if (!vaultRoot) {
				throw new Error("当前 Vault 不是文件系统库，无法锁定 harness 工作区");
			}
			const workspaceId = this.runtime.workspaceIdentity(vaultRoot);
			const occupied = await this.runtime.probeHealth(this.getBaseUrl());
			if (generation !== this.generation || this.disposed) return;
			if (occupied.reachable) {
				if (
					occupied.identity &&
					occupied.identity.workspaceId !== workspaceId
				) {
					throw new Error("Harness 工作区身份不匹配，拒绝复用已占用端口");
				}
				throw new Error("Harness 端口已被未知或非本实例服务占用");
			}

			const executable = this.resolveExecutable();
			const harnessVersion = this.runtime.resolveVersion(executable);
			let backendPort = await this.runtime.allocateBackendPort();
			if (backendPort === this.options.getPort()) {
				backendPort = await this.runtime.allocateBackendPort();
			}
			const identity: Omit<DshHealthIdentity, "ready"> = {
				product: DSH_HEALTH_PRODUCT,
				protocolVersion: DSH_HEALTH_PROTOCOL_VERSION,
				harnessVersion,
				instanceNonce: this.runtime.createNonce(),
				workspaceId,
			};
			gateway = this.runtime.createGateway({
				publicPort: this.options.getPort(),
				backendPort,
				identity,
			});
			await gateway.start();
			if (generation !== this.generation || this.disposed) {
				await gateway.close();
				return;
			}
			this.gateway = gateway;

			const plan = this.runtime.prepareLaunchPlan({
				executable,
				port: backendPort,
				vaultRoot,
			});
			child = this.runtime.spawnProcess(
				plan,
				buildDshChildEnvironment(plan.env)
			);
			if (generation !== this.generation || this.disposed) {
				await this.terminateChild(child);
				await gateway.close();
				return;
			}
			this.child = child;
			let stderrTail = "";
			let exitError = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
			});
			const exitMessage = (code: number | null): string =>
				`dsh 进程退出（code ${code ?? "?"}）${
					stderrTail ? `：${stderrTail.slice(-300)}` : ""
				}`;
			child.once("exit", (code) => {
				exitError = exitMessage(code);
				if (
					generation !== this.generation ||
					this.child !== child ||
					this.disposed
				) {
					return;
				}
				this.child = null;
				gateway?.setReady(false);
				if (this.gateway === gateway) this.gateway = null;
				void gateway?.close();
				this.setState("error", exitError);
			});
			child.once("error", (error) => {
				exitError = `dsh 启动失败：${error.message}`;
				if (
					generation === this.generation &&
					this.child === child &&
					!this.disposed
				) {
					this.setState("error", exitError);
				}
			});

			await this.waitForBackendReady(
				generation,
				dshBaseUrl(backendPort),
				() => exitError
			);
			if (generation !== this.generation || this.disposed) {
				await this.cleanupOwned(child, gateway);
				return;
			}
			gateway.setReady(true);
			const verified = await this.runtime.probeHealth(this.getBaseUrl());
			assertDshHealthIdentity(verified, identity, true);
			this.setStateFor(generation, "ready");
		} catch (error) {
			if (child || gateway) await this.cleanupOwned(child, gateway);
			if (generation !== this.generation || this.disposed) return;
			const message = error instanceof Error ? error.message : String(error);
			this.setState("error", message);
			throw error;
		}
	}

	private async waitForBackendReady(
		generation: number,
		baseUrl: string,
		getExitError: () => string
	): Promise<void> {
		const deadline = this.runtime.now() + this.readyTimeoutMs;
		while (this.runtime.now() < deadline) {
			if (generation !== this.generation || this.disposed) return;
			const exitError = getExitError();
			if (exitError) throw new Error(exitError);
			if (await this.runtime.probeBackend(baseUrl)) return;
			await this.runtime.wait(this.pollIntervalMs);
		}
		throw new Error(
			`dsh web 在 ${Math.round(this.readyTimeoutMs / 1000)} 秒内未就绪`
		);
	}

	private async cleanupOwned(
		child: ChildProcess | null,
		gateway: DshGateway | null
	): Promise<void> {
		if (this.child === child) this.child = null;
		if (this.gateway === gateway) this.gateway = null;
		gateway?.setReady(false);
		await gateway?.close();
		if (child) await this.terminateChild(child);
	}

	private async stopManagedResources(): Promise<void> {
		const child = this.child;
		const gateway = this.gateway;
		this.child = null;
		this.gateway = null;
		gateway?.setReady(false);
		await gateway?.close();
		if (child) await this.terminateChild(child);
	}

	private async terminateChild(child: ChildProcess): Promise<void> {
		if (child.exitCode !== null || child.signalCode !== null) return;
		if (!child.killed) child.kill("SIGTERM");
		if (await this.waitForChildExit(child, this.stopTimeoutMs)) return;
		child.kill("SIGKILL");
		await this.waitForChildExit(child, this.stopTimeoutMs);
	}

	private waitForChildExit(
		child: ChildProcess,
		timeoutMs: number
	): Promise<boolean> {
		if (child.exitCode !== null || child.signalCode !== null) {
			return Promise.resolve(true);
		}
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value: boolean): void => {
				if (settled) return;
				settled = true;
				child.off("exit", onExit);
				window.clearTimeout(timer);
				resolve(value);
			};
			const onExit = (): void => finish(true);
			const timer = window.setTimeout(() => finish(false), timeoutMs);
			child.once("exit", onExit);
		});
	}
}
