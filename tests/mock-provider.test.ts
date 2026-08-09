import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/ai/provider/mock-provider";
import type { AskEvent } from "../src/ai/provider/types";

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

const fixtureA: AskEvent[] = [
	{ type: "text", text: "第一组" },
	{ type: "usage", inputTokens: 10, outputTokens: 3 },
	{ type: "done", sessionId: "mock-session-a" },
];
const fixtureB: AskEvent[] = [
	{ type: "text", text: "第二组" },
	{
		type: "tool-request",
		toolCallId: "tool-fixed",
		name: "Read",
		input: { file_path: "30 洞察/a.md" },
	},
	{ type: "error", message: "fixture error", retryable: false },
	{ type: "done", sessionId: "mock-session-b" },
];

function provider(seed: number): MockProvider {
	return new MockProvider({
		id: "mock",
		kind: "mock",
		seed,
		capabilities: [
			"chat",
			"stream",
			"tools",
			"usage",
			"cancel",
			"resume",
			"fork",
		],
		fixtures: [fixtureA, fixtureB],
		toolResults: {
			"tool-fixed": {
				output: { content: "预定义工具结果" },
				isError: false,
			},
		},
	});
}

describe("MockProvider", () => {
	it("returns text, tool, usage, error, and done fixtures in deterministic order", async () => {
		const first = provider(1);
		const second = provider(1);
		const request = {
			runId: "run",
			turnId: "turn",
			sessionId: "session",
			text: "deterministic",
			toolsAllowed: true,
			executedToolIds: new Set<string>(),
		} as const;

		const firstEvents = await collect(first.chat(request));
		const secondEvents = await collect(second.chat(request));

		expect(firstEvents).toEqual(secondEvents);
		expect(firstEvents.map((event) => event.type)).toEqual([
			"text",
			"tool-request",
			"tool-result",
			"error",
			"done",
		]);
		expect(firstEvents[2]).toEqual({
			type: "tool-result",
			toolCallId: "tool-fixed",
			output: { content: "预定义工具结果" },
			isError: false,
		});
	});

	it("uses the fixed seed to select a reproducible fixture sequence", async () => {
		const events = await collect(
			provider(0).chat({
				runId: "run",
				turnId: "turn",
				text: "first fixture",
				toolsAllowed: true,
				executedToolIds: new Set(),
			})
		);

		expect(events).toEqual(fixtureA);
	});

	it("records cancel and resume calls without network access", async () => {
		const mock = provider(0);

		await mock.cancel("run-9");
		await mock.resume("session-9");

		expect(mock.diagnostics()).toEqual({
			cancelledRunIds: ["run-9"],
			resumedSessionIds: ["session-9"],
			requestCount: 0,
		});
	});
});
