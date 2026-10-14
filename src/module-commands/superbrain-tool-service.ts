import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { safeSuperbrainPath, type SuperbrainToolId } from "./superbrain-catalog";

export interface SuperbrainJsonRunner {
	run(script: "vault.py" | "workflow.py" | "scheduled.py", args: readonly string[], options?: { stdin?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
}

/** Node runs the two kit scripts by fixed name and argv, with no shell or imported code. */
export class LocalSuperbrainRunner implements SuperbrainJsonRunner {
	constructor(private readonly vaultRoot: string) {}

	private async scriptPath(script: "vault.py" | "workflow.py" | "scheduled.py"): Promise<string> {
		const root = await realpath(this.vaultRoot);
		let current = root;
		for (const part of ["System", "tools", script]) {
			current = join(current, part);
			if ((await lstat(current)).isSymbolicLink()) throw new Error("本地工具路径含符号链接");
		}
		const exact = await realpath(current);
		if (!exact.startsWith(`${root}${sep}`)) throw new Error("本地工具不属于当前资料库");
		let manifest: unknown;
		try { manifest = JSON.parse(await readFile(join(root, "System", ".install-manifest.json"), "utf8")); }
		catch { throw new Error("本地工具缺少安装完整性记录，请先安装登记的候选包"); }
		const expected = (manifest as { system_files?: Record<string, unknown> }).system_files?.[`System/tools/${script}`];
		if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) throw new Error("本地工具未列入安装记录");
		const actual = createHash("sha256").update(await readFile(exact)).digest("hex");
		if (actual !== expected) throw new Error("本地工具与安装记录不一致，请复核安装包");
		return exact;
	}

	async run(script: "vault.py" | "workflow.py" | "scheduled.py", args: readonly string[], options: { stdin?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
		const path = await this.scriptPath(script);
		const root = await realpath(this.vaultRoot);
		if (options.signal?.aborted) throw new Error("已取消");
		const timeoutMs = options.timeoutMs ?? 120_000;
		if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 7_300_000) throw new Error("超时设置无效");
		return await new Promise((done, reject) => {
			const child = spawn("python3", ["-B", path, "--root", root, ...args, ...(script === "scheduled.py" ? [] : ["--json"])], {
				cwd: root, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
			});
			let stdout = "";
			let stderr = "";
			let finished = false;
			const fail = (reason: string) => { if (!finished) { finished = true; cleanup(); reject(new Error(reason)); } };
			const cleanup = () => { window.clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
			const abort = () => { child.kill("SIGTERM"); fail("已取消本地工具运行"); };
			const timer = window.setTimeout(() => { child.kill("SIGTERM"); fail("本地工具运行超时"); }, timeoutMs);
			options.signal?.addEventListener("abort", abort, { once: true });
			child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => { stdout += chunk; if (stdout.length > 8_000_000) { child.kill("SIGTERM"); fail("本地工具输出超过上限"); } });
			child.stderr.on("data", (chunk: string) => { stderr += chunk; if (stderr.length > 80_000) { child.kill("SIGTERM"); fail("本地工具错误输出超过上限"); } });
			child.on("error", () => fail("Python 运行环境不可用"));
			child.on("close", code => {
				if (finished) return;
				finished = true; cleanup();
				let parsed: unknown;
				try { parsed = JSON.parse(stdout); } catch { reject(new Error("本地工具未返回有效结果")); return; }
				if (Array.isArray(parsed)) { done({ items: parsed, process_exit_code: code }); return; }
				if (!parsed || typeof parsed !== "object") { reject(new Error("本地工具结果格式无效")); return; }
				done({ ...parsed as Record<string, unknown>, process_exit_code: code });
			});
			child.stdin.on("error", () => undefined);
			child.stdin.end(options.stdin ?? "");
		});
	}
}

export interface SuperbrainToolInput { query?: string; source?: string; destination?: string; archive?: string; snapshotOperation?: "create" | "verify" | "restore" }
export interface SuperbrainToolPlan { readonly tool: SuperbrainToolId; readonly preview: unknown; readonly writes: boolean }
interface PreparedTool { tool: SuperbrainToolId; runArgs: string[]; writes: boolean }

/** Every write is preceded by the matching kit preview. Run uses the captured argv. */
export class SuperbrainToolService {
	private readonly prepared = new WeakMap<SuperbrainToolPlan, PreparedTool>();
	constructor(private readonly runner: SuperbrainJsonRunner, private readonly vaultRoot?: string) {}

	private args(tool: SuperbrainToolId, input: SuperbrainToolInput): { preview: string[]; run: string[]; writes: boolean } {
		switch (tool) {
			case "inventory": return { preview: ["inventory"], run: ["inventory"], writes: false };
			case "health": return { preview: ["check"], run: ["check"], writes: false };
			case "selftest": return { preview: ["selftest"], run: ["selftest"], writes: false };
			case "search": {
				const query = input.query?.trim();
				if (!query || query.length > 500) throw new Error("请输入不超过 500 字的检索内容");
				return { preview: ["index", "query", query], run: ["index", "query", query], writes: false };
			}
			case "members": return { preview: ["members"], run: ["members", "--write"], writes: true };
			case "index": return { preview: ["index", "build", "--check"], run: ["index", "build"], writes: true };
			case "snapshot": {
				const operation = input.snapshotOperation ?? "create";
				if (operation === "create") return { preview: ["snapshot", "check"], run: ["snapshot", "create"], writes: true };
				const archive = input.archive?.trim();
				if (!archive || !isAbsolute(archive) || archive.length > 1000) throw new Error("请选择快照 ZIP 的绝对路径");
				if (operation === "verify") return { preview: ["snapshot", "verify", archive], run: ["snapshot", "verify", archive], writes: false };
				if (operation !== "restore") throw new Error("未知快照操作");
				const target = input.destination?.trim();
				if (!target || !isAbsolute(target) || target.length > 1000) throw new Error("请选择尚不存在的库外恢复目录");
				if (this.vaultRoot) {
					const subpath = relative(resolve(this.vaultRoot), resolve(target));
					if (!subpath || (!subpath.startsWith(`..${sep}`) && subpath !== ".." && !isAbsolute(subpath))) throw new Error("恢复目标必须在当前资料库之外");
				}
				return { preview: ["snapshot", "restore", archive, target, "--check"], run: ["snapshot", "restore", archive, target], writes: true };
			}
			case "export": {
				const source = safeSuperbrainPath(input.source);
				const destination = input.destination?.trim();
				if (!destination || !isAbsolute(destination) || destination.length > 1000) throw new Error("请选择库外的新导出目录");
				return { preview: ["export-okf", "--src", source, "--out", destination], run: ["export-okf", "--src", source, "--out", destination, "--write"], writes: true };
			}
		}
	}

	async preview(tool: SuperbrainToolId, input: SuperbrainToolInput = {}, signal?: AbortSignal): Promise<SuperbrainToolPlan> {
		const args = this.args(tool, input);
		const preview = await this.runner.run("vault.py", args.preview, { signal });
		const failed = Boolean(preview && typeof preview === "object" && (preview as Record<string, unknown>).process_exit_code !== undefined && (preview as Record<string, unknown>).process_exit_code !== 0);
		const plan: SuperbrainToolPlan = Object.freeze({ tool, preview, writes: args.writes && !failed });
		if (!failed) this.prepared.set(plan, { tool, runArgs: args.run, writes: args.writes });
		return plan;
	}

	async run(plan: SuperbrainToolPlan, signal?: AbortSignal): Promise<unknown> {
		const stored = this.prepared.get(plan);
		if (!stored || stored.tool !== plan.tool) throw new Error("请重新预览本地工具");
		this.prepared.delete(plan);
		if (!stored.writes) return plan.preview;
		return await this.runner.run("vault.py", stored.runArgs, { signal });
	}
}

export const SUPERBRAIN_SCHEDULE_JOBS = ["morning", "full-cycle", "weekly-reset", "heartbeat"] as const;
export type SuperbrainScheduleJob = typeof SUPERBRAIN_SCHEDULE_JOBS[number];
export interface SuperbrainSchedulePlan { readonly job: SuperbrainScheduleJob; readonly preview: unknown; readonly enabled: boolean }

/** Optional M07 jobs are configured in Markdown-adjacent jobs.json and remain disabled by default. */
export class SuperbrainScheduleService {
	private readonly prepared = new WeakSet<SuperbrainSchedulePlan>();
	constructor(private readonly runner: SuperbrainJsonRunner) {}

	async preview(job: SuperbrainScheduleJob, signal?: AbortSignal): Promise<SuperbrainSchedulePlan> {
		if (!SUPERBRAIN_SCHEDULE_JOBS.includes(job)) throw new Error("未登记的定时任务");
		const preview = await this.runner.run("scheduled.py", [job], { signal });
		const enabled = Boolean(preview && typeof preview === "object" && (preview as Record<string, unknown>).status === "eligible");
		const plan = Object.freeze({ job, preview, enabled });
		if (enabled) this.prepared.add(plan);
		return plan;
	}

	async run(plan: SuperbrainSchedulePlan, signal?: AbortSignal): Promise<unknown> {
		if (!this.prepared.has(plan) || !plan.enabled) throw new Error("请重新预览已启用的定时任务");
		this.prepared.delete(plan);
		return await this.runner.run("scheduled.py", [plan.job, "--run"], { signal, timeoutMs: 7_300_000 });
	}
}
