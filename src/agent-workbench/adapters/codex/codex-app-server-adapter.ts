import type { AgentEvent, AgentEventType } from "../../contracts/agent-events";
import type { AgentRuntimeAdapter, CreateSessionInput, ModelDescriptor, NativeSessionBinding, RuntimeProbe, RuntimeSteer, RuntimeTurn } from "../../contracts/runtime-adapter";
import type { RuntimeCapabilities } from "../../contracts/runtime-capabilities";
import { RuntimeEventFactory } from "../shared/event-factory";
import { textField, type ProtocolFrame } from "../shared/protocol-frame";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimePrompt } from "../../contracts/execution-request";
import { decodeRuntimeImages } from "../shared/image-input";

export interface CodexAppServerPort {
	probe(signal?: AbortSignal): Promise<RuntimeProbe>;
	request<T>(method: string, params: Record<string, unknown>): Promise<T>;
	turn(params: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<ProtocolFrame>;
	respond?(requestId: string | number, result: unknown): Promise<void>;
	steer(threadId: string, text: string): Promise<void>;
	cancel(threadId: string, reason?: string): Promise<void>;
	close(): Promise<void>;
}

type TalosApproval = "allow" | "allow-always" | "deny" | "cancel";

function nestedRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function completedAgentMessageText(payload: Record<string, unknown>): string | undefined {
	const item = nestedRecord(payload.item);
	if (item?.type === "agentMessage" && typeof item.text === "string") {
		return item.text;
	}
	return undefined;
}

const CODEX_TOOL_ITEM_TYPES = new Set([
	"commandExecution",
	"fileChange",
	"imageView",
	"webSearch",
	"collabAgentToolCall",
	"mcpToolCall",
	"dynamicToolCall",
]);

function canonicalToolItem(payload: Record<string, unknown>): Record<string, unknown> | null {
	const item = nestedRecord(payload.item);
	return item && typeof item.type === "string" && CODEX_TOOL_ITEM_TYPES.has(item.type) ? item : null;
}

function canonicalToolName(item: Record<string, unknown>): string {
	const explicit = [item.tool, item.name].find((value): value is string => typeof value === "string" && value.length > 0);
	if (explicit) return explicit;
	const names: Record<string, string> = {
		commandExecution: "Bash",
		fileChange: "Edit",
		imageView: "ImageView",
		webSearch: "WebSearch",
		collabAgentToolCall: "Agent",
		mcpToolCall: "MCP",
		dynamicToolCall: "Tool",
	};
	return typeof item.type === "string" ? names[item.type] ?? "工具" : "工具";
}

function canonicalToolPayload(method: string, payload: Record<string, unknown>): Record<string, unknown> {
	if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
		return {
			...(typeof payload.itemId === "string" ? { id: payload.itemId } : {}),
			...(typeof payload.delta === "string" ? { output: payload.delta } : {}),
		};
	}
	const item = canonicalToolItem(payload);
	if (!item) return {};
	const status = typeof item.status === "string" ? item.status.toLocaleLowerCase("en-US") : "";
	const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
	const input = item.type === "commandExecution"
		? { command: item.command, cwd: item.cwd }
		: item.input ?? item.arguments ?? item.changes ?? item.query ?? item.path ?? {};
	const output = item.aggregatedOutput ?? item.result ?? item.output ?? "";
	return {
		...(typeof item.id === "string" ? { id: item.id } : {}),
		name: canonicalToolName(item),
		input,
		output,
		error: exitCode !== null ? exitCode !== 0 : status === "failed" || status === "error",
	};
}

function completedTurnError(payload: Record<string, unknown>): string | undefined {
	const turn = nestedRecord(payload.turn);
	const error = nestedRecord(turn?.error);
	return typeof error?.message === "string" ? error.message : undefined;
}

function eventType(method: string, payload: Record<string, unknown>): AgentEventType | null {
	if (method === "item/agentMessage/delta") return "assistant.delta";
	if (method === "item/completed" && completedAgentMessageText(payload) !== undefined) return "assistant.final";
	if (method === "item/started" && canonicalToolItem(payload)) return "tool.started";
	if (method === "item/completed" && canonicalToolItem(payload)) return "tool.finished";
	if (method.includes("reasoning")) return "thinking.delta";
	if (method.includes("plan")) return "plan.updated";
	if (method === "item/fileChange/patchUpdated") return "file.diff";
	if (method.includes("requestApproval")) return "approval.requested";
	if (method === "item/tool/requestUserInput") return "user.question";
	if (method.includes("tokenUsage")) return "usage.updated";
	if (method === "turn/completed") {
		const turn = nestedRecord(payload.turn);
		return turn?.status === "failed" ? "error" : "turn.finished";
	}
	if (method.includes("subagent")) return "subagent.updated";
	if (method.includes("commandExecution") || method.includes("fileChange") || method.includes("tool")) {
		return method.endsWith("/completed") ? "tool.finished" : method.endsWith("/started") ? "tool.started" : "tool.updated";
	}
	if (method === "error") return payload.willRetry === true ? "runtime.status" : "error";
	if (method === "notice" && typeof payload.message === "string") return "notice";
	return null;
}

export class CodexAppServerAdapter implements AgentRuntimeAdapter {
	readonly id = "codex" as const;
	private binding: NativeSessionBinding | null = null;
	private activeModel: string | undefined;
	private pendingContext: string | undefined;
	private readonly events = new RuntimeEventFactory(this.id);
	constructor(
		private readonly port: CodexAppServerPort,
		private readonly onDispose: () => Promise<void> = async () => {},
		private readonly imageTempRoot?: string,
	) {}

	probe(signal?: AbortSignal) { return this.port.probe(signal); }
	async listModels(): Promise<ModelDescriptor[]> {
		const result = await this.port.request<{ data?: Array<{
			id: string;
			model?: string;
			displayName?: string;
			description?: string;
			hidden?: boolean;
			isDefault?: boolean;
			supportedReasoningEfforts?: Array<{ reasoningEffort?: string; value?: string; description?: string }>;
			defaultReasoningEffort?: string;
			serviceTiers?: Array<{ id: string; name?: string; description?: string }>;
			defaultServiceTier?: string | null;
		}> }>("model/list", {});
		return (result.data ?? []).flatMap((model) => {
			if (model.hidden) return [];
			const id = model.model?.trim() || model.id;
			const reasoningOptions = (model.supportedReasoningEfforts ?? []).flatMap((option) => {
				const value = option.reasoningEffort?.trim() || option.value?.trim();
				return value ? [{ value, label: value, ...(option.description ? { description: option.description } : {}) }] : [];
			});
			const serviceTiers = (model.serviceTiers ?? []).filter((tier) => tier.id.trim()).map((tier) => ({
				id: tier.id,
				label: tier.name?.trim() || tier.id,
				...(tier.description ? { description: tier.description } : {}),
			}));
			return [{
				id,
				label: model.displayName ?? id,
				...(model.description ? { description: model.description } : {}),
				...(model.isDefault ? { isDefault: true } : {}),
				...(reasoningOptions.length ? { reasoningOptions } : {}),
				...(model.defaultReasoningEffort ? { defaultReasoning: model.defaultReasoningEffort } : {}),
				...(serviceTiers.length ? { serviceTiers } : {}),
				...(model.defaultServiceTier ? { defaultServiceTier: model.defaultServiceTier } : {}),
			}];
		});
	}
	async createSession(input: CreateSessionInput): Promise<NativeSessionBinding> {
		const result = await this.port.request<{ thread: { id: string }; model?: string }>("thread/start", {
			cwd: input.vaultRoot, model: input.model, provider: input.providerProfileId,
			approvalPolicy: "on-request", sandbox: "danger-full-access",
			runtimeWorkspaceRoots: [input.vaultRoot], persistExtendedHistory: true, experimentalRawEvents: true,
		});
		this.activeModel = result.model ?? input.model;
		this.pendingContext = input.initialContext;
		return this.binding = { runtimeId: this.id, sessionId: result.thread.id, protocolVersion: "app-server-v2", ...(input.providerProfileId ? { providerProfileId: input.providerProfileId } : {}) };
	}
	async resumeSession(binding: NativeSessionBinding): Promise<void> {
		const result = await this.port.request<{ model?: string }>("thread/resume", {
			threadId: binding.sessionId,
			approvalPolicy: "on-request",
			sandbox: "danger-full-access",
			persistExtendedHistory: true,
		});
		this.activeModel = result.model;
		this.binding = binding;
	}
	async synchronizeContext(input: { context: string }): Promise<void> { this.pendingContext = input.context; }
	async *send(turn: RuntimeTurn): AsyncIterable<AgentEvent> {
		if (!this.binding) throw new Error("Codex native session 尚未绑定");
		const imageDirectory = this.imageTempRoot ? path.join(this.imageTempRoot, `turn-${turn.turnId}`) : null;
		const input: Array<Record<string, unknown>> = [];
		try {
			const images = decodeRuntimeImages(turn.input);
			if (images.length && !imageDirectory) throw new Error("Codex 图片临时目录未配置");
			if (imageDirectory) await mkdir(imageDirectory, { recursive: true });
			for (const [index, image] of images.entries()) {
				const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, "-") || `image-${index + 1}`;
				const filePath = path.join(imageDirectory!, `${index + 1}-${safeName}`);
				await writeFile(filePath, Buffer.from(image.base64, "base64"), { mode: 0o600 });
				input.push({ type: "localImage", path: filePath });
			}
			const prompt = this.pendingContext ? `${this.pendingContext}\n\n${runtimePrompt(turn)}` : runtimePrompt(turn);
			if (prompt) input.push({ type: "text", text: prompt, text_elements: [] });
		const params = {
			threadId: this.binding.sessionId,
			input,
			model: turn.model,
			serviceTier: turn.serviceTier,
			approvalPolicy: "on-request",
			sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
			collaborationMode: {
				mode: turn.workflow === "plan" ? "plan" : "default",
				settings: {
					model: turn.model ?? this.activeModel ?? "gpt-5.5",
					reasoning_effort: turn.reasoning ?? null,
					developer_instructions: null,
				},
			},
		};
		for await (const frame of this.port.turn(params, turn.signal)) {
			const completedText = completedAgentMessageText(frame.params);
			const completedError = completedTurnError(frame.params);
			const payload = {
				...frame.params,
				...canonicalToolPayload(frame.method, frame.params),
				...(completedText !== undefined ? { text: completedText } : {}),
				...(completedError ? { message: completedError } : {}),
				protocolMethod: frame.method,
			};
			const nativeId = textField(frame.params, "itemId", "id") ?? String(frame.id ?? "");
			const type = eventType(frame.method, frame.params);
			if (!type) continue;
			yield this.events.create({ conversationId: turn.conversationId, turnId: turn.turnId, type, payload, nativeId });
		}
		this.pendingContext = undefined;
		} finally {
			if (imageDirectory) await rm(imageDirectory, { recursive: true, force: true }).catch(() => undefined);
		}
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
	async respondUserInput(input: { requestId: string | number; answers: Record<string, string | string[]> | null }): Promise<void> {
		await this.answerUser(input.requestId, Object.fromEntries(Object.entries(input.answers ?? {}).map(([key, value]) => [key, { answers: Array.isArray(value) ? value : [value] }])));
	}
	async steer(input: RuntimeSteer): Promise<void> {
		if (!this.binding) throw new Error("Codex native session 尚未绑定");
		await this.port.steer(this.binding.sessionId, input.text);
	}
	async cancel(reason?: string): Promise<void> { if (this.binding) await this.port.cancel(this.binding.sessionId, reason); }
	async fork(input: { binding: NativeSessionBinding }): Promise<NativeSessionBinding> {
		const result = await this.port.request<{ thread: { id: string } }>("thread/fork", { threadId: input.binding.sessionId });
		return { runtimeId: this.id, sessionId: result.thread.id, protocolVersion: "app-server-v2", ...(input.binding.providerProfileId ? { providerProfileId: input.binding.providerProfileId } : {}) };
	}
	async rollback(numTurns: number): Promise<void> { await this.port.request("thread/rollback", { threadId: this.binding?.sessionId, numTurns }); }
	async compact(): Promise<void> { await this.port.request("thread/compact/start", { threadId: this.binding?.sessionId }); }
	async dispose(): Promise<void> { try { await this.cancel("dispose"); await this.port.close(); } finally { await this.onDispose(); this.binding = null; this.activeModel = undefined; } }
	capabilities(): RuntimeCapabilities {
		return {
			session: { resume: "native", fork: "native", compact: "native", rewind: "native", steer: "native" },
			input: { text: "native", image: "native", vaultFile: "talos-emulated", selection: "talos-emulated" },
			tools: { shell: "native", edit: "native", mcp: "native", skills: "native", subagents: "native", askUser: "native" },
			control: { plan: "native", reasoning: "native", serviceTier: "native", usage: "native" },
			security: { nativeApproval: "native", nativeSandbox: "talos-emulated", networkPolicy: "talos-emulated", externalPathGrant: "talos-emulated" },
		};
	}
}
