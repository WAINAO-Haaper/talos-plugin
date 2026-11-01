import {
	App,
	Modal,
	Notice,
	Setting,
	TFile,
	TFolder,
	type WorkspaceLeaf,
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
			const stem = normalizePath(`${s.reportsFolder}/weekly-${todayStr()}`);
			let path = `${stem}.md`;
			let suffix = 2;
			while (app.vault.getAbstractFileByPath(path)) path = `${stem}-${suffix++}.md`;
			const body =
				`---\ntitle: 项目周报 ${todayStr()}\ndate: ${todayStr()}\ntags: [周报, TALOS]\nstatus: draft\ntype: weekly-note\n---\n\n` +
				`# 项目周报 · ${todayStr()}\n\n## 本周进展\n\n${this.content || ""}\n\n## 卡点\n\n## 下周焦点\n`;
			await app.vault.create(path, body);
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

export interface VaultLintResult {
	notes: number;
	missingFrontmatter: number;
	missingTags: number;
	missingStatus: number;
}

/** A 类只读检查；所有入口复用同一口径，不生成或覆盖报告。 */
export function vaultLint(app: App): VaultLintResult {
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

	const result = {
		notes: notes.length,
		missingFrontmatter: missFm.length,
		missingTags: missTags.length,
		missingStatus: missStatus.length,
	};
	new Notice(`只读 Lint：扫描 ${result.notes} 篇 · 缺 frontmatter ${result.missingFrontmatter} · 缺 tags ${result.missingTags} · 缺 status ${result.missingStatus}`);
	return result;
}

/** 研究复用真实 AI 工作台；只打开界面，不改写草稿或自动发送。 */
export async function openResearchWorkbench(
	open: () => Promise<WorkspaceLeaf | null>,
	signal?: AbortSignal
): Promise<{ workbenchOpened: true; sent: false }> {
	if (signal?.aborted) throw new DOMException("打开研究工作台已取消", "AbortError");
	const leaf = await open();
	if (!leaf) throw new Error("无法在右侧边栏打开 AI 工作台");
	if (signal?.aborted) throw new DOMException("打开研究工作台已取消", "AbortError");
	new Notice("已打开 AI 工作台，请输入研究问题；原有草稿保持不变");
	return { workbenchOpened: true, sent: false };
}
