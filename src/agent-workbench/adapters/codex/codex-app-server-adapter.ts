import type { AgentEvent, AgentEventType } from "../../contracts/agent-events";
import type { AgentRuntimeAdapter, CreateSessionInput, ModelDescriptor, NativeSessionBinding, RuntimeProbe, RuntimeSteer, RuntimeTurn } from "../../contracts/runtime-adapter";
import type { RuntimeCapabilities } from "../../contracts/runtime-capabilities";
import { RuntimeEventFactory } from "../shared/event-factory";
import { textField, type ProtocolFrame } from "../shared/protocol-frame";
import { assertCodexPermissionProfile, TALOS_AGENT_WORKBENCH_CODEX_PROFILE } from "../../security/codex-permission-profile";

export interface CodexAppServerPort {
	probe(signal?: AbortSignal): Promise<RuntimeProbe>;
	request<T>(method: string, params: Record<string, unknown>): Promise<T>;
	turn(params: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<ProtocolFrame>;
	respond?(requestId: string | number, result: unknown): Promise<void>;
	cancel(threadId: string, turnId?: string, reason?: string): Promise<void>;
	close(): Promise<void>;
}

type TalosApproval = "allow" | "allow-always" | "deny" | "cancel";

function eventType(method: string): AgentEventType {
	if (method === "item/agentMessage/delta") return "assistant.delta";
	if (method.includes("reasoning")) return "thinking.delta";
	if (method.includes("plan")) return "plan.updated";
	if (method === "item/fileChange/patchUpdated") return "file.diff";
	if (method.includes("requestApproval")) return "approval.requested";
	if (method === "item/tool/requestUserInput") return "user.question";
	if (method.includes("tokenUsage")) return "usage.updated";
	if (method === "turn/completed") return "turn.finished";
	if (method.includes("subagent")) return "subagent.updated";
	if (method.includes("commandExecution") || method.includes("fileChange") || method.includes("tool")) {
		return method.endsWith("/completed") ? "tool.finished" : method.endsWith("/started") ? "tool.started" : "tool.updated";
	}
	if (method === "error") return "error";
	return "notice";
}

export class CodexAppServerAdapter implements AgentRuntimeAdapter {
	readonly id = "codex" as const;
	private binding: NativeSessionBinding | null = null;
	private activeTurnId: string | undefined;
	private pendingContext: string | undefined;
	private readonly events = new RuntimeEventFactory(this.id);
	constructor(private readonly port: CodexAppServerPort, private readonly onDispose: () => Promise<void> = async () => {}) {}

	probe(signal?: AbortSignal) { return this.port.probe(signal); }
	async listModels(): Promise<ModelDescriptor[]> {
		const result = await this.port.request<{ data?: Array<{ id: string; displayName?: string }> }>("model/list", {});
		return (result.data ?? []).map((model) => ({ id: model.id, label: model.displayName ?? model.id }));
	}
	async createSession(input: CreateSessionInput): Promise<NativeSessionBinding> {
		const result = await this.port.request<{ thread: { id: string }; activePermissionProfile?: { id?: string } }>("thread/start", {
			cwd: input.vaultRoot, model: input.model, provider: input.providerProfileId,
			approvalPolicy: "on-request", permissions: TALOS_AGENT_WORKBENCH_CODEX_PROFILE,
			runtimeWorkspaceRoots: [input.vaultRoot], persistExtendedHistory: true, experimentalRawEvents: true,
		});
		assertCodexPermissionProfile(result);
		this.pendingContext = input.initialContext;
		return this.binding = { runtimeId: this.id, sessionId: result.thread.id, protocolVersion: "app-server-v2" };
	}
	async resumeSession(binding: NativeSessionBinding): Promise<void> {
		const result = await this.port.request<{ activePermissionProfile?: { id?: string } }>("thread/resume", { threadId: binding.sessionId, approvalPolicy: "on-request", permissions: TALOS_AGENT_WORKBENCH_CODEX_PROFILE, persistExtendedHistory: true });
		assertCodexPermissionProfile(result);
		this.binding = binding;
	}
	async synchronizeContext(input: { context: string }): Promise<void> { this.pendingContext = input.context; }
	async *send(turn: RuntimeTurn): AsyncIterable<AgentEvent> {
		if (!this.binding) throw new Error("Codex native session 尚未绑定");
		this.activeTurnId = turn.turnId;
		const params = {
			threadId: this.binding.sessionId,
			input: [{ type: "text", text: this.pendingContext ? `${this.pendingContext}\n\n${turn.text}` : turn.text }],
			model: turn.model,
			approvalPolicy: "on-request",
			permissions: TALOS_AGENT_WORKBENCH_CODEX_PROFILE,
			collaborationMode: { mode: turn.workflow === "plan" ? "plan" : "default" },
		};
		for await (const frame of this.port.turn(params, turn.signal)) {
			const payload = { ...frame.params, protocolMethod: frame.method };
			const nativeId = textField(frame.params, "itemId", "id") ?? String(frame.id ?? "");
			yield this.events.create({ conversationId: turn.conversationId, turnId: turn.turnId, type: eventType(frame.method), payload, nativeId });
		}
		this.pendingContext = undefined;
		this.activeTurnId = undefined;
	}
	async resolveApproval(requestId: string | number, decision: TalosApproval, kind: "command" | "file" | "permissions" = "command", permissions: Record<string, unknown> = {}): Promise<void> {
		if (!this.port.respond) throw new Error("Codex transport 不支持 server request response");
		if (kind === "permissions") {
			await this.port.respond(requestId, { permissions: decision === "allow" || decision === "allow-always" ? permissions : {}, scope: decision === "allow-always" ? "session" : "turn" });
			return;
		}
		const mapped = decision === "allow-always" ? "acceptForSession" : decision === "allow" ? "accept" : decision === "cancel" ? "cancel" : "decline";
		await this.port.respond(requestId, { decision: mapped });
	}
	async answerUser(requestId: string | number, answers: Record<string, { answers: string[] }>): Promise<void> {
		if (!this.port.respond) throw new Error("Codex transport 不支持 ask-user response");
		await this.port.respond(requestId, { answers });
	}
	async respondApproval(input: { requestId: string | number; decision: TalosApproval; kind?: "command" | "file" | "permissions"; details?: Record<string, unknown> }): Promise<void> {
		await this.resolveApproval(input.requestId, input.decision, input.kind, input.details);
	}
	async respondUserInput(input: { requestId: string | number; answers: Record<string, string | string[]> }): Promise<void> {
		await this.answerUser(input.requestId, Object.fromEntries(Object.entries(input.answers).map(([key, value]) => [key, { answers: Array.isArray(value) ? value : [value] }])));
	}
	async steer(input: RuntimeSteer): Promise<void> { await this.port.request("turn/steer", { threadId: this.binding?.sessionId, turnId: input.turnId, input: [{ type: "text", text: input.text }] }); }
	async cancel(reason?: string): Promise<void> { if (this.binding) await this.port.cancel(this.binding.sessionId, this.activeTurnId, reason); }
	async fork(input: { binding: NativeSessionBinding }): Promise<NativeSessionBinding> {
		const result = await this.port.request<{ thread: { id: string } }>("thread/fork", { threadId: input.binding.sessionId });
		return { runtimeId: this.id, sessionId: result.thread.id, protocolVersion: "app-server-v2" };
	}
	async rollback(numTurns: number): Promise<void> { await this.port.request("thread/rollback", { threadId: this.binding?.sessionId, numTurns }); }
	async compact(): Promise<void> { await this.port.request("thread/compact/start", { threadId: this.binding?.sessionId }); }
	async dispose(): Promise<void> { try { await this.cancel("dispose"); await this.port.close(); } finally { await this.onDispose(); this.binding = null; } }
	capabilities(): RuntimeCapabilities {
		return {
			session: { resume: "native", fork: "native", compact: "native", rewind: "native", steer: "native" },
			input: { text: "native", image: "native", vaultFile: "native", selection: "talos-emulated" },
			tools: { shell: "native", edit: "native", mcp: "native", skills: "native", subagents: "native", askUser: "native" },
			control: { plan: "native", reasoning: "native", serviceTier: "native", usage: "native" },
			security: { nativeApproval: "native", nativeSandbox: "native", networkPolicy: "native", externalPathGrant: "talos-emulated" },
		};
	}
}
