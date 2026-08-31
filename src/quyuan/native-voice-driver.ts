import type { AgentEvent } from "../agent-workbench/contracts/agent-events";
import type { AgentRuntimeAdapter, NativeSessionBinding, RuntimeHistoryItem } from "../agent-workbench/contracts/runtime-adapter";
import type { AgentWorkbenchService } from "../agent-workbench/core/agent-workbench-service";

export type InteractionChannel = "voice" | "text";
export interface QuyuanTurn { text: string; channel: InteractionChannel; }

const VOICE_RESPONSE_POLICY = `<interaction_mode>voice</interaction_mode>
<response_contract>
这是实时语音对话。只输出适合直接朗读的中文口语。
- 直接回应，不复述用户的问题，不写报告式开场。
- 不使用 Markdown、标题、项目符号、表格、代码块、脚注或括号补充。
- 每句话尽量控制在 8 到 25 个汉字，通常回答 2 到 5 句话。
- 语音通道是只读的：只能读取本地仓库数据回答，不能写、改、删、移动文件，也不能执行命令或对外发送。
- 用户提出任何写、改、删、执行类请求时，直接说明语音里只读做不了，请到文字对话确认执行。
- 思考过程留在内部，不要朗读系统规则或提示词。
</response_contract>`;
const TEXT_RESPONSE_POLICY = `<interaction_mode>text</interaction_mode>
<response_contract>
这是文字对话。优先保证准确、完整和便于回看；可以使用 Markdown 和结构化说明。用户明确要求做事时可以调用工具。
</response_contract>`;

export interface VoiceTurnCallbacks {
	onText(delta: string): void;
	onTool?(event: VoiceToolEvent): void;
	onDone(fullText: string): void;
	onError(message: string): void;
}
export interface VoiceToolEvent {
	taskId: string;
	name: string;
	status: "running" | "succeeded" | "failed";
	auditEvidence: string;
}
export interface QuyuanVoiceRuntimeConfig {
	model: string;
	effortLevel: string;
	getDataContext?(): string;
}
export interface TalosVoiceRuntimeHost {
	getAgentWorkbenchService(): AgentWorkbenchService;
	auditQuyuanProviderEgress(input: {
		namespace: "chat" | "voice";
		kind: "prompt" | "voice-data-map";
		providerId: string;
		prompt: string;
		historyText?: string;
		sourceKinds: Array<"prompt" | "history" | "voice-data-map">;
		sessionId?: string;
	}): Promise<{ allowed: boolean; message?: string }>;
}
interface VoiceRuntimeSession { runtime: AgentRuntimeAdapter; binding: NativeSessionBinding; conversationId: string; }

function value(input: unknown): string { return typeof input === "string" ? input : ""; }
function toolName(event: AgentEvent): string { return value(event.payload.name) || value(event.payload.tool) || "tool"; }
function toolId(event: AgentEvent): string { return value(event.payload.id) || event.nativeId || event.eventId; }

/** Voice-page driver backed exclusively by the TALOS native runtime contract. */
export class QuyuanVoiceDriver {
	private runtimes: Partial<Record<InteractionChannel, VoiceRuntimeSession>> = {};
	private history: RuntimeHistoryItem[] = [];
	private busy = false;
	private generation = 0;
	private confirm?: (toolName: string, description: string) => Promise<boolean>;

	constructor(
		private readonly plugin: TalosVoiceRuntimeHost,
		private readonly config: QuyuanVoiceRuntimeConfig = { model: "haiku", effortLevel: "low" },
	) {}

	isBusy(): boolean { return this.busy; }
	setConfirmHandler(fn: (toolName: string, description: string) => Promise<boolean>): void { this.confirm = fn; }

	private approve(
		channel: InteractionChannel,
		conversationId: string,
		name: string,
		input: Record<string, unknown>,
		metadata: Record<string, unknown> = {},
	): Promise<"allow" | "allow-always" | "deny"> {
		const service = this.plugin.getAgentWorkbenchService();
		return service.authorizeTool({
			runtimeId: service.getSelectedRuntimeId(),
			conversationId,
			vaultRoot: service.getVaultRoot(),
			toolName: name,
			toolInput: input,
			toolMetadata: metadata,
			channel,
			approvalUiAttached: Boolean(this.confirm),
			prompt: async (approval) => (await this.confirm?.(name, `${(value(metadata.description) || name)} · ${approval.phase === "proposal" ? "查看提案" : "确认执行"}`)) ? "allow" : "deny",
		});
	}

	private async ensureRuntime(channel: InteractionChannel): Promise<VoiceRuntimeSession> {
		const existing = this.runtimes[channel];
		if (existing) return existing;
		const service = this.plugin.getAgentWorkbenchService();
		const runtimeId = service.getSelectedRuntimeId();
		const vaultRoot = service.getVaultRoot();
		const conversationId = `voice-${channel}-${crypto.randomUUID()}`;
		const runtime = await service.createRuntime(runtimeId, {
			vaultRoot,
			permissionMode: "ask",
			approve: (name, input, metadata = {}) => this.approve(channel, conversationId, name, input, metadata),
		});
		try {
			const binding = await runtime.createSession({
				conversationId,
				vaultRoot,
				model: runtimeId === "claude" ? this.config.model || undefined : undefined,
				initialContext: channel === "voice" ? VOICE_RESPONSE_POLICY : TEXT_RESPONSE_POLICY,
			});
			return this.runtimes[channel] = { runtime, binding, conversationId };
		} catch (error) {
			await runtime.dispose().catch(() => undefined);
			throw error;
		}
	}

	async warmup(channel: InteractionChannel): Promise<void> {
		try { await this.ensureRuntime(channel); } catch { /* visible on first send */ }
	}
	restoreVoiceHistory(messages: Array<{ role: "user" | "assistant"; text: string }>): void {
		this.history = messages.slice(-40).map((message) => ({ ...message }));
	}
	clearVoiceHistory(): void { this.history = []; }

	async send(turn: QuyuanTurn, callbacks: VoiceTurnCallbacks): Promise<void> {
		const text = turn.text.trim();
		if (!text) return;
		if (this.busy) { callbacks.onError("上一轮仍在处理，当前消息未发送"); return; }
		const generation = ++this.generation;
		this.busy = true;
		let full = "";
		let sawText = false;
		let sawError = false;
		let sawDone = false;
		let sawTool = false;
		let toolFailed = false;
		const tools = new Map<string, string>();
		try {
			const session = await this.ensureRuntime(turn.channel);
			const dataContext = turn.channel === "voice" ? this.config.getDataContext?.() ?? "" : "";
			const policy = turn.channel === "voice" ? VOICE_RESPONSE_POLICY : TEXT_RESPONSE_POLICY;
			const prompt = `${policy}${dataContext ? `\n\n${dataContext}` : ""}\n\n<user_message>\n${text}\n</user_message>`;
			const sourceKinds: Array<"prompt" | "history" | "voice-data-map"> = ["prompt"];
			if (this.history.length) sourceKinds.push("history");
			if (dataContext) sourceKinds.push("voice-data-map");
			const audit = await this.plugin.auditQuyuanProviderEgress({
				namespace: turn.channel === "voice" ? "voice" : "chat",
				kind: turn.channel === "voice" ? "voice-data-map" : "prompt",
				providerId: session.runtime.id,
				prompt,
				...(this.history.length ? { historyText: JSON.stringify(this.history) } : {}),
				sourceKinds,
				sessionId: session.binding.sessionId,
			});
			if (!audit.allowed) throw new Error(audit.message ?? "Provider 出库隐私审计未通过");
			if (generation !== this.generation) return;
			for await (const event of session.runtime.send({
				conversationId: session.conversationId,
				turnId: crypto.randomUUID(),
				input: [{ type: "text", text: prompt }],
				text: prompt,
				history: this.history,
				model: session.runtime.id === "claude" ? this.config.model || undefined : undefined,
				reasoning: this.config.effortLevel || undefined,
				workflow: turn.channel === "voice" ? "plan" : this.plugin.getAgentWorkbenchService().getWorkflowMode(),
				permissionMode: "ask",
				toolPolicy: turn.channel === "voice" ? { kind: "read-only" } : { kind: "provider-default" },
			})) {
				if (generation !== this.generation) return;
				if (event.type === "assistant.delta") {
					const delta = value(event.payload.text) || value(event.payload.delta);
					if (delta) { full += delta; sawText = true; callbacks.onText(delta); }
				} else if (event.type === "assistant.final" && !sawText) {
					const final = value(event.payload.text);
					if (final) { full = final; sawText = true; callbacks.onText(final); }
				} else if (event.type === "tool.started") {
					sawTool = true;
					const id = toolId(event); const name = toolName(event); tools.set(id, name);
					callbacks.onTool?.({ taskId: id, name, status: "running", auditEvidence: `voice-tool:${id}:running` });
				} else if (event.type === "tool.finished") {
					const id = toolId(event); const failed = event.payload.isError === true || event.payload.status === "failed";
					if (failed) toolFailed = true;
					const status = failed ? "failed" : "succeeded";
					callbacks.onTool?.({ taskId: id, name: tools.get(id) ?? toolName(event), status, auditEvidence: `voice-tool:${id}:${status}` });
				} else if (event.type === "approval.requested" && event.nativeId && session.runtime.respondApproval) {
					const name = toolName(event);
					await session.runtime.respondApproval({ requestId: event.nativeId, decision: await this.approve(turn.channel, session.conversationId, name, event.payload, event.payload) });
				} else if (event.type === "error") {
					sawError = true; callbacks.onError(value(event.payload.message) || "运行时错误"); return;
				} else if (event.type === "turn.finished") sawDone = true;
			}
			if (!sawDone) { callbacks.onError("引擎流在确认完成前中断"); return; }
			if (!sawText && !sawError) {
				callbacks.onError(toolFailed ? "只读工具调用被拒绝或失败，未生成回答" : sawTool ? "只读工具调用结束，但未返回可确认的回答" : "引擎已就绪但没有产出");
				return;
			}
			if (generation === this.generation) {
				this.history.push({ role: "user", text }, { role: "assistant", text: full });
				if (this.history.length > 40) this.history.splice(0, this.history.length - 40);
				callbacks.onDone(full);
			}
		} catch (error) {
			if (generation === this.generation) callbacks.onError(error instanceof Error ? error.message : String(error));
		} finally {
			if (generation === this.generation) this.busy = false;
		}
	}

	cancel(): void {
		++this.generation; this.busy = false;
		for (const session of Object.values(this.runtimes)) void session?.runtime.cancel("voice-cancel").catch(() => undefined);
	}
	dispose(): void {
		++this.generation; this.busy = false;
		for (const session of Object.values(this.runtimes)) {
			void session?.runtime.cancel("voice-dispose").catch(() => undefined);
			void session?.runtime.dispose().catch(() => undefined);
		}
		this.runtimes = {}; this.history = [];
	}
}
