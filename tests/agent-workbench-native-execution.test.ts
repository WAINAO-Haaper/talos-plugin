import { describe, expect, it, vi } from "vitest";
import { createAgentEvent, type AgentEvent } from "../src/agent-workbench/contracts/agent-events";
import type {
	AgentRuntimeAdapter,
	CreateSessionInput,
	RuntimeTurn,
} from "../src/agent-workbench/contracts/runtime-adapter";
import { unavailableCapabilities } from "../src/agent-workbench/contracts/runtime-capabilities";
import { AgentExecutionCoordinator } from "../src/agent-workbench/core/agent-execution-coordinator";
import { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";
import { ConversationService } from "../src/agent-workbench/core/conversation-service";
import { WorkbenchConversationCoordinator } from "../src/agent-workbench/core/workbench-conversation-coordinator";
import {
	ConversationInputLedger,
	type ConversationInputLedgerAdapter,
} from "../src/agent-workbench/storage/conversation-input-ledger";
import {
	PortableConversationStore,
	type PortableFileAdapter,
} from "../src/agent-workbench/storage/portable-conversation-store";
import { RuntimeBindingStore } from "../src/agent-workbench/storage/runtime-binding-store";

class MemoryFiles implements PortableFileAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	async exists(path: string) { return this.files.has(path) || this.folders.has(path); }
	async read(path: string) { const value = this.files.get(path); if (value === undefined) throw new Error("missing"); return value; }
	async write(path: string, value: string) { this.files.set(path, value); }
	async rename(from: string, to: string) { this.files.set(to, await this.read(from)); this.files.delete(from); }
	async replace(from: string, to: string) { await this.rename(from, to); }
	async remove(path: string) { this.files.delete(path); }
	async mkdir(path: string) { this.folders.add(path); }
	async list(path: string) {
		const prefix = `${path}/`;
		const files = [...this.files.keys()].filter((item) => item.startsWith(prefix) && !item.slice(prefix.length).includes("/")).map((item) => item.slice(prefix.length));
		return { files, folders: [] };
	}
}

function fixtures(
	send: AgentRuntimeAdapter["send"],
	preflightEgress?: ConstructorParameters<typeof AgentExecutionCoordinator>[0]["preflightEgress"],
	runtimeOverrides: Partial<AgentRuntimeAdapter> = {},
) {
	const files = new MemoryFiles();
	const conversations = new ConversationService(new PortableConversationStore(files));
	let bindings: Record<string, unknown> = {};
	const coordinator = new WorkbenchConversationCoordinator(conversations, new RuntimeBindingStore({
		read: async () => bindings,
		write: async (value) => { bindings = structuredClone(value); },
	}));
	let ledgerState: Awaited<ReturnType<ConversationInputLedgerAdapter["read"]>> = null;
	const ledger = new ConversationInputLedger({
		read: async () => structuredClone(ledgerState),
		write: async (value) => { ledgerState = structuredClone(value); },
	});
	const runtime: AgentRuntimeAdapter = {
		id: "codex",
		probe: async () => ({ runtimeId: "codex", status: "ready" }),
		listModels: async () => [],
		createSession: async (_input: CreateSessionInput) => ({ runtimeId: "codex", sessionId: "native-1" }),
		resumeSession: async () => undefined,
		send,
		cancel: async () => undefined,
		dispose: async () => undefined,
		capabilities: unavailableCapabilities,
		...runtimeOverrides,
	};
	const createRuntime = vi.fn(async () => runtime);
	const execution = new AgentExecutionCoordinator({
		conversations: coordinator,
		ledger,
		vaultRoot: "/synthetic/vault",
		createRuntime,
		preflightEgress,
	});
	return { conversations, execution, ledger, createRuntime };
}

async function takeEvent(iterator: AsyncGenerator<AgentEvent>): Promise<AgentEvent> {
	const result = await iterator.next();
	if (result.done) throw new Error("expected another agent event");
	return result.value;
}

describe("TALOS native execution coordinator", () => {
	it("stages structured input, accepts on first provider event and preserves every request field", async () => {
		let ledger!: ConversationInputLedger;
		const observed: RuntimeTurn[] = [];
		const fixture = fixtures(async function* (turn) {
			observed.push(turn);
			expect((await ledger.list(turn.conversationId))[0]?.stage).toBe("staged");
			yield createAgentEvent({
				eventId: "native-delta",
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				runtimeId: "codex",
				type: "assistant.delta",
				timestamp: "2026-08-28T00:00:00.000Z",
				payload: { text: "done" },
			});
		});
		ledger = fixture.ledger;
		const conversation = await fixture.conversations.create();
		const events = [];
		for await (const event of fixture.execution.execute(conversation, {
			conversationId: conversation.conversationId,
			input: [
				{ type: "text", text: "inspect" },
				{ type: "image", id: "img-1", name: "chart.png", mimeType: "image/png", dataUrl: "data:image/png;base64,YQ==" },
			],
			context: { linkedContent: { path: "notes/current.md", content: "context" }, externalContextPaths: ["/private/local/context.md"], enabledMcpServers: ["vault-tools"] },
			model: "gpt-test",
			reasoning: "high",
			serviceTier: "priority",
			workflow: "plan",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
		})) events.push(event.type);
		expect(events).toEqual(["user.message", "assistant.start", "assistant.delta", "turn.finished"]);
		expect(observed[0]).toMatchObject({
			model: "gpt-test",
			reasoning: "high",
			serviceTier: "priority",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
			context: { linkedContent: { path: "notes/current.md", content: "context" } },
		});
		const records = await ledger.list(conversation.conversationId);
		expect(records).toMatchObject([{ stage: "accepted", images: [{ name: "chart.png", byteLength: 3 }], contextPaths: ["notes/current.md", "[external-context]"] }]);
		expect(JSON.stringify(records)).not.toContain("YQ==");
		expect(JSON.stringify(records)).not.toContain("/private/local");
		const stored = await fixture.conversations.store.load(conversation.conversationId);
		const storedTypes = stored.events.map((event) => event.type);
		expect(storedTypes).not.toContain("assistant.delta");
		expect(storedTypes).toEqual(expect.arrayContaining(["user.message", "assistant.start", "turn.finished"]));
		const storedUser = stored.events.find((event) => event.type === "user.message");
		expect(typeof storedUser?.payload.recordId).toBe("string");
		expect(storedUser?.payload).toMatchObject({ contextPaths: ["notes/current.md", "[external-context]"], images: [{ name: "chart.png" }] });
	});

	it("discards a pre-acceptance input and never replays it after a transport failure", async () => {
		const send = vi.fn((): AsyncIterable<AgentEvent> => ({
			[Symbol.asyncIterator]: () => ({
				next: () => Promise.reject(new Error("transport failed before acceptance")),
			}),
		}));
		const fixture = fixtures(send);
		const conversation = await fixture.conversations.create();
		const events = [];
		for await (const event of fixture.execution.execute(conversation, {
			conversationId: conversation.conversationId,
			input: [{ type: "text", text: "once" }],
			workflow: "plan",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
		})) events.push(event);
		expect(events).toMatchObject([{ type: "error", payload: { accepted: false } }]);
		expect(await fixture.ledger.list(conversation.conversationId)).toEqual([]);
		expect((await fixture.conversations.store.load(conversation.conversationId)).events.some((event) => event.type === "user.message")).toBe(false);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("fails closed before staging or runtime startup when provider egress is denied", async () => {
		const send = vi.fn(async function* () { yield createAgentEvent({ eventId: "unexpected", conversationId: "c", turnId: "t", runtimeId: "codex", type: "turn.finished", timestamp: new Date().toISOString(), payload: {} }); });
		const audit = vi.fn(async () => ({ allowed: false, message: "blocked by audit" }));
		const fixture = fixtures(send, audit);
		const conversation = await fixture.conversations.create();
		await expect(async () => {
			for await (const event of fixture.execution.execute(conversation, {
				conversationId: conversation.conversationId,
				input: [{ type: "text", text: "private prompt" }],
				workflow: "plan",
				permissionMode: "ask",
				toolPolicy: { kind: "read-only" },
			})) throw new Error(`unexpected event: ${event.type}`);
		}).rejects.toThrow("blocked by audit");
		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: "codex", prompt: "private prompt", hasImages: false }));
		expect(send).not.toHaveBeenCalled();
		expect(await fixture.ledger.list(conversation.conversationId)).toEqual([]);
	});

	it("finishes an accepted user cancellation without invalidating it as a runtime error", async () => {
		const fixture = fixtures(async function* (turn) {
			yield createAgentEvent({
				eventId: "accepted-delta",
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				runtimeId: "codex",
				type: "assistant.delta",
				timestamp: "2026-08-28T00:00:00.000Z",
				payload: { text: "partial" },
			});
			await new Promise<void>((_resolve, reject) => {
				turn.signal?.addEventListener("abort", () => reject(new Error("aborted by user")), { once: true });
			});
		});
		const conversation = await fixture.conversations.create();
		const iterator = fixture.execution.execute(conversation, {
			conversationId: conversation.conversationId,
			input: [{ type: "text", text: "cancel me" }],
			workflow: "plan",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
		});
		expect((await takeEvent(iterator)).type).toBe("user.message");
		expect((await takeEvent(iterator)).type).toBe("assistant.start");
		expect((await takeEvent(iterator)).type).toBe("assistant.delta");
		const terminal = iterator.next();
		await Promise.resolve();
		await fixture.execution.cancel(conversation.conversationId);
		const terminalResult = await terminal;
		expect(terminalResult.done).toBe(false);
		expect(terminalResult.value as AgentEvent).toMatchObject({ type: "turn.finished", payload: { status: "cancelled" } });
		expect((await iterator.next()).done).toBe(true);
		const stored = await fixture.conversations.store.load(conversation.conversationId);
		expect(stored.events.some((event) => event.type === "error")).toBe(false);
	});

	it("reserves a conversation before asynchronous preflight completes", async () => {
		let releaseAudit!: (value: { allowed: boolean }) => void;
		const auditGate = new Promise<{ allowed: boolean }>((resolve) => { releaseAudit = resolve; });
		const audit = vi.fn(() => auditGate);
		const fixture = fixtures(async function* (turn) {
			yield createAgentEvent({ eventId: "done", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "turn.finished", timestamp: new Date().toISOString(), payload: {} });
		}, audit);
		const conversation = await fixture.conversations.create();
		const request = {
			conversationId: conversation.conversationId,
			input: [{ type: "text" as const, text: "only once" }],
			workflow: "plan" as const,
			permissionMode: "ask" as const,
			toolPolicy: { kind: "read-only" as const },
		};
		const first = fixture.execution.execute(conversation, request);
		const firstEvent = first.next();
		await vi.waitFor(() => expect(audit).toHaveBeenCalledTimes(1));
		const duplicate = fixture.execution.execute(conversation, request);
		await expect(duplicate.next()).rejects.toThrow("已有回合");
		releaseAudit({ allowed: true });
		expect((await firstEvent).done).toBe(false);
		for await (const event of first) void event;
	});

	it("runs distinct conversations concurrently while preserving each conversation id", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const send = vi.fn(async function* (turn: RuntimeTurn) {
			await gate;
			yield createAgentEvent({
				eventId: `accepted-${turn.conversationId}`,
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				runtimeId: "codex",
				type: "runtime.status",
				timestamp: new Date().toISOString(),
				payload: { message: "accepted" },
			});
			yield createAgentEvent({
				eventId: `finished-${turn.conversationId}`,
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				runtimeId: "codex",
				type: "turn.finished",
				timestamp: new Date().toISOString(),
				payload: {},
			});
		});
		const fixture = fixtures(send);
		const firstConversation = await fixture.conversations.create("first");
		const secondConversation = await fixture.conversations.create("second");
		const request = (conversationId: string) => ({
			conversationId, input: [{ type: "text" as const, text: conversationId }],
			workflow: "plan" as const, permissionMode: "ask" as const, toolPolicy: { kind: "read-only" as const },
		});
		const first = fixture.execution.execute(firstConversation, request(firstConversation.conversationId));
		const second = fixture.execution.execute(secondConversation, request(secondConversation.conversationId));
		const firstEvent = first.next(); const secondEvent = second.next();
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		release();
		expect((await firstEvent).value).toMatchObject({ type: "user.message", conversationId: firstConversation.conversationId });
		expect((await secondEvent).value).toMatchObject({ type: "user.message", conversationId: secondConversation.conversationId });
		await Promise.all([(async () => { for await (const event of first) void event; })(), (async () => { for await (const event of second) void event; })()]);
	});

	it("drops cross-turn events and stops after the first terminal event", async () => {
		const fixture = fixtures(async function* (turn) {
			yield createAgentEvent({ eventId: "wrong-turn", conversationId: turn.conversationId, turnId: "stale-turn", runtimeId: "codex", type: "assistant.delta", timestamp: new Date().toISOString(), payload: { text: "stale" } });
			yield createAgentEvent({ eventId: "valid-delta", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "assistant.delta", timestamp: new Date().toISOString(), payload: { text: "valid" } });
			yield createAgentEvent({ eventId: "valid-finish", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "turn.finished", timestamp: new Date().toISOString(), payload: {} });
			yield createAgentEvent({ eventId: "late-delta", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "assistant.delta", timestamp: new Date().toISOString(), payload: { text: "late" } });
		});
		const conversation = await fixture.conversations.create();
		const events: AgentEvent[] = [];
		for await (const event of fixture.execution.execute(conversation, {
			conversationId: conversation.conversationId,
			input: [{ type: "text", text: "fenced" }],
			workflow: "plan",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
		})) events.push(event);
		expect(events.map((event) => event.eventId)).not.toContain("wrong-turn");
		expect(events.map((event) => event.eventId)).not.toContain("late-delta");
		expect(events.map((event) => event.type)).toEqual(["user.message", "assistant.start", "assistant.delta", "turn.finished"]);
	});

	it("responds to a cancelled native question instead of parking the provider", async () => {
		const respondUserInput = vi.fn(async () => undefined);
		const fixture = fixtures(async function* (turn) {
			yield createAgentEvent({ eventId: "question", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "user.question", timestamp: new Date().toISOString(), nativeId: "question-1", payload: { questions: [] } });
			yield createAgentEvent({ eventId: "done", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "turn.finished", timestamp: new Date().toISOString(), payload: {} });
		}, undefined, { respondUserInput });
		const conversation = await fixture.conversations.create();
		for await (const event of fixture.execution.execute(conversation, {
			conversationId: conversation.conversationId,
			input: [{ type: "text", text: "ask" }],
			workflow: "plan",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
		}, { answer: async () => null })) void event;
		expect(respondUserInput).toHaveBeenCalledWith({ requestId: "question-1", answers: null });
	});

	it("freezes a runtime switch to its target conversation while another tab changes selection", async () => {
		const files = new MemoryFiles();
		const conversations = new ConversationService(new PortableConversationStore(files));
		let bindings: Record<string, unknown> = {};
		const coordinator = new WorkbenchConversationCoordinator(conversations, new RuntimeBindingStore({
			read: async () => bindings,
			write: async (value) => { bindings = structuredClone(value); },
		}));
		const conversation = await conversations.create();
		let releaseSwitch!: () => void;
		const switchGate = new Promise<void>((resolve) => { releaseSwitch = resolve; });
		vi.spyOn(coordinator, "switchRuntime").mockImplementation(async () => { await switchGate; return false; });
		const service = new AgentWorkbenchService({ conversationCoordinator: coordinator });
		const switching = service.switchConversationRuntime(conversation.conversationId, "claude", "claude-test");
		expect(service.getSelectedRuntimeId()).toBe("claude");
		service.selectRuntime("ohmypi", "pi-test");
		releaseSwitch();
		await switching;
		expect((await conversations.store.load(conversation.conversationId)).manifest.selection).toEqual({
			runtimeId: "claude",
			model: "claude-test",
		});
		expect(service.getSelection()).toEqual({ runtimeId: "ohmypi", model: "pi-test" });
	});

	it("keeps a provider failure terminal instead of synthesizing a completed turn", async () => {
		const dispose = vi.fn(async () => undefined);
		const fixture = fixtures(async function* (turn) {
			yield createAgentEvent({ eventId: "failed", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "error", timestamp: new Date().toISOString(), payload: { message: "provider failed" } });
		}, undefined, { dispose });
		const conversation = await fixture.conversations.create();
		const events: AgentEvent[] = [];
		for await (const event of fixture.execution.execute(conversation, {
			conversationId: conversation.conversationId,
			input: [{ type: "text", text: "fail" }],
			workflow: "plan",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
		})) events.push(event);
		expect(events.map((event) => event.type)).toEqual(["user.message", "assistant.start", "error"]);
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("releases the native process after every terminal turn and resumes the durable binding on demand", async () => {
		const dispose = vi.fn(async () => undefined);
		const createSession = vi.fn(async () => ({ runtimeId: "codex" as const, sessionId: "native-1" }));
		const resumeSession = vi.fn(async () => undefined);
		const fixture = fixtures(async function* (turn) {
			yield createAgentEvent({
				eventId: `finished-${turn.turnId}`,
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				runtimeId: "codex",
				type: "turn.finished",
				timestamp: new Date().toISOString(),
				payload: {},
			});
		}, undefined, { createSession, resumeSession, dispose });
		const conversation = await fixture.conversations.create();
		const request = {
			conversationId: conversation.conversationId,
			input: [{ type: "text" as const, text: "one turn at a time" }],
			workflow: "plan" as const,
			permissionMode: "ask" as const,
			toolPolicy: { kind: "read-only" as const },
		};

		for await (const event of fixture.execution.execute(conversation, request)) void event;
		for await (const event of fixture.execution.execute(conversation, request)) void event;

		expect(fixture.createRuntime).toHaveBeenCalledTimes(2);
		expect(createSession).toHaveBeenCalledTimes(1);
		expect(resumeSession).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(2);
	});

	it("keeps the conversation reserved until native process disposal completes", async () => {
		let finishDispose!: () => void;
		const disposeGate = new Promise<void>((resolve) => { finishDispose = resolve; });
		const dispose = vi.fn(() => disposeGate);
		const fixture = fixtures(async function* (turn) {
			yield createAgentEvent({
				eventId: "finished-before-dispose",
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				runtimeId: "codex",
				type: "turn.finished",
				timestamp: new Date().toISOString(),
				payload: {},
			});
		}, undefined, { dispose });
		const conversation = await fixture.conversations.create();
		const request = {
			conversationId: conversation.conversationId,
			input: [{ type: "text" as const, text: "hold until closed" }],
			workflow: "plan" as const,
			permissionMode: "ask" as const,
			toolPolicy: { kind: "read-only" as const },
		};
		const running = (async () => {
			for await (const event of fixture.execution.execute(conversation, request)) void event;
		})();
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));

		const duplicate = fixture.execution.execute(conversation, request);
		await expect(duplicate.next()).rejects.toThrow("已有回合");
		finishDispose();
		await running;
	});

	it("deduplicates repeated native terminal frames even when their local event ids differ", async () => {
		const fixture = fixtures(async function* (turn) {
			for (const eventId of ["local-final-1", "local-final-2"]) {
				yield createAgentEvent({
					eventId,
					conversationId: turn.conversationId,
					turnId: turn.turnId,
					runtimeId: "codex",
					type: "assistant.final",
					timestamp: new Date().toISOString(),
					nativeId: "native-final-1",
					payload: { text: "done" },
				});
			}
			yield createAgentEvent({
				eventId: "finished",
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				runtimeId: "codex",
				type: "turn.finished",
				timestamp: new Date().toISOString(),
				payload: {},
			});
		});
		const conversation = await fixture.conversations.create();
		const emitted: AgentEvent[] = [];
		for await (const event of fixture.execution.execute(conversation, {
			conversationId: conversation.conversationId,
			input: [{ type: "text", text: "dedupe" }],
			workflow: "plan",
			permissionMode: "ask",
			toolPolicy: { kind: "read-only" },
		})) emitted.push(event);

		expect(emitted.filter((event) => event.type === "assistant.final")).toHaveLength(1);
		expect((await fixture.conversations.store.load(conversation.conversationId)).events.filter((event) => event.type === "assistant.final")).toHaveLength(1);
	});
});
