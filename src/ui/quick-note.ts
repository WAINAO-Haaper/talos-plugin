import type { ConsoleActionRuntime } from "../console-action-runtime";

export interface QuickNoteOptions {
	parent: HTMLElement;
	runtime: ConsoleActionRuntime;
	targetFolder: string;
	now?: () => Date;
	onSaved?: (path: string) => void;
}

function pathStamp(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

function quickNoteContent(text: string, date: Date): string {
	const day = [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
	return [
		"---",
		"tags: [TALOS, quick-note]",
		"status: inbox",
		"type: note",
		`created: ${day}`,
		"---",
		"",
		"# 快捷便签",
		"",
		text,
		"",
	].join("\n");
}

export class QuickNote {
	private root: HTMLElement | null = null;
	private textarea: HTMLTextAreaElement | null = null;
	private status: HTMLElement | null = null;
	private saveButton: HTMLButtonElement | null = null;
	private undoButton: HTMLButtonElement | null = null;
	private lastTaskId: string | null = null;

	constructor(private readonly options: QuickNoteOptions) {}

	mount(): HTMLElement {
		if (this.root) return this.root;
		const doc = this.options.parent.ownerDocument;
		const root = doc.createElement("section");
		root.className = "talos-quick-note";
		root.setAttribute("aria-label", "快捷便签");
		this.options.parent.appendChild(root);
		this.root = root;

		const textarea = doc.createElement("textarea");
		textarea.className = "talos-quick-note__input";
		textarea.setAttribute("rows", "6");
		textarea.setAttribute(
			"placeholder",
			"记录一个想法、待办或观察。保存后进入收件箱，可撤销。"
		);
		textarea.setAttribute("aria-label", "便签内容");
		root.appendChild(textarea);
		this.textarea = textarea;

		const footer = doc.createElement("footer");
		footer.className = "talos-quick-note__footer";
		root.appendChild(footer);

		const status = doc.createElement("span");
		status.className = "talos-quick-note__status";
		status.setAttribute("aria-live", "polite");
		status.textContent = "0 字 · 尚未保存";
		footer.appendChild(status);
		this.status = status;

		const actions = doc.createElement("div");
		actions.className = "talos-quick-note__actions";
		footer.appendChild(actions);

		const undo = doc.createElement("button");
		undo.className = "module-hero-action talos-quick-note__undo";
		undo.type = "button";
		undo.setAttribute("data-talos-quick-note-action", "undo");
		undo.textContent = "撤销保存";
		undo.hidden = true;
		undo.addEventListener("click", () => void this.undo());
		actions.appendChild(undo);
		this.undoButton = undo;

		const save = doc.createElement("button");
		save.className = "module-hero-action talos-quick-note__save";
		save.type = "button";
		save.setAttribute("data-talos-quick-note-action", "save");
		save.textContent = "保存到收件箱";
		save.addEventListener("click", () => void this.save());
		actions.appendChild(save);
		this.saveButton = save;

		textarea.addEventListener("input", () => this.updateDraftStatus());
		textarea.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
			event.preventDefault();
			void this.save();
		});
		return root;
	}

	private updateDraftStatus(): void {
		if (!this.textarea || !this.status) return;
		const length = this.textarea.value.trim().length;
		this.status.dataset.state = "draft";
		this.status.textContent = `${length} 字 · ${length > 0 ? "待保存" : "尚未保存"}`;
	}

	private async save(): Promise<void> {
		if (!this.textarea || !this.status || !this.saveButton || !this.undoButton) {
			return;
		}
		const text = this.textarea.value.trim();
		if (!text) {
			this.status.dataset.state = "error";
			this.status.textContent = "请输入便签内容";
			this.textarea.focus();
			return;
		}

		const date = this.options.now?.() || new Date();
		const folder = this.options.targetFolder.replace(/\/+$/, "");
		const targetPath = `${folder}/talos-quick-note-${pathStamp(date)}.md`;
		this.saveButton.disabled = true;
		this.undoButton.hidden = true;
		this.status.dataset.state = "saving";
		this.status.textContent = "正在创建恢复点并保存…";

		try {
			const task = await this.options.runtime.runner.run({
				actionId: "create-note",
				idempotencyKey: `quick-note:${targetPath}`,
				input: {
					targetPath,
					content: quickNoteContent(text, date),
				},
				request: {
					readPaths: [],
					writePaths: [targetPath],
					effects: ["write"],
				},
			});
			if (task.state !== "completed") {
				this.status.dataset.state = "error";
				this.status.textContent = task.error || "保存未完成";
				return;
			}
			this.lastTaskId = task.id;
			this.textarea.value = "";
			this.status.dataset.state = "saved";
			this.status.textContent = `已保存 · ${targetPath}`;
			this.undoButton.hidden = !this.options.runtime.runner.canRevert(task.id);
			this.options.onSaved?.(targetPath);
		} catch (error) {
			this.status.dataset.state = "error";
			this.status.textContent =
				error instanceof Error ? error.message : String(error);
		} finally {
			this.saveButton.disabled = false;
		}
	}

	private async undo(): Promise<void> {
		if (!this.lastTaskId || !this.status || !this.undoButton) return;
		this.undoButton.disabled = true;
		this.status.dataset.state = "saving";
		this.status.textContent = "正在撤销便签写入…";
		try {
			const reverted = await this.options.runtime.runner.revert(this.lastTaskId);
			this.status.dataset.state = reverted ? "reverted" : "error";
			this.status.textContent = reverted ? "已撤销，便签文件已移除" : "当前无法撤销";
			if (reverted) {
				this.lastTaskId = null;
				this.undoButton.hidden = true;
			}
		} catch (error) {
			this.status.dataset.state = "error";
			this.status.textContent =
				error instanceof Error ? error.message : String(error);
		} finally {
			this.undoButton.disabled = false;
		}
	}
}
