import { describe, expect, it } from "vitest";
import {
	AnthropicApiProvider,
} from "../src/ai/provider/anthropic-api-provider";
import {
	OpenAiCompatibleProvider,
} from "../src/ai/provider/openai-compatible-provider";
import type { AskEvent } from "../src/ai/provider/types";
import {
	ProviderSecretStore,
	type SecretStoragePort,
} from "../src/ai/provider/provider-secret-store";

class MemorySecrets implements SecretStoragePort {
	readonly values = new Map<string, string>();
	reads = 0;

	setSecret(id: string, secret: string): void {
		this.values.set(id, secret);
	}

	getSecret(id: string): string | null {
		this.reads += 1;
		return this.values.get(id) ?? null;
	}

	listSecrets(): string[] {
		return [...this.values.keys()];
	}
}

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
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

function requestInputUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

describe("AnthropicApiProvider", () => {
	it("reads its secret only when a request starts and maps Anthropic SSE", async () => {
		const storage = new MemorySecrets();
		const secrets = new ProviderSecretStore(storage);
		secrets.set("talos-anthropic-api-key", "anthropic-private");
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const provider = new AnthropicApiProvider({
			id: "anthropic-main",
			endpoint: "https://api.anthropic.test",
			model: "claude-test",
			systemPrompt: "system",
			secretRef: "talos-anthropic-api-key",
			secrets,
			toolRunner: {
				async run() {
					return { content: "", isError: false };
				},
			},
			fetcher: async (url, init) => {
				requests.push({ url: requestInputUrl(url), init });
				return sseResponse([
					{
						type: "message_start",
						message: { usage: { input_tokens: 7 } },
					},
					{
						type: "content_block_start",
						index: 0,
						content_block: { type: "text" },
					},
					{
						type: "content_block_delta",
						index: 0,
						delta: { type: "text_delta", text: "你好" },
					},
					{ type: "content_block_stop", index: 0 },
					{
						type: "message_delta",
						delta: { stop_reason: "end_turn" },
						usage: { output_tokens: 3 },
					},
				]);
			},
		});

		expect(storage.reads).toBe(0);
		const events = await collect(
			provider.chat({
				runId: "run-anthropic",
				turnId: "turn-1",
				text: "开始",
			})
		);

		expect(storage.reads).toBe(1);
		expect(requests[0]?.url).toBe(
			"https://api.anthropic.test/v1/messages"
		);
		expect(
			(requests[0]?.init?.headers as Record<string, string>)["x-api-key"]
		).toBe("anthropic-private");
		expect(events).toContainEqual({ type: "text", text: "你好" });
		expect(events).toContainEqual({
			type: "usage",
			inputTokens: 7,
			outputTokens: 3,
		});
		expect(JSON.stringify(events)).not.toContain("anthropic-private");
	});

	it("runs Anthropic tool calls through the shared agent runtime", async () => {
		const storage = new MemorySecrets();
		const secrets = new ProviderSecretStore(storage);
		secrets.set("talos-anthropic-api-key", "secret");
		let calls = 0;
		let toolRuns = 0;
		const provider = new AnthropicApiProvider({
			id: "anthropic-tools",
			endpoint: "https://api.anthropic.test",
			model: "claude-test",
			systemPrompt: "system",
			secretRef: "talos-anthropic-api-key",
			secrets,
			toolRunner: {
				async run(call) {
					toolRuns += 1;
					expect(call).toMatchObject({
						id: "tool-1",
						name: "Read",
						input: { file_path: "30 洞察/a.md" },
					});
					return { content: "vault text", isError: false };
				},
			},
			fetcher: async () => {
				calls += 1;
				if (calls === 1) {
					return sseResponse([
						{
							type: "content_block_start",
							index: 0,
							content_block: {
								type: "tool_use",
								id: "tool-1",
								name: "Read",
							},
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: {
								type: "input_json_delta",
								partial_json: '{"file_path":"30 洞察/a.md"}',
							},
						},
						{ type: "content_block_stop", index: 0 },
						{
							type: "message_delta",
							delta: { stop_reason: "tool_use" },
						},
					]);
				}
				return sseResponse([
					{
						type: "content_block_start",
						index: 0,
						content_block: { type: "text" },
					},
					{
						type: "content_block_delta",
						index: 0,
						delta: { type: "text_delta", text: "已读取" },
					},
					{ type: "content_block_stop", index: 0 },
					{
						type: "message_delta",
						delta: { stop_reason: "end_turn" },
					},
				]);
			},
		});

		const events = await collect(
			provider.chat({
				runId: "run-tool",
				turnId: "turn-tool",
				text: "读取",
			})
		);

		expect(toolRuns).toBe(1);
		expect(calls).toBe(2);
		expect(events.map((event) => event.type)).toEqual([
			"tool-request",
			"tool-result",
			"text",
			"done",
		]);
	});
});

describe("OpenAiCompatibleProvider", () => {
	it("maps Chat Completions SSE and reads the key on demand", async () => {
		const storage = new MemorySecrets();
		const secrets = new ProviderSecretStore(storage);
		secrets.set("talos-openai-api-key", "openai-private");
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const provider = new OpenAiCompatibleProvider({
			id: "openai-compatible",
			endpoint: "https://gateway.test",
			model: "model-x",
			systemPrompt: "system",
			secretRef: "talos-openai-api-key",
			secrets,
			toolRunner: {
				async run() {
					return { content: "", isError: false };
				},
			},
			fetcher: async (url, init) => {
				requests.push({ url: requestInputUrl(url), init });
				return sseResponse([
					{
						choices: [
							{
								delta: { content: "完成" },
								finish_reason: "stop",
							},
						],
					},
					{
						choices: [],
						usage: { prompt_tokens: 11, completion_tokens: 4 },
					},
				]);
			},
		});

		expect(storage.reads).toBe(0);
		const events = await collect(
			provider.chat({
				runId: "run-openai",
				turnId: "turn-1",
				text: "开始",
			})
		);

		expect(storage.reads).toBe(1);
		expect(requests[0]?.url).toBe(
			"https://gateway.test/v1/chat/completions"
		);
		expect(
			(requests[0]?.init?.headers as Record<string, string>).Authorization
		).toBe("Bearer openai-private");
		expect(events).toContainEqual({ type: "text", text: "完成" });
		expect(events).toContainEqual({
			type: "usage",
			inputTokens: 11,
			outputTokens: 4,
		});
		expect(JSON.stringify(events)).not.toContain("openai-private");
	});

	it("uses a versioned Zhipu-compatible base without adding another v1", async () => {
		const storage = new MemorySecrets();
		const secrets = new ProviderSecretStore(storage);
		secrets.set("talos-zhipu-api-key", "zhipu-private");
		const requests: string[] = [];
		const provider = new OpenAiCompatibleProvider({
			id: "zhipu-compatible",
			endpoint: "https://open.bigmodel.cn/api/coding/paas/v4",
			model: "glm-5.2",
			systemPrompt: "system",
			secretRef: "talos-zhipu-api-key",
			secrets,
			toolRunner: {
				async run() {
					return { content: "", isError: false };
				},
			},
			fetcher: async (url) => {
				requests.push(requestInputUrl(url));
				return sseResponse([
					{
						choices: [
							{
								delta: { content: "完成" },
								finish_reason: "stop",
							},
						],
					},
				]);
			},
		});

		await collect(
			provider.chat({
				runId: "run-zhipu",
				turnId: "turn-zhipu",
				text: "开始",
			})
		);

		expect(requests).toEqual([
			"https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
		]);
	});

	it("returns a sanitized non-retryable error for a missing secret", async () => {
		const storage = new MemorySecrets();
		const provider = new OpenAiCompatibleProvider({
			id: "missing-secret",
			endpoint: "https://gateway.test",
			model: "model-x",
			systemPrompt: "system",
			secretRef: "talos-openai-api-key",
			secrets: new ProviderSecretStore(storage),
			toolRunner: {
				async run() {
					return { content: "", isError: false };
				},
			},
			fetcher: async () => {
				throw new Error("fetch should not run");
			},
		});

		const events = await collect(
			provider.chat({
				runId: "run-missing",
				turnId: "turn-1",
				text: "开始",
			})
		);

		expect(events).toContainEqual({
			type: "error",
			message: "未配置 Provider 密钥",
			retryable: false,
		});
	});
});
