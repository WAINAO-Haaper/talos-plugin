import { describe, expect, it } from "vitest";
import {
	ApiAgentRuntime,
	type ApiToolRunner,
} from "../src/ai/provider/api-agent-runtime";
import type {
	ModelClient,
	StreamHandlers,
} from "../src/jarvis/agent/loop";
import type { AskEvent } from "../src/ai/provider/types";
import type { ToolResult } from "../src/jarvis/agent/vault-tools";

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

class ToolThenTextModel implements ModelClient {
	private hasToolResult = false;
	aborted = false;

	pushUser(): void {}

	pushToolResults(_results: ToolResult[]): void {
		this.hasToolResult = true;
	}

	async stream(handlers: StreamHandlers): Promise<void> {
		if (!this.hasToolResult) {
			handlers.onToolCall({
				id: "tool-1",
				name: "Read",
				input: { file_path: "30 洞察/a.md" },
			});
			handlers.onDone("tool_use");
			return;
		}
		handlers.onTextDelta("完成");
		handlers.onUsage({
			inputTokens: 10,
			outputTokens: 2,
			contextWindow: 1000,
		});
		handlers.onDone("end");
	}

	abort(): void {
		this.aborted = true;
	}
}

describe("ApiAgentRuntime", () => {
	it("reuses AgentLoop for streaming text, tools, usage, and done", async () => {
		const model = new ToolThenTextModel();
		let toolRuns = 0;
		const tools: ApiToolRunner = {
			async run() {
				toolRuns += 1;
				return { content: "file content", isError: false };
			},
		};
		const runtime = new ApiAgentRuntime({
			id: "anthropic-api",
			modelFactory: () => model,
			toolRunner: tools,
		});

		const events = await collect(
			runtime.chat({
				runId: "run-1",
				turnId: "turn-1",
				text: "读取并总结",
			})
		);

		expect(events.map((event) => event.type)).toEqual([
			"tool-request",
			"tool-result",
			"text",
			"usage",
			"done",
		]);
		expect(toolRuns).toBe(1);
	});

	it("does not execute a completed tool twice across retries", async () => {
		let toolRuns = 0;
		const tools: ApiToolRunner = {
			async run() {
				toolRuns += 1;
				return { content: "cached", isError: false };
			},
		};
		const runtime = new ApiAgentRuntime({
			id: "openai-api",
			modelFactory: () => new ToolThenTextModel(),
			toolRunner: tools,
		});

		await collect(
			runtime.chat({
				runId: "run-1",
				turnId: "turn-1",
				text: "first",
			})
		);
		await collect(
			runtime.chat({
				runId: "run-2",
				turnId: "turn-2",
				text: "retry",
				executedToolIds: new Set(["tool-1"]),
			})
		);

		expect(toolRuns).toBe(1);
	});

	it("does not reuse a tool result across distinct sessions", async () => {
		let toolRuns = 0;
		const runtime = new ApiAgentRuntime({
			id: "session-scoped-cache",
			modelFactory: () => new ToolThenTextModel(),
			toolRunner: {
				async run() {
					toolRuns += 1;
					return { content: `result-${toolRuns}`, isError: false };
				},
			},
		});

		await collect(
			runtime.chat({
				runId: "run-a",
				turnId: "turn-a",
				sessionId: "session-a",
				text: "first session",
			})
		);
		await collect(
			runtime.chat({
				runId: "run-b",
				turnId: "turn-b",
				sessionId: "session-b",
				text: "second session",
			})
		);

		expect(toolRuns).toBe(2);
	});

	it("settles with error and done when the model stream promise rejects", async () => {
		const runtime = new ApiAgentRuntime({
			id: "rejecting-stream",
			modelFactory: () => ({
				pushUser() {},
				pushToolResults() {},
				async stream() {
					throw new Error("stream rejected");
				},
				abort() {},
			}),
			toolRunner: {
				async run() {
					return { content: "", isError: false };
				},
			},
		});

		const events = await collect(
			runtime.chat({
				runId: "run-reject",
				turnId: "turn-reject",
				text: "trigger rejection",
			})
		);

		expect(events).toEqual([
			{ type: "error", message: "stream rejected", retryable: false },
			{ type: "done" },
		]);
	});

	it("cancels the active model run", async () => {
		const model = new ToolThenTextModel();
		const runtime = new ApiAgentRuntime({
			id: "anthropic-api",
			modelFactory: () => model,
			toolRunner: {
				async run() {
					return { content: "", isError: false };
				},
			},
		});
		const iterator = runtime.chat({
			runId: "run-cancel",
			turnId: "turn",
			text: "cancel",
		})[Symbol.asyncIterator]();

		await iterator.next();
		await runtime.cancel("run-cancel");

		expect(model.aborted).toBe(true);
	});

	it.each([
		[401, false],
		[429, true],
		[500, true],
	])("surfaces HTTP %s without exposing authorization values", async (status, retryable) => {
		const secret = "fake-secret-never-log";
		const runtime = new ApiAgentRuntime({
			id: "http-error",
			modelFactory: () => ({
				pushUser() {},
				pushToolResults() {},
				async stream(handlers) {
					handlers.onError(new Error(`HTTP ${status}`));
				},
				abort() {},
			}),
			toolRunner: {
				async run() {
					return { content: "", isError: false };
				},
			},
			classifyError: () => ({ retryable }),
		});

		const events = await collect(
			runtime.chat({
				runId: `run-${status}`,
				turnId: "turn",
				text: secret,
			})
		);
		const serialized = JSON.stringify(events);

		expect(events).toContainEqual({
			type: "error",
			message: `HTTP ${status}`,
			retryable,
		});
		expect(serialized).not.toContain(secret);
	});
});
