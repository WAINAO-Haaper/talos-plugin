import { Modal, Notice, sanitizeHTMLToDom, type App } from "obsidian";
import { renderPreviewHtml } from "../../vendor/serena-post/vendor/kaitox/x-article/previewHtml";
import { assetDataUrl } from "./media";
import { aggregateRecordState } from "./service";
import { PublishingSettingsModal } from "./settings-modal";
import type { PublishingApproval, PublishingHost } from "./host";
import type { DraftState, PreparedArticle, PublishRecord, PublishingAccount } from "./types";

const LABELS: Record<DraftState | "partial", string> = { pending: "待发送", sending: "发送中", queued: "已排队，等待 X 回执", "draft-created": "草稿已创建", failed: "创建失败", unknown: "结果待确认", partial: "部分完成" };

export class PublishingModal extends Modal {
	private article: PreparedArticle | null = null;
	private approval: PublishingApproval | null = null;
	private accounts: PublishingAccount[] = [];
	private selected = new Set<string>();
	private source!: HTMLInputElement;
	private titleInput!: HTMLInputElement;
	private digest!: HTMLInputElement;
	private author!: HTMLInputElement;
	private cover!: HTMLInputElement;
	private previews!: HTMLElement;
	private checks!: HTMLElement;
	private confirmArea!: HTMLElement;
	private targetArea!: HTMLElement;
	private history!: HTMLElement;
	private status!: HTMLElement;
	private busy = false;
	private timer: number | null = null;
	private sequence = 0;
	private confirmationSequence = 0;
	constructor(app: App, private readonly host: PublishingHost) { super(app); }
	onOpen(): void {
		this.setTitle("排版与平台草稿");
		this.modalEl.addClass("talos-publishing-modal");
		const header = this.contentEl.createDiv({ cls: "talos-publishing-toolbar" });
		header.createEl("p", { text: "一篇笔记，分别准备公众号与 X 草稿。" });
		this.button(header, "账号设置", () => new PublishingSettingsModal(this.app, this.host, () => { this.invalidate(); void this.loadAccounts(); }).open());
		const form = this.contentEl.createDiv({ cls: "talos-publishing-form" });
		const field = (label: string, placeholder: string) => {
			const row = form.createEl("label", { cls: "talos-publishing-field" }); row.createSpan({ text: label });
			const input = row.createEl("input", { attr: { type: "text", placeholder } }); input.addEventListener("input", () => this.invalidate()); return input;
		};
		this.source = field("文章笔记", "输入或选择库内笔记路径");
		const options = form.createEl("datalist", { attr: { id: `talos-publish-notes-${Date.now()}` } });
		this.source.setAttribute("list", options.id);
		const notes = this.host.listNotes();
		const filter = () => { options.empty(); for (const note of notes.filter(n => n.path.toLowerCase().includes(this.source.value.toLowerCase())).slice(0, 100)) options.createEl("option", { value: note.path }); };
		this.source.addEventListener("input", filter); filter();
		this.titleInput = field("文章标题", "默认使用笔记文件名");
		this.digest = field("公众号摘要", "选填，最多 120 字");
		this.author = field("公众号署名", "选填，最多 8 字");
		this.cover = field("封面图片", "公众号必填，填写库内图片路径");
		const active = this.app.workspace.getActiveFile();
		if (active?.extension === "md") { this.source.value = active.path; this.titleInput.value = active.basename; }
		this.targetArea = this.contentEl.createDiv({ cls: "talos-publishing-targets" });
		const toolbar = this.contentEl.createDiv({ cls: "talos-publishing-toolbar" });
		this.button(toolbar, "生成预览与检查", () => { void this.prepare(); }, true);
		this.button(toolbar, "取消等待", () => { this.host.cancel(); this.status.setText("已请求停止。已经送达平台的内容不会被撤回，请核对草稿记录。"); });
		this.status = this.contentEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		this.checks = this.contentEl.createDiv({ cls: "talos-publishing-checks" });
		this.previews = this.contentEl.createDiv({ cls: "talos-publishing-previews" });
		this.confirmArea = this.contentEl.createDiv({ cls: "talos-publishing-confirm" });
		const historyHead = this.contentEl.createDiv({ cls: "talos-publishing-toolbar" });
		historyHead.createEl("h3", { text: "草稿记录" });
		this.button(historyHead, "刷新记录", () => { void this.refreshHistory(); });
		this.history = this.contentEl.createDiv({ cls: "talos-publishing-history" });
		void this.loadAccounts(); void this.refreshHistory();
	}
	private button(parent: HTMLElement, label: string, action: () => void, primary = false): HTMLButtonElement {
		const button = parent.createEl("button", { text: label, cls: primary ? "mod-cta" : "", attr: { type: "button" } }); button.addEventListener("click", action); return button;
	}
	private invalidate(): void { this.sequence++; this.article = null; this.approval = null; this.confirmArea?.empty(); this.previews?.empty(); this.checks?.empty(); }
	private async loadAccounts(): Promise<void> {
		try {
			this.accounts = (await this.host.loadConfig()).accounts;
			this.selected = new Set(this.accounts.map(a => a.id)); this.targetArea.empty();
			if (!this.accounts.length) this.targetArea.createEl("p", { text: "先打开账号设置，添加公众号和 X 目标。" });
			for (const account of this.accounts) {
				const label = this.targetArea.createEl("label");
				const checkbox = label.createEl("input", { attr: { type: "checkbox" } }); checkbox.checked = true;
				label.createSpan({ text: `${account.platform === "wechat" ? "公众号" : "X"} · ${account.label}` });
				checkbox.addEventListener("change", () => { if (checkbox.checked) this.selected.add(account.id); else this.selected.delete(account.id); this.approval = null; this.confirmArea.empty(); if (this.article) void this.showConfirmation(); });
			}
		} catch (e) { this.showError(e); }
	}
	private async prepare(): Promise<void> {
		if (this.busy) return;
		this.invalidate(); const sequence = this.sequence;
		this.busy = true; this.status.setText("正在本地准备文章和附件；尚未向平台发送。");
		try {
			const sourcePath = this.source.value.trim();
			const article = await this.host.prepare({ sourcePath, title: this.titleInput.value.trim() || sourcePath.split("/").pop()?.replace(/\.md$/i, "") || "", digest: this.digest.value, author: this.author.value, coverPath: this.cover.value.trim() || undefined });
			if (sequence !== this.sequence) return;
			this.article = article; this.renderPreviews(article);
			this.checks.createEl("p", { text: `${article.assets.length} 个正文附件 · 内容指纹 ${article.fingerprint.slice(0, 12)} · 发送使用本次预览快照` });
			for (const warning of article.warnings) this.checks.createEl("p", { text: warning, cls: "talos-publishing-warning" });
			this.status.setText("本地预览已就绪。检查两边效果后确认创建草稿。");
			await this.showConfirmation();
		} catch (e) { this.showError(e); } finally { this.busy = false; }
	}
	private renderPreviews(article: PreparedArticle): void {
		this.previews.empty();
		const xHtml = renderPreviewHtml(article.xMarkdown, { title: article.title, coverUrl: article.cover ? assetDataUrl(article.cover) : undefined, resolveImage: src => { const asset = article.assets.find(a => a.fileName === src); return asset ? assetDataUrl(asset) : null; }, isVideo: src => article.assets.some(a => a.fileName === src && a.mime.startsWith("video/")) });
		for (const [title, html] of [["公众号预览", article.wechatHtml], ["X 文章预览", xHtml]]) {
			const pane = this.previews.createDiv({ cls: "talos-publishing-preview-pane" }); pane.createEl("h3", { text: title });
			const shadow = pane.createDiv({ cls: "talos-publishing-preview-body" }).attachShadow({ mode: "open" });
			const style = this.contentEl.ownerDocument.createElement("style");
			style.textContent = ":host{display:block;background:white;color:#1b1b1b;padding:20px;font:15px/1.8 system-ui;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}pre{white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6px}blockquote{border-left:3px solid #999;padding-left:12px}";
			shadow.appendChild(style); shadow.appendChild(sanitizeHTMLToDom(html));
			shadow.addEventListener("click", event => { if ((event.target as Element).closest("a")) event.preventDefault(); });
		}
	}
	private async showConfirmation(): Promise<void> {
		const request = ++this.confirmationSequence;
		const article = this.article; this.confirmArea.empty();
		if (!article || !this.selected.size) return;
		const selected = this.accounts.filter(a => this.selected.has(a.id));
		if (selected.some(a => a.platform === "wechat") && !article.cover) { this.confirmArea.createEl("p", { text: "公众号需要本地封面图片，请填写后重新生成预览。" }); return; }
		try {
			const approval = await this.host.proposal(article, [...this.selected]);
			if (this.article !== article || request !== this.confirmationSequence) return;
			this.approval = approval;
			this.confirmArea.createEl("h3", { text: "确认本次发送" });
			this.confirmArea.createEl("p", { text: `文章「${article.title}」及已列出的附件将发送到：${selected.map(a => a.label).join("、")}。只创建草稿。` });
			if (selected.some(a => a.platform === "x")) this.confirmArea.createEl("p", { text: "X 使用 Chrome 当前登录的账号；TALOS 无法验证浏览器账号身份。请先确认用户名与所选目标一致，且 Kaitox 扩展已配置配对码。" });
			const label = this.confirmArea.createEl("label");
			const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
			label.createSpan({ text: "我已核对内容、附件和目标账号，同意创建这些草稿" });
			const send = this.button(this.confirmArea, "确认创建草稿", () => { if (checkbox.checked && this.approval?.id === approval.id) void this.send(approval.id); }, true);
			send.disabled = true; checkbox.addEventListener("change", () => { send.disabled = !checkbox.checked || this.busy; });
		} catch (e) { this.showError(e); }
	}
	private async send(id: string): Promise<void> {
		if (this.busy) return;
		this.busy = true; this.confirmArea.empty(); this.status.setText("正在创建草稿；请保持 Chrome 和 X 编辑器打开。视频处理可能需要数分钟。");
		this.timer = window.setInterval(() => { void this.refreshHistory(); }, 2000);
		try { const record = await this.host.confirm(id, () => { void this.refreshHistory(); }); this.status.setText(`${LABELS[aggregateRecordState(record)]}。正式发布请在平台里完成。`); }
		catch (e) { this.showError(e); }
		finally { this.busy = false; if (this.timer !== null) window.clearInterval(this.timer); this.timer = null; await this.refreshHistory(); }
	}
	private async refreshHistory(): Promise<void> {
		try {
			const records = await this.host.records(); this.history.empty();
			if (!records.length) this.history.createEl("p", { text: "还没有草稿发送记录。" });
			for (const record of records.slice(-12).reverse()) this.renderRecord(record);
		} catch (e) { this.history.setText(e instanceof Error ? e.message : "草稿记录读取失败"); }
	}
	private renderRecord(record: PublishRecord): void {
		const row = this.history.createDiv({ cls: "talos-publishing-record" });
		row.createEl("strong", { text: `${record.sourcePath} · ${LABELS[aggregateRecordState(record)]}` });
		for (const receipt of record.targets) {
			const line = row.createDiv(); line.createSpan({ text: `${receipt.accountLabel}：${LABELS[receipt.state]}${receipt.error ? ` · ${receipt.error}` : ""}` });
			if (receipt.draftUrl && /^https:\/\/(?:x\.com|mp\.weixin\.qq\.com)\//.test(receipt.draftUrl)) this.button(line, "打开草稿箱", () => { window.open(receipt.draftUrl, "_blank", "noopener"); });
			else if (receipt.platform === "wechat" && ["draft-created", "unknown"].includes(receipt.state)) this.button(line, "打开公众号后台", () => { window.open("https://mp.weixin.qq.com/", "_blank", "noopener"); });
		}
		if (record.targets.some(r => ["queued", "unknown", "sending"].includes(r.state))) this.button(row, "核对原草稿结果", () => { void this.host.reconcile(record.id).then(() => this.refreshHistory()).catch(e => this.showError(e)); });
	}
	private showError(cause: unknown): void { this.status?.setText(cause instanceof Error ? cause.message : "操作失败，请查看草稿记录"); }
	onClose(): void { this.sequence++; if (this.timer !== null) window.clearInterval(this.timer); this.timer = null; this.contentEl.empty(); }
}

export function openPublishingModal(app: App, host: PublishingHost): void {
	try { new PublishingModal(app, host).open(); } catch { new Notice("无法打开草稿工作区"); }
}
