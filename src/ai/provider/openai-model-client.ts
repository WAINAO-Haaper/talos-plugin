import { contextWindowFor, type SeedTurn, type UserTurn } from "../../jarvis/engine-types";
import type {
	ModelClient,
	StreamHandlers,
} from "../../jarvis/agent/loop";
import type { ToolResult } from "../../jarvis/agent/vault-tools";
import { OPENAI_TOOLS } from "../../jarvis/agent/tool-schema";

function reasoningEffort(level: string, model: string): string | null {
	if (level === "off") return null;
	const normalized = model.toLowerCase();
	const isReasoning =
		normalized.includes("gpt-5") ||
		normalized.includes("o1") ||
		normalized.includes("o3") ||
		normalized.includes("codex");
	if (!isReasoning) return null;
	return level === "low" ? "low" : level === "high" ? "high" : "medium";
}

interface OpenAiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OpenAiMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | unknown[] | null;
	tool_calls?: OpenAiToolCall[];
	tool_call_id?: string;
}

interface OpenAiChunk {
	choices?: {
		delta?: {
			content?: string;
			tool_calls?: {
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}[];
		};
		finish_reason?: string | null;
	}[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ToolCallAccumulator {
	id: string;
	name: string;
	args: string;
}

export interface OpenAiModelClientConfig {
	endpoint: string;
	thinkingLevel: string;
}

export class OpenAiModelClient implements ModelClient {
	private messages: OpenAiMessage[];
	private controller: AbortController | null = null;

	constructor(
		private readonly config: OpenAiModelClientConfig,
		private readonly model: string,
		system: string,
		private readonly getApiKey: () => string | null,
		private readonly fetcher: typeof fetch = window.fetch.bind(
			window
		)
	) {
		this.messages = [{ role: "system", content: system }];
	}

	seed(turns: SeedTurn[]): void {
		for (const turn of turns) {
			this.messages.push({ role: turn.role, content: turn.text });
		}
	}

	pushUser(turn: UserTurn): void {
		if (turn.images && turn.images.length > 0) {
			const content: unknown[] = [
				{ type: "text", text: turn.text },
			];
			for (const image of turn.images) {
				content.push({
					type: "image_url",
					image_url: {
						url: `data:${image.mime};base64,${image.dataB64}`,
					},
				});
			}
			this.messages.push({ role: "user", content });
		} else {
			this.messages.push({ role: "user", content: turn.text });
		}
	}

	pushToolResults(results: ToolResult[]): void {
		for (const result of results) {
			this.messages.push({
				role: "tool",
				tool_call_id: result.id,
				content: result.content,
			});
		}
	}

	async stream(handlers: StreamHandlers): Promise<void> {
		const apiKey = this.getApiKey()?.trim() ?? "";
		if (!apiKey) {
			handlers.onError(new Error("未配置 Provider 密钥"));
			return;
		}
		const base = this.config.endpoint.trim() || "https://api.openai.com";
		const endpoint = base.endsWith("/v1/chat/completions")
			? base
			: `${base.replace(/\/+$/, "")}/v1/chat/completions`;
		this.controller = new AbortController();

		let assistantText = "";
		const calls: Record<number, ToolCallAccumulator> = {};
		let finishReason = "stop";
		const payload: Record<string, unknown> = {
			model: this.model,
			messages: this.messages,
			tools: OPENAI_TOOLS,
			stream: true,
			stream_options: { include_usage: true },
		};
		const effort = reasoningEffort(
			this.config.thinkingLevel,
			this.model
		);
		if (effort) payload.reasoning_effort = effort;

		try {
			const response = await this.fetcher(endpoint, {
				method: "POST",
				signal: this.controller.signal,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(payload),
			});
			if (!response.ok || !response.body) {
				handlers.onError(new Error(`OpenAI HTTP ${response.status}`));
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let separator: number;
				while ((separator = buffer.indexOf("\n\n")) >= 0) {
					const chunk = buffer.slice(0, separator);
					buffer = buffer.slice(separator + 2);
					const data = chunk
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trim())
						.join("");
					if (!data || data === "[DONE]") continue;
					let event: OpenAiChunk;
					try {
						event = JSON.parse(data) as OpenAiChunk;
					} catch {
						continue;
					}
					if (event.usage) {
						handlers.onUsage({
							inputTokens: event.usage.prompt_tokens ?? 0,
							outputTokens:
								event.usage.completion_tokens ?? 0,
							contextWindow: contextWindowFor(this.model),
						});
					}
					const choice = event.choices?.[0];
					if (!choice) continue;
					if (choice.delta?.content) {
						assistantText += choice.delta.content;
						handlers.onTextDelta(choice.delta.content);
					}
					for (const toolCall of choice.delta?.tool_calls ?? []) {
						const index = toolCall.index ?? 0;
						const accumulator = (calls[index] ??= {
							id: "",
							name: "",
							args: "",
						});
						if (toolCall.id) accumulator.id = toolCall.id;
						if (toolCall.function?.name) {
							accumulator.name = toolCall.function.name;
						}
						if (toolCall.function?.arguments) {
							accumulator.args +=
								toolCall.function.arguments;
						}
					}
					if (choice.finish_reason) {
						finishReason = choice.finish_reason;
					}
				}
			}
			this.finalize(
				handlers,
				assistantText,
				calls,
				finishReason
			);
		} catch (error) {
			if (this.controller?.signal.aborted) {
				this.finalize(handlers, assistantText, calls, "stop");
				return;
			}
			handlers.onError(
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}

	abort(): void {
		this.controller?.abort();
	}

	private finalize(
		handlers: StreamHandlers,
		text: string,
		calls: Record<number, ToolCallAccumulator>,
		finishReason: string
	): void {
		const accumulated = Object.keys(calls)
			.map(Number)
			.sort((left, right) => left - right)
			.map((index) => calls[index]);
		if (finishReason === "tool_calls" && accumulated.length > 0) {
			const toolCalls: OpenAiToolCall[] = accumulated.map((call) => ({
				id: call.id,
				type: "function",
				function: {
					name: call.name,
					arguments: call.args || "{}",
				},
			}));
			this.messages.push({
				role: "assistant",
				content: text || null,
				tool_calls: toolCalls,
			});
			for (const call of accumulated) {
				let input: Record<string, unknown> = {};
				try {
					input = JSON.parse(
						call.args || "{}"
					) as Record<string, unknown>;
				} catch {
					// Empty or malformed tool input is treated as no input.
				}
				handlers.onToolCall({
					id: call.id,
					name: call.name,
					input,
				});
			}
			handlers.onDone("tool_use");
		} else {
			this.messages.push({ role: "assistant", content: text });
			handlers.onDone("end");
		}
	}
}
