import { FuzzySuggestModal, Modal, TFile, type App } from "obsidian";
import {
	buildLocalFilePreview,
	evaluateDeclaredLocalPreview,
	type LocalPreviewRejected,
	type LocalPreviewResult,
} from "./local-preview-policy";

const byteLabel = (bytes: number): string => bytes < 1024
	? `${bytes} B`
	: bytes < 1024 * 1024
		? `${(bytes / 1024).toFixed(1)} KB`
		: `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export class LocalFilePreviewModal extends Modal {
	private generation = 0;
	private localUrl: string | null = null;

	constructor(app: App, private readonly file: TFile) { super(app); }

	onOpen(): void {
		this.modalEl.addClass("claudian-local-file-preview-modal");
		this.titleEl.setText(`本地预览 · ${this.file.name}`);
		void this.read(++this.generation);
	}

	onClose(): void {
		this.generation += 1;
		this.releaseUrl();
		this.contentEl.empty();
	}

	private releaseUrl(): void {
		if (!this.localUrl) return;
		URL.revokeObjectURL(this.localUrl);
		this.localUrl = null;
	}

	private async read(generation: number): Promise<void> {
		this.contentEl.empty();
		const policy = evaluateDeclaredLocalPreview(this.file.name, this.file.stat.size);
		if ("status" in policy) { this.rejected(policy); return; }
		const loading = this.contentEl.createDiv({ cls: "claudian-local-file-preview-status", text: "正在读取 Vault 本地字节…" });
		let result: LocalPreviewResult;
		try {
			const raw = await this.app.vault.readBinary(this.file);
			result = buildLocalFilePreview(this.file.name, new Uint8Array(raw));
		} catch {
			result = { status: "rejected", reason: "invalid-content", message: "无法读取本地文件。", policy, privacyBoundary: "vault-local-no-egress" };
		}
		if (generation !== this.generation) return;
		loading.remove();
		this.render(result);
	}

	private render(result: LocalPreviewResult): void {
		if (result.status === "rejected") { this.rejected(result); return; }
		const metadata = this.contentEl.createDiv({ cls: "claudian-local-file-preview-meta" });
		for (const label of [result.policy.id.toUpperCase(), byteLabel(this.file.stat.size), "Vault 本地 · 无外发"]) metadata.createSpan({ text: label });
		if (result.mode === "plain-text") {
			const preEl = this.contentEl.createEl("pre", { cls: "claudian-local-file-preview-text" });
			preEl.setText(result.text);
			if (result.truncated) this.boundedNotice();
			return;
		}
		if (result.mode === "table") {
			const table = this.contentEl.createDiv({ cls: "claudian-local-file-preview-table-wrap" }).createEl("table", { cls: "claudian-local-file-preview-table" });
			result.rows.forEach((row, rowIndex) => {
				const rowEl = table.createEl("tr");
				row.forEach((cell) => {
					const cellEl = rowEl.createEl(rowIndex === 0 ? "th" : "td");
					cellEl.setText(cell);
				});
			});
			if (result.truncated) this.boundedNotice();
			return;
		}
		this.localUrl = URL.createObjectURL(new Blob([Uint8Array.from(result.bytes).buffer], { type: result.mimeType }));
		const element = result.mode === "image"
			? this.contentEl.createEl("img", { cls: "claudian-local-file-preview-image", attr: { alt: this.file.name, src: this.localUrl, referrerpolicy: "no-referrer" } })
			: this.contentEl.createEl("iframe", { cls: "claudian-local-file-preview-pdf", attr: { src: this.localUrl, title: `PDF 本地预览 · ${this.file.name}`, sandbox: "", referrerpolicy: "no-referrer" } });
		element.addEventListener("error", () => {
			this.releaseUrl();
			element.remove();
			this.rejected({ status: "rejected", reason: "invalid-content", message: "本地解码器拒绝了该文件。", policy: result.policy, privacyBoundary: result.privacyBoundary });
		}, { once: true });
	}

	private rejected(result: LocalPreviewRejected): void {
		const fallback = this.contentEl.createDiv({ cls: "claudian-local-file-preview-fallback" });
		fallback.createEl("strong", { text: "无法预览" });
		fallback.createEl("p", { text: result.message });
		fallback.createEl("small", { text: "文件内容没有离开当前 Vault。" });
	}

	private boundedNotice(): void {
		this.contentEl.createDiv({ cls: "claudian-local-file-preview-truncated", text: "预览已按安全上限截断，请打开原文件查看剩余内容。" });
	}
}

export class LocalFilePreviewPicker extends FuzzySuggestModal<TFile> {
	constructor(app: App) { super(app); this.setPlaceholder("选择要在本地安全预览的 Vault 文件"); }
	getItems(): TFile[] { return [...this.app.vault.getFiles()].sort((left, right) => left.path.localeCompare(right.path)); }
	getItemText(file: TFile): string { return file.path; }
	onChooseItem(file: TFile): void { new LocalFilePreviewModal(this.app, file).open(); }
}
