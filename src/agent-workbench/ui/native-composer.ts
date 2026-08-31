import { MarkdownView, Notice, setIcon, TFile, type App } from "obsidian";
import type {
	RuntimeExecutionContext,
	RuntimeInputBlock,
} from "../contracts/runtime-adapter";
import { LocalFilePreviewPicker } from "./file-preview/local-preview-modal";

export interface NativeComposerDraft {
	input: RuntimeInputBlock[];
	context?: RuntimeExecutionContext;
	toolPolicy: { kind: "read-only" | "provider-default" };
}

export interface NativeComposerOptions {
	app: App;
	onSubmit(draft: NativeComposerDraft): Promise<void>;
	onStop(): Promise<void>;
	onCompact(): Promise<void>;
	onFork(): Promise<void>;
	onNewConversation(): Promise<void>;
	onWorkflow(mode: "plan" | "execute"): void;
	onRefine(text: string): Promise<string>;
	onInlineEdit(draft: NativeComposerDraft): Promise<void>;
}

interface ImageDraft {
	id: string;
	name: string;
	mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
	dataUrl: string;
	byteLength: number;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set<ImageDraft["mimeType"]>(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const BUILTIN_COMMANDS = [
	{ value: "/compact", label: "压缩当前上下文" },
	{ value: "/fork", label: "从当前会话分叉" },
	{ value: "/new", label: "新建会话" },
	{ value: "/plan", label: "切换到只规划" },
	{ value: "/execute", label: "切换到可执行" },
	{ value: "/refine", label: "优化当前指令" },
] as const;

function readFileDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败"));
		reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
		reader.readAsDataURL(file);
	});
}

function uniquePaths(files: TFile[]): TFile[] {
	const seen = new Set<string>();
	return files.filter((file) => !seen.has(file.path) && seen.add(file.path));
}

export class NativeComposer {
	private root: HTMLElement;
	private textarea: HTMLTextAreaElement;
	private submitButton: HTMLButtonElement;
	private contextRow: HTMLElement;
	private dropdown: HTMLElement;
	private queueRow: HTMLElement;
	private fileInput: HTMLInputElement;
	private selectedFiles: TFile[] = [];
	private images: ImageDraft[] = [];
	private enabledMcpServers = new Set<string>();
	private mcpServers: string[] = [];
	private busy = false;
	private disposed = false;

	constructor(container: HTMLElement, private readonly options: NativeComposerOptions) {
		const doc = container.ownerDocument;
		const root = doc.createElement("div");
		root.className = "claudian-input-container talos-native-composer";
		const contextRow = doc.createElement("div");
		contextRow.className = "claudian-context-row";
		root.appendChild(contextRow);
		this.contextRow = contextRow;

		const wrapper = doc.createElement("div");
		wrapper.className = "claudian-input-wrapper";
		const composer = doc.createElement("div");
		composer.className = "claudian-input-composer";
		const textarea = doc.createElement("textarea");
		textarea.className = "claudian-input";
		textarea.placeholder = "给 TALOS 发送消息…  使用 @ 添加文件，/ 使用命令";
		textarea.rows = 3;
		textarea.setAttribute("aria-label", "消息输入");
		composer.appendChild(textarea);
		this.textarea = textarea;

		const dropdown = doc.createElement("div");
		dropdown.className = "claudian-mention-dropdown";
		dropdown.hidden = true;
		wrapper.append(composer, dropdown);
		this.dropdown = dropdown;

		const toolbar = doc.createElement("div");
		toolbar.className = "claudian-input-toolbar";
		const left = doc.createElement("div");
		left.className = "claudian-input-nav-actions";
		left.append(
			this.iconButton("paperclip", "添加 Vault 文件", () => this.openFilePicker()),
			this.iconButton("file-search", "本地安全预览", () => new LocalFilePreviewPicker(this.options.app).open()),
			this.iconButton("image", "添加图片", () => this.fileInput.click()),
			this.iconButton("server", "MCP 服务器", () => this.openMcpMenu()),
			this.iconButton("wand-sparkles", "行内编辑当前选区", () => void this.submitInlineEdit()),
		);
		const submit = this.iconButton("arrow-up", "发送", () => void this.handleSubmitButton());
		submit.classList.add("claudian-submit-btn");
		this.submitButton = submit;
		toolbar.append(left, submit);
		wrapper.appendChild(toolbar);
		root.appendChild(wrapper);

		const queueRow = doc.createElement("div");
		queueRow.className = "claudian-input-queue-row";
		queueRow.hidden = true;
		root.appendChild(queueRow);
		this.queueRow = queueRow;

		const fileInput = doc.createElement("input");
		fileInput.type = "file";
		fileInput.accept = "image/png,image/jpeg,image/gif,image/webp";
		fileInput.multiple = true;
		fileInput.hidden = true;
		fileInput.addEventListener("change", () => void this.addImages(Array.from(fileInput.files ?? [])));
		root.appendChild(fileInput);
		this.fileInput = fileInput;

		textarea.addEventListener("input", () => this.updateSuggestions());
		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void this.handlePrimaryAction();
			}
			if (event.key === "Escape") this.closeDropdown();
		});
		textarea.addEventListener("paste", (event) => {
			const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
			if (images.length) { event.preventDefault(); void this.addImages(images); }
		});
		root.addEventListener("dragover", (event) => { event.preventDefault(); root.classList.add("is-dragging"); });
		root.addEventListener("dragleave", () => root.classList.remove("is-dragging"));
		root.addEventListener("drop", (event) => {
			event.preventDefault();
			root.classList.remove("is-dragging");
			const images = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
			if (images.length) void this.addImages(images);
		});
		container.appendChild(root);
		this.root = root;
		void this.discoverMcpServers();
	}

	private iconButton(icon: string, label: string, action: () => void): HTMLButtonElement {
		const button = this.root?.ownerDocument.createElement("button") ?? this.textarea?.ownerDocument.createElement("button") ?? activeDocument.createElement("button");
		button.type = "button";
		button.className = "claudian-input-nav-btn";
		button.setAttribute("aria-label", label);
		button.title = label;
		setIcon(button, icon);
		button.addEventListener("click", action);
		return button;
	}

	private async discoverMcpServers(): Promise<void> {
		const servers = new Set<string>();
		for (const path of [".mcp.json", ".claude/mcp.json"]) {
			try {
				if (!(await this.options.app.vault.adapter.exists(path))) continue;
				const parsed: unknown = JSON.parse(await this.options.app.vault.adapter.read(path));
				const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
				const mcp = record.mcpServers && typeof record.mcpServers === "object" && !Array.isArray(record.mcpServers)
					? record.mcpServers as Record<string, unknown>
					: {};
				for (const name of Object.keys(mcp)) servers.add(name);
			} catch { /* malformed MCP config remains disabled */ }
		}
		this.mcpServers = [...servers].sort((a, b) => a.localeCompare(b));
	}

	private openMcpMenu(): void {
		this.dropdown.replaceChildren();
		this.dropdown.hidden = false;
		if (!this.mcpServers.length) {
			const empty = this.dropdown.ownerDocument.createElement("div");
			empty.className = "claudian-mention-empty";
			empty.textContent = "未发现 Vault 内 MCP 配置；运行时自己的 MCP 仍按原配置工作";
			this.dropdown.appendChild(empty);
			return;
		}
		for (const server of this.mcpServers) {
			const button = this.dropdown.ownerDocument.createElement("button");
			button.type = "button";
			button.className = "claudian-mention-item";
			button.setAttribute("aria-pressed", String(this.enabledMcpServers.has(server)));
			button.textContent = `${this.enabledMcpServers.has(server) ? "✓ " : ""}${server}`;
			button.addEventListener("click", () => {
				if (this.enabledMcpServers.has(server)) this.enabledMcpServers.delete(server);
				else this.enabledMcpServers.add(server);
				this.renderContextChips();
				this.openMcpMenu();
			});
			this.dropdown.appendChild(button);
		}
	}

	private updateSuggestions(): void {
		const before = this.textarea.value.slice(0, this.textarea.selectionStart);
		if (/^\/[^\s]*$/.test(before)) {
			const query = before.toLowerCase();
			this.renderCommandSuggestions(BUILTIN_COMMANDS.filter((command) => command.value.startsWith(query)));
			return;
		}
		const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
		if (!match) { this.closeDropdown(); return; }
		const query = (match[1] ?? "").toLocaleLowerCase();
		const files = this.options.app.vault.getMarkdownFiles()
			.filter((file) => file.path.toLocaleLowerCase().includes(query))
			.slice(0, 12);
		this.renderFileSuggestions(files, match.index + match[0].indexOf("@"), this.textarea.selectionStart);
	}

	private renderCommandSuggestions(commands: readonly { value: string; label: string }[]): void {
		this.dropdown.replaceChildren();
		this.dropdown.hidden = commands.length === 0;
		for (const command of commands) {
			const button = this.dropdown.ownerDocument.createElement("button");
			button.type = "button";
			button.className = "claudian-mention-item";
			button.textContent = `${command.value} · ${command.label}`;
			button.addEventListener("click", () => {
				this.textarea.value = `${command.value} `;
				this.closeDropdown();
				this.textarea.focus();
			});
			this.dropdown.appendChild(button);
		}
	}

	private renderFileSuggestions(files: TFile[], start: number, end: number): void {
		this.dropdown.replaceChildren();
		this.dropdown.hidden = false;
		if (!files.length) {
			const empty = this.dropdown.ownerDocument.createElement("div");
			empty.className = "claudian-mention-empty";
			empty.textContent = "没有匹配文件";
			this.dropdown.appendChild(empty);
			return;
		}
		for (const file of files) {
			const button = this.dropdown.ownerDocument.createElement("button");
			button.type = "button";
			button.className = "claudian-mention-item";
			const name = button.ownerDocument.createElement("strong");
			name.className = "claudian-mention-name";
			name.textContent = file.basename;
			const path = button.ownerDocument.createElement("small");
			path.className = "claudian-mention-path";
			path.textContent = file.path;
			button.append(name, path);
			button.addEventListener("click", () => {
				this.selectedFiles = uniquePaths([...this.selectedFiles, file]);
				this.textarea.setRangeText("", start, end, "end");
				this.renderContextChips();
				this.closeDropdown();
				this.textarea.focus();
			});
			this.dropdown.appendChild(button);
		}
	}

	private openFilePicker(): void {
		const files = this.options.app.vault.getMarkdownFiles().slice(0, 40);
		this.renderFileSuggestions(files, this.textarea.selectionStart, this.textarea.selectionStart);
	}

	private closeDropdown(): void {
		this.dropdown.hidden = true;
		this.dropdown.replaceChildren();
	}

	private async addImages(files: File[]): Promise<void> {
		for (const file of files) {
			if (!IMAGE_TYPES.has(file.type as ImageDraft["mimeType"])) {
				new Notice(`不支持的图片格式：${file.name}`);
				continue;
			}
			if (file.size > MAX_IMAGE_BYTES) {
				new Notice(`图片超过 10 MB：${file.name}`);
				continue;
			}
			this.images.push({
				id: crypto.randomUUID(),
				name: file.name,
				mimeType: file.type as ImageDraft["mimeType"],
				dataUrl: await readFileDataUrl(file),
				byteLength: file.size,
			});
		}
		this.fileInput.value = "";
		this.renderContextChips();
	}

	private renderContextChips(): void {
		this.contextRow.replaceChildren();
		for (const file of this.selectedFiles) {
			const chip = this.contextRow.ownerDocument.createElement("span");
			chip.className = "claudian-file-chip";
			const name = chip.ownerDocument.createElement("span");
			name.className = "claudian-file-chip-name";
			name.textContent = file.basename;
			const remove = chip.ownerDocument.createElement("button");
			remove.type = "button";
			remove.className = "claudian-file-chip-remove";
			remove.setAttribute("aria-label", `移除 ${file.basename}`);
			remove.textContent = "×";
			remove.addEventListener("click", () => { this.selectedFiles = this.selectedFiles.filter((candidate) => candidate.path !== file.path); this.renderContextChips(); });
			chip.append(name, remove);
			this.contextRow.appendChild(chip);
		}
		for (const image of this.images) {
			const chip = this.contextRow.ownerDocument.createElement("span");
			chip.className = "claudian-image-chip";
			const preview = chip.ownerDocument.createElement("img");
			preview.className = "claudian-image-thumb";
			preview.src = image.dataUrl;
			preview.alt = "";
			const name = chip.ownerDocument.createElement("span");
			name.className = "claudian-image-name";
			name.textContent = image.name;
			const remove = chip.ownerDocument.createElement("button");
			remove.type = "button";
			remove.className = "claudian-image-remove";
			remove.textContent = "×";
			remove.addEventListener("click", () => { this.images = this.images.filter((candidate) => candidate.id !== image.id); this.renderContextChips(); });
			chip.append(preview, name, remove);
			this.contextRow.appendChild(chip);
		}
		for (const server of this.enabledMcpServers) {
			const chip = this.contextRow.ownerDocument.createElement("span");
			chip.className = "claudian-file-chip";
			chip.textContent = `MCP · ${server}`;
			this.contextRow.appendChild(chip);
		}
		this.contextRow.hidden = this.contextRow.childElementCount === 0;
	}

	private async createDraft(): Promise<NativeComposerDraft> {
		const text = this.textarea.value.trim();
		const input: RuntimeInputBlock[] = [
			...(text ? [{ type: "text" as const, text }] : []),
			...this.images.map((image) => ({
				type: "image" as const,
				id: image.id,
				name: image.name,
				mimeType: image.mimeType,
				dataUrl: image.dataUrl,
			})),
		];
		const selections: NonNullable<RuntimeExecutionContext["selections"]> = [];
		for (const file of this.selectedFiles) {
			try { selections.push({ source: "editor", path: file.path, text: await this.options.app.vault.cachedRead(file) }); }
			catch { /* removed file is ignored at submission time */ }
		}
		const markdown = this.options.app.workspace.getActiveViewOfType(MarkdownView);
		const editorSelection = markdown?.editor.getSelection().trim();
		if (editorSelection) selections.push({ source: "editor", path: markdown?.file?.path, text: editorSelection });
		const activeFile = this.options.app.workspace.getActiveFile();
		const context: RuntimeExecutionContext | undefined = selections.length || activeFile || this.enabledMcpServers.size
			? {
				...(activeFile ? { linkedContent: { path: activeFile.path } } : {}),
				...(selections.length ? { selections } : {}),
				...(this.enabledMcpServers.size ? { enabledMcpServers: [...this.enabledMcpServers] } : {}),
			}
			: undefined;
		return { input, context, toolPolicy: { kind: "provider-default" } };
	}

	private async handleSubmitButton(): Promise<void> {
		if (this.busy) { await this.options.onStop(); return; }
		await this.handlePrimaryAction();
	}

	private async handlePrimaryAction(): Promise<void> {
		if (this.busy) {
			const draft = await this.createDraft();
			if (draft.input.length) await this.options.onSubmit(draft);
			return;
		}
		const command = this.textarea.value.trim().toLowerCase();
		if (command === "/compact") { this.textarea.value = ""; await this.options.onCompact(); return; }
		if (command === "/fork") { this.textarea.value = ""; await this.options.onFork(); return; }
		if (command === "/new") { this.textarea.value = ""; await this.options.onNewConversation(); return; }
		if (command === "/plan" || command === "/execute") {
			this.textarea.value = "";
			this.options.onWorkflow(command === "/plan" ? "plan" : "execute");
			new Notice(command === "/plan" ? "已切换为只规划" : "已切换为可执行");
			return;
		}
		if (command.startsWith("/refine ")) {
			const source = this.textarea.value.trim().slice("/refine ".length).trim();
			if (!source) return;
			this.setBusy(true);
			try { this.textarea.value = await this.options.onRefine(source); }
			finally { this.setBusy(false); }
			return;
		}
		const draft = await this.createDraft();
		if (!draft.input.length) return;
		await this.options.onSubmit(draft);
	}

	private async submitInlineEdit(): Promise<void> {
		const markdown = this.options.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdown?.editor.getSelection().trim()) {
			new Notice("请先在当前 Markdown 笔记中选择要修改的文字");
			return;
		}
		const draft = await this.createDraft();
		if (!draft.input.length) draft.input.push({ type: "text", text: "请改写当前选区，保持原意并只返回替换文本。" });
		await this.options.onInlineEdit(draft);
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		this.submitButton.replaceChildren();
		setIcon(this.submitButton, busy ? "square" : "arrow-up");
		this.submitButton.setAttribute("aria-label", busy ? "停止" : "发送");
		this.root.classList.toggle("is-streaming", busy);
	}

	setQueueMessage(message?: string): void {
		this.queueRow.hidden = !message;
		this.queueRow.textContent = message ?? "";
	}

	restoreAfterFailure(draft: NativeComposerDraft): void {
		this.textarea.value = draft.input
			.flatMap((block) => block.type === "text" ? [block.text] : [])
			.join("\n\n");
		this.images = draft.input.flatMap((block): ImageDraft[] => block.type === "image" ? [{
			id: block.id,
			name: block.name,
			mimeType: block.mimeType as ImageDraft["mimeType"],
			dataUrl: block.dataUrl,
			byteLength: 0,
		}] : []);
		const files = (draft.context?.selections ?? [])
			.flatMap((selection) => selection.path ? [this.options.app.vault.getAbstractFileByPath(selection.path)] : [])
			.filter((file): file is TFile => file instanceof TFile);
		this.selectedFiles = uniquePaths(files);
		this.enabledMcpServers = new Set(draft.context?.enabledMcpServers ?? []);
		this.renderContextChips();
		this.updateSuggestions();
	}

	clearAfterSend(): void {
		this.textarea.value = "";
		this.images = [];
		this.renderContextChips();
	}

	focus(): void { this.textarea.focus(); }
	getValue(): string { return this.textarea.value; }
	setValue(value: string): void { this.textarea.value = value; }

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.root.remove();
		this.selectedFiles = [];
		this.images = [];
		this.enabledMcpServers.clear();
	}
}
