import { describe, expect, it } from "vitest";
import { ProviderFacade } from "../src/ai/provider/provider-facade";
import { MockProvider } from "../src/ai/provider/mock-provider";
import type { AskEvent, ProviderCapability } from "../src/ai/provider/types";

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

function provider(id: string, events: AskEvent[], capabilities: ProviderCapability[] = ["chat", "stream", "tools", "usage", "cancel", "resume", "fork"]): MockProvider {
	return new MockProvider({ id, kind: "mock", seed: 0, capabilities, fixtures: [events] });
}

describe("ProviderFacade core", () => {
	it("registers providers and reports missing capabilities", () => {
		const facade = new ProviderFacade();
		facade.register(provider("text", [{ type: "done" }], ["chat", "stream", "cancel"]));
		expect(facade.listProviders()).toEqual([{ id: "text", kind: "mock" }]);
		expect(facade.getAvailability("text", ["chat", "tools", "resume"])).toEqual({ enabled: false, missing: ["tools", "resume"] });
	});

	it("records provider switch points and independent forks", () => {
		const facade = new ProviderFacade(() => 100);
		facade.register(provider("first", [{ type: "done" }]));
		facade.register(provider("second", [{ type: "done" }]));
		facade.createSession({ sessionId: "source", providerId: "first" });
		facade.switchProvider("source", "second", "turn-2");
		const fork = facade.forkSession({ sourceSessionId: "source", sessionId: "fork", atTurnId: "turn-2", providerId: "first" });
		expect(facade.getSession("source").switchPoints).toEqual([{ fromProviderId: "first", toProviderId: "second", atTurnId: "turn-2", changedAt: 100 }]);
		expect(fork.forkedFrom).toEqual({ sessionId: "source", atTurnId: "turn-2" });
	});

	it("never repeats a completed tool after switching providers", async () => {
		const events: AskEvent[] = [
			{ type: "tool-request", toolCallId: "tool-1", name: "Write", input: {} },
			{ type: "tool-result", toolCallId: "tool-1", output: "ok", isError: false },
			{ type: "done" },
		];
		const facade = new ProviderFacade();
		facade.register(provider("first", events));
		facade.register(provider("second", events));
		facade.createSession({ sessionId: "session", providerId: "first" });
		await collect(facade.chat("session", { runId: "one", turnId: "one", text: "go" }));
		facade.switchProvider("session", "second", "two");
		const next = await collect(facade.chat("session", { runId: "two", turnId: "two", text: "continue" }));
		expect(next).toContainEqual({ type: "tool-skipped", toolCallId: "tool-1", reason: "already-executed" });
		expect(next.some((event) => event.type === "tool-request")).toBe(false);
	});

	it("keeps review turns tool-free", async () => {
		const facade = new ProviderFacade();
		facade.register(provider("reviewer", [
			{ type: "tool-request", toolCallId: "review-tool", name: "Write", input: {} },
			{ type: "tool-result", toolCallId: "review-tool", output: "ignored", isError: false },
			{ type: "done" },
		]));
		facade.createSession({ sessionId: "session", providerId: "reviewer" });
		const events = await collect(facade.reviewTurn("session", "reviewer", { runId: "review", turnId: "turn", reviewOfTurnId: "source", text: "review" }));
		expect(events).toContainEqual({ type: "tool-skipped", toolCallId: "review-tool", reason: "review-mode" });
		expect(events.some((event) => event.type === "tool-result")).toBe(false);
	});
});
