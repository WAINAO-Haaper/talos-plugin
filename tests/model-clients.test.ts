import { describe, expect, it } from "vitest";
import { AnthropicModelClient } from "../src/ai/provider/anthropic-model-client";
import { OpenAiModelClient } from "../src/ai/provider/openai-model-client";
import type { StreamHandlers } from "../src/jarvis/agent/loop";

interface RecordedRequest {
	url: string;
	payload: Record<string, unknown>;
	headers: Record<string, string>;
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

function sseResponse(events: unknown[]): Response {
	const body = events
		.map((event) => `data: ${JSON.stringify(event)}\n\n`)
		.join("");
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function recordingFetcher(
	respond: (input: RequestInfo | URL, init?: RequestInit) => Response,
	recorded: RecordedRequest[]
): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const body = init?.body;
		recorded.push({
			url: requestUrl(input),
			payload: JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>,
			headers: Object.fromEntries(
				Object.entries((init?.headers ?? {}) as Record<string, string>)
			),
		});
		return respond(input, init);
	});
}

function recorder(): {
	handlers: StreamHandlers;
	text: string[];
	thinking: string[];
	tools: Array<{ id: string; name: string; input: Record<string, unknown> }>;
	usage: Array<{ inputTokens: number; outputTokens: number; contextWindow: number }>;
	done: Array<"end" | "tool_use">;
	errors: Error[];
} {
	const state = {
		text: [] as string[],
		thinking: [] as string[],
		tools: [] as Array<{ id: string; name: string; input: Record<string, unknown> }>,
		usage: [] as Array<{ inputTokens: number; outputTokens: number; contextWindow: number }>,
		done: [] as Array<"end" | "tool_use">,
		errors: [] as Error[],
	};
	return {
		...state,
		handlers: {
			onTextDelta: (t) => state.text.push(t),
			onThinkingDelta: (t) => state.thinking.push(t),
			onToolCall: (c) => state.tools.push(c),
			onUsage: (u) => state.usage.push(u),
			onDone: (s) => state.done.push(s),
			onError: (e) => state.errors.push(e),
		},
	};
}

const NO_KEY = () => null;
const WITH_KEY = () => "test-key";

describe("AnthropicModelClient", () => {
	it("refuses to call the network without an API key", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new AnthropicModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"claude-sonnet-4",
			"sys",
			NO_KEY,
			recordingFetcher(() => sseResponse([]), recorded)
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.errors.map((e) => e.message)).toEqual(["未配置 Provider 密钥"]);
		expect(rec.done).toEqual([]);
		expect(recorded).toEqual([]);
	});

	it("normalizes the endpoint and streams text with usage", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new AnthropicModelClient(
			{ endpoint: "https://proxy.example.com/", thinkingLevel: "off" },
			"claude-sonnet-4",
			"sys",
			WITH_KEY,
			recordingFetcher(
				() =>
					sseResponse([
						{ type: "message_start", message: { usage: { input_tokens: 10 } } },
						{ type: "content_block_start", index: 0, content_block: { type: "text" } },
						{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } },
						{ type: "content_block_stop", index: 0 },
						{
							type: "message_delta",
							delta: { stop_reason: "end_turn" },
							usage: { output_tokens: 5 },
						},
					]),
				recorded
			)
		);
		client.pushUser({ text: "hi" });
		const rec = recorder();
		await client.stream(rec.handlers);

		expect(recorded[0].url).toBe("https://proxy.example.com/v1/messages");
		expect(recorded[0].headers["x-api-key"]).toBe("test-key");
		expect(rec.text).toEqual(["你好"]);
		expect(rec.usage).toEqual([
			{ inputTokens: 10, outputTokens: 5, contextWindow: 200000 },
		]);
		expect(rec.done).toEqual(["end"]);
		expect(rec.errors).toEqual([]);
		const payload = recorded[0].payload;
		expect(payload.thinking).toBeUndefined();
		expect(payload.max_tokens).toBe(8192);
		expect(payload.stream).toBe(true);
	});

	it("enables extended thinking budget only when configured", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new AnthropicModelClient(
			{ endpoint: "https://api.anthropic.com/v1/messages", thinkingLevel: "high" },
			"claude-sonnet-4",
			"sys",
			WITH_KEY,
			recordingFetcher(() => sseResponse([]), recorded)
		);
		await client.stream(recorder().handlers);
		expect(recorded[0].url).toBe("https://api.anthropic.com/v1/messages");
		expect(recorded[0].payload.thinking).toEqual({
			type: "enabled",
			budget_tokens: 16384,
		});
		expect(recorded[0].payload.max_tokens).toBe(16384 + 8192);
	});

	it("assembles tool_use blocks from json deltas and reports tool_use stop", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new AnthropicModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"claude-sonnet-4",
			"sys",
			WITH_KEY,
			recordingFetcher(
				() =>
					sseResponse([
						{
							type: "content_block_start",
							index: 0,
							content_block: { type: "tool_use", id: "t1", name: "Read" },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "input_json_delta", partial_json: '{"path":' },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "input_json_delta", partial_json: '"a.md"}' },
						},
						{ type: "content_block_stop", index: 0 },
						{ type: "message_delta", delta: { stop_reason: "tool_use" } },
					]),
				recorded
			)
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.tools).toEqual([
			{ id: "t1", name: "Read", input: { path: "a.md" } },
		]);
		expect(rec.done).toEqual(["tool_use"]);
	});

	it("merges consecutive same-role seed turns", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new AnthropicModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"claude-sonnet-4",
			"sys",
			WITH_KEY,
			recordingFetcher(() => sseResponse([]), recorded)
		);
		client.seed([
			{ role: "user", text: "一" },
			{ role: "user", text: "二" },
			{ role: "assistant", text: "答" },
		]);
		await client.stream(recorder().handlers);
		const messages = recorded[0].payload.messages as Array<{
			role: string;
			content: unknown[];
		}>;
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("user");
		expect(messages[0].content).toHaveLength(2);
	});

	it("reports HTTP errors with status", async () => {
		const client = new AnthropicModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"claude-sonnet-4",
			"sys",
			WITH_KEY,
			recordingFetcher(
				() => new Response("nope", { status: 401 }),
				[]
			)
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.errors.map((e) => e.message)).toEqual(["Anthropic HTTP 401"]);
	});
});

describe("OpenAiModelClient", () => {
	it("refuses to call the network without an API key", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new OpenAiModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"gpt-5",
			"sys",
			NO_KEY,
			recordingFetcher(() => sseResponse([]), recorded)
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.errors.map((e) => e.message)).toEqual(["未配置 Provider 密钥"]);
		expect(recorded).toEqual([]);
	});

	it("targets the chat completions endpoint and streams text with usage", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new OpenAiModelClient(
			{ endpoint: "https://api.openai.com/v1", thinkingLevel: "off" },
			"gpt-5",
			"sys",
			WITH_KEY,
			recordingFetcher(
				() =>
					sseResponse([
						{ choices: [{ delta: { content: "你" } }] },
						{ choices: [{ delta: { content: "好" }, finish_reason: "stop" }] },
						{ usage: { prompt_tokens: 3, completion_tokens: 2 } },
					]),
				recorded
			)
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(recorded[0].url).toBe("https://api.openai.com/v1/chat/completions");
		expect(recorded[0].headers["Authorization"]).toBe("Bearer test-key");
		expect(rec.text).toEqual(["你", "好"]);
		expect(rec.usage).toEqual([
			{ inputTokens: 3, outputTokens: 2, contextWindow: 400000 },
		]);
		expect(rec.done).toEqual(["end"]);
		const messages = recorded[0].payload.messages as Array<{ role: string }>;
		expect(messages[0].role).toBe("system");
	});

	it("accumulates streamed tool calls and reports tool_use stop", async () => {
		const client = new OpenAiModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"gpt-5",
			"sys",
			WITH_KEY,
			recordingFetcher(
				() =>
					sseResponse([
						{
							choices: [
								{
									delta: {
										tool_calls: [
											{
												index: 0,
												id: "c1",
												function: { name: "Read", arguments: '{"pa' },
											},
										],
									},
								},
							],
						},
						{
							choices: [
								{
									delta: {
										tool_calls: [
											{ index: 0, function: { arguments: 'th":"a.md"}' } },
										],
									},
									finish_reason: "tool_calls",
								},
							],
						},
					]),
				[]
			)
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.tools).toEqual([
			{ id: "c1", name: "Read", input: { path: "a.md" } },
		]);
		expect(rec.done).toEqual(["tool_use"]);
	});

	it("sets reasoning_effort only for reasoning models when enabled", async () => {
		const recorded: RecordedRequest[] = [];
		const reasoning = new OpenAiModelClient(
			{ endpoint: "", thinkingLevel: "low" },
			"gpt-5",
			"sys",
			WITH_KEY,
			recordingFetcher(() => sseResponse([]), recorded)
		);
		await reasoning.stream(recorder().handlers);
		expect(recorded[0].payload.reasoning_effort).toBe("low");

		const plain = new OpenAiModelClient(
			{ endpoint: "", thinkingLevel: "high" },
			"gpt-4o",
			"sys",
			WITH_KEY,
			recordingFetcher(() => sseResponse([]), recorded)
		);
		await plain.stream(recorder().handlers);
		expect(recorded[1].payload.reasoning_effort).toBeUndefined();
	});

	it("reports HTTP errors with status", async () => {
		const client = new OpenAiModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"gpt-5",
			"sys",
			WITH_KEY,
			recordingFetcher(() => new Response("nope", { status: 429 }), [])
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.errors.map((e) => e.message)).toEqual(["OpenAI HTTP 429"]);
	});
});
describe("Provider response format compatibility", () => {
	it("accepts buffered OpenAI JSON and omits tools in API-only mode", async () => {
		const recorded: RecordedRequest[] = [];
		const client = new OpenAiModelClient(
			{ endpoint: "", thinkingLevel: "off", toolsEnabled: false },
			"gpt-5",
			"sys",
			WITH_KEY,
			recordingFetcher(() => new Response(JSON.stringify({
				choices: [{ message: { content: "JSON reply" } }],
				usage: { prompt_tokens: 2, completion_tokens: 3 },
			}), {
				status: 200,
				headers: { "content-type": "application/json" },
			}), recorded),
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.text).toEqual(["JSON reply"]);
		expect(rec.done).toEqual(["end"]);
		expect(recorded[0]?.payload.tools).toBeUndefined();
	});

	it("parses CRLF Anthropic SSE framing", async () => {
		const body = [
			{ type: "content_block_start", index: 0, content_block: { type: "text" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "CRLF" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" } },
		].map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
		const client = new AnthropicModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"claude-sonnet-4",
			"sys",
			WITH_KEY,
			recordingFetcher(() => new Response(body, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}), []),
		);
		const rec = recorder();
		await client.stream(rec.handlers);
		expect(rec.text).toEqual(["CRLF"]);
		expect(rec.done).toEqual(["end"]);
	});

	it("reports unsupported and empty responses instead of silent success", async () => {
		const unsupported = new OpenAiModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"gpt-5",
			"sys",
			WITH_KEY,
			recordingFetcher(() => new Response("<html>proxy error</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}), []),
		);
		const unsupportedRec = recorder();
		await unsupported.stream(unsupportedRec.handlers);
		expect(unsupportedRec.errors[0]?.message).toContain("响应格式不受支持");
		expect(unsupportedRec.done).toEqual([]);

		const empty = new AnthropicModelClient(
			{ endpoint: "", thinkingLevel: "off" },
			"claude-sonnet-4",
			"sys",
			WITH_KEY,
			recordingFetcher(() => sseResponse([]), []),
		);
		const emptyRec = recorder();
		await empty.stream(emptyRec.handlers);
		expect(emptyRec.errors[0]?.message).toContain("没有可解析事件");
		expect(emptyRec.done).toEqual([]);
	});
});
