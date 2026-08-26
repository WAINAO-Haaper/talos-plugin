import type { AgentEvent, AgentEventType } from "../../contracts/agent-events";
import type { AgentRuntimeAdapter, CreateSessionInput, ModelDescriptor, NativeSessionBinding, RuntimeProbe, RuntimeTurn } from "../../contracts/runtime-adapter";
import type { RuntimeCapabilities } from "../../contracts/runtime-capabilities";
import { RuntimeEventFactory } from "../shared/event-factory";
import type { ProtocolFrame } from "../shared/protocol-frame";

export interface ClaudeTurnInput {
	sessionId: string;
	prompt: string;
	model?: string;
	workflow: RuntimeTurn["workflow"];
	signal?: AbortSignal;
	permissionMode: "default";
	sandbox: { enabled: true; failIfUnavailable: true };
}

export interface ClaudeAgentSdkPort {
	probe(signal?: AbortSignal): Promise<RuntimeProbe>;
	models(signal?: AbortSignal): Promise<ModelDescriptor[]>;
	create(input: CreateSessionInput): Promise<string>;
	resume(sessionId: string): Promise<void>;
	turn(input: ClaudeTurnInput): AsyncIterable<ProtocolFrame>;
	cancel(): Promise<void>;
	fork(sessionId: string): Promise<string>;
	close(): Promise<void>;
}

function claudeEventType(method: string): AgentEventType {
	if (method === "assistant.delta") return "assistant.delta";
	if (method === "assistant.final") return "assistant.final";
	if (method.includes("thinking")) return "thinking.delta";
	if (method === "tool.started") return "tool.started";
	if (method === "tool.finished") return "tool.finished";
	if (method === "file.diff") return "file.diff";
	if (method === "approval.requested") return "approval.requested";
	if (method === "ask-user") return "user.question";
	if (method === "usage") return "usage.updated";
	if (method === "turn.finished") return "turn.finished";
	return method === "error" ? "error" : "notice";
}

export class ClaudeAgentSdkAdapter implements AgentRuntimeAdapter {
	readonly id = "claude" as const;
	private binding: NativeSessionBinding | null = null;
	private pendingContext: string | undefined;
	private readonly events = new RuntimeEventFactory(this.id);
	constructor(private readonly port: ClaudeAgentSdkPort, private readonly sandboxReady: () => boolean) {}
	probe(signal?: AbortSignal) { return this.port.probe(signal); }
	listModels(signal?: AbortSignal) { return this.port.models(signal); }
	async createSession(input: CreateSessionInput): Promise<NativeSessionBinding> {
		const sessionId = await this.port.create(input);
		this.pendingContext = input.initialContext;
		return this.binding = { runtimeId: this.id, sessionId, protocolVersion: "agent-sdk" };
	}
	async resumeSession(binding: NativeSessionBinding): Promise<void> { await this.port.resume(binding.sessionId); this.binding = binding; }
	async synchronizeContext(input: { context: string }): Promise<void> { this.pendingContext = input.context; }
	async *send(turn: RuntimeTurn): AsyncIterable<AgentEvent> {
		if (!this.binding) throw new Error("Claude native session 尚未绑定");
		if (turn.workflow === "execute" && !this.sandboxReady()) throw new Error("Claude sandbox 未 ready，Execute 已失败关闭");
		const prompt = this.pendingContext ? `${this.pendingContext}\n\n${turn.text}` : turn.text;
		for await (const frame of this.port.turn({ sessionId: this.binding.sessionId, prompt, model: turn.model, workflow: turn.workflow, signal: turn.signal, permissionMode: "default", sandbox: { enabled: true, failIfUnavailable: true } })) {
			yield this.events.create({ conversationId: turn.conversationId, turnId: turn.turnId, type: claudeEventType(frame.method), payload: { ...frame.params, protocolMethod: frame.method }, nativeId: String(frame.id ?? "") });
		}
		this.pendingContext = undefined;
	}
	async runAuxiliary(kind: "title" | "refine" | "inline-edit", turn: RuntimeTurn): Promise<AgentEvent[]> {
		const output: AgentEvent[] = [];
		for await (const event of this.send({ ...turn, text: `[${kind}] ${turn.text}` })) output.push(event);
		return output;
	}
	async cancel(): Promise<void> { await this.port.cancel(); }
	async fork(input: { binding: NativeSessionBinding }): Promise<NativeSessionBinding> { return { runtimeId: this.id, sessionId: await this.port.fork(input.binding.sessionId), protocolVersion: "agent-sdk" }; }
	async dispose(): Promise<void> { await this.cancel(); await this.port.close(); this.binding = null; }
	capabilities(): RuntimeCapabilities {
		return {
			session: { resume: "native", fork: "native", compact: "native", rewind: "unavailable", steer: "unavailable" },
			input: { text: "native", image: "native", vaultFile: "native", selection: "talos-emulated" },
			tools: { shell: "native", edit: "native", mcp: "native", skills: "native", subagents: "native", askUser: "native" },
			control: { plan: "native", reasoning: "native", serviceTier: "unavailable", usage: "native" },
			security: { nativeApproval: "native", nativeSandbox: "native", networkPolicy: "talos-emulated", externalPathGrant: "talos-emulated" },
		};
	}
}
