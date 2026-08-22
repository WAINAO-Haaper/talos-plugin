/**
 * D-TLP-014：DeepSeek Harness 进程管理（Obsidian 桌面端 Node 能力）。
 * 负责 dsh web 子进程的解析、启动、健康轮询、重启与随插件卸载终止。
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { chmodSync, existsSync, mkdirSync } from "fs";
import * as os from "os";
import * as http from "http";

import {
	buildDshLaunchPlan,
	dshBaseUrl,
	dshHomeRoot,
	type DshLaunchPlan,
} from "./dsh-runtime";

export type DshRuntimeState = "stopped" | "starting" | "ready" | "error";

export interface DshProcessManagerOptions {
	/** 设置页配置的可执行路径；留空时自动探测 PATH 中的 dsh。 */
	getConfiguredExecutable(): string;
	getPort(): number;
	/** 当前 vault 根路径（文件系统适配器）；不可得时必须返回 null。 */
	getVaultRoot(): string | null;
	readyTimeoutMs?: number;
	pollIntervalMs?: number;
}

type StateListener = (state: DshRuntimeState, error: string) => void;

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

export class DshProcessManager {
	private child: ChildProcess | null = null;
	private state: DshRuntimeState = "stopped";
	private lastError = "";
	private startPromise: Promise<void> | null = null;
	private readonly listeners = new Set<StateListener>();
	private readonly readyTimeoutMs: number;
	private readonly pollIntervalMs: number;

	constructor(private readonly options: DshProcessManagerOptions) {
		this.readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
		this.pollIntervalMs = options.pollIntervalMs ?? 400;
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
				"未找到 dsh CLI。请先安装 DeepSeek Harness（npm i -g @deepseek-ai/dsh），或在设置页填写 dsh 可执行路径。"
			);
		}
		return detected;
	}

	private buildLaunchPlan(): DshLaunchPlan {
		const vaultRoot = this.options.getVaultRoot();
		if (!vaultRoot) {
			throw new Error("当前 Vault 不是文件系统库，无法锁定 harness 工作区");
		}
		const home = dshHomeRoot(os.homedir());
		mkdirSync(home, { recursive: true, mode: 0o700 });
		try {
			chmodSync(home, 0o700);
		} catch {
			/* Windows 无 POSIX 权限位，忽略 */
		}
		return buildDshLaunchPlan({
			executable: this.resolveExecutable(),
			port: this.options.getPort(),
			dshHome: home,
			vaultRoot,
		});
	}

	/** 幂等启动：ready/starting 直接复用进行中的过程。 */
	async ensureStarted(): Promise<void> {
		if (this.state === "ready") return;
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.doStart().finally(() => {
			this.startPromise = null;
		});
		return this.startPromise;
	}

	private async doStart(): Promise<void> {
		if (await this.isServing()) {
			this.setState("ready");
			return;
		}
		this.setState("starting");
		let plan: DshLaunchPlan;
		try {
			plan = this.buildLaunchPlan();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setState("error", message);
			throw error;
		}

		const child = spawn(plan.executable, plan.args, {
			cwd: plan.cwd,
			env: { ...process.env, ...plan.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.child = child;
		let stderrTail = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
		});
		const exitMessage = (code: number | null): string =>
			`dsh 进程退出（code ${code ?? "?"}）${stderrTail ? `：${stderrTail.slice(-300)}` : ""}`;
		// 启动阶段快速失败：子进程退出即拒绝，不再空等就绪超时。
		const earlyExit = new Promise<never>((_, reject) => {
			child.once("exit", (code) => reject(new Error(exitMessage(code))));
		});
		earlyExit.catch(() => {});
		child.on("exit", (code) => {
			if (this.child === child) this.child = null;
			if (this.state === "ready" || this.state === "starting") {
				this.setState("error", exitMessage(code));
			}
		});
		child.on("error", (error) => {
			if (this.child === child) this.child = null;
			this.setState("error", `dsh 启动失败：${error.message}`);
		});

		try {
			await Promise.race([this.waitForReady(), earlyExit]);
			this.setState("ready");
		} catch (error) {
			await this.stop();
			const message = error instanceof Error ? error.message : String(error);
			this.setState("error", message);
			throw error;
		}
	}

	private isServing(): Promise<boolean> {
		return new Promise((resolve) => {
			const request = http.get(this.getBaseUrl(), (response) => {
				response.resume();
				resolve((response.statusCode ?? 500) < 500);
			});
			request.on("error", () => resolve(false));
			request.setTimeout(1500, () => {
				request.destroy();
				resolve(false);
			});
		});
	}

	private async waitForReady(): Promise<void> {
		const deadline = Date.now() + this.readyTimeoutMs;
		while (Date.now() < deadline) {
			if (await this.isServing()) return;
			await new Promise((resolve) =>
				window.setTimeout(resolve, this.pollIntervalMs)
			);
		}
		throw new Error(
			`dsh web 在 ${Math.round(this.readyTimeoutMs / 1000)} 秒内未就绪（${this.getBaseUrl()}）`
		);
	}

	async restart(): Promise<void> {
		await this.stop();
		await this.ensureStarted();
	}

	async stop(): Promise<void> {
		const child = this.child;
		this.child = null;
		if (child && !child.killed) {
			child.kill("SIGTERM");
		}
		if (this.state !== "error") this.setState("stopped");
	}
}
