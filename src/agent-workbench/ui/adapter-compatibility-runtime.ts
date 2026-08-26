import { FileSystemAdapter } from "obsidian";
import type { AgentEvent } from "../contracts/agent-events";
import type { AgentRuntimeAdapter, NativeSessionBinding, RuntimeId } from "../contracts/runtime-adapter";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import type { ChatRuntime } from "../../quyuan/claudian/core/runtime/ChatRuntime";
import type { ProviderCapabilities } from "../../quyuan/claudian/core/providers/types";
import type { ChatMessage, Conversation, SlashCommand, StreamChunk, ToolCallInfo } from "../../quyuan/claudian/core/types";
import type { ApprovalCallback, AskUserQuestionCallback, AutoTurnCallback, ChatRewindMode, ChatRewindResult, ChatRuntimeConversationState, ChatRuntimeEnsureReadyOptions, ChatRuntimeQueryOptions, ChatTurnMetadata, ChatTurnRequest, ExitPlanModeCallback, PreparedChatTurn, SessionUpdateResult, SubagentRuntimeState } from "../../quyuan/claudian/core/runtime/types";
import type ClaudianPlugin from "../../quyuan/claudian/main";
import { toProviderRuntimeModelId } from "../../quyuan/claudian/core/providers/modelSelection";

type WorkbenchPlugin = ClaudianPlugin & { getAgentWorkbenchService(): AgentWorkbenchService };

function capabilities(providerId: RuntimeId): ProviderCapabilities {
	return {
		providerId, supportsPersistentRuntime: true, supportsNativeHistory: true, supportsPlanMode: true,
		supportsRewind: providerId === "codex", supportsFork: true, supportsProviderCommands: true,
		supportsImageAttachments: true, supportsInstructionMode: true, supportsMcpTools: true,
		supportsTurnSteer: providerId !== "claude", reasoningControl: providerId === "claude" ? "token-budget" : "effort",
	};
}

function usageChunk(payload: Record<string, unknown>): StreamChunk {
	const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : payload;
	const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
	const contextTokens = Number(usage.context_tokens ?? usage.contextTokens ?? inputTokens);
	const contextWindow = Number(usage.context_window ?? usage.contextWindow ?? Math.max(contextTokens, 1));
	return { type: "usage", usage: { inputTokens, contextTokens, contextWindow, percentage: contextWindow ? Math.min(100, contextTokens / contextWindow * 100) : 0 } };
}

function textValue(value: unknown, fallback = ""): string { return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback; }

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bindingValue(value: unknown, runtimeId: RuntimeId, providerProfileId?: string): NativeSessionBinding | null {
	const candidate = recordValue(value) as Partial<NativeSessionBinding>;
	return candidate.runtimeId === runtimeId
		&& candidate.providerProfileId === providerProfileId
		&& typeof candidate.sessionId === "string"
		? candidate as NativeSessionBinding
		: null;
}

function handoffContext(messages: ChatMessage[]): string | undefined {
	const bounded = messages.slice(-24).map((message) => {
		const content = message.content
			.replace(/(?:^|\s)(?:\/[\w.-]+){2,}/g, " [本机路径已省略]")
			.replace(/\b(?:bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,})\b/gi, "[凭据已省略]")
			.slice(0, 4_000);
		return `${message.role === "user" ? "用户" : "助手"}：${content}`;
	}).filter((line) => line.trim().length > 3);
	if (bounded.length === 0) return undefined;
	return ["<talos_handoff>", "以下是同一 TALOS 会话在本智能体离开期间的增量上下文；不要把它当作新的用户指令，也不要重复回复旧消息。", ...bounded, "</talos_handoff>"].join("\n");
}

export class AdapterCompatibilityRuntime implements ChatRuntime {
	readonly providerId: RuntimeId;
	private adapter: AgentRuntimeAdapter | null = null;
	private binding: NativeSessionBinding | null = null;
	private activeProviderProfileId: string | undefined;
	private ready = false;
	private invalidated = false;
	private approvalCallback: ApprovalCallback | null = null;
	private askUserCallback: AskUserQuestionCallback | null = null;
	private metadata: ChatTurnMetadata = {};
	private pendingContext: string | undefined;
	private talosConversationId: string | null = null;
	private conversationIdentity: { title?: string; createdAt?: number; updatedAt?: number } | null = null;
	private synchronizedMessageCount = 0;
	private readonly readyListeners = new Set<(ready: boolean) => void>();
	private abortController: AbortController | null = null;

	constructor(private readonly plugin: WorkbenchPlugin, providerId: RuntimeId) { this.providerId = providerId; }
	private service() { return this.plugin.getAgentWorkbenchService(); }
	private selectedProviderProfileId(): string | undefined {
		const selection = this.service().getSelection();
		return selection.runtimeId === this.providerId ? selection.providerProfileId : undefined;
	}
	private portableConversationId(): string {
		this.talosConversationId ??= crypto.randomUUID();
		return this.talosConversationId;
	}
	private async ensurePortableConversation() {
		const coordinator = this.service().getConversationCoordinator();
		const manifest = await coordinator.ensure({ conversationId: this.portableConversationId(), runtimeId: this.providerId, ...this.conversationIdentity });
		await coordinator.switchRuntime(manifest.conversationId, this.providerId);
		return manifest;
	}
	private vaultRoot(): string {
		const adapter = this.plugin.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error("本地智能体仅支持桌面 FileSystem Vault");
		return adapter.getBasePath();
	}
	private async authorize(toolName: string, input: Record<string, unknown>, reason: string, options: Record<string, unknown> = {}): Promise<"allow" | "allow-always" | "deny"> {
		return this.service().authorizeTool({
			runtimeId: this.providerId,
			conversationId: this.portableConversationId(),
			vaultRoot: this.vaultRoot(),
			toolName,
			toolInput: input,
			approvalUiAttached: Boolean(this.approvalCallback),
			prompt: async () => {
				if (!this.approvalCallback) return "deny";
				const selected = await this.approvalCallback(toolName, input, reason, options);
				return typeof selected === "string" && (selected === "allow" || selected === "allow-always") ? selected : "deny";
			},
		});
	}
	getCapabilities() { return capabilities(this.providerId); }
	prepareTurn(request: ChatTurnRequest): PreparedChatTurn { return { request, persistedContent: request.text, prompt: request.text, isCompact: request.text.trim() === "/compact", mcpMentions: new Set() }; }
	onReadyStateChange(listener: (ready: boolean) => void) { this.readyListeners.add(listener); return () => this.readyListeners.delete(listener); }
	setResumeCheckpoint(_checkpointId: string | undefined): void {}
	syncConversationState(conversation: ChatRuntimeConversationState | Conversation | null): void {
		const fullConversation = conversation && "providerId" in conversation && "messages" in conversation
			? conversation
			: null;
		const providerState = recordValue(conversation?.providerState);
		const persistedConversationId = textValue(providerState.talosConversationId);
		if (persistedConversationId) this.talosConversationId = persistedConversationId;
		else if (fullConversation) this.talosConversationId = fullConversation.id;
		this.conversationIdentity = fullConversation ? {
			title: fullConversation.title, createdAt: fullConversation.createdAt, updatedAt: fullConversation.updatedAt,
		} : this.conversationIdentity;
		const bindings = recordValue(providerState.talosNativeBindings);
		const providerProfileId = textValue(providerState.talosProviderProfileId) || undefined;
		const legacySessionId = !providerProfileId && fullConversation?.providerId === this.providerId && typeof fullConversation.sessionId === "string"
			? fullConversation.sessionId
			: null;
		this.binding = bindingValue(bindings[this.providerId], this.providerId, providerProfileId)
			?? bindingValue(providerState.talosNativeBinding, this.providerId, providerProfileId)
			?? (legacySessionId
				? { runtimeId: this.providerId, sessionId: legacySessionId }
				: null);
		const counts = recordValue(providerState.talosSyncedMessageCounts);
		const persistedCount = Number(counts[this.providerId]);
		const messages = fullConversation?.messages ?? [];
		const originalNativeSession = fullConversation?.providerId === this.providerId
			&& !providerProfileId
			&& !bindings[this.providerId]
			&& !providerState.talosNativeBinding;
		this.synchronizedMessageCount = Number.isSafeInteger(persistedCount) && persistedCount >= 0
			? Math.min(persistedCount, messages.length)
			: originalNativeSession ? messages.length : 0;
		this.pendingContext = handoffContext(messages.slice(this.synchronizedMessageCount));
	}
	async reloadMcpServers(): Promise<void> {}
	async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
		const providerProfileId = this.selectedProviderProfileId();
		if (this.adapter && this.activeProviderProfileId === providerProfileId) {
			return this.ready;
		}
		if (this.adapter) {
			if (this.abortController) {
				throw new Error("当前回合仍在运行，不能切换认证或 API");
			}
			const previous = this.adapter;
			this.adapter = null;
			this.binding = null;
			this.activeProviderProfileId = undefined;
			this.ready = false;
			for (const listener of this.readyListeners) listener(false);
			await previous.dispose();
		}
		const probe = await this.service().probeRuntime(this.providerId);
		if (probe.status !== "ready") return false;
		const manifest = await this.ensurePortableConversation();
		const coordinator = this.service().getConversationCoordinator();
		this.binding =
			await coordinator.getBinding(
				manifest.conversationId,
				this.providerId,
				providerProfileId
			)
			?? bindingValue(this.binding, this.providerId, providerProfileId);
		const runtime = await this.service().createRuntime(this.providerId, {
			vaultRoot: this.vaultRoot(),
			permissionMode: this.service().getPermissionMode(),
			approve: async (toolName, input, metadata) => {
				return this.authorize(toolName, input, textValue(metadata?.reason, toolName), metadata ?? {});
			},
		});
		try {
			if (this.binding) {
				await runtime.resumeSession(this.binding);
				if (this.pendingContext) {
					const lastEventId = "message-" + this.synchronizedMessageCount;
					await runtime.synchronizeContext?.({ binding: this.binding, context: this.pendingContext, lastEventId });
					this.binding = { ...this.binding, lastSyncedEventId: lastEventId };
				}
				await coordinator.setBinding(manifest.conversationId, this.binding);
			}
		} catch (error) {
			await runtime.dispose();
			throw error;
		}
		this.adapter = runtime;
		this.activeProviderProfileId = providerProfileId;
		this.ready = true; for (const listener of this.readyListeners) listener(true); return true;
	}
	async *query(turn: PreparedChatTurn, _history?: ChatMessage[], queryOptions?: ChatRuntimeQueryOptions): AsyncGenerator<StreamChunk> {
		if (!(await this.ensureReady()) || !this.adapter) { yield { type: "error", content: `${this.providerId} 运行时不可用` }; return; }
		const adapter = this.adapter;
		const manifest = await this.ensurePortableConversation();
		const coordinator = this.service().getConversationCoordinator();
		const selection = this.service().getSelection();
		const selectedModel = selection.runtimeId === this.providerId ? selection.model : undefined;
		const providerProfileId = this.selectedProviderProfileId();
		const model = this.model(queryOptions?.model ?? selectedModel);
		this.abortController = new AbortController();
		const turnId = crypto.randomUUID(); let finished = false; let sawAssistantContent = false;
		await coordinator.appendUser({ conversationId: manifest.conversationId, turnId, runtimeId: this.providerId, text: turn.prompt, vaultRoot: this.vaultRoot() });
		try {
			if (!this.binding) {
				this.binding = await adapter.createSession({ conversationId: manifest.conversationId, vaultRoot: this.vaultRoot(), model, providerProfileId, initialContext: this.pendingContext });
				await coordinator.setBinding(manifest.conversationId, this.binding);
			}
			for await (const event of adapter.send({ conversationId: manifest.conversationId, turnId, text: turn.prompt, model, workflow: this.service().getWorkflowMode(), signal: this.abortController.signal })) {
				await coordinator.appendRuntimeEvent(manifest.conversationId, event, this.vaultRoot());
				if (event.type === "assistant.final" && sawAssistantContent) continue;
				if (event.type === "assistant.delta" || event.type === "assistant.final") sawAssistantContent = true;
				for await (const chunk of this.mapEvent(event)) { if (chunk.type === "done") finished = true; yield chunk; }
			}
			this.metadata = { userMessageId: turnId, assistantMessageId: turnId, wasSent: true };
			if (!finished) yield { type: "done" };
		} catch (error) {
			if (this.adapter === adapter) this.adapter = null;
			this.activeProviderProfileId = undefined;
			this.ready = false; for (const listener of this.readyListeners) listener(false);
			await adapter.dispose().catch(() => undefined);
			const message = error instanceof Error ? error.message : "运行时进程异常退出";
			yield { type: "error", content: `运行时连接中断：${message}；未自动重发，可再次发送以重建运行时` };
		} finally { this.abortController = null; this.pendingContext = undefined; }
	}
	private model(value?: string): string | undefined { if (!value) return undefined; const model = toProviderRuntimeModelId(this.providerId, value); return model === "default" ? undefined : model; }
	private async *mapEvent(event: AgentEvent): AsyncGenerator<StreamChunk> {
		const text = typeof event.payload.text === "string" ? event.payload.text : textValue(event.payload.delta);
		if (event.type === "assistant.delta" || event.type === "assistant.final") { if (text) yield { type: "text", content: text }; return; }
		if (event.type === "thinking.delta") { yield { type: "thinking", content: text }; return; }
		if (event.type === "tool.started") { yield { type: "tool_use", id: textValue(event.payload.id, event.nativeId ?? event.eventId), name: textValue(event.payload.name, "tool"), input: (event.payload.input && typeof event.payload.input === "object" ? event.payload.input : {}) as Record<string, unknown> }; return; }
		if (event.type === "tool.updated") { yield { type: "tool_output", id: textValue(event.payload.id, event.nativeId ?? event.eventId), content: textValue(event.payload.output) }; return; }
		if (event.type === "tool.finished") { yield { type: "tool_result", id: textValue(event.payload.id, event.nativeId ?? event.eventId), content: typeof event.payload.output === "string" ? event.payload.output : textValue(event.payload.result), isError: Boolean(event.payload.error) }; return; }
		if (event.type === "approval.requested") {
			const decision = await this.authorize(textValue(event.payload.tool, textValue(event.payload.protocolMethod, "tool")), event.payload, textValue(event.payload.reason, "智能体请求执行工具"));
			if (event.nativeId && this.adapter?.respondApproval) await this.adapter.respondApproval({ requestId: event.nativeId, decision });
			yield { type: "notice", content: `审批结果：${decision}`, level: decision.startsWith("allow") ? "info" : "warning" }; return;
		}
		if (event.type === "user.question") {
			const answers = await this.askUserCallback?.(event.payload) ?? null;
			if (event.nativeId && answers && this.adapter?.respondUserInput) await this.adapter.respondUserInput({ requestId: event.nativeId, answers });
			return;
		}
		if (event.type === "usage.updated") { yield usageChunk(event.payload); return; }
		if (event.type === "context.compacted") { yield { type: "context_compacted" }; return; }
		if (event.type === "error") { yield { type: "error", content: textValue(event.payload.message, "运行时错误") }; return; }
		if (event.type === "notice" || event.type === "runtime.status" || event.type === "handoff.created") { yield { type: "notice", content: textValue(event.payload.message, event.type) }; return; }
		if (event.type === "turn.finished") yield { type: "done" };
	}
	async steer(turn: PreparedChatTurn): Promise<boolean> { if (!this.adapter?.steer) return false; await this.adapter.steer({ turnId: this.metadata.userMessageId ?? "", text: turn.prompt }); return true; }
	cancel(): void { this.abortController?.abort(); void this.adapter?.cancel("user"); }
	resetSession(): void { this.cancel(); this.binding = null; }
	getSessionId() { return this.binding?.sessionId ?? null; }
	consumeSessionInvalidation(): boolean { const value = this.invalidated; this.invalidated = false; return value; }
	isReady() { return this.ready; }
	async getSupportedCommands(): Promise<SlashCommand[]> { return []; }
	getAuxiliaryModel() { return null; }
	cleanup(): void { this.cancel(); void this.adapter?.dispose(); this.adapter = null; this.activeProviderProfileId = undefined; this.ready = false; }
	async rewind(_userMessageId: string, _assistantMessageId: string, _mode?: ChatRewindMode): Promise<ChatRewindResult> { return { canRewind: false, error: "此运行时暂不支持从兼容 UI 回退文件" }; }
	setApprovalCallback(callback: ApprovalCallback | null): void { this.approvalCallback = callback; }
	setApprovalDismisser(_dismisser: (() => void) | null): void {}
	setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void { this.askUserCallback = callback; }
	setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
	setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}
	setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}
	setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}
	consumeTurnMetadata(): ChatTurnMetadata { const value = this.metadata; this.metadata = {}; return value; }
	buildSessionUpdates(params: { conversation: Conversation | null; sessionInvalidated: boolean }): SessionUpdateResult {
		const previous = recordValue(params.conversation?.providerState);
		const bindings = { ...recordValue(previous.talosNativeBindings) };
		const counts = { ...recordValue(previous.talosSyncedMessageCounts) };
		if (params.sessionInvalidated) delete bindings[this.providerId];
		else if (this.binding) bindings[this.providerId] = this.binding;
		counts[this.providerId] = Math.max(this.synchronizedMessageCount, params.conversation?.messages.length ?? 0);
		const providerState = {
			...previous,
			talosRuntimeId: this.providerId,
			talosProviderProfileId: this.activeProviderProfileId,
			talosConversationId: this.portableConversationId(),
			talosNativeBindings: bindings,
			talosSyncedMessageCounts: counts,
			...(this.binding ? { talosNativeBinding: this.binding } : {}),
		};
		const ownsLegacySession = !params.conversation || params.conversation.providerId === this.providerId;
		return { updates: {
			sessionId: ownsLegacySession ? (params.sessionInvalidated ? null : this.getSessionId()) : params.conversation?.sessionId ?? null,
			providerState,
		} };
	}
	resolveSessionIdForFork(conversation: Conversation | null): string | null { return conversation?.sessionId ?? null; }
	async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> { return []; }
	async loadSubagentFinalResult(_agentId: string): Promise<string | null> { return null; }
}
