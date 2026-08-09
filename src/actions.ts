import {
	App,
	FileSystemAdapter,
	Modal,
	Notice,
	Setting,
	TFile,
	TFolder,
	normalizePath,
} from "obsidian";
import {
	applyPendingApprovalDecision,
	type PendingApprovalDecision,
} from "./approval-actions";
import {
	applyCandidateDecision,
	type CandidateDecision,
} from "./candidate-actions";
import {
	applyApprovalExecutionRecord,
	buildMockModelAppend,
	parseApprovalExecutableSpec,
} from "./approval-executor";
import {
	createApprovalTaskRuntime,
	type ApprovalTaskRuntime,
} from "./approval-task-runtime";
import type { TalosSettings } from "./settings";
import { createWindowTimerHost } from "./task-core/task-runner";

const approvalTaskRuntimes = new WeakMap<App, ApprovalTaskRuntime>();

export function registerApprovalTaskRuntime(
	app: App,
	runtime: ApprovalTaskRuntime
): void {
	approvalTaskRuntimes.set(app, runtime);
}

export function unregisterApprovalTaskRuntime(app: App): void {
	approvalTaskRuntimes.delete(app);
}

export function getApprovalTaskRuntime(app: App): ApprovalTaskRuntime {
	const existing = approvalTaskRuntimes.get(app);
	if (existing) return existing;
	const runtime = createApprovalTaskRuntime(
		createWindowTimerHost(activeWindow)
	);
	approvalTaskRuntimes.set(app, runtime);
	return runtime;
}

function todayStr(): string {
	const d = new Date();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = normalizePath(folder);
	if (app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
	const parts = path.split("/");
	let cur = "";
	for (const part of parts) {
		cur = cur ? `${cur}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(cur)) {
			try {
				await app.vault.createFolder(cur);
			} catch {
				/* 已存在 */
			}
		}
	}
}

async function openPathInVault(app: App, path: string): Promise<void> {
	const f = app.vault.getAbstractFileByPath(normalizePath(path));
	if (f instanceof TFile) {
		await app.workspace.getLeaf(true).openFile(f);
	} else {
		new Notice(`未找到：${path}`);
	}
}

export async function openFile(app: App, path: string): Promise<void> {
	await openPathInVault(app, path);
}

export async function decidePendingApproval(
	app: App,
	settings: TalosSettings,
	title: string,
	decision: PendingApprovalDecision
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.pendingApprovalsPath)
	);
	if (!(file instanceof TFile)) {
		new Notice("未找到 pending-approvals.md");
		return false;
	}

	const raw = await app.vault.read(file);
	const result = applyPendingApprovalDecision(raw, {
		title,
		decision,
		date: todayStr(),
		operator: "TALOS",
	});
	if (!result.ok) {
		new Notice(result.message);
		return false;
	}

	await app.vault.modify(file, result.content);
	new Notice(result.message);
	return true;
}

export async function decidePreferenceCandidate(
	app: App,
	settings: TalosSettings,
	title: string,
	decision: CandidateDecision
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.candidatesPath)
	);
	if (!(file instanceof TFile)) {
		new Notice("未找到 candidates.md");
		return false;
	}

	const raw = await app.vault.read(file);
	const result = applyCandidateDecision(raw, {
		title,
		decision,
		date: todayStr(),
		operator: "TALOS",
	});
	if (!result.ok) {
		new Notice(result.message);
		return false;
	}

	await app.vault.modify(file, result.content);
	new Notice(result.message);
	return true;
}

export async function approveAndExecuteApprovalWithMockModel(
	app: App,
	settings: TalosSettings,
	title: string
): Promise<boolean> {
	const approvalFile = app.vault.getAbstractFileByPath(
		normalizePath(settings.pendingApprovalsPath)
	);
	if (!(approvalFile instanceof TFile)) {
		new Notice("未找到 pending-approvals.md");
		return false;
	}

	const raw = await app.vault.read(approvalFile);
	const approved = applyPendingApprovalDecision(raw, {
		title,
		decision: "approve",
		date: todayStr(),
		operator: "TALOS",
	});
	if (!approved.ok) {
		new Notice(approved.message);
		return false;
	}

	const spec = parseApprovalExecutableSpec(approved.content, title);
	if (!spec) {
		new Notice("审批项缺少执行器、目标文件或执行指令");
		return false;
	}
	if (spec.executor !== "mock-model-file-append") {
		new Notice(`暂不支持执行器：${spec.executor}`);
		return false;
	}

	const target = app.vault.getAbstractFileByPath(normalizePath(spec.targetPath));
	if (!(target instanceof TFile)) {
		new Notice(`未找到目标文件：${spec.targetPath}`);
		return false;
	}

	let successMessage = "";
	const task = await getApprovalTaskRuntime(app).run({
		idempotencyKey: `approval:${settings.pendingApprovalsPath}:${title}`,
		title,
		pendingApprovalsPath: settings.pendingApprovalsPath,
		targetPath: spec.targetPath,
		execute: async () => {
			const original = await app.vault.read(target);
			const now = new Date();
			const date = todayStr();
			const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
			const append = buildMockModelAppend({
				title,
				targetPath: spec.targetPath,
				instruction: spec.instruction,
				date,
				time,
				originalContent: original,
			});
			await app.vault.modify(target, `${original.trimEnd()}\n${append}`);

			const recorded = applyApprovalExecutionRecord(approved.content, {
				title,
				targetPath: spec.targetPath,
				date,
				time,
				executor: spec.executor,
			});
			if (!recorded.ok) throw new Error(recorded.message);
			await app.vault.modify(approvalFile, recorded.content);
			successMessage = recorded.message;
			return { message: recorded.message };
		},
	});
	if (task.state !== "completed") {
		new Notice(task.error || "模型执行任务未完成");
		return false;
	}
	new Notice(successMessage || "该审批任务已完成");
	return true;
}

// ---------- 新建（收件箱 / 日记 / 周报）----------
export class CreateModal extends Modal {
	settings: TalosSettings;
	onDone: () => void;
	kind = "inbox";
	title = "";
	content = "";

	constructor(app: App, settings: TalosSettings, onDone: () => void) {
		super(app);
		this.settings = settings;
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "新建" });

		new Setting(contentEl).setName("类型").addDropdown((d) => {
			d.addOption("inbox", "收件箱条目");
			d.addOption("diary", "今日日记");
			d.addOption("weekly", "项目周报");
			d.setValue("inbox").onChange((v) => (this.kind = v));
		});
		new Setting(contentEl).setName("标题").addText((t) =>
			t.setPlaceholder("标题（日记可留空）").onChange((v) => (this.title = v))
		);
		new Setting(contentEl).setName("内容").addTextArea((t) => {
			t.setPlaceholder("正文 / 链接 / 想法…").onChange((v) => (this.content = v));
			t.inputEl.rows = 5;
			t.inputEl.addClass("talos-modal-textarea");
		});
		new Setting(contentEl).addButton((b) =>
			b.setButtonText("创建").setCta().onClick(() => void this.submit())
		);
	}

	async submit(): Promise<void> {
		const app = this.app;
		const s = this.settings;
		if (this.kind === "diary") {
			const date = todayStr();
			await ensureFolder(app, s.dailyFolder);
			const path = normalizePath(`${s.dailyFolder}/${date}.md`);
			if (!(app.vault.getAbstractFileByPath(path) instanceof TFile)) {
				await app.vault.create(
					path,
					`---\ntitle: ${date}\ndate: ${date}\ntags: [日记]\nstatus: active\ntype: daily-note\n---\n\n# ${date}\n\n## 今日唯一胜利条件\n\n## Tasks\n\n## Notes\n`
				);
			}
			new Notice(`日记 ${date} 就绪`);
			this.close();
			await openPathInVault(app, path);
		} else if (this.kind === "weekly") {
			await ensureFolder(app, s.reportsFolder);
			const path = normalizePath(`${s.reportsFolder}/weekly-${todayStr()}.md`);
			const body =
				`---\ntitle: 项目周报 ${todayStr()}\ndate: ${todayStr()}\ntags: [周报, TALOS]\nstatus: draft\ntype: weekly-note\n---\n\n` +
				`# 项目周报 · ${todayStr()}\n\n## 本周进展\n\n${this.content || ""}\n\n## 卡点\n\n## 下周焦点\n`;
			const existing = app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await app.vault.modify(existing, body);
			else await app.vault.create(path, body);
			new Notice("项目周报已创建");
			this.close();
			await openPathInVault(app, path);
		} else {
			const title = (this.title || "未命名").trim();
			const safe = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
			await ensureFolder(app, s.inboxFolder);
			const path = normalizePath(`${s.inboxFolder}/${Date.now()}-${safe}.md`);
			await app.vault.create(
				path,
				`---\ntitle: "${title}"\ndate: ${todayStr()}\ntags: [收件箱]\nstatus: inbox\n---\n\n${this.content || ""}\n`
			);
			new Notice(`已写入收件箱：${safe}`);
			this.close();
		}
		this.onDone();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- 发布回填 ----------
export class PublishBackfillModal extends Modal {
	settings: TalosSettings;
	onDone: () => void;
	week = "A";
	platform = "抖音";
	url = "";

	constructor(app: App, settings: TalosSettings, onDone: () => void) {
		super(app);
		this.settings = settings;
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "发布回填" });
		contentEl.createEl("p", {
			text: "记录一条真实发布，勾掉对应 PUB-W 并写回链接。",
			cls: "talos-modal-hint",
		});

		new Setting(contentEl).setName("批次").addDropdown((d) => {
			d.addOption("A", "PUB-W A");
			d.addOption("B", "PUB-W B");
			d.addOption("C", "PUB-W C");
			d.setValue("A").onChange((v) => (this.week = v));
		});
		new Setting(contentEl).setName("平台").addText((t) =>
			t.setValue("抖音").onChange((v) => (this.platform = v))
		);
		new Setting(contentEl).setName("发布链接").addText((t) =>
			t.setPlaceholder("https://…").onChange((v) => (this.url = v))
		);
		new Setting(contentEl).addButton((b) =>
			b.setButtonText("回填").setCta().onClick(() => void this.submit())
		);
	}

	async submit(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(
			normalizePath(this.settings.talosTasksPath)
		);
		if (!(file instanceof TFile)) {
			new Notice("未找到 TALOS tasks.md");
			return;
		}
		let raw = await this.app.vault.read(file);
		const tag = `PUB-W ${this.week}`;
		const re = new RegExp(
			`(- )\\[ \\]( \\*\\*PUB-W\\s*${this.week}\\*\\*[^\\n]*)`
		);
		if (re.test(raw)) {
			const stamp = `  ✅ ${todayStr()} · ${this.platform}${this.url ? " " + this.url : ""}`;
			raw = raw.replace(re, `$1[x]$2${stamp}`);
			await this.app.vault.modify(file, raw);
			new Notice(`已回填 ${tag}（${this.platform}）`);
		} else {
			new Notice(`${tag} 未找到或已勾选`);
		}
		this.close();
		this.onDone();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- Vault Lint（全库 frontmatter 体检）----------
const LINT_EXEMPT = [
	"System/", "template/", "模板/", "Excalidraw/", "attachments/", "自动化/",
	"04-项目/TALOS系统/07-控制台/talos-plugin/",
];

export async function vaultLint(
	app: App,
	settings: TalosSettings
): Promise<void> {
	const configDir = app.vault.configDir;
	const notes = app.vault.getMarkdownFiles().filter((f) => {
		if (f.basename === "_README") return false;
		if (f.path.includes(".excalidraw")) return false;
		if (f.path.startsWith(configDir + "/")) return false;
		if (f.path.includes("/客户交付物/") || f.path.includes("/交付包/")) return false;
		return !LINT_EXEMPT.some((p) => f.path.startsWith(p));
	});

	const missFm: string[] = [];
	const missTags: string[] = [];
	const missStatus: string[] = [];
	for (const f of notes) {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		if (!fm) {
			missFm.push(f.path);
			continue;
		}
		if (!fm.tags) missTags.push(f.path);
		if (!fm.status) missStatus.push(f.path);
	}

	const sec = (t: string, a: string[]) =>
		`## ${t}（${a.length}）\n\n` +
		(a.length ? a.slice(0, 60).map((p) => `- [[${p}]]`).join("\n") : "- 无") +
		"\n\n";

	const report =
		`---\ntitle: TALOS Lint ${todayStr()}\ndate: ${todayStr()}\ntags: [系统, 健康度, TALOS]\nstatus: active\ntype: system\n---\n\n` +
		`# TALOS Lint · ${todayStr()}\n\n> 全库扫描 ${notes.length} 篇知识笔记（已排除系统/基础设施/交付副本）。\n\n` +
		sec("缺 frontmatter", missFm) +
		sec("缺 tags", missTags) +
		sec("缺 status", missStatus);

	await ensureFolder(app, settings.reportsFolder);
	const path = normalizePath(`${settings.reportsFolder}/talos-lint-${todayStr()}.md`);
	let file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) await app.vault.modify(file, report);
	else file = await app.vault.create(path, report);
	new Notice(`Lint：缺fm ${missFm.length} · 缺tags ${missTags.length} · 缺status ${missStatus.length}`);
	if (file instanceof TFile) await openPathInVault(app, path);
}

// ---------- Deep Research（桌面端 + 安全门）----------
type DeepResearchSpawn = typeof import("child_process").spawn;

function deepResearchAbortError(): Error {
	const error = new Error("Deep Research 已取消");
	error.name = "AbortError";
	return error;
}

function throwIfDeepResearchAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw deepResearchAbortError();
}

export async function deepResearch(
	app: App,
	settings: TalosSettings,
	signal?: AbortSignal,
	spawnOverride?: DeepResearchSpawn
): Promise<void> {
	throwIfDeepResearchAborted(signal);
	const topic = "TALOS 个人上下文操作系统 最新动态";
	const cmd = settings.agentCommand.trim();

	if (!cmd) {
		await ensureFolder(app, settings.reportsFolder);
		throwIfDeepResearchAborted(signal);
		const path = normalizePath(
			`${settings.reportsFolder}/deep-research-${todayStr()}.md`
		);
		const body =
			`---\ntitle: Deep Research ${todayStr()}\ndate: ${todayStr()}\ntags: [研究, 占位]\nstatus: draft\ntype: 研究报告\n---\n\n` +
			`# Deep Research · ${topic}\n\n> ⚠️ 占位报告。要真正调用智能体，请在插件设置填写「Agent 命令」（如 claude -p / codex exec）。\n`;
		const existing = app.vault.getAbstractFileByPath(path);
		throwIfDeepResearchAborted(signal);
		if (existing instanceof TFile) await app.vault.modify(existing, body);
		else await app.vault.create(path, body);
		new Notice("未配置 Agent 命令：已写占位报告");
		return;
	}

	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		new Notice("Deep Research 仅桌面端可用");
		return;
	}
	let spawnFn: DeepResearchSpawn | null = spawnOverride ?? null;
	if (!spawnFn) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			spawnFn = (require("child_process") as typeof import("child_process")).spawn;
		} catch {
			spawnFn = null;
		}
	}
	if (!spawnFn) {
		new Notice("Deep Research 仅桌面端可用");
		return;
	}

	new Notice(`运行 Agent：${cmd} …`);
	const parts = cmd.split(/\s+/).filter(Boolean);
	const bin = parts[0] ?? "";
	const args = [...parts.slice(1), `就「${topic}」做一次 deep research，输出 Markdown`];
	let child: ReturnType<DeepResearchSpawn>;
	try {
		child = spawnFn(bin, args, {
			cwd: adapter.getBasePath(),
			shell: false,
		});
	} catch (error) {
		const failure = error instanceof Error ? error : new Error(String(error));
		new Notice(`Deep Research 无法启动「${bin}」：${failure.message}`);
		throw failure;
	}
	let out = "";
	child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
	child.stderr?.on("data", (d: Buffer) => (out += d.toString()));

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const cleanup = (): void => {
			signal?.removeEventListener("abort", onAbort);
		};
		const resolveOnce = (): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		};
		const rejectOnce = (error: unknown): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error instanceof Error ? error : new Error(String(error)));
		};
		const onAbort = (): void => {
			try {
				child.kill();
			} catch {
				// The child may already have exited; cancellation still rejects the task.
			}
			rejectOnce(deepResearchAbortError());
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) {
			onAbort();
			return;
		}

		// 命令不存在等 spawn 失败必须结束任务，不能成为渲染进程未捕获异常。
		child.on("error", (error: Error) => {
			new Notice(`Deep Research 无法启动「${bin}」：${error.message}`);
			rejectOnce(error);
		});
		child.on("close", (code: number | null) => {
			void (async () => {
				if (settled) return;
				try {
					throwIfDeepResearchAborted(signal);
					await ensureFolder(app, settings.reportsFolder);
					throwIfDeepResearchAborted(signal);
					const path = normalizePath(
						`${settings.reportsFolder}/deep-research-${todayStr()}.md`
					);
					const body =
						`---\ntitle: Deep Research ${todayStr()}\ndate: ${todayStr()}\ntags: [研究]\nstatus: draft\ntype: 研究报告\n---\n\n` +
						`# Deep Research · ${topic}\n\n> 命令：\`${cmd}\` · 退出码 ${code ?? "?"}\n\n${out}\n`;
					const existing = app.vault.getAbstractFileByPath(path);
					throwIfDeepResearchAborted(signal);
					if (existing instanceof TFile) {
						await app.vault.modify(existing, body);
					} else {
						await app.vault.create(path, body);
					}
					new Notice(`Deep Research 完成（退出码 ${code ?? "?"}）`);
					resolveOnce();
				} catch (error) {
					rejectOnce(error);
				}
			})();
		});
	});
}
