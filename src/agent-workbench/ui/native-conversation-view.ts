import { MarkdownView, Notice, normalizePath, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { createAgentEvent, type AgentEvent } from "../contracts/agent-events";
import type { ConversationManifest } from "../contracts/conversation";
import { executionText } from "../contracts/execution-request";
import type { RuntimeId } from "../contracts/runtime-adapter";
import type {
	AgentWorkbenchInteractionPort,
	AgentWorkbenchService,
} from "../core/agent-workbench-service";
import { projectMessages } from "../storage/conversation-projection";
import { conversationPreview } from "./conversation-display";
import { NativeComposer, type NativeComposerDraft } from "./native-composer";
import { NativeEventRenderer } from "./native-event-renderer";

export interface NativeConversationViewOptions {
	leaf: WorkspaceLeaf;
	service: AgentWorkbenchService;
	onSelectionChanged?(runtimeId: RuntimeId, model?: string): void;
}

function textValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function runtimeEvents(events: AgentEvent[], runtimeId: RuntimeId): AgentEvent[] {
	return events.filter((event) => event.runtimeId === runtimeId);
}

function safeExportName(value: string): string {
	return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "TALOS 会话";
}

function approvalDisplayValue(value: unknown, key = ""): unknown {
	if (/secret|token|password|api[_-]?key|authorization|cookie/i.test(key)) return "[已隐藏]";
	if (Array.isArray(value)) return value.map((item) => approvalDisplayValue(item));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, approvalDisplayValue(item, name)]));
	}
	return value;
}

export class NativeConversationView implements AgentWorkbenchInteractionPort {
	private static readonly MAX_OPEN_CONVERSATIONS = 6;
	private readonly app: App;
	private root: HTMLElement | null = null;
	private tabBar: HTMLElement | null = null;
	private messages: HTMLElement | null = null;
	private history: HTMLElement | null = null;
	private historyList: HTMLElement | null = null;
	private approvalRegion: HTMLElement | null = null;
	private composerHost: HTMLElement | null = null;
	private composer: NativeComposer | null = null;
	private renderer: NativeEventRenderer | null = null;
	private activeConversationId: string | null = null;
	private openConversationIds: string[] = [];
	private manifests = new Map<string, ConversationManifest>();
	private mounted = false;
	private destroyed = false;
	private readonly runningConversationIds = new Set<string>();
	private readonly queuedDrafts = new Map<string, NativeComposerDraft>();
	private readonly liveEvents = new Map<string, AgentEvent[]>();
	private readonly pendingUserEvents = new Map<string, AgentEvent>();
	private openRequestVersion = 0;
	private historyRequestVersion = 0;
	private newConversationRequest: Promise<void> | null = null;
	private readonly pendingInteractionCancels = new Map<string, Set<() => void>>();

	constructor(private readonly options: NativeConversationViewOptions) {
		this.app = options.leaf.view.app;
	}

	private isRunning(conversationId = this.activeConversationId): boolean {
		return Boolean(conversationId && this.runningConversationIds.has(conversationId));
	}

	private visibleEvents(events: AgentEvent[], manifest: ConversationManifest): AgentEvent[] {
		const persisted = runtimeEvents(events, manifest.selection.runtimeId);
		const transient = this.liveEvents.get(manifest.conversationId) ?? [];
		const seen = new Set(persisted.map((event) => event.eventId));
		return [...persisted, ...transient.filter((event) => !seen.has(event.eventId))];
	}

	private syncComposerState(): void {
		const conversationId = this.activeConversationId;
		this.composer?.setBusy(this.isRunning(conversationId));
		this.composer?.setQueueMessage(
			conversationId && this.queuedDrafts.has(conversationId)
				? "已排队 1 条消息，将在当前回合结束后发送"
				: undefined,
		);
	}

	private interactionCancels(conversationId: string): Set<() => void> {
		let cancels = this.pendingInteractionCancels.get(conversationId);
		if (!cancels) this.pendingInteractionCancels.set(conversationId, cancels = new Set());

		return cancels;
	}

	private syncInteractionVisibility(): void {
		if (!this.approvalRegion) return;
		for (const child of Array.from(this.approvalRegion.children)) {
			const owner = (child as HTMLElement).dataset.conversationId;
			(child as HTMLElement).hidden = Boolean(owner && owner !== this.activeConversationId);
		}
	}
	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") throw new Error("TALOS 原生对话只允许 chat 命名空间");
		if (this.destroyed) throw new Error("TALOS 原生对话视图已释放");
		if (!this.root) this.build(container.ownerDocument);
		if (!this.root) throw new Error("TALOS 原生对话外壳未创建");
		if (this.root.parentElement !== container) container.appendChild(this.root);
		this.options.service.attachInteractionPort(this);
		if (!this.mounted) {
			this.mounted = true;
			await this.restoreConversations();
		}
	}

	private build(doc: Document): void {
		const root = doc.createElement("div");
		root.className = "claudian-container claudian-embedded-root talos-native-chat";
		root.dataset.talosImplementation = "native";

		const tabRow = doc.createElement("div");
		tabRow.className = "claudian-tab-bar-container";
		const historyButton = doc.createElement("button");
		historyButton.type = "button";
		historyButton.className = "claudian-nav-btn claudian-nav-btn-top";
		historyButton.setAttribute("aria-label", "会话历史");
		setIcon(historyButton, "panel-left");
		historyButton.addEventListener("click", () => this.toggleHistory());
		const tabBar = doc.createElement("div");
		tabBar.className = "claudian-tab-badges";
		tabBar.setAttribute("role", "tablist");
		const newButton = doc.createElement("button");
		newButton.type = "button";
		newButton.className = "claudian-new-tab-btn";
		newButton.setAttribute("aria-label", "新建会话");
		setIcon(newButton, "plus");
		newButton.addEventListener("click", () => void this.newConversation());
		tabRow.append(historyButton, tabBar, newButton);
		root.appendChild(tabRow);
		this.tabBar = tabBar;

		const main = doc.createElement("div");
		main.className = "talos-native-chat-main";
		const history = this.buildHistory(doc);
		main.appendChild(history);
		const content = doc.createElement("div");
		content.className = "claudian-tab-content-container";
		const wrapper = doc.createElement("div");
		wrapper.className = "claudian-messages-wrapper";
		const messages = doc.createElement("div");
		messages.className = "claudian-messages claudian-messages-focusable";
		messages.tabIndex = 0;
		wrapper.appendChild(messages);
		content.appendChild(wrapper);
		const approval = doc.createElement("div");
		approval.className = "talos-native-approval-region";
		approval.setAttribute("aria-live", "assertive");
		content.appendChild(approval);
		const composerHost = doc.createElement("div");
		composerHost.className = "claudian-active-input-slot";
		content.appendChild(composerHost);
		main.appendChild(content);
		root.appendChild(main);

		this.root = root;
		this.messages = messages;
		this.approvalRegion = approval;
		this.composerHost = composerHost;
		this.renderer = new NativeEventRenderer(messages, this.app, () => this.app.workspace.getActiveFile()?.path ?? "");
		this.composer = new NativeComposer(composerHost, {
			app: this.app,
			onSubmit: (draft) => this.submit(draft),
			onStop: () => this.stop(),
			onCompact: () => this.compact(),
			onFork: () => this.fork(),
			onNewConversation: () => this.newConversation(),
			onWorkflow: (mode) => this.options.service.setWorkflowMode(mode),
			onRefine: (text) => this.refineInstruction(text),
			onInlineEdit: (draft) => this.inlineEdit(draft),
		});
	}

	private buildHistory(doc: Document): HTMLElement {
		const history = doc.createElement("aside");
		history.className = "claudian-history-container talos-native-history";
		history.hidden = true;
		const header = doc.createElement("div");
		header.className = "claudian-history-header";
		const title = doc.createElement("strong");
		title.textContent = "会话历史";
		const close = doc.createElement("button");
		close.type = "button";
		close.setAttribute("aria-label", "关闭历史");
		setIcon(close, "x");
		close.addEventListener("click", () => this.toggleHistory(false));
		header.append(title, close);
		const search = doc.createElement("input");
		search.type = "search";
		search.placeholder = "搜索会话";
		search.setAttribute("aria-label", "搜索会话");
		search.addEventListener("input", () => void this.renderHistory(search.value));
		const list = doc.createElement("div");
		list.className = "claudian-history-list";
		history.append(header, search, list);
		this.history = history;
		this.historyList = list;
		return history;
	}

	private toggleHistory(force?: boolean): void {
		if (!this.history) return;
		this.history.hidden = force === undefined ? !this.history.hidden : !force;
		if (!this.history.hidden) void this.renderHistory();
		void this.persistUiState();
	}

	private persistUiState(): Promise<void> {
		return this.options.service.saveUiState({
			schemaVersion: 1,
			openConversationIds: [...this.openConversationIds],
			...(this.activeConversationId ? { activeConversationId: this.activeConversationId } : {}),
			historyOpen: this.history ? !this.history.hidden : false,
		}).catch(() => undefined);
	}

	private async restoreConversations(): Promise<void> {
		const manifests = await this.options.service.listConversations();
		this.manifests = new Map(manifests.map((manifest) => [manifest.conversationId, manifest]));
		const saved = await this.options.service.loadUiState();
		const active = manifests.filter((manifest) => manifest.lifecycle === "active").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		this.openConversationIds = saved.openConversationIds.filter((id) => this.manifests.get(id)?.lifecycle === "active").slice(-6);
		if (!this.openConversationIds.length) this.openConversationIds = active.slice(0, 6).map((manifest) => manifest.conversationId).reverse();
		if (this.history) this.history.hidden = !saved.historyOpen;
		if (!this.openConversationIds.length) {
			this.activeConversationId = null;
			this.renderTabs();
			await this.renderer?.render([]);
			return;
		}
		const selected = saved.activeConversationId && this.openConversationIds.includes(saved.activeConversationId)
			? saved.activeConversationId
			: this.openConversationIds.at(-1)!;
		await this.openConversation(selected);
	}

	private async refreshManifests(): Promise<void> {
		const manifests = await this.options.service.listConversations();
		this.manifests = new Map(manifests.map((manifest) => [manifest.conversationId, manifest]));
	}

	private trackOpenConversation(id: string): string[] {
		if (this.openConversationIds.includes(id)) return [];
		this.openConversationIds.push(id);
		if (this.openConversationIds.length > NativeConversationView.MAX_OPEN_CONVERSATIONS) {
			return this.openConversationIds.splice(0, this.openConversationIds.length - NativeConversationView.MAX_OPEN_CONVERSATIONS);
		}
		return [];
	}

	private renderTabs(): void {
		if (!this.tabBar) return;
		this.tabBar.replaceChildren();
		for (const [index, id] of this.openConversationIds.entries()) {
			const manifest = this.manifests.get(id);
			if (!manifest) continue;
			const tab = this.tabBar.ownerDocument.createElement("div");
			tab.className = `claudian-tab-badge claudian-tab-badge-expanded ${id === this.activeConversationId ? "claudian-tab-badge-active" : "claudian-tab-badge-idle"}`;
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-selected", String(id === this.activeConversationId));
			tab.dataset.provider = manifest.selection.runtimeId;
			const number = tab.ownerDocument.createElement("span");
			number.className = "talos-quyuan-tab-index";
			number.textContent = String(index + 1);
			const title = tab.ownerDocument.createElement("span");
			title.className = "talos-quyuan-tab-title";
			title.textContent = manifest.title;
			const close = tab.ownerDocument.createElement("button");
			close.type = "button";
			close.className = "talos-quyuan-tab-close";
			close.setAttribute("aria-label", `关闭 ${manifest.title}`);
			close.textContent = "×";
			close.addEventListener("click", (event) => { event.stopPropagation(); void this.closeTab(id); });
			tab.append(number, title, close);
			tab.addEventListener("click", () => void this.openConversation(id));
			this.tabBar.appendChild(tab);
		}
	}

	private async openConversation(id: string): Promise<void> {
		const requestVersion = ++this.openRequestVersion;
		const projection = await this.options.service.loadConversation(id);
		if (this.destroyed || requestVersion !== this.openRequestVersion) return;
		this.activeConversationId = id;
		this.syncInteractionVisibility();
		this.manifests.set(id, projection.manifest);
		const evicted = this.trackOpenConversation(id);
		for (const evictedId of evicted) {
			if (this.isRunning(evictedId)) continue;
			const discarded = await this.options.service.discardEmptyConversation(evictedId).catch(() => false);
			if (discarded) this.manifests.delete(evictedId);
		}
		if (this.destroyed || requestVersion !== this.openRequestVersion) return;
		this.options.service.restoreSelection(projection.manifest.selection);
		this.options.onSelectionChanged?.(
			projection.manifest.selection.runtimeId,
			projection.manifest.selection.model,
		);
		this.renderTabs();
		await this.renderer?.render(this.visibleEvents(projection.events, projection.manifest));
		if (this.destroyed || requestVersion !== this.openRequestVersion) return;
		const pendingUser = this.pendingUserEvents.get(id);
		if (pendingUser) this.renderer?.appendPendingUser(pendingUser);
		await this.persistUiState();
		this.syncComposerState();
		this.composer?.focus();
	}

	private async closeTab(id: string): Promise<void> {
		if (this.isRunning(id)) {
			new Notice("请先停止当前回合");
			return;
		}
		const discarded = await this.options.service.discardEmptyConversation(id).catch(() => false);
		if (discarded) this.manifests.delete(id);
		this.openConversationIds = this.openConversationIds.filter((candidate) => candidate !== id);
		if (this.activeConversationId === id) this.activeConversationId = null;
		if (!this.openConversationIds.length) {
			this.renderTabs();
			await this.renderer?.render([]);
			await this.persistUiState();
			this.syncComposerState();
			this.composer?.focus();
			return;
		}
		if (!this.activeConversationId) await this.openConversation(this.openConversationIds.at(-1)!);
		else { this.renderTabs(); await this.persistUiState(); }
	}

	private newConversation(): Promise<void> {
		if (this.newConversationRequest) return this.newConversationRequest;
		this.newConversationRequest = this.createOrReuseConversation().finally(() => {
			this.newConversationRequest = null;
		});
		return this.newConversationRequest;
	}

	private async createOrReuseConversation(): Promise<void> {
		const currentId = this.activeConversationId;
		if (currentId && !this.isRunning(currentId)) {
			const current = await this.options.service.loadConversation(currentId);
			if (
				this.activeConversationId === currentId
				&& current.manifest.lifecycle === "active"
				&& current.manifest.title === "新会话"
				&& current.events.length === 0
			) {
				this.composer?.focus();
				return;
			}
		}
		if (this.destroyed) return;
		const created = await this.options.service.createConversation();
		this.manifests.set(created.conversationId, created);
		await this.openConversation(created.conversationId);
	}

	async selectRuntime(runtimeId: RuntimeId, modelId?: string): Promise<boolean> {
		if (!this.activeConversationId) {
			this.options.service.selectRuntime(runtimeId, modelId);
			const created = await this.options.service.createConversation();
			this.manifests.set(created.conversationId, created);
			await this.openConversation(created.conversationId);
			return false;
		}
		const conversationId = this.activeConversationId;
		const current = await this.options.service.loadConversation(conversationId);
		const sameRuntime = current.manifest.selection.runtimeId === runtimeId;
		if (sameRuntime) {
			this.options.service.selectRuntime(runtimeId, modelId);
			await this.options.service.persistConversationSelection(conversationId);
			const projection = await this.options.service.loadConversation(conversationId);
			if (this.activeConversationId !== conversationId) return false;
			this.manifests.set(conversationId, projection.manifest);
			this.renderTabs();
			await this.renderer?.render(this.visibleEvents(projection.events, projection.manifest));
			await this.persistUiState();
			return false;
		}
		const hasConversationContent = current.events.some((event) =>
			event.type === "user.message" || event.type === "assistant.final"
		);
		if (this.isRunning(conversationId) || hasConversationContent) {
			this.options.service.selectRuntime(runtimeId, modelId);
			const created = await this.options.service.createConversation();
			this.manifests.set(created.conversationId, created);
			await this.openConversation(created.conversationId);
			return false;
		}
		const requestVersion = ++this.openRequestVersion;
		const handoffCreated = await this.options.service.switchConversationRuntime(conversationId, runtimeId, modelId);
		if (this.activeConversationId !== conversationId || requestVersion !== this.openRequestVersion) return handoffCreated;
		const projection = await this.options.service.loadConversation(conversationId);
		if (this.activeConversationId !== conversationId || requestVersion !== this.openRequestVersion) return handoffCreated;
		this.manifests.set(conversationId, projection.manifest);
		this.options.onSelectionChanged?.(projection.manifest.selection.runtimeId, projection.manifest.selection.model);
		this.renderTabs();
		await this.renderer?.render(this.visibleEvents(projection.events, projection.manifest));
		await this.persistUiState();
		return handoffCreated;
	}

	async persistCurrentSelection(): Promise<void> {
		if (!this.activeConversationId) return;
		const conversationId = this.activeConversationId;
		await this.options.service.persistConversationSelection(conversationId);
		if (this.activeConversationId !== conversationId) return;
		const projection = await this.options.service.loadConversation(conversationId);
		if (this.activeConversationId !== conversationId) return;
		this.manifests.set(conversationId, projection.manifest);
		this.renderTabs();
	}

	private async submit(draft: NativeComposerDraft): Promise<void> {
		if (!this.activeConversationId) {
			await this.newConversation();
			if (!this.activeConversationId) return;
		}
		await this.runConversation(this.activeConversationId, draft);
	}

	private async runConversation(conversationId: string, draft: NativeComposerDraft): Promise<void> {
		if (this.isRunning(conversationId)) {
			const text = draft.input.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
			const hasRichInput = draft.input.some((block) => block.type === "image")
				|| Boolean(draft.context?.selections?.length)
				|| Boolean(draft.context?.externalContextPaths?.length)
				|| Boolean(draft.context?.enabledMcpServers?.length);
			if (text && !hasRichInput && await this.options.service.steerConversationTurn(conversationId, text)) {
				if (this.activeConversationId === conversationId) {
					this.composer?.clearAfterSend();
					this.composer?.setQueueMessage("已把补充内容发送给当前回合");
				}
				return;
			}
			this.queuedDrafts.set(conversationId, draft);
			if (this.activeConversationId === conversationId) {
				this.composer?.clearAfterSend();
				this.syncComposerState();
			}
			return;
		}
		const displayText = executionText(draft.input) || "[图片]";
		const pendingUser = createAgentEvent({
			eventId: `pending-user-${crypto.randomUUID()}`,
			conversationId,
			turnId: `pending-turn-${crypto.randomUUID()}`,
			runtimeId: this.manifests.get(conversationId)?.selection.runtimeId ?? this.options.service.getSelection().runtimeId,
			type: "user.message",
			timestamp: new Date().toISOString(),
			payload: {
				text: displayText,
				images: draft.input.flatMap((block) => block.type === "image" ? [{ name: block.name }] : []),
			},
		});
		this.pendingUserEvents.set(conversationId, pendingUser);
		if (this.activeConversationId === conversationId) this.renderer?.appendPendingUser(pendingUser);
		let userMessageAccepted = false;
		let preparationFailed = false;
		this.runningConversationIds.add(conversationId);
		if (this.activeConversationId === conversationId) {
			this.composer?.clearAfterSend();
			this.syncComposerState();
		}
		try {
			for await (const event of this.options.service.executeConversationTurn(conversationId, draft)) {
				if (event.type === "user.message") {
					userMessageAccepted = true;
					this.pendingUserEvents.delete(conversationId);
				}
				if (event.type === "error" && event.payload.accepted === false) {
					preparationFailed = true;
				}
				if (event.type === "assistant.final" || event.type === "turn.finished") {
					const remaining = (this.liveEvents.get(conversationId) ?? []).filter((candidate) => candidate.turnId !== event.turnId);
					if (remaining.length) this.liveEvents.set(conversationId, remaining);
					else this.liveEvents.delete(conversationId);
				} else if (event.type === "assistant.delta" || event.type === "thinking.delta" || event.type === "tool.updated") {
					const events = this.liveEvents.get(conversationId) ?? [];
					events.push(event);
					this.liveEvents.set(conversationId, events);
				}
				if (this.activeConversationId === conversationId) await this.renderer?.append(event);
			}
			await this.refreshManifests();
			this.renderTabs();
		} catch (error) {
			preparationFailed = true;
			new Notice(`消息未发送：${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.dismissPendingInteractions(conversationId);
			if (!userMessageAccepted && this.activeConversationId === conversationId) {
				this.renderer?.markPendingUserFailed();
				if (preparationFailed) this.composer?.restoreAfterFailure(draft);
			}
			this.pendingUserEvents.delete(conversationId);
			this.runningConversationIds.delete(conversationId);
			this.liveEvents.delete(conversationId);
			const queued = this.queuedDrafts.get(conversationId);
			this.queuedDrafts.delete(conversationId);
			if (this.activeConversationId === conversationId) this.syncComposerState();
			if (queued) await this.runConversation(conversationId, queued);
		}
	}

	private async stop(): Promise<void> {
		if (!this.activeConversationId) return;
		this.dismissPendingInteractions(this.activeConversationId);
		await this.options.service.cancelConversationTurn(this.activeConversationId);
	}

	private async compact(): Promise<void> {
		if (!this.activeConversationId) return;
		if (!await this.options.service.compactConversation(this.activeConversationId)) {
			new Notice("当前智能体不支持原生上下文压缩");
		}
	}

	private async fork(): Promise<void> {
		if (!this.activeConversationId || this.isRunning(this.activeConversationId)) return;
		const target = await this.options.service.forkConversation(this.activeConversationId);
		this.manifests.set(target.conversationId, target);
		await this.openConversation(target.conversationId);
	}

	private async inlineEdit(draft: NativeComposerDraft): Promise<void> {
		const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdown) return;
		const original = markdown.editor.getSelection();
		if (!original.trim()) return;
		const instruction = draft.input.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n").trim() || "请改写选区，保持原意，只返回替换文本。";
		const request: NativeComposerDraft = {
			...draft,
			input: [{ type: "text", text: `${instruction}\n\n<selection>\n${original}\n</selection>` }],
		};
		const before = await this.options.service.createConversation("行内编辑预览");
		let replacement = "";
		try {
			for await (const event of this.options.service.executeConversationTurn(before.conversationId, request)) {
				if (event.type === "assistant.final") replacement = textValue(event.payload.text, replacement);
				else if (event.type === "assistant.delta") replacement += textValue(event.payload.text);
			}
			if (!replacement.trim()) throw new Error("智能体没有返回替换文本");
			const accepted = await this.confirmInlineEdit(original, replacement.trim());
			if (accepted && markdown.editor.getSelection() === original) markdown.editor.replaceSelection(replacement.trim());
			else if (accepted) new Notice("编辑器选区已变化，未应用替换");
		} finally {
			await this.options.service.setConversationLifecycle(before.conversationId, "deleted");
		}
	}

	private async refineInstruction(source: string): Promise<string> {
		const conversation = await this.options.service.createConversation("指令优化预览");
		let result = "";
		try {
			for await (const event of this.options.service.executeConversationTurn(conversation.conversationId, {
				input: [{ type: "text", text: `请把下面的指令改写得更清晰、可执行；只返回改写后的指令。\n\n<instruction>\n${source}\n</instruction>` }],
				toolPolicy: { kind: "read-only" },
			})) {
				if (event.type === "assistant.final") result = textValue(event.payload.text, result);
				else if (event.type === "assistant.delta") result += textValue(event.payload.text);
			}
			if (!result.trim()) throw new Error("智能体没有返回优化后的指令");
			return result.trim();
		} finally {
			await this.options.service.setConversationLifecycle(conversation.conversationId, "deleted");
		}
	}

	private confirmInlineEdit(original: string, replacement: string): Promise<boolean> {
		return new Promise((resolve) => {
			if (!this.approvalRegion) { resolve(false); return; }
			const card = this.approvalRegion.ownerDocument.createElement("div");
			card.className = "claudian-inline-diff-preview";
			const body = card.ownerDocument.createElement("pre");
			body.className = "claudian-inline-diff-preview-body";
			body.textContent = `- ${original}\n+ ${replacement}`;
			const actions = card.ownerDocument.createElement("div");
			actions.className = "claudian-inline-preview-actions";
			const finish = (value: boolean) => { card.remove(); resolve(value); };
			actions.append(this.actionButton("应用", () => finish(true)), this.actionButton("取消", () => finish(false)));
			card.append(body, actions);
			this.approvalRegion.appendChild(card);
		});
	}

	private actionButton(label: string, action: () => void): HTMLButtonElement {
		const button = (this.approvalRegion?.ownerDocument ?? activeDocument).createElement("button");
		button.type = "button";
		button.className = "claudian-action-btn";
		button.textContent = label;
		button.addEventListener("click", action);
		return button;
	}

	async approveAction(input: Parameters<AgentWorkbenchInteractionPort["approveAction"]>[0]): Promise<"allow" | "allow-always" | "deny" | "cancel"> {
		return new Promise((resolve) => {
			if (!this.approvalRegion) { resolve("deny"); return; }
			const card = this.approvalRegion.ownerDocument.createElement("section");
			card.className = "claudian-ask-approval-agent";
			card.dataset.conversationId = input.conversationId;
			const policy = recordValue(input.options);
			const risk = textValue(policy.risk, "C");
			const phase = textValue(policy.phase, "execute");
			const actionKind = textValue(policy.actionKind, "unknown");
			const phaseLabel = phase === "proposal" ? "提案预览" : risk === "C" ? "独立执行批准" : "执行批准";
			const title = card.ownerDocument.createElement("strong");
			title.className = "claudian-ask-approval-tool-name";
			title.textContent = input.runtimeId + " · " + input.toolName + " · " + phaseLabel;
			const reason = card.ownerDocument.createElement("p");
			reason.className = "claudian-ask-approval-reason";
			reason.textContent = "风险 " + risk + " · " + input.reason;
			const target = card.ownerDocument.createElement("pre");
			target.className = "claudian-ask-approval-desc";
			target.textContent = JSON.stringify(approvalDisplayValue({
				canonicalToolId: policy.canonicalToolId,
				targets: policy.targets,
				recovery: policy.recovery,
				proposalAvailable: policy.proposalAvailable,
				proposal: input.toolInput,
			}), null, 2);
			const actions = card.ownerDocument.createElement("div");
			actions.className = "claudian-input-nav-actions";
			const cancels = this.interactionCancels(input.conversationId);
			const finish = (decision: "allow" | "allow-always" | "deny" | "cancel") => {
				cancels.delete(cancel);
				card.remove();
				resolve(decision);
			};
			const cancel = () => finish("cancel");
			cancels.add(cancel);
			actions.append(
				this.actionButton(
					phase === "proposal" ? "确认提案" : risk === "C" ? "批准执行" : "允许一次",
					() => finish("allow")
				),
			);
			if (risk === "B" && actionKind !== "unknown") {
				actions.append(this.actionButton("允许并记住", () => finish("allow-always")));
			}
			actions.append(this.actionButton("拒绝", () => finish("deny")));
			card.append(title, reason, target, actions);
			this.approvalRegion.appendChild(card);
			this.syncInteractionVisibility();
		});
	}

	async answerQuestion(event: AgentEvent): Promise<Record<string, string | string[]> | null> {
		return new Promise((resolve) => {
			if (!this.approvalRegion) { resolve(null); return; }
			const card = this.approvalRegion.ownerDocument.createElement("section");
			card.className = "claudian-ask-question-inline";
			card.dataset.conversationId = event.conversationId;
			const rawQuestions = Array.isArray(event.payload.questions) && event.payload.questions.length
				? event.payload.questions
				: [event.payload];
			const controls: Array<{ id: string; control: HTMLTextAreaElement | HTMLSelectElement }> = [];
			for (const [index, raw] of rawQuestions.entries()) {
				const question = recordValue(raw);
				const field = card.ownerDocument.createElement("div");
				field.className = "claudian-ask-question-item";
				const label = field.ownerDocument.createElement("label");
				label.className = "claudian-ask-question-text";
				label.textContent = textValue(question.question) || textValue(question.message) || textValue(question.header) || "请补充信息";
				const id = textValue(question.id) || textValue(question.header) || `answer-${index + 1}`;
				const options = Array.isArray(question.options) ? question.options : [];
				if (options.length) {
					const select = field.ownerDocument.createElement("select");
					select.className = "claudian-ask-choice-list";
					select.multiple = question.multiSelect === true;
					for (const rawOption of options) {
						const optionValue = recordValue(rawOption);
						const option = select.ownerDocument.createElement("option");
						option.value = textValue(optionValue.value) || textValue(optionValue.label) || textValue(rawOption);
						option.textContent = textValue(optionValue.label) || option.value;
						select.appendChild(option);
					}
					field.append(label, select);
					controls.push({ id, control: select });
				} else {
					const input = field.ownerDocument.createElement("textarea");
					input.className = "claudian-ask-custom-text";
					field.append(label, input);
					controls.push({ id, control: input });
				}
				card.appendChild(field);
			}
			const cancels = this.interactionCancels(event.conversationId);
			const finish = (answer: Record<string, string | string[]> | null) => {
				cancels.delete(cancel);
				card.remove();
				resolve(answer);
			};
			const cancel = () => finish(null);
			cancels.add(cancel);
			card.append(
				this.actionButton("提交", () => finish(Object.fromEntries(controls.map(({ id, control }) => [
					id,
					control.tagName === "SELECT" && (control as HTMLSelectElement).multiple
						? Array.from((control as HTMLSelectElement).selectedOptions).map((option) => option.value)
						: control.value,
				])))),
				this.actionButton("取消", () => finish(null)),
			);
			this.approvalRegion.appendChild(card);
			controls[0]?.control.focus();
			this.syncInteractionVisibility();
		});
	}

	private dismissPendingInteractions(conversationId?: string): void {
		if (conversationId) {
			const cancels = this.pendingInteractionCancels.get(conversationId);
			for (const cancel of [...(cancels ?? [])]) cancel();
			this.pendingInteractionCancels.delete(conversationId);
			return;
		}
		for (const cancels of this.pendingInteractionCancels.values()) {
			for (const cancel of [...cancels]) cancel();
		}
		this.pendingInteractionCancels.clear();
	}

	private async renderHistory(query = ""): Promise<void> {
		if (!this.historyList) return;
		const requestVersion = ++this.historyRequestVersion;
		await this.refreshManifests();
		if (this.destroyed || requestVersion !== this.historyRequestVersion || !this.historyList) return;
		const needle = query.trim().toLocaleLowerCase();
		const manifests = [...this.manifests.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		const entries = await Promise.all(manifests.map(async (manifest) => ({
			manifest,
			projection: await this.options.service.loadConversation(manifest.conversationId),
		})));
		if (this.destroyed || requestVersion !== this.historyRequestVersion || !this.historyList) return;
		this.historyList.replaceChildren();
		for (const { manifest, projection } of entries) {
			if (needle && !manifest.title.toLocaleLowerCase().includes(needle)) {
				if (!projectMessages(runtimeEvents(projection.events, manifest.selection.runtimeId)).some((message) => message.text.toLocaleLowerCase().includes(needle))) continue;
			}
			const item = this.historyList.ownerDocument.createElement("div");
			item.className = "claudian-history-item";
			item.dataset.lifecycle = manifest.lifecycle;
			const content = item.ownerDocument.createElement("button");
			content.type = "button";
			content.className = "claudian-history-item-content";
			const title = content.ownerDocument.createElement("strong");
			title.className = "claudian-history-item-title";
			title.textContent = manifest.title;
			const summary = content.ownerDocument.createElement("span");
			summary.className = "claudian-history-item-summary";
			summary.textContent = conversationPreview(runtimeEvents(projection.events, manifest.selection.runtimeId)) || "暂无对话内容";
			const date = content.ownerDocument.createElement("small");
			date.className = "claudian-history-item-date";
			date.textContent = `${manifest.selection.runtimeId} · ${new Date(manifest.updatedAt).toLocaleString()}${manifest.importedFrom ? " · 旧历史" : ""}`;
			content.append(title, summary, date);
			content.addEventListener("click", () => { void this.openConversation(manifest.conversationId); this.toggleHistory(false); });
			const actions = item.ownerDocument.createElement("div");
			actions.className = "claudian-history-item-actions";
			actions.append(
				this.historyAction("pencil", "重命名", () => void this.renameConversation(manifest)),
				this.historyAction(manifest.lifecycle === "active" ? "archive" : "archive-restore", manifest.lifecycle === "active" ? "归档" : "恢复", () => void this.toggleLifecycle(manifest)),
				this.historyAction("download", "导出", () => void this.exportConversation(manifest)),
				this.historyAction("trash-2", "软删除", () => void this.deleteConversation(manifest)),
			);
			item.append(content, actions);
			this.historyList.appendChild(item);
		}
		if (!this.historyList.childElementCount) {
			const empty = this.historyList.ownerDocument.createElement("div");
			empty.className = "claudian-history-empty";
			empty.textContent = "没有匹配会话";
			this.historyList.appendChild(empty);
		}
	}

	private historyAction(icon: string, label: string, action: () => void): HTMLButtonElement {
		const button = (this.historyList?.ownerDocument ?? activeDocument).createElement("button");
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.title = label;
		setIcon(button, icon);
		button.addEventListener("click", (event) => { event.stopPropagation(); action(); });
		return button;
	}

	private async renameConversation(manifest: ConversationManifest): Promise<void> {
		// Obsidian may render the workbench in a popout window, so use its active window.
		const next = activeWindow.prompt("会话标题", manifest.title)?.trim();
		if (!next) return;
		await this.options.service.renameConversation(manifest.conversationId, next);
		await this.refreshManifests();
		this.renderTabs();
		await this.renderHistory();
	}

	private async toggleLifecycle(manifest: ConversationManifest): Promise<void> {
		await this.options.service.setConversationLifecycle(manifest.conversationId, manifest.lifecycle === "active" ? "archived" : "active");
		await this.renderHistory();
	}

	private async deleteConversation(manifest: ConversationManifest): Promise<void> {
		await this.options.service.setConversationLifecycle(manifest.conversationId, "deleted");
		this.openConversationIds = this.openConversationIds.filter((id) => id !== manifest.conversationId);
		if (this.activeConversationId === manifest.conversationId) await this.newConversation();
		await this.renderHistory();
	}

	private async exportConversation(manifest: ConversationManifest): Promise<void> {
		const projection = await this.options.service.loadConversation(manifest.conversationId);
		const folder = "TALOS Exports";
		if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.createFolder(folder);
		let path = normalizePath(`${folder}/${safeExportName(manifest.title)}.md`);
		if (await this.app.vault.adapter.exists(path)) path = normalizePath(`${folder}/${safeExportName(manifest.title)}-${Date.now()}.md`);
		const lines = [`# ${manifest.title}`, ""];
		for (const message of projectMessages(runtimeEvents(projection.events, manifest.selection.runtimeId))) lines.push(`## ${message.role}`, "", message.text, "");
		await this.app.vault.create(path, `${lines.join("\n")}\n`);
		new Notice(`会话已导出：${path}`);
	}

	focusComposer(): void { this.composer?.focus(); }
	async suspend(): Promise<void> { this.root?.remove(); }

	async destroy(): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;
		this.dismissPendingInteractions();
		await Promise.all([...this.runningConversationIds].map((conversationId) =>
			this.options.service.cancelConversationTurn(conversationId).catch(() => undefined)
		));
		this.options.service.attachInteractionPort(null);
		this.composer?.destroy();
		this.renderer?.destroy();
		this.root?.remove();
		this.root = null;
		this.tabBar = null;
		this.messages = null;
		this.history = null;
		this.historyList = null;
		this.approvalRegion = null;
		this.composerHost = null;
		this.composer = null;
		this.renderer = null;
		this.manifests.clear();
		this.openConversationIds = [];
		this.runningConversationIds.clear();
		this.queuedDrafts.clear();
		this.liveEvents.clear();
		this.pendingUserEvents.clear();
	}
}
