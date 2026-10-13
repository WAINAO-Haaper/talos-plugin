// 「补齐 TALOS 库结构」：先列出计划，确认后才写；只新建缺失项、只向已有文件末尾追加缺少的分区。
import { Modal, Notice, TFile, TFolder, normalizePath, type App } from "obsidian";
import type { TalosSchemaKey } from "../data/schema";
import { VAULT_FILE_SPECS, planScaffold, type ScaffoldOp, type SettingsFileKey, type VaultFileKey } from "../data/vault-files";
import type TalosPlugin from "../main";

/** 补齐时保证存在的核心模块目录（模板、自动化、配置等按需由使用者自建）。 */
const SCAFFOLD_MODULES: TalosSchemaKey[] = ["inbox", "logs", "insights", "assets", "projects", "archive", "identity", "soul", "output", "system"];

export function resolveFileLocation(plugin: TalosPlugin, key: VaultFileKey | SettingsFileKey): string {
	const settings = plugin.talosSettings as unknown as Record<string, unknown>;
	if (key in settings && typeof settings[key] === "string") return normalizePath(settings[key]);
	return plugin.paths.file(key as VaultFileKey);
}

/** 读取每个登记项的当前内容：文件返回文本，目录返回空串，不存在返回 null。 */
export async function readRegisteredFiles(plugin: TalosPlugin): Promise<Array<{ spec: (typeof VAULT_FILE_SPECS)[number]; path: string; content: string | null }>> {
	const out = [];
	for (const spec of VAULT_FILE_SPECS) {
		const path = resolveFileLocation(plugin, spec.key);
		const node = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
		let content: string | null = null;
		if (spec.kind === "dir") content = node instanceof TFolder ? "" : null;
		else if (node instanceof TFile) content = await plugin.app.vault.cachedRead(node);
		out.push({ spec, path, content });
	}
	return out;
}

export async function buildScaffoldPlan(plugin: TalosPlugin): Promise<ScaffoldOp[]> {
	return planScaffold({
		moduleDirs: SCAFFOLD_MODULES.map((key) => plugin.paths.dir(key)),
		files: await readRegisteredFiles(plugin),
		exists: (path) => plugin.app.vault.getAbstractFileByPath(path) !== null,
	});
}

export async function applyScaffold(app: App, ops: ScaffoldOp[]): Promise<{ done: number; skipped: number }> {
	let done = 0;
	let skipped = 0;
	for (const op of ops) {
		const path = normalizePath(op.path);
		const node = app.vault.getAbstractFileByPath(path);
		if (op.kind === "mkdir") {
			if (node) { skipped++; continue; }
			await app.vault.createFolder(path);
		} else if (op.kind === "create") {
			// 执行时再核对一次：期间被创建的文件不覆盖。
			if (node) { skipped++; continue; }
			await app.vault.create(path, op.content);
		} else {
			if (!(node instanceof TFile)) { skipped++; continue; }
			await app.vault.process(node, (data) => `${data.replace(/\s*$/, "\n")}${op.content}`);
		}
		done++;
	}
	return { done, skipped };
}

const KIND_LABELS: Record<ScaffoldOp["kind"], string> = { mkdir: "新建目录", create: "新建文件", append: "补充分区（追加到末尾）" };

export class ScaffoldModal extends Modal {
	constructor(private readonly plugin: TalosPlugin, private readonly ops: ScaffoldOp[]) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("talos-scaffold-modal");
		contentEl.createEl("h2", { text: "补齐库结构" });
		if (this.ops.length === 0) {
			contentEl.createEl("p", { text: "库结构完整：各页面需要的目录和文件都已就位，无需补齐。" });
			return;
		}
		contentEl.createEl("p", {
			text: "只新建缺失的目录和文件；已有文件只在末尾追加插件需要的分区，原有内容不动。确认前不会写入任何内容。",
		});
		for (const kind of ["mkdir", "create", "append"] as const) {
			const group = this.ops.filter((op) => op.kind === kind);
			if (group.length === 0) continue;
			contentEl.createEl("h4", { text: `${KIND_LABELS[kind]} · ${group.length}` });
			const list = contentEl.createEl("ul");
			for (const op of group) list.createEl("li", { text: `${op.path} — ${op.label}` });
		}
		const actions = contentEl.createDiv({ cls: "modal-button-container" });
		actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
		const confirm = actions.createEl("button", { cls: "mod-cta", text: `确认补齐 ${this.ops.length} 项` });
		confirm.addEventListener("click", () => {
			confirm.disabled = true;
			void (async () => {
				try {
					const result = await applyScaffold(this.app, this.ops);
					new Notice(`已补齐 ${result.done} 项${result.skipped ? `，跳过 ${result.skipped} 项已存在` : ""}`);
					this.plugin.refreshAllViews();
					this.close();
				} catch (error) {
					confirm.disabled = false;
					new Notice(`补齐中断：${error instanceof Error ? error.message : String(error)}`);
				}
			})();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
