import { randomUUID } from "node:crypto";
import { forkSession, query, type CanUseTool, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CreateSessionInput, ModelDescriptor, RuntimeProbe } from "../contracts/runtime-adapter";
import type { ClaudeAgentSdkPort, ClaudeTurnInput } from "../adapters/claude/claude-agent-sdk-adapter";
import type { ProtocolFrame } from "../adapters/shared/protocol-frame";

export interface ClaudePermissionDelegate {
	decide(toolName: string, input: Record<string, unknown>, metadata: { blockedPath?: string; reason?: string; toolUseId: string; requestId: string }): Promise<{ allow: boolean; message?: string }>;
}

export interface ClaudeSdkFacade {
	query(input: Parameters<typeof query>[0]): Query;
	forkSession(sessionId: string): Promise<{ sessionId: string }>;
}

const defaultSdk: ClaudeSdkFacade = { query, forkSession: (sessionId) => forkSession(sessionId) };

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

function mapMessage(message: SDKMessage): ProtocolFrame[] {
	const record = asRecord(message);
	if (record.type === "stream_event") {
		const event = asRecord(record.event); const delta = asRecord(event.delta);
		if (delta.type === "text_delta" && typeof delta.text === "string") return [{ method: "assistant.delta", params: { text: delta.text } }];
		if (delta.type === "thinking_delta" && typeof delta.thinking === "string") return [{ method: "thinking.delta", params: { text: delta.thinking } }];
		if (delta.type === "input_json_delta") return [{ method: "tool.updated", params: { partialJson: delta.partial_json } }];
		return [];
	}
	if (record.type === "assistant") {
		const content = asRecord(record.message).content;
		if (!Array.isArray(content)) return [];
		const frames: ProtocolFrame[] = [];
		for (const block of content) {
			const item = asRecord(block);
			if (item.type === "text" && typeof item.text === "string") frames.push({ method: "assistant.final", params: { text: item.text } });
			if (item.type === "tool_use") frames.push({ method: "tool.started", params: { id: item.id, name: item.name, input: item.input } });
		}
		return frames;
	}
	if (record.type === "result") {
		const frames: ProtocolFrame[] = [];
		if (record.subtype === "success" && typeof record.result === "string") frames.push({ method: "assistant.final", params: { text: record.result } });
		frames.push({ method: "usage", params: { usage: record.usage, modelUsage: record.modelUsage } });
		frames.push({ method: "turn.finished", params: { status: record.subtype, errors: record.errors } });
		return frames;
	}
	if (record.type === "system" && record.subtype === "permission_denied") return [{ method: "approval.resolved", params: { decision: "deny", tool: record.tool_name } }];
	if (record.type === "system" && typeof record.subtype === "string" && record.subtype.startsWith("task_")) return [{ method: "task.progress", params: record }];
	if (record.type === "auth_status" && record.error) return [{ method: "error", params: { message: record.error } }];
	return [];
}

export class ClaudeSdkQueryPort implements ClaudeAgentSdkPort {
	private sessionId: string | null = null;
	private newSession = false;
	private active: Query | null = null;
	constructor(
		private readonly vaultRoot: string,
		private readonly probeRuntime: (signal?: AbortSignal) => Promise<RuntimeProbe>,
		private readonly permissions: ClaudePermissionDelegate,
		private readonly configuredModels: ModelDescriptor[] = [],
		private readonly executablePath?: string,
		private readonly sdk: ClaudeSdkFacade = defaultSdk,
	) {}

	probe(signal?: AbortSignal) { return this.probeRuntime(signal); }
	async models(): Promise<ModelDescriptor[]> { return [...this.configuredModels]; }
	async create(_input: CreateSessionInput): Promise<string> { this.newSession = true; return this.sessionId = randomUUID(); }
	async resume(sessionId: string): Promise<void> { this.newSession = false; this.sessionId = sessionId; }
	async *turn(input: ClaudeTurnInput): AsyncIterable<ProtocolFrame> {
		const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
			const decision = await this.permissions.decide(toolName, toolInput, { blockedPath: options.blockedPath, reason: options.decisionReason, toolUseId: options.toolUseID, requestId: options.requestId });
			return decision.allow ? { behavior: "allow", updatedInput: toolInput, toolUseID: options.toolUseID } : { behavior: "deny", message: decision.message ?? "TALOS 权限策略拒绝", toolUseID: options.toolUseID };
		};
		const options = {
			cwd: this.vaultRoot,
			model: input.model,
			permissionMode: input.workflow === "plan" ? "plan" as const : "default" as const,
			canUseTool,
			includePartialMessages: true,
			sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false },
			pathToClaudeCodeExecutable: this.executablePath,
			...(this.newSession ? { sessionId: this.sessionId ?? input.sessionId } : { resume: this.sessionId ?? input.sessionId }),
		};
		const active = this.sdk.query({ prompt: input.prompt, options }); this.active = active;
		try { for await (const message of active) for (const frame of mapMessage(message)) yield frame; this.newSession = false; }
		finally { if (this.active === active) this.active = null; }
	}
	async cancel(): Promise<void> { this.active?.close(); this.active = null; }
	async fork(sessionId: string): Promise<string> { return (await this.sdk.forkSession(sessionId)).sessionId; }
	async close(): Promise<void> { await this.cancel(); }
}
