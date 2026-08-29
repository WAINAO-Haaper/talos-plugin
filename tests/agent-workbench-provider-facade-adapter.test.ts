import { describe, expect, it, vi } from "vitest";
import { createAgentEvent } from "../src/agent-workbench/contracts/agent-events";
import type { AgentRuntimeAdapter, RuntimeTurn } from "../src/agent-workbench/contracts/runtime-adapter";
import { unavailableCapabilities } from "../src/agent-workbench/contracts/runtime-capabilities";
import type { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";
import { AgentWorkbenchProviderAdapter, createAgentWorkbenchProviderAdapters } from "../src/ai/provider/agent-workbench-provider-adapter";
import type { AskEvent } from "../src/ai/provider/types";

async function collect(iterable: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of iterable) events.push(event);
	return events;
}

function fixture(send: AgentRuntimeAdapter["send"]) {
	const cancel = vi.fn(async () => undefined);
	const dispose = vi.fn(async () => undefined);
	const createSession = vi.fn(async () => ({ runtimeId: "codex" as const, sessionId: "native-session" }));
	const resumeSession = vi.fn(async () => undefined);
	const runtime: AgentRuntimeAdapter = {
		id: "codex",
		probe: async () => ({ runtimeId: "codex", status: "ready" }),
		listModels: async () => [],
		createSession,
		resumeSession,
		send,
		cancel,
		dispose,
		capabilities: unavailableCapabilities,
	};
	const service = {
		createRuntime: vi.fn(async () => runtime),
		getSelection: () => ({ runtimeId: "codex" }),
		getWorkflowMode: () => "plan",
	} as unknown as AgentWorkbenchService;
	return { runtime, service, cancel, dispose, createSession, resumeSession };
}

describe("AgentWorkbenchProviderAdapter", () => {
	it("maps TALOS native events into the canonical ProviderFacade stream", async () => {
		const observed: RuntimeTurn[] = [];
		const test = fixture(async function* (turn) {
			observed.push(turn);
			for (const [eventId, type, payload] of [
				["d", "assistant.delta", { text: "hello" }],
				["s", "tool.started", { id: "tool-1", name: "Read", input: { path: "note.md" } }],
				["f", "tool.finished", { id: "tool-1", output: "ok" }],
				["u", "usage.updated", { inputTokens: 3, outputTokens: 4 }],
				["z", "turn.finished", { status: "completed" }],
			] as const) yield createAgentEvent({ eventId, conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type, timestamp: new Date().toISOString(), payload });
		});
		const adapter = new AgentWorkbenchProviderAdapter({ runtimeId: "codex", service: test.service, vaultRoot: "/vault" });
		const events = await collect(adapter.chat({ runId: "run", turnId: "turn", sessionId: "logical", text: "inspect", historyRef: [{ role: "user", content: "before" }], toolsAllowed: false }));
		expect(events).toEqual([
			{ type: "text", text: "hello" },
			{ type: "tool-request", toolCallId: "tool-1", name: "Read", input: { path: "note.md" } },
			{ type: "tool-result", toolCallId: "tool-1", output: "ok", isError: false },
			{ type: "usage", inputTokens: 3, outputTokens: 4 },
			{ type: "done", sessionId: "logical" },
		]);
		expect(observed[0]).toMatchObject({ history: [{ role: "user", text: "before" }], toolPolicy: { kind: "read-only" } });
		expect(test.dispose).toHaveBeenCalledOnce();
	});

	it("resumes the native binding for later turns in the same logical session", async () => {
		const test = fixture(async function* (turn) {
			yield createAgentEvent({ eventId: `done-${turn.turnId}`, conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "turn.finished", timestamp: new Date().toISOString(), payload: {} });
		});
		const adapter = new AgentWorkbenchProviderAdapter({ runtimeId: "codex", service: test.service, vaultRoot: "/vault" });
		await collect(adapter.chat({ runId: "run-1", turnId: "turn-1", sessionId: "logical", text: "first" }));
		await collect(adapter.chat({ runId: "run-2", turnId: "turn-2", sessionId: "logical", text: "second" }));
		expect(test.createSession).toHaveBeenCalledTimes(1);
		expect(test.resumeSession).toHaveBeenCalledWith({ runtimeId: "codex", sessionId: "native-session" });
	});

	it("cancels the exact active native runtime", async () => {
		let release!: () => void;
		const wait = new Promise<void>((resolve) => { release = resolve; });
		const test = fixture(async function* (turn) {
			yield createAgentEvent({ eventId: "d", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "assistant.delta", timestamp: new Date().toISOString(), payload: { text: "started" } });
			await wait;
		});
		const adapter = new AgentWorkbenchProviderAdapter({ runtimeId: "codex", service: test.service, vaultRoot: "/vault" });
		const iterator = adapter.chat({ runId: "run", turnId: "turn", text: "go" })[Symbol.asyncIterator]();
		await iterator.next();
		await adapter.cancel("run");
		expect(test.cancel).toHaveBeenCalledWith("provider-facade");
		release();
		await iterator.next();
	});

	it("publishes all three native runtime adapters", () => {
		const test = fixture(async function* () {});
		expect(createAgentWorkbenchProviderAdapters(test.service, "/vault").map((adapter) => adapter.id)).toEqual(["claude", "codex", "ohmypi"]);
	});
});
