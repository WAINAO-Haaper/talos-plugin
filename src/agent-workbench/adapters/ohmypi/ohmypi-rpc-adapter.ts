import type { AgentEvent, AgentEventType } from "../../contracts/agent-events";
import type { AgentRuntimeAdapter, CreateSessionInput, ModelDescriptor, NativeSessionBinding, RuntimeProbe, RuntimeSteer, RuntimeTurn } from "../../contracts/runtime-adapter";
import type { RuntimeCapabilities } from "../../contracts/runtime-capabilities";
import type { PermissionMode } from "../../contracts/approval";
import { RuntimeEventFactory } from "../shared/event-factory";
import type { ProtocolFrame } from "../shared/protocol-frame";

export interface OhMyPiRpcPort {
	probe(signal?: AbortSignal): Promise<RuntimeProbe>;
	request<T>(method: string, params: Record<string, unknown>): Promise<T>;
	prompt(params: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<ProtocolFrame>;
	respond(requestId: string, response: Record<string, unknown>): Promise<void>;
	abort(): Promise<void>;
	close(): Promise<void>;
}

export function buildOhMyPiLaunch(executable: string, vaultRoot: string, permissionMode: PermissionMode = "ask") {
	const approvalMode = permissionMode === "ask" ? "always-ask" : "write";
	return { executable, args: ["--mode", "rpc", "--cwd", vaultRoot, "--approval-mode", approvalMode], cwd: vaultRoot };
}


function nestedRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

function ompEventType(method: string, payload: Record<string, unknown>): AgentEventType {
	if (method === "message_update") {
		const update = nestedRecord(payload.assistantMessageEvent);
		if (update?.type === "text_delta") return "assistant.delta";
		if (update?.type === "thinking_delta") return "thinking.delta";
		if (update?.type === "error") return "error";
	}
	if (method === "message_end") return "assistant.final";
	if (method === "tool_execution_start") return "tool.started";
	if (method === "tool_execution_update") return "tool.updated";
	if (method === "tool_execution_end") return "tool.finished";
	if (method === "extension_ui_request") {
		const options = Array.isArray(payload.options) ? payload.options : [];
		if (payload.method === "confirm" || (payload.method === "select" && options.includes("Approve") && options.includes("Deny"))) return "approval.requested";
		if (["select", "input", "editor"].includes(typeof payload.method === "string" ? payload.method : "")) return "user.question";
		return "notice";
	}
	if (method === "turn_end") return "usage.updated";
	if (method === "auto_compaction_end") return "context.compacted";
	if (method === "agent_end") return "turn.finished";
	return method === "error" ? "error" : "notice";
}

function normalizePayload(frame: ProtocolFrame): Record<string, unknown> {
	const payload: Record<string, unknown> = { ...frame.params, protocolMethod: frame.method };
	if (frame.method === "message_update") {
		const update = nestedRecord(frame.params.assistantMessageEvent);
		if (typeof update?.delta === "string") payload.text = update.delta;
		if (nestedRecord(update?.error)?.errorMessage) payload.message = nestedRecord(update?.error)?.errorMessage;
	}
	if (frame.method === "message_end") {
		const message = nestedRecord(frame.params.message);
		const content = Array.isArray(message?.content) ? message.content : [];
		payload.text = content.map((item) => nestedRecord(item)).filter((item): item is Record<string, unknown> => !!item && item.type === "text" && typeof item.text === "string").map((item) => item.text).join("");
	}
	if (frame.method.startsWith("tool_execution_")) {
		payload.id = frame.params.toolCallId; payload.name = frame.params.toolName; payload.input = frame.params.args; payload.output = frame.params.partialResult ?? frame.params.result; payload.error = frame.params.isError;
	}
	if (frame.method === "turn_end") {
		const message = nestedRecord(frame.params.message); payload.usage = nestedRecord(message?.usage) ?? {};
	}
	return payload;
}

export class OhMyPiRpcAdapter implements AgentRuntimeAdapter {
	readonly id = "ohmypi" as const;
	private binding: NativeSessionBinding | null = null;
	private pendingContext: string | undefined;
	private activeModel: string | undefined;
	private readonly pendingUiRequests = new Map<string, { method: string; options: string[] }>();
	private readonly events = new RuntimeEventFactory(this.id);
	constructor(private readonly port: OhMyPiRpcPort, private readonly sandboxReady: () => boolean, private readonly onDispose: () => Promise<void> = async () => {}) {}
	probe(signal?: AbortSignal) { return this.port.probe(signal); }
	async listModels(): Promise<ModelDescriptor[]> { const result = await this.port.request<{ models: Array<{ id: string; name?: string; provider?: string }> }>("get_available_models", {}); return result.models.map((item) => ({ id: item.provider ? `${item.provider}/${item.id}` : item.id, label: item.name ?? item.id, providerProfileId: item.provider })); }
	async createSession(input: CreateSessionInput): Promise<NativeSessionBinding> {
		if (input.model) await this.selectModel(input.model);
		const result = await this.port.request<{ sessionId: string; sessionFile?: string }>("get_state", {});
		this.pendingContext = input.initialContext;
		return this.binding = { runtimeId: this.id, sessionId: result.sessionId, nativeResumeToken: result.sessionFile, protocolVersion: "omp-rpc-v2" };
	}
	async resumeSession(binding: NativeSessionBinding): Promise<void> { if (!binding.nativeResumeToken) throw new Error("OhMyPi 会话缺少原生 resume token"); await this.port.request("switch_session", { sessionPath: binding.nativeResumeToken }); this.binding = binding; }
	async synchronizeContext(input: { context: string }): Promise<void> { this.pendingContext = input.context; }
	async *send(turn: RuntimeTurn): AsyncIterable<AgentEvent> {
		if (!this.binding) throw new Error("OhMyPi native session 尚未绑定");
		if (turn.workflow === "execute" && !this.sandboxReady()) throw new Error("OhMyPi sandbox 未 ready，Execute 已失败关闭");
		if (turn.model && turn.model !== this.activeModel) await this.selectModel(turn.model);
		const text = this.pendingContext ? `${this.pendingContext}\n\n${turn.text}` : turn.text;
		for await (const frame of this.port.prompt({ text }, turn.signal)) {
			const payload = normalizePayload(frame);
			if (frame.method === "extension_ui_request" && typeof frame.id === "string") this.pendingUiRequests.set(frame.id, { method: typeof payload.method === "string" ? payload.method : "", options: Array.isArray(payload.options) ? payload.options.filter((item): item is string => typeof item === "string") : [] });
			yield this.events.create({ conversationId: turn.conversationId, turnId: turn.turnId, type: ompEventType(frame.method, payload), payload, nativeId: typeof frame.id === "string" ? frame.id : undefined });
		}
		this.pendingContext = undefined;
	}
	private async selectModel(model: string): Promise<void> { const slash = model.indexOf("/"); if (slash < 1 || slash === model.length - 1) throw new Error("OhMyPi 模型必须使用 provider/model 标识"); await this.port.request("set_model", { provider: model.slice(0, slash), modelId: model.slice(slash + 1) }); this.activeModel = model; }
	async steer(input: RuntimeSteer): Promise<void> { await this.port.request("steer", { message: input.text }); }
	async followUp(text: string): Promise<void> { await this.port.request("follow_up", { message: text }); }
	async respondApproval(input: { requestId: string | number; decision: "allow" | "allow-always" | "deny" | "cancel"; details?: Record<string, unknown> }): Promise<void> { if (typeof input.requestId !== "string") throw new Error("OhMyPi UI request id 无效"); const request = this.pendingUiRequests.get(input.requestId); this.pendingUiRequests.delete(input.requestId); const approved = input.decision === "allow" || input.decision === "allow-always"; await this.port.respond(input.requestId, request?.method === "select" ? { value: approved ? "Approve" : "Deny" } : { confirmed: approved }); }
	async respondUserInput(input: { requestId: string | number; answers: Record<string, string | string[]> }): Promise<void> { if (typeof input.requestId !== "string") throw new Error("OhMyPi UI request id 无效"); this.pendingUiRequests.delete(input.requestId); const answer = Object.values(input.answers).at(0); await this.port.respond(input.requestId, typeof answer === "string" ? { value: answer } : { cancelled: true }); }
	async cancel(): Promise<void> { if (this.binding) await this.port.abort(); }
	async fork(input: { binding: NativeSessionBinding }): Promise<NativeSessionBinding> { if (this.binding?.sessionId !== input.binding.sessionId) await this.resumeSession(input.binding); const branch = await this.port.request<{ messages: Array<{ entryId: string }> }>("get_branch_messages", {}); const entryId = branch.messages.at(-1)?.entryId; const result = entryId ? await this.port.request<{ cancelled: boolean }>("branch", { entryId }) : await this.port.request<{ cancelled: boolean }>("new_session", { parentSession: input.binding.nativeResumeToken }); if (result.cancelled) throw new Error("OhMyPi branch 已取消"); const state = await this.port.request<{ sessionId: string; sessionFile?: string }>("get_state", {}); return { runtimeId: this.id, sessionId: state.sessionId, nativeResumeToken: state.sessionFile, protocolVersion: "omp-rpc-v2" }; }
	async compact(): Promise<void> { await this.port.request("compact", {}); }
	async messages(): Promise<unknown[]> { const result = await this.port.request<{ messages: unknown[] }>("get_messages", {}); return result.messages; }
	async dispose(): Promise<void> { try { await this.cancel(); await this.port.close(); } finally { await this.onDispose(); this.binding = null; this.pendingUiRequests.clear(); } }
	capabilities(): RuntimeCapabilities {
		return {
			session: { resume: "native", fork: "native", compact: "native", rewind: "unavailable", steer: "native" },
			input: { text: "native", image: "native", vaultFile: "native", selection: "talos-emulated" },
			tools: { shell: "native", edit: "native", mcp: "native", skills: "native", subagents: "native", askUser: "native" },
			control: { plan: "native", reasoning: "native", serviceTier: "unavailable", usage: "native" },
			security: { nativeApproval: "native", nativeSandbox: "talos-emulated", networkPolicy: "talos-emulated", externalPathGrant: "talos-emulated" },
		};
	}
}
