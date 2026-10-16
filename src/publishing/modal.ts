import { Modal, Notice, sanitizeHTMLToDom, type App, type TFile } from "obsidian";
import { renderPreviewHtml } from "../../vendor/serena-post/vendor/kaitox/x-article/previewHtml";
import { assetDataUrl } from "./media";
import { aggregateRecordState } from "./service";
import { PublishingSettingsModal } from "./settings-modal";
import { choosePublishingImage, choosePublishingNote } from "./pickers";
import { PreviewController, type PreviewState } from "./preview-controller";
import { DEFAULT_WECHAT_PRESENTATION } from "./theme";
import type { PublishingApproval, PublishingHost } from "./host";
import type { ArticleInput, DraftState, PreparedArticle, PublishRecord, PublishingAccount } from "./types";

const LABELS: Record<DraftState | "partial", string> = { pending: "待发送", sending: "发送中", queued: "已排队，等待 X 回执", "draft-created": "草稿已创建", failed: "创建失败", unknown: "结果待确认", partial: "部分完成" };
type PreviewInput = Omit<ArticleInput, "markdown">;
type PreviewMode = "both" | "wechat" | "x";

export class PublishingModal extends Modal {
	private preview!: PreviewController<PreviewInput, PreparedArticle>;
	private previewState: PreviewState<PreparedArticle> = { phase: "empty", revision: 0 };
	private approval: Pick<PublishingApproval, "id"> | null = null;
	private approvalRevision = -1;
	private confirmationSequence = 0;
	private accounts: PublishingAccount[] = [];
	private accountsLoaded = false;
	private selected = new Set<string>();
	private source!: HTMLInputElement;
	private titleInput!: HTMLInputElement;
	private digest!: HTMLInputElement;
	private author!: HTMLInputElement;
	private cover!: HTMLInputElement;
	private fontSize!: HTMLSelectElement;
	private lineHeight!: HTMLSelectElement;
	private accent!: HTMLInputElement;
	private editor!: HTMLElement;
	private previews!: HTMLElement;
	private coverThumb!: HTMLElement;
	private checks!: HTMLElement;
	private confirmArea!: HTMLElement;
	private targetArea!: HTMLElement;
	private history!: HTMLElement;
	private status!: HTMLElement;
	private previewBadge!: HTMLElement;
	private sendButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private refreshButton!: HTMLButtonElement;
	private settingsButton!: HTMLButtonElement;
	private confirmed = false;
	private sending = false;
	private refreshAfterSend = false;
	private closed = false;
	private mode: PreviewMode = "both";
	private timer: number | null = null;
	private unwatch: (() => void) | null = null;
	private watchedPath = "";
	constructor(app: App, private readonly host: PublishingHost) { super(app); }

	onOpen(): void {
		this.closed = false;
		this.setTitle("排版与平台草稿");
		this.modalEl.addClass("talos-publishing-modal");
		this.contentEl.addClass("talos-publishing-workspace");
		const header = this.contentEl.createDiv({ cls: "talos-publishing-header" });
		header.createEl("p", { text: "修改后自动本地预览 · 确认后才创建平台草稿" });
		this.settingsButton = this.button(header, "账号设置", () => {
			if (this.sending) return;
			new PublishingSettingsModal(this.app, this.host, () => { this.invalidateApproval(); void this.loadAccounts(); }).open();
		});
		const body = this.contentEl.createDiv({ cls: "talos-publishing-body" });
		this.editor = body.createDiv({ cls: "talos-publishing-editor" });
		this.editor.createEl("h3", { text: "内容与封面" });
		this.source = this.field(this.editor, "文章笔记", "选择笔记，或输入库内路径");
		const sourceActions = this.editor.createDiv({ cls: "talos-publishing-inline-actions" });
		this.button(sourceActions, "选择笔记", () => choosePublishingNote(this.app, this.host.listNotes(), file => this.selectNote(file)));
		this.button(sourceActions, "使用当前笔记", () => {
			const file = this.app.workspace.getActiveFile();
			if (file?.extension === "md") this.selectNote(file);
			else this.status.setText("当前主页面不是 Markdown 笔记，请用「选择笔记」。");
		});
		this.titleInput = this.field(this.editor, "文章标题", "默认使用笔记文件名");
		this.cover = this.field(this.editor, "封面图片", "公众号必填，选择库内图片");
		const coverActions = this.editor.createDiv({ cls: "talos-publishing-inline-actions" });
		this.button(coverActions, "选择封面", () => choosePublishingImage(this.app, this.host.listImages(), file => { if (!this.sending && !this.closed) { this.cover.value = file.path; this.schedule(); } }));
		this.button(coverActions, "清除封面", () => { this.cover.value = ""; this.schedule(); });
		this.coverThumb = this.editor.createDiv({ cls: "talos-publishing-cover-thumb" });
		this.coverThumb.createSpan({ text: "选择图片后显示封面缩略图" });
		const extra = this.editor.createEl("details", { cls: "talos-publishing-details" });
		extra.createEl("summary", { text: "摘要与署名 · 公众号" });
		this.digest = this.field(extra, "公众号摘要", "选填，最多 120 字");
		this.author = this.field(extra, "公众号署名", "选填，最多 8 字");
		const typography = this.editor.createDiv({ cls: "talos-publishing-typography" });
		typography.createEl("h3", { text: "公众号排版" });
		typography.createEl("p", { cls: "setting-item-description", text: "以下样式作用于公众号；X 使用平台支持的文章格式。" });
		this.fontSize = this.select(typography, "字号", [14, 15, 16, 17, 18, 19, 20].map(n => [String(n), `${n} px`]), String(DEFAULT_WECHAT_PRESENTATION.fontSize));
		this.lineHeight = this.select(typography, "行距", [1.5, 1.75, 2, 2.25].map(n => [String(n), `${n} 倍`]), String(DEFAULT_WECHAT_PRESENTATION.lineHeight));
		this.accent = this.field(typography, "主题色", "", "color"); this.accent.value = DEFAULT_WECHAT_PRESENTATION.accent;
		this.button(typography, "恢复默认排版", () => { this.fontSize.value = String(DEFAULT_WECHAT_PRESENTATION.fontSize); this.lineHeight.value = String(DEFAULT_WECHAT_PRESENTATION.lineHeight); this.accent.value = DEFAULT_WECHAT_PRESENTATION.accent; this.schedule(); });
		this.targetArea = this.editor.createDiv({ cls: "talos-publishing-targets" });
		const history = this.editor.createEl("details", { cls: "talos-publishing-details" });
		history.createEl("summary", { text: "最近草稿记录" });
		this.button(history, "刷新记录", () => { void this.refreshHistory(); });
		this.history = history.createDiv({ cls: "talos-publishing-history" });

		const previewArea = body.createDiv({ cls: "talos-publishing-preview-area" });
		const toolbar = previewArea.createDiv({ cls: "talos-publishing-preview-toolbar" });
		const modes = toolbar.createDiv({ cls: "talos-publishing-preview-modes", attr: { role: "group", "aria-label": "预览平台" } });
		for (const [value, label] of [["both", "双平台"], ["wechat", "公众号"], ["x", "X 文章"]] as const) {
			const button = this.button(modes, label, () => {
				this.mode = value; this.previews.dataset.previewMode = value;
				for (const b of Array.from(modes.querySelectorAll("button"))) b.setAttribute("aria-pressed", String(b === button));
			}); button.setAttribute("aria-pressed", String(value === this.mode));
		}
		this.refreshButton = this.button(toolbar, "刷新正文", () => { if (!this.sending) this.schedule(true); });
		this.previewBadge = previewArea.createDiv({ cls: "talos-publishing-preview-badge", attr: { role: "status", "aria-live": "polite" } });
		this.checks = previewArea.createDiv({ cls: "talos-publishing-checks" });
		this.previews = previewArea.createDiv({ cls: "talos-publishing-previews", attr: { "data-preview-mode": this.mode } });
		this.renderEmpty();
		const footer = this.contentEl.createDiv({ cls: "talos-publishing-footer" });
		this.status = footer.createDiv({ cls: "talos-publishing-status", attr: { role: "status", "aria-live": "polite" } });
		this.confirmArea = footer.createDiv({ cls: "talos-publishing-confirm" });
		const actions = footer.createDiv({ cls: "talos-publishing-footer-actions" });
		this.cancelButton = this.button(actions, "取消等待", () => { this.host.cancel(); this.status.setText("已请求停止。已经送达平台的内容不会被撤回，请核对草稿记录。"); }); this.cancelButton.hidden = true;
		this.sendButton = this.button(actions, "确认创建草稿", () => { void this.send(); }, true); this.sendButton.disabled = true;
		this.preview = new PreviewController({ prepare: input => this.host.prepare(input), onState: state => this.receivePreview(state), debounceMs: 350,
			timers: { setTimeout: (callback, delay) => this.contentEl.ownerDocument.defaultView!.setTimeout(callback, delay), clearTimeout: handle => this.contentEl.ownerDocument.defaultView!.clearTimeout(handle as number) } });
		const active = this.app.workspace.getActiveFile();
		if (active?.extension === "md") { this.source.value = active.path; this.titleInput.value = active.basename; }
		void this.loadAccounts(); void this.refreshHistory(); this.schedule(true);
	}

	private field(parent: HTMLElement, label: string, placeholder: string, type = "text"): HTMLInputElement {
		const row = parent.createEl("label", { cls: "talos-publishing-field" }); row.createSpan({ text: label });
		const input = row.createEl("input", { attr: { type, placeholder } }); input.addEventListener("input", () => this.schedule()); return input;
	}
	private select(parent: HTMLElement, label: string, options: string[][], value: string): HTMLSelectElement {
		const row = parent.createEl("label", { cls: "talos-publishing-field" }); row.createSpan({ text: label });
		const input = row.createEl("select", { attr: { "aria-label": label } });
		for (const [key, text] of options) input.createEl("option", { value: key, text }); input.value = value; input.addEventListener("change", () => this.schedule()); return input;
	}
	private button(parent: HTMLElement, label: string, action: () => void, primary = false): HTMLButtonElement {
		const button = parent.createEl("button", { text: label, cls: primary ? "mod-cta" : "", attr: { type: "button" } }); button.addEventListener("click", action); return button;
	}
	private selectNote(file: TFile): void {
		if (this.sending || this.closed) return;
		if (this.source.value !== file.path) { this.cover.value = ""; this.digest.value = ""; }
		this.source.value = file.path; this.titleInput.value = file.basename; this.schedule(true);
	}
	private input(): PreviewInput {
		const sourcePath = this.source.value.trim();
		return { sourcePath, title: this.titleInput.value.trim() || sourcePath.split("/").pop()?.replace(/\.md$/i, "") || "", digest: this.digest.value, author: this.author.value, coverPath: this.cover.value.trim() || undefined,
			presentation: { fontSize: Number(this.fontSize.value), lineHeight: Number(this.lineHeight.value), accent: this.accent.value } };
	}
	private invalidateApproval(revoke = true): void {
		if (revoke && this.approval) this.host.revokeApproval(this.approval.id);
		this.confirmationSequence++; this.approval = null; this.approvalRevision = -1; this.confirmed = false;
		this.confirmArea?.empty(); if (this.sendButton) this.sendButton.disabled = true;
	}
	private schedule(immediate = false): void {
		if (!this.preview || this.closed) return;
		if (this.sending) { this.refreshAfterSend = true; return; }
		this.invalidateApproval();
		const input = this.input();
		if (input.sourcePath !== this.watchedPath) {
			this.unwatch?.(); this.watchedPath = input.sourcePath;
			this.unwatch = input.sourcePath ? this.host.watchSource(input.sourcePath, currentPath => {
				if (currentPath && currentPath !== this.source.value) {
					const oldTitle = this.source.value.split("/").pop()?.replace(/\.md$/i, "") ?? "";
					this.source.value = currentPath; this.watchedPath = currentPath;
					if (this.titleInput.value === oldTitle) this.titleInput.value = currentPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
				}
				this.schedule(true);
			}) : null;
		}
		if (!input.sourcePath) this.preview.clear();
		else if (immediate) this.preview.refresh(input);
		else this.preview.update(input);
	}
	private receivePreview(state: PreviewState<PreparedArticle>): void {
		if (this.closed) return;
		this.previewState = state; this.invalidateApproval();
		this.previews.dataset.stale = String(state.phase !== "ready");
		if (state.phase === "empty") { this.status.setText("选择一篇笔记后自动生成预览。"); this.previewBadge.setText("等待选稿"); this.coverThumb.empty(); this.coverThumb.createSpan({ text: "选择图片后显示封面缩略图" }); this.renderEmpty(); return; }
		if (state.phase === "pending" || state.phase === "updating") {
			this.previewBadge.setText(state.result ? "正在更新 · 暂时显示上次预览" : "正在准备本地预览…");
			this.status.setText("预览更新完成后才能确认创建草稿。"); return;
		}
		if (state.phase === "error") { this.previewBadge.setText(state.result ? "更新失败 · 当前画面为上次预览，不能发送" : "预览暂未生成"); this.status.setText(state.error || "预览更新失败，请检查输入后重试。"); return; }
		const article = state.result;
		if (!article) return;
		this.renderPreviews(article); this.renderChecks(article);
		this.previewBadge.setText("预览已更新 · 仅本地处理");
		this.coverThumb.empty();
		if (article.cover) this.coverThumb.createEl("img", { attr: { src: assetDataUrl(article.cover), alt: "本次封面预览" } });
		else this.coverThumb.createSpan({ text: "未选择封面 · 公众号需要封面" });
		this.status.setText(`${article.assets.length} 个正文附件 · 发送使用当前预览版本`);
		void this.showConfirmation();
	}
	private renderEmpty(): void {
		this.previews.empty();
		const empty = this.previews.createDiv({ cls: "talos-publishing-empty" });
		empty.createEl("h3", { text: "在这里查看两边的文章效果" });
		empty.createEl("p", { text: "选择笔记后，标题、封面和公众号排版会随修改自动更新。" });
		this.checks?.empty();
	}
	private renderChecks(article: PreparedArticle): void {
		this.checks.empty();
		if (!article.warnings.length) return;
		const detail = this.checks.createEl("details"); detail.createEl("summary", { text: `${article.warnings.length} 项平台格式提示` });
		for (const warning of article.warnings) detail.createEl("p", { text: warning });
	}
	private renderPreviews(article: PreparedArticle): void {
		const previousScroll = new Map(Array.from(this.previews.querySelectorAll<HTMLElement>(".talos-publishing-preview-body")).map(body => [body.dataset.platform, body.scrollTop]));
		this.previews.empty();
		const xHtml = renderPreviewHtml(article.xMarkdown, { title: article.title, coverUrl: article.cover ? assetDataUrl(article.cover) : undefined, resolveImage: src => { const asset = article.assets.find(a => a.fileName === src); return asset ? assetDataUrl(asset) : null; }, isVideo: src => article.assets.some(a => a.fileName === src && a.mime.startsWith("video/")) });
		for (const [platform, title, html] of [["wechat", "公众号预览", article.wechatHtml], ["x", "X 文章预览", xHtml]]) {
			const pane = this.previews.createDiv({ cls: "talos-publishing-preview-pane", attr: { "data-platform": platform } }); pane.createEl("h3", { text: title });
			const body = pane.createDiv({ cls: "talos-publishing-preview-body", attr: { "data-platform": platform } });
			const shadow = body.attachShadow({ mode: "open" });
			const style = this.contentEl.ownerDocument.createElement("style");
			style.textContent = ":host{display:block;background:white;color:#1b1b1b;padding:18px;font:15px/1.8 system-ui;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}pre{white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6px}blockquote{border-left:3px solid #999;padding-left:12px}.draft-title{font:700 24px/1.4 system-ui;margin:0 0 14px}.draft-meta{color:#777;font:12px/1.5 system-ui;margin-bottom:16px}.draft-cover{display:block;margin-bottom:16px}";
			shadow.appendChild(style);
			if (platform === "wechat") {
				const heading = this.contentEl.ownerDocument.createElement("h1"); heading.className = "draft-title"; heading.textContent = article.title; shadow.appendChild(heading);
				if (article.author || article.digest) { const meta = this.contentEl.ownerDocument.createElement("p"); meta.className = "draft-meta"; meta.textContent = [article.author, article.digest].filter(Boolean).join(" · "); shadow.appendChild(meta); }
				if (article.cover) { const image = this.contentEl.ownerDocument.createElement("img"); image.className = "draft-cover"; image.src = assetDataUrl(article.cover); image.alt = "文章封面"; shadow.appendChild(image); }
			}
			shadow.appendChild(sanitizeHTMLToDom(html));
			shadow.addEventListener("click", event => { if ((event.target as Element).closest("a")) event.preventDefault(); });
			body.scrollTop = previousScroll.get(platform) ?? 0;
		}
	}
	private async loadAccounts(): Promise<void> {
		try {
			const config = await this.host.loadConfig(); if (this.closed) return;
			const previousIds = new Set(this.accounts.map(a => a.id)); this.accounts = config.accounts;
			this.selected = new Set(this.accounts.filter(a => !this.accountsLoaded || !previousIds.has(a.id) || this.selected.has(a.id)).map(a => a.id)); this.accountsLoaded = true;
			this.invalidateApproval(); this.targetArea.empty(); this.targetArea.createEl("h3", { text: "草稿目标" });
			if (!this.accounts.length) { this.targetArea.createEl("p", { text: "可先调整预览；发送前再到账号设置添加目标。" }); }
			for (const account of this.accounts) {
				const label = this.targetArea.createEl("label", { cls: "talos-publishing-target" });
				const checkbox = label.createEl("input", { attr: { type: "checkbox" } }); checkbox.checked = this.selected.has(account.id);
				label.createSpan({ text: `${account.platform === "wechat" ? "公众号" : "X"} · ${account.label}` });
				checkbox.addEventListener("change", () => { if (this.sending) return; if (checkbox.checked) this.selected.add(account.id); else this.selected.delete(account.id); this.invalidateApproval(); void this.showConfirmation(); });
			}
			void this.showConfirmation();
		} catch (e) { this.showError(e); }
	}
	private async showConfirmation(): Promise<void> {
		this.invalidateApproval(); const request = this.confirmationSequence;
		const { result: article, revision } = this.previewState;
		if (this.sending || this.closed || !article || !this.preview.isCurrentReady(revision)) return;
		if (!this.selected.size) { this.status.setText("预览已更新。请在账号设置添加目标，并选择草稿平台。"); return; }
		const selectedIds = [...this.selected]; const selected = this.accounts.filter(a => this.selected.has(a.id));
		if (selected.some(a => a.platform === "wechat") && !article.cover) { this.status.setText("公众号需要封面；请在左侧选择图片，预览会自动更新。"); return; }
		try {
			const approval = await this.host.proposal(article, selectedIds);
			if (this.closed || this.sending || request !== this.confirmationSequence || !this.preview.isCurrentReady(revision)) { this.host.revokeApproval(approval.id); return; }
			this.approval = { id: approval.id }; this.approvalRevision = revision;
			this.confirmArea.createEl("p", { text: `将创建草稿：${selected.map(a => a.label).join("、")}。正式发布仍由你在平台完成。` });
			if (selected.some(a => a.platform === "x")) this.confirmArea.createEl("p", { cls: "talos-publishing-x-account", text: "请核对 Chrome 当前登录账号与 X 目标一致；TALOS 无法验证浏览器账号身份。" });
			const label = this.confirmArea.createEl("label"); const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
			label.createSpan({ text: "已核对当前预览、附件和目标账号" });
			checkbox.addEventListener("change", () => { this.confirmed = checkbox.checked; this.sendButton.disabled = !this.canSend(); });
		} catch (e) { if (request === this.confirmationSequence && this.preview.isCurrentReady(revision)) this.showError(e); }
	}
	private canSend(): boolean { return !this.closed && !this.sending && this.confirmed && !!this.approval && this.preview.isCurrentReady(this.approvalRevision); }
	private lockEditing(locked: boolean): void {
		for (const input of Array.from(this.editor.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button"))) input.disabled = locked;
		this.settingsButton.disabled = locked; this.refreshButton.disabled = locked; this.sendButton.disabled = true; this.cancelButton.hidden = !locked;
	}
	private async send(): Promise<void> {
		if (!this.canSend() || !this.approval) return;
		// confirm consumes the accepted token; revoke only superseded or abandoned previews.
		const id = this.approval.id; this.sending = true; this.invalidateApproval(false); this.lockEditing(true);
		this.status.setText("正在创建草稿；已锁定本次预览与账号。X 视频处理可能需要数分钟。");
		this.timer = this.contentEl.ownerDocument.defaultView!.setInterval(() => { void this.refreshHistory(); }, 2000);
		try { const record = await this.host.confirm(id, () => { void this.refreshHistory(); }); if (!this.closed) this.status.setText(`${LABELS[aggregateRecordState(record)]}。正式发布请在平台里完成。`); }
		catch (e) { if (!this.closed) this.showError(e); }
		finally {
			this.sending = false;
			if (this.timer !== null) this.contentEl.ownerDocument.defaultView!.clearInterval(this.timer);
			this.timer = null;
			if (!this.closed) {
				this.lockEditing(false); await this.refreshHistory();
				if (this.refreshAfterSend) { this.refreshAfterSend = false; this.schedule(true); }
				else void this.showConfirmation();
			}
		}
	}
	private async refreshHistory(): Promise<void> {
		try { const records = await this.host.records(); if (this.closed) return; this.history.empty(); if (!records.length) this.history.createEl("p", { text: "还没有草稿发送记录。" }); for (const record of records.slice(-6).reverse()) this.renderRecord(record); }
		catch (e) { if (!this.closed) this.history.setText(e instanceof Error ? e.message : "草稿记录读取失败"); }
	}
	private renderRecord(record: PublishRecord): void {
		const row = this.history.createDiv({ cls: "talos-publishing-record" }); row.createEl("strong", { text: `${record.sourcePath} · ${LABELS[aggregateRecordState(record)]}` });
		for (const receipt of record.targets) {
			const line = row.createDiv(); line.createSpan({ text: `${receipt.accountLabel}：${LABELS[receipt.state]}${receipt.error ? ` · ${receipt.error}` : ""}` });
			if (receipt.draftUrl && /^https:\/\/(?:x\.com|mp\.weixin\.qq\.com)\//.test(receipt.draftUrl)) this.button(line, "打开草稿箱", () => { window.open(receipt.draftUrl, "_blank", "noopener"); });
			else if (receipt.platform === "wechat" && ["draft-created", "unknown"].includes(receipt.state)) this.button(line, "打开公众号后台", () => { window.open("https://mp.weixin.qq.com/", "_blank", "noopener"); });
		}
		if (record.targets.some(r => ["queued", "unknown", "sending"].includes(r.state))) this.button(row, "核对原草稿结果", () => { void this.host.reconcile(record.id).then(() => this.refreshHistory()).catch(e => this.showError(e)); });
	}
	private showError(cause: unknown): void { if (!this.closed) this.status?.setText(cause instanceof Error ? cause.message : "操作失败，请查看草稿记录"); }
	onClose(): void { this.closed = true; this.invalidateApproval(); this.preview?.dispose(); this.unwatch?.(); this.unwatch = null; if (this.timer !== null) this.contentEl.ownerDocument.defaultView!.clearInterval(this.timer); this.timer = null; this.contentEl.empty(); }
}

export function openPublishingModal(app: App, host: PublishingHost): void { try { new PublishingModal(app, host).open(); } catch { new Notice("无法打开草稿工作区"); } }
