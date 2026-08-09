import { contextWindowFor, type SeedTurn, type UserTurn } from "../../jarvis/engine-types";
import type {
	ModelClient,
	StreamHandlers,
} from "../../jarvis/agent/loop";
import type { ToolResult } from "../../jarvis/agent/vault-tools";
import { ANTHROPIC_TOOLS } from "../../jarvis/agent/tool-schema";

function thinkingBudget(level: string): number {
	switch (level) {
		case "low": return 2048;
		case "medium": return 8192;
		case "high": return 16384;
		default: return 0;
	}
}

interface Msg {
	role: "user" | "assistant";
	content: unknown[];
}

interface SseEvent {
	type?: string;
	index?: number;
	delta?: {
		type?: string;
		text?: string;
		thinking?: string;
		partial_json?: string;
		stop_reason?: string;
	};
	content_block?: { type?: string; id?: string; name?: string };
	message?: { usage?: { input_tokens?: number } };
	usage?: { output_tokens?: number };
}

interface BlockAcc {
	type: string;
	text: string;
	id?: string;
	name?: string;
	json: string;
}

export interface AnthropicModelClientConfig {
	endpoint: string;
	thinkingLevel: string;
}

export class AnthropicModelClient implements ModelClient {
	private messages: Msg[] = [];
	private controller: AbortController | null = null;

	constructor(
		private readonly config: AnthropicModelClientConfig,
		private readonly model: string,
		private readonly system: string,
		private readonly getApiKey: () => string | null,
		private readonly fetcher: typeof fetch = window.fetch.bind(
			window
		)
	) {}

	seed(turns: SeedTurn[]): void {
		for (const turn of turns) {
			const last = this.messages[this.messages.length - 1];
			if (last && last.role === turn.role) {
				last.content.push({ type: "text", text: turn.text });
			} else {
				this.messages.push({
					role: turn.role,
					content: [{ type: "text", text: turn.text }],
				});
			}
		}
	}

	pushUser(turn: UserTurn): void {
		const content: unknown[] = [{ type: "text", text: turn.text }];
		for (const image of turn.images ?? []) {
			content.push({
				type: "image",
				source: {
					type: "base64",
					media_type: image.mime,
					data: image.dataB64,
				},
			});
		}
		this.messages.push({ role: "user", content });
	}

	pushToolResults(results: ToolResult[]): void {
		this.messages.push({
			role: "user",
			content: results.map((result) => ({
				type: "tool_result",
				tool_use_id: result.id,
				content: result.content,
				is_error: result.isError,
			})),
		});
	}

	async stream(handlers: StreamHandlers): Promise<void> {
		const apiKey = this.getApiKey()?.trim() ?? "";
		if (!apiKey) {
			handlers.onError(new Error("未配置 Provider 密钥"));
			return;
		}
		const base =
			this.config.endpoint.trim() || "https://api.anthropic.com";
		const endpoint = base.endsWith("/v1/messages")
			? base
			: `${base.replace(/\/+$/, "")}/v1/messages`;
		this.controller = new AbortController();

		const assistant: unknown[] = [];
		const current: Record<number, BlockAcc> = {};
		let stopReason = "end_turn";
		let inputTokens = 0;
		const contextWindow = contextWindowFor(this.model);
		const budget = thinkingBudget(this.config.thinkingLevel);
		const payload: Record<string, unknown> = {
			model: this.model,
			max_tokens: budget > 0 ? budget + 8192 : 8192,
			system: this.system,
			messages: this.messages,
			tools: ANTHROPIC_TOOLS,
			stream: true,
		};
		if (budget > 0) {
			payload.thinking = { type: "enabled", budget_tokens: budget };
		}

		try {
			const response = await this.fetcher(endpoint, {
				method: "POST",
				signal: this.controller.signal,
				headers: {
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
					"content-type": "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
				},
				body: JSON.stringify(payload),
			});
			if (!response.ok || !response.body) {
				handlers.onError(
					new Error(`Anthropic HTTP ${response.status}`)
				);
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
						.join("\n");
					if (!data || data === "[DONE]") continue;
					let event: SseEvent;
					try {
						event = JSON.parse(data) as SseEvent;
					} catch {
						continue;
					}
					if (
						event.type === "message_start" &&
						event.message?.usage?.input_tokens != null
					) {
						inputTokens =
							event.message.usage.input_tokens;
					}
					if (
						event.type === "message_delta" &&
						event.usage?.output_tokens != null
					) {
						handlers.onUsage({
							inputTokens,
							outputTokens: event.usage.output_tokens,
							contextWindow,
						});
					}
					this.handle(
						event,
						handlers,
						assistant,
						current,
						(reason) => (stopReason = reason)
					);
				}
			}
			if (assistant.length > 0) {
				this.messages.push({
					role: "assistant",
					content: assistant,
				});
			}
			handlers.onDone(
				stopReason === "tool_use" ? "tool_use" : "end"
			);
		} catch (error) {
			if (this.controller?.signal.aborted) {
				const textOnly = assistant.filter(
					(block) =>
						(block as { type?: string }).type === "text"
				);
				if (textOnly.length > 0) {
					this.messages.push({
						role: "assistant",
						content: textOnly,
					});
				}
				handlers.onDone("end");
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

	private handle(
		event: SseEvent,
		handlers: StreamHandlers,
		assistant: unknown[],
		current: Record<number, BlockAcc>,
		setStop: (reason: string) => void
	): void {
		const index = event.index ?? 0;
		switch (event.type) {
			case "content_block_start": {
				const block = event.content_block ?? {};
				if (block.type === "tool_use") {
					current[index] = {
						type: "tool_use",
						text: "",
						id: block.id,
						name: block.name,
						json: "",
					};
				} else {
					current[index] = {
						type: block.type ?? "text",
						text: "",
						json: "",
					};
				}
				break;
			}
			case "content_block_delta": {
				const block = current[index];
				const delta = event.delta ?? {};
				if (!block) break;
				if (delta.type === "text_delta" && delta.text) {
					block.text += delta.text;
					handlers.onTextDelta(delta.text);
				} else if (
					delta.type === "thinking_delta" &&
					delta.thinking
				) {
					block.text += delta.thinking;
					handlers.onThinkingDelta(delta.thinking);
				} else if (
					delta.type === "input_json_delta" &&
					delta.partial_json
				) {
					block.json += delta.partial_json;
				}
				break;
			}
			case "content_block_stop": {
				const block = current[index];
				if (!block) break;
				if (block.type === "text") {
					assistant.push({ type: "text", text: block.text });
				} else if (block.type === "tool_use") {
					let input: Record<string, unknown> = {};
					try {
						input = JSON.parse(
							block.json || "{}"
						) as Record<string, unknown>;
					} catch {
						// Empty or malformed tool input is treated as no input.
					}
					assistant.push({
						type: "tool_use",
						id: block.id,
						name: block.name,
						input,
					});
					handlers.onToolCall({
						id: String(block.id ?? ""),
						name: String(block.name ?? ""),
						input,
					});
				}
				delete current[index];
				break;
			}
			case "message_delta":
				if (event.delta?.stop_reason) {
					setStop(event.delta.stop_reason);
				}
				break;
			default:
				break;
		}
	}
}
