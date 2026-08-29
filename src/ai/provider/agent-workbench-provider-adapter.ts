import type { AgentEvent } from "../../agent-workbench/contracts/agent-events";
import type {
	AgentRuntimeAdapter,
	RuntimeHistoryItem,
	RuntimeId,
} from "../../agent-workbench/contracts/runtime-adapter";
import type { AgentWorkbenchService } from "../../agent-workbench/core/agent-workbench-service";
import type {
	AskEvent,
	AskRequest,
	ProviderCapability,
	TalosProvider,
} from "./types";

export interface AgentWorkbenchProviderAdapterOptions {
	runtimeId: RuntimeId;
	service: AgentWorkbenchService;
	vaultRoot: string;
}

function history(value: unknown): RuntimeHistoryItem[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.flatMap((item): RuntimeHistoryItem[] => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const record = item as Record<string, unknown>;
		const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
		const text = typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : null;
		return role && text ? [{ role, text }] : [];
	});
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function toolId(event: AgentEvent): string {
	return text(event.payload.id) || event.nativeId || event.eventId;
}

function usageNumber(payload: Record<string, unknown>, ...keys: string[]): number {
	for (const key of keys) {
		const value = payload[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return 0;
}

/** Provider-facade bridge backed only by TALOS runtime adapters. */
export class AgentWorkbenchProviderAdapter implements TalosProvider {
	readonly id: string;
	readonly kind = "cli" as const;
	private readonly active = new Map<string, AgentRuntimeAdapter>();
	private readonly bindings = new Map<string, Awaited<ReturnType<AgentRuntimeAdapter["createSession"]>>>();
	private pendingResumeSessionId: string | null = null;

	constructor(private readonly options: AgentWorkbenchProviderAdapterOptions) {
		this.id = options.runtimeId;
	}

	capabilities(): ReadonlySet<ProviderCapability> {
		return new Set(["chat", "stream", "tools", "usage", "cancel", "resume", "fork"]);
	}

	async *chat(request: AskRequest): AsyncIterable<AskEvent> {
		const runtime = await this.options.service.createRuntime(this.options.runtimeId, {
			vaultRoot: this.options.vaultRoot,
			permissionMode: "ask",
			approve: async () => "deny",
		});
		this.active.set(request.runId, runtime);
		const logicalSessionId = request.sessionId ?? this.pendingResumeSessionId ?? crypto.randomUUID();
		this.pendingResumeSessionId = null;
		let sawDone = false;
		let sawDelta = false;
		let sawError = false;
		try {
			let binding = this.bindings.get(logicalSessionId);
			if (binding) {
				try { await runtime.resumeSession(binding); }
				catch { this.bindings.delete(logicalSessionId); binding = undefined; }
			}
			if (!binding) {
				binding = await runtime.createSession({
					conversationId: logicalSessionId,
					vaultRoot: this.options.vaultRoot,
					model: this.options.service.getSelection().runtimeId === this.options.runtimeId
						? this.options.service.getSelection().model
						: undefined,
				});
				this.bindings.set(logicalSessionId, binding);
			}
			for await (const event of runtime.send({
				conversationId: logicalSessionId,
				turnId: request.turnId,
				input: [{ type: "text", text: request.text }],
				text: request.text,
				history: history(request.historyRef),
				workflow: request.toolsAllowed === false ? "plan" : this.options.service.getWorkflowMode(),
				permissionMode: "ask",
				toolPolicy: request.toolsAllowed === false ? { kind: "read-only" } : { kind: "provider-default" },
			})) {
				if (event.type === "assistant.delta") {
					sawDelta = true;
					const content = text(event.payload.text) || text(event.payload.delta);
					if (content) yield { type: "text", text: content };
				} else if (event.type === "assistant.final" && !sawDelta) {
					const content = text(event.payload.text);
					if (content) yield { type: "text", text: content };
				} else if (event.type === "thinking.delta") {
					const content = text(event.payload.text) || text(event.payload.delta);
					if (content) yield { type: "thinking", text: content };
				} else if (event.type === "tool.started") {
					yield {
						type: "tool-request",
						toolCallId: toolId(event),
						name: text(event.payload.name) || text(event.payload.tool) || "tool",
						input: event.payload.input && typeof event.payload.input === "object" && !Array.isArray(event.payload.input)
							? event.payload.input as Record<string, unknown>
							: {},
					};
				} else if (event.type === "tool.finished") {
					yield {
						type: "tool-result",
						toolCallId: toolId(event),
						output: event.payload.output ?? event.payload.result,
						isError: event.payload.isError === true || event.payload.status === "failed",
					};
				} else if (event.type === "approval.requested" && event.nativeId && runtime.respondApproval) {
					await runtime.respondApproval({ requestId: event.nativeId, decision: "deny" });
				} else if (event.type === "user.question" && event.nativeId && runtime.respondUserInput) {
					await runtime.respondUserInput({ requestId: event.nativeId, answers: null });
				} else if (event.type === "usage.updated") {
					yield {
						type: "usage",
						inputTokens: usageNumber(event.payload, "inputTokens", "input_tokens"),
						outputTokens: usageNumber(event.payload, "outputTokens", "output_tokens"),
					};
				} else if (event.type === "error") {
					sawError = true;
					yield { type: "error", message: text(event.payload.message) || "运行时错误", retryable: event.payload.recoverable === true };
				} else if (event.type === "turn.finished") {
					sawDone = true;
					yield { type: "done", sessionId: logicalSessionId };
				}
			}
			if (!sawDone && !sawError) yield { type: "done", sessionId: logicalSessionId };
		} finally {
			if (this.active.get(request.runId) === runtime) this.active.delete(request.runId);
			await runtime.dispose().catch(() => undefined);
		}
	}

	async cancel(runId: string): Promise<void> {
		await this.active.get(runId)?.cancel("provider-facade");
	}

	async resume(sessionId: string): Promise<void> {
		this.pendingResumeSessionId = sessionId;
	}
}

export function createAgentWorkbenchProviderAdapters(
	service: AgentWorkbenchService,
	vaultRoot: string,
): AgentWorkbenchProviderAdapter[] {
	return (["claude", "codex", "ohmypi"] as const).map((runtimeId) =>
		new AgentWorkbenchProviderAdapter({ runtimeId, service, vaultRoot })
	);
}
