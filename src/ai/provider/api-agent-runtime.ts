import {
	AgentLoop,
	type AgentToolRunner,
	type ModelClient,
} from "../../jarvis/agent/loop";
import type { JarvisEvents, SeedTurn } from "../../jarvis/engine-types";
import type {
	ToolCall,
	ToolOutcome,
} from "../../jarvis/agent/vault-tools";
import { sanitizeAuditValue } from "../../task-core/audit-sanitizer";
import type {
	AskEvent,
	AskRequest,
	ProviderCapability,
	TalosProvider,
} from "./types";

export type ApiToolRunner = AgentToolRunner;

export function apiHistoryTurns(value: unknown): SeedTurn[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item): SeedTurn[] => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const record = item as Record<string, unknown>;
		const role = record.role === "user"
			? "user"
			: record.role === "assistant"
				? "assistant"
				: null;
		const text = typeof record.text === "string"
			? record.text
			: typeof record.content === "string"
				? record.content
				: "";
		return role && text ? [{ role, text }] : [];
	});
}

export interface ApiAgentRuntimeOptions {
	id: string;
	modelFactory(request: AskRequest): ModelClient;
	toolRunner: ApiToolRunner;
	classifyError?: (error: Error) => { retryable: boolean };
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
	private readonly values: T[] = [];
	private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
	private closed = false;

	push(value: T): void {
		if (this.closed) return;
		const waiter = this.waiters.shift();
		if (waiter) waiter({ done: false, value });
		else this.values.push(value);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const waiter of this.waiters.splice(0)) {
			waiter({ done: true, value: undefined });
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: async () => {
				const value = this.values.shift();
				if (value !== undefined) return { done: false, value };
				if (this.closed) return { done: true, value: undefined };
				return new Promise<IteratorResult<T>>((resolve) => {
					this.waiters.push(resolve);
				});
			},
		};
	}
}

function defaultClassifyError(error: Error): { retryable: boolean } {
	const status = Number(/\b(401|429|5\d\d)\b/.exec(error.message)?.[1] ?? 0);
	return { retryable: status === 429 || status >= 500 };
}

export class ApiAgentRuntime implements TalosProvider {
	readonly id: string;
	readonly kind = "api" as const;
	private readonly active = new Map<string, AgentLoop>();
	private readonly toolResults = new Map<string, ToolOutcome>();
	private resumedSessionId: string | null = null;

	constructor(private readonly options: ApiAgentRuntimeOptions) {
		this.id = options.id;
	}

	capabilities(): ReadonlySet<ProviderCapability> {
		return new Set([
			"chat",
			"stream",
			"tools",
			"usage",
			"cancel",
			"resume",
			"fork",
		]);
	}

	chat(request: AskRequest): AsyncIterable<AskEvent> {
		const queue = new AsyncEventQueue<AskEvent>();
		const model = this.options.modelFactory({
			...request,
			sessionId: request.sessionId ?? this.resumedSessionId ?? undefined,
		});
		this.resumedSessionId = null;
		const executed = request.executedToolIds ?? new Set<string>();
		const toolResultScope = request.sessionId ?? request.runId;
		const tools: AgentToolRunner = {
			run: async (call: ToolCall) => {
				const cacheKey = `${toolResultScope}\0${call.id}`;
				const cached = this.toolResults.get(cacheKey);
				if (cached) return cached;
				if (executed.has(call.id)) {
					return {
						content: "工具已在先前运行中完成，跳过重复执行",
						isError: false,
					};
				}
				if (request.toolsAllowed === false) {
					return { content: "复核模式禁止执行工具", isError: true };
				}
				const result = await this.options.toolRunner.run(call);
				if (!result.isError) this.toolResults.set(cacheKey, result);
				return result;
			},
		};
		const events: JarvisEvents = {
			onTextDelta: (text) => queue.push({ type: "text", text }),
			onThinkingDelta: (text) => queue.push({ type: "thinking", text }),
			onToolUse: (tool) =>
				queue.push({
					type: "tool-request",
					toolCallId: tool.id,
					name: tool.name,
					input:
						typeof tool.input === "object" && tool.input !== null
							? (tool.input as Record<string, unknown>)
							: {},
				}),
			onToolResult: (result) =>
				queue.push({
					type: "tool-result",
					toolCallId: result.id,
					output: result.content,
					isError: result.isError,
				}),
			onUsage: (usage) =>
				queue.push({
					type: "usage",
					inputTokens: usage.inputTokens,
					outputTokens: usage.outputTokens,
				}),
			onError: (error) => {
				const safe = String(sanitizeAuditValue(error.message));
				const classify = this.options.classifyError ?? defaultClassifyError;
				queue.push({
					type: "error",
					message: safe,
					retryable: classify(error).retryable,
				});
			},
		};
		const loop = new AgentLoop(model, tools, events);
		this.active.set(request.runId, loop);
		void loop
			.turn({ text: request.text })
			.finally(() => {
				this.active.delete(request.runId);
				queue.push({
					type: "done",
					...(request.sessionId ? { sessionId: request.sessionId } : {}),
				});
				queue.close();
			});
		return queue;
	}

	async cancel(runId: string): Promise<void> {
		this.active.get(runId)?.abort();
	}

	async resume(sessionId: string): Promise<void> {
		this.resumedSessionId = sessionId;
	}
}
