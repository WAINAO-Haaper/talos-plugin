import { describe, expect, it } from "vitest";
import type { AgentRuntimeAdapter, CreateSessionInput, RuntimeProbe, RuntimeTurn } from "../src/agent-workbench/contracts/runtime-adapter";
import { ClaudeAgentSdkAdapter, type ClaudeAgentSdkPort, type ClaudeTurnInput } from "../src/agent-workbench/adapters/claude/claude-agent-sdk-adapter";
import { ClaudeSdkQueryPort, type ClaudeSdkFacade } from "../src/agent-workbench/transports/claude-sdk-port";
import { CodexAppServerAdapter, type CodexAppServerPort } from "../src/agent-workbench/adapters/codex/codex-app-server-adapter";
import { buildOhMyPiLaunch, OhMyPiRpcAdapter, type OhMyPiRpcPort } from "../src/agent-workbench/adapters/ohmypi/ohmypi-rpc-adapter";
import type { ProtocolFrame } from "../src/agent-workbench/adapters/shared/protocol-frame";
import { CodexProcessPort } from "../src/agent-workbench/transports/codex-process-port";
import { OhMyPiProcessPort } from "../src/agent-workbench/transports/ohmypi-process-port";
import type { OmpRpcConnection, OmpRpcFrame } from "../src/agent-workbench/transports/omp-rpc-connection";
import type { JsonRpcConnection } from "../src/agent-workbench/transports/json-line-rpc-connection";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const ready = (runtimeId: "claude" | "codex" | "ohmypi"): RuntimeProbe => ({ runtimeId, status: "ready", version: "1.2.3" });

class CodexPort implements CodexAppServerPort {
	calls: Array<[string, Record<string, unknown>]> = [];
	turnParams: Record<string, unknown>[] = [];
	responses: Array<[string | number, unknown]> = [];
	async probe() { return ready("codex"); }
	async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		this.calls.push([method, params]);
		if (method === "thread/start") return { thread: { id: "codex-1" } } as T;
		if (method === "thread/resume") return {} as T;
		if (method === "thread/fork") return { thread: { id: "codex-fork" } } as T;
		if (method === "model/list") return { data: [{
			id: "catalog-gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true,
			supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Deep reasoning" }],
			defaultReasoningEffort: "high",
			serviceTiers: [{ id: "priority", name: "Fast", description: "Low latency" }],
			defaultServiceTier: "default",
		}] } as T;
		return {} as T;
	}
	async *turn(params: Record<string, unknown>): AsyncIterable<ProtocolFrame> {
		this.turnParams.push(params);
		yield { method: "turn/started", params: { turn: { id: "turn-1" } } };
		yield { method: "thread/status/changed", params: { status: "active" } };
		yield { method: "item/agentMessage/delta", params: { delta: "hello" } };
		yield { method: "item/reasoning/textDelta", params: { delta: "thinking" } };
		yield { id: 7, method: "item/commandExecution/requestApproval", params: { command: "pwd" } };
		yield { method: "item/tool/requestUserInput", params: { questions: [] } };
		yield { method: "thread/tokenUsage/updated", params: { total: 12 } };
		yield { method: "turn/completed", params: { status: "completed" } };
	}
	async respond(id: string | number, value: unknown) { this.responses.push([id, value]); }
	async steer() {}
	async cancel() {}
	async close() {}
}

class ClaudePort implements ClaudeAgentSdkPort {
	turns: ClaudeTurnInput[] = [];
	async probe() { return ready("claude"); }
	async models() { return [{ id: "sonnet-test", label: "Sonnet Test" }]; }
	async create() { return "claude-1"; }
	async resume() {}
	async *turn(input: ClaudeTurnInput) { this.turns.push(input); yield { method: "assistant.delta", params: { text: "hello" } }; yield { method: "usage", params: { tokens: 4 } }; }
	async cancel() {}
	async fork() { return "claude-fork"; }
	async close() {}
}

class OmpPort implements OhMyPiRpcPort {
	calls: string[] = [];
	responses: Array<[string, Record<string, unknown>]> = [];
	async probe() { return ready("ohmypi"); }
	async request<T>(method: string): Promise<T> {
		this.calls.push(method);
		if (method === "get_state") return { sessionId: this.calls.filter((call) => call === "get_state").length > 1 ? "omp-fork" : "omp-1", sessionFile: "/synthetic/session.jsonl" } as T;
		if (method === "new_session") return { cancelled: false } as T;
		if (method === "get_branch_messages") return { messages: [{ entryId: "entry-1" }] } as T;
		if (method === "branch") return { cancelled: false } as T;
		if (method === "get_available_models") return { models: [{ id: "omp-test", provider: "synthetic" }] } as T;
		if (method === "get_messages") return { messages: [] } as T;
		return {} as T;
	}
	async *prompt() { yield { id: "approval-1", method: "extension_ui_request", params: { method: "select", title: "Approve tool", options: ["Approve", "Deny"] } }; yield { method: "tool_execution_start", params: { toolCallId: "tool-1", toolName: "read", args: {} } }; yield { method: "message_update", params: { assistantMessageEvent: { type: "text_delta", delta: "hello" } } }; yield { method: "agent_end", params: {} }; }
	async respond(id: string, response: Record<string, unknown>) { this.responses.push([id, response]); }
	async abort() {}
	async close() {}
}

const createInput: CreateSessionInput = { conversationId: "conversation-1", vaultRoot: "/synthetic/vault", model: "test" };
const turn: RuntimeTurn = { conversationId: "conversation-1", turnId: "turn-1", text: "hello", workflow: "plan" };

async function consume(iterable: AsyncIterable<unknown>): Promise<void> {
	for await (const event of iterable) void event;
}

async function contract(adapter: AgentRuntimeAdapter) {
	expect((await adapter.probe()).status).toBe("ready");
	const binding = await adapter.createSession(adapter.id === "ohmypi" ? { ...createInput, model: "synthetic/omp-test" } : createInput);
	expect(binding.runtimeId).toBe(adapter.id);
	await adapter.resumeSession(binding);
	const events = [];
	for await (const event of adapter.send(turn)) events.push(event);
	expect(events.length).toBeGreaterThan(0);
	expect(events.every((event) => event.runtimeId === adapter.id && event.conversationId === turn.conversationId)).toBe(true);
	if (adapter.fork) expect((await adapter.fork({ binding })).runtimeId).toBe(adapter.id);
	await adapter.cancel("test");
	await adapter.dispose();
}

describe("runtime adapter shared contract", () => {
	it("passes for Codex, Claude and OhMyPi without a model call", async () => {
		await contract(new CodexAppServerAdapter(new CodexPort()));
		await contract(new ClaudeAgentSdkAdapter(new ClaudePort(), () => true));
		await contract(new OhMyPiRpcAdapter(new OmpPort(), () => true));
	});
});

describe("adapter protocol semantics", () => {
	it("starts every OhMyPi conversation with a fresh native session before reading state", async () => {
		const port = new OmpPort();
		const adapter = new OhMyPiRpcAdapter(port, () => true);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		expect(port.calls.slice(0, 3)).toEqual(["new_session", "set_model", "get_state"]);
		await adapter.dispose();
	});

	it("fences OhMyPi prompt output to the current agent_start/agent_end run", async () => {
		const connection: OmpRpcConnection = {
			ready: async () => undefined,
			request: async <T,>() => ({} as T),
			respond: async () => undefined,
			async *subscribe(): AsyncIterable<OmpRpcFrame> {
				yield { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "stale answer" }] } };
				yield { type: "agent_start" };
				yield { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "current answer" } };
				yield { type: "agent_end" };
				yield { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "late answer" }] } };
			},
			close: async () => undefined,
		};
		const port = new OhMyPiProcessPort(connection, async () => ready("ohmypi"));
		const methods: string[] = [];
		for await (const frame of port.prompt({ text: "new question" })) methods.push(frame.method);
		expect(methods).toEqual(["agent_start", "message_update", "agent_end"]);
	});

	it("maps Claude SDK user tool_result blocks to tool.finished", async () => {
		const messages = [
			{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pwd" } }] } },
			{ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: false }] } },
			{ type: "result", subtype: "success", result: "done", usage: {}, modelUsage: {} },
		] as unknown as SDKMessage[];
		const sdk: ClaudeSdkFacade = {
			query: () => ({
				async *[Symbol.asyncIterator]() { for (const message of messages) yield message; },
				close: () => undefined,
			} as unknown as ReturnType<ClaudeSdkFacade["query"]>),
			forkSession: async () => ({ sessionId: "fork" }),
		};
		const port = new ClaudeSdkQueryPort(
			"/synthetic/vault",
			async () => ready("claude"),
			{ decide: async () => ({ allow: true }) },
			[],
			undefined,
			{},
			sdk,
		);
		await port.create(createInput);
		const frames: ProtocolFrame[] = [];
		for await (const frame of port.turn({
			sessionId: "claude-1",
			prompt: "run",
			workflow: "execute",
			permissionMode: "default",
			sandbox: { enabled: true, failIfUnavailable: true },
		})) frames.push(frame);
		expect(frames.map((frame) => frame.method)).toEqual([
			"tool.started",
			"tool.finished",
			"assistant.final",
			"usage",
			"turn.finished",
		]);
		expect(frames[1]?.params).toMatchObject({ id: "tool-1", output: "ok", error: false });
	});

	it("deduplicates identical Claude assistant and result finals", async () => {
		const messages = [
			{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "done" }] } },
			{ type: "result", subtype: "success", result: "done", usage: {}, modelUsage: {} },
		] as unknown as SDKMessage[];
		const sdk: ClaudeSdkFacade = {
			query: () => ({
				async *[Symbol.asyncIterator]() { for (const message of messages) yield message; },
				close: () => undefined,
			} as unknown as ReturnType<ClaudeSdkFacade["query"]>),
			forkSession: async () => ({ sessionId: "fork" }),
		};
		const port = new ClaudeSdkQueryPort(
			"/synthetic/vault",
			async () => ready("claude"),
			{ decide: async () => ({ allow: true }) },
			[],
			undefined,
			{},
			sdk,
		);
		await port.create(createInput);
		const frames: ProtocolFrame[] = [];
		for await (const frame of port.turn({
			sessionId: "claude-1",
			prompt: "run",
			workflow: "execute",
			permissionMode: "default",
			sandbox: { enabled: true, failIfUnavailable: true },
		})) frames.push(frame);
		expect(frames.filter((frame) => frame.method === "assistant.final")).toEqual([
			{ method: "assistant.final", params: { text: "done" } },
		]);
	});

	it("drops empty and duplicate OhMyPi message_end finals", async () => {
		class FinalNoiseOmpPort extends OmpPort {
			async *prompt() {
				yield { method: "agent_start", params: {} };
				yield { method: "message_end", params: { message: { content: [{ type: "thinking", thinking: "hidden" }] } } };
				yield { method: "message_update", params: { assistantMessageEvent: { type: "text_delta", delta: "answer" } } };
				yield { method: "message_end", params: { message: { content: [{ type: "text", text: "answer" }] } } };
				yield { method: "message_end", params: { message: { content: [{ type: "text", text: "answer" }] } } };
				yield { method: "agent_end", params: {} };
			}
		}
		const adapter = new OhMyPiRpcAdapter(new FinalNoiseOmpPort(), () => true);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		const events = [];
		for await (const event of adapter.send(turn)) events.push(event);
		expect(events.map((event) => event.type)).toEqual(["runtime.status", "assistant.delta", "assistant.final", "turn.finished"]);
		expect(events.filter((event) => event.type === "assistant.final")).toHaveLength(1);
	});

	it("projects current Codex model reasoning and service-tier metadata", async () => {
		const adapter = new CodexAppServerAdapter(new CodexPort());
		await expect(adapter.listModels()).resolves.toEqual([{
			id: "gpt-test",
			label: "GPT Test",
			isDefault: true,
			reasoningOptions: [{ value: "high", label: "high", description: "Deep reasoning" }],
			defaultReasoning: "high",
			serviceTiers: [{ id: "priority", label: "Fast", description: "Low latency" }],
			defaultServiceTier: "default",
		}]);
	});

	it("keeps the Codex turn open across retryable errors until completion", async () => {
		const connection = {
			request: async <T,>(method: string) => method === "turn/start" ? { turn: { id: "turn-native" } } as T : {} as T,
			notify: async () => undefined,
			respond: async () => undefined,
			async *subscribe() {
				yield { method: "item/agentMessage/delta", params: { threadId: "thread-2", turnId: "turn-native", delta: "foreign" } };
				yield { method: "error", params: { threadId: "thread-1", turnId: "turn-native", willRetry: true, error: { message: "Reconnecting" } } };
				yield { method: "item/agentMessage/delta", params: { turnId: "turn-native", delta: "recovered" } };
				yield { method: "turn/completed", params: { turn: { id: "turn-native", status: "completed" } } };
			},
			close: async () => undefined,
		} as JsonRpcConnection;
		const port = new CodexProcessPort(connection, async () => ready("codex"));
		const methods: string[] = [];
		for await (const frame of port.turn({ threadId: "thread-1" })) methods.push(frame.method);
		expect(methods).toEqual(["error", "item/agentMessage/delta", "turn/completed"]);
	});

	it("uses the native Codex turn identity for steering and interruption", async () => {
		const requests: Array<[string, Record<string, unknown>]> = [];
		let release!: () => void;
		let markActive!: () => void;
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		const active = new Promise<void>((resolve) => { markActive = resolve; });
		const connection = {
			request: async <T,>(method: string, params: Record<string, unknown>) => {
				requests.push([method, params]);
				return method === "turn/start" ? { turn: { id: "native-turn-7" } } as T : {} as T;
			},
			notify: async () => undefined,
			respond: async () => undefined,
			async *subscribe() {
				markActive();
				await blocked;
				yield { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "native-turn-7", status: "completed" } } };
			},
			close: async () => undefined,
		} as JsonRpcConnection;
		const port = new CodexProcessPort(connection, async () => ready("codex"));
		const iterator = port.turn({ threadId: "thread-1" })[Symbol.asyncIterator]();
		const first = iterator.next();
		await active;
		await port.steer("thread-1", "继续");
		await port.cancel("thread-1");
		release();
		const firstFrame = (await first).value as ProtocolFrame | undefined;
		expect(firstFrame?.method).toBe("turn/completed");
		await iterator.next();
		expect(requests.find(([method]) => method === "turn/steer")?.[1]).toEqual({
			threadId: "thread-1",
			expectedTurnId: "native-turn-7",
			input: [{ type: "text", text: "继续" }],
		});
		expect(requests.find(([method]) => method === "turn/interrupt")?.[1]).toEqual({
			threadId: "thread-1",
			turnId: "native-turn-7",
		});
	});

	it("stops a Codex turn after six consecutive retryable errors", async () => {
		const requests: string[] = [];
		const connection = {
			request: async <T,>(method: string) => {
				requests.push(method);
				return method === "turn/start" ? { turn: { id: "turn-native" } } as T : {} as T;
			},
			notify: async () => undefined,
			respond: async () => undefined,
			async *subscribe() {
				for (let index = 1; index <= 6; index += 1) {
					yield { method: "error", params: { turnId: "turn-native", willRetry: true, error: { message: `retry ${index}` } } };
				}
			},
			close: async () => undefined,
		} as JsonRpcConnection;
		const port = new CodexProcessPort(connection, async () => ready("codex"));
		const frames: ProtocolFrame[] = [];
		for await (const frame of port.turn({ threadId: "thread-1" })) frames.push(frame);
		expect(frames).toHaveLength(6);
		expect(frames.slice(0, -1).every((frame) => frame.params.willRetry === true)).toBe(true);
		expect(frames.at(-1)?.params).toMatchObject({
			willRetry: false,
			error: { message: "连接重试已达到 6 次", additionalDetails: "retry 6" },
		});
		expect(requests).toContain("turn/interrupt");
	});

	it("maps retrying Codex errors to silent runtime status and failed turns to errors", async () => {
		class RetryPort extends CodexPort {
			async *turn(): AsyncIterable<ProtocolFrame> {
				yield { method: "error", params: { willRetry: true, error: { message: "Reconnecting" } } };
				yield { method: "item/agentMessage/delta", params: { delta: "recovered" } };
				yield { method: "turn/completed", params: { turn: { status: "failed", error: { message: "final failure" } } } };
			}
		}
		const adapter = new CodexAppServerAdapter(new RetryPort());
		await adapter.createSession(createInput);
		const events = [];
		for await (const event of adapter.send(turn)) events.push(event);
		expect(events.map((event) => event.type)).toEqual(["runtime.status", "assistant.delta", "error"]);
	});

	it("maps current Codex generic command items to a complete tool lifecycle", async () => {
		class CurrentCommandPort extends CodexPort {
			async *turn(): AsyncIterable<ProtocolFrame> {
				yield { method: "item/started", params: { item: {
					type: "commandExecution", id: "command-1", command: "pwd", cwd: "/synthetic/vault",
					status: "inProgress", aggregatedOutput: null, exitCode: null,
				} } };
				yield { method: "item/commandExecution/outputDelta", params: { itemId: "command-1", delta: "/synthetic/vault\n" } };
				yield { method: "item/completed", params: { item: {
					type: "commandExecution", id: "command-1", command: "pwd", cwd: "/synthetic/vault",
					status: "completed", aggregatedOutput: "/synthetic/vault\n", exitCode: 0,
				} } };
				yield { method: "turn/completed", params: { turn: { status: "completed" } } };
			}
		}
		const adapter = new CodexAppServerAdapter(new CurrentCommandPort());
		await adapter.createSession(createInput);
		const events = [];
		for await (const event of adapter.send(turn)) events.push(event);
		expect(events.map((event) => event.type)).toEqual([
			"tool.started",
			"tool.updated",
			"tool.finished",
			"turn.finished",
		]);
		expect(events[0]?.payload).toMatchObject({
			id: "command-1",
			name: "Bash",
			input: { command: "pwd", cwd: "/synthetic/vault" },
		});
		expect(events[2]?.payload).toMatchObject({
			id: "command-1",
			output: "/synthetic/vault\n",
			error: false,
		});
	});

	it("maps a final-only Codex agent message to assistant.final", async () => {
		class FinalOnlyPort extends CodexPort {
			async *turn(): AsyncIterable<ProtocolFrame> {
				yield { method: "item/completed", params: { item: { id: "agent-1", type: "agentMessage", text: "final answer" } } };
				yield { method: "turn/completed", params: { turn: { status: "completed" } } };
			}
		}
		const adapter = new CodexAppServerAdapter(new FinalOnlyPort());
		await adapter.createSession(createInput);
		const events = [];
		for await (const event of adapter.send(turn)) events.push(event);
		expect(events.map((event) => event.type)).toEqual(["assistant.final", "turn.finished"]);
		expect(events[0]?.payload).toMatchObject({ text: "final answer" });
	});

	it("passes the selected Codex API profile to thread/start and binds that session separately", async () => {
		const port = new CodexPort();
		const adapter = new CodexAppServerAdapter(port);
		const binding = await adapter.createSession({
			...createInput,
			providerProfileId: "openai",
		});
		expect(port.calls[0]).toEqual([
			"thread/start",
			expect.objectContaining({ provider: "openai" }),
		]);
		expect(binding).toMatchObject({
			runtimeId: "codex",
			providerProfileId: "openai",
		});
	});

	it("sends the complete Codex collaboration settings required by current app-server", async () => {
		const port = new CodexPort();
		const adapter = new CodexAppServerAdapter(port);
		await adapter.createSession({ ...createInput, model: "gpt-5.6-sol" });
		await consume(adapter.send({ ...turn, model: undefined, workflow: "plan" }));
		expect(port.turnParams[0]?.collaborationMode).toEqual({
			mode: "plan",
			settings: { model: "gpt-5.6-sol", reasoning_effort: null, developer_instructions: null },
		});
		expect(port.calls[0]?.[1]).toMatchObject({ sandbox: "danger-full-access" });
		expect(port.calls[0]?.[1]).not.toHaveProperty("permissions");
		expect(port.turnParams[0]).toMatchObject({ sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" } });
		expect(port.turnParams[0]).not.toHaveProperty("permissions");
	});

	it("maps Codex server events and preserves persistent approval", async () => {
		const port = new CodexPort(); const adapter = new CodexAppServerAdapter(port);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		const types = [];
		for await (const event of adapter.send(turn)) types.push(event.type);
		expect(types).toEqual(["assistant.delta", "thinking.delta", "approval.requested", "user.question", "usage.updated", "turn.finished"]);
		expect(types).not.toContain("notice");
		await adapter.resolveApproval(7, "allow-always");
		expect(port.responses.at(-1)).toEqual([7, { decision: "acceptForSession" }]);
		await adapter.resolveApproval(8, "allow-always", "permissions", { fileSystem: { read: ["vault"] } });
		expect(port.responses.at(-1)?.[1]).toMatchObject({ scope: "session" });
	});

	it("drops unknown provider lifecycle frames instead of rendering protocol notices", async () => {
		class NoisyClaudePort extends ClaudePort {
			async *turn(input: ClaudeTurnInput) {
				this.turns.push(input);
				yield { method: "session.started", params: { sessionId: "synthetic" } };
				yield { method: "assistant.delta", params: { text: "hello" } };
			}
		}
		class NoisyOmpPort extends OmpPort {
			async *prompt() {
				yield { method: "agent_start", params: { sessionId: "synthetic" } };
				yield { method: "message_update", params: { assistantMessageEvent: { type: "text_delta", delta: "hello" } } };
				yield { method: "agent_end", params: {} };
			}
		}
		const adapters: AgentRuntimeAdapter[] = [
			new ClaudeAgentSdkAdapter(new NoisyClaudePort(), () => true),
			new OhMyPiRpcAdapter(new NoisyOmpPort(), () => true),
		];
		for (const adapter of adapters) {
			await adapter.createSession(adapter.id === "ohmypi" ? { ...createInput, model: "synthetic/omp-test" } : createInput);
			const types = [];
			for await (const event of adapter.send(turn)) types.push(event.type);
			expect(types).not.toContain("notice");
			expect(types).toContain("assistant.delta");
		}
	});

	it("injects first-session handoff context exactly once for Codex and Claude", async () => {
		const codexPort = new CodexPort(); const codex = new CodexAppServerAdapter(codexPort);
		await codex.createSession({ ...createInput, initialContext: "handoff-codex" });
		await consume(codex.send(turn));
		await consume(codex.send({ ...turn, turnId: "turn-2" }));
		expect(codexPort.turnParams[0]).toMatchObject({ input: [{ type: "text", text: "handoff-codex\n\nhello" }] });
		expect(codexPort.turnParams[1]).toMatchObject({ input: [{ type: "text", text: "hello" }] });

		const claudePort = new ClaudePort(); const claude = new ClaudeAgentSdkAdapter(claudePort, () => true);
		await claude.createSession({ ...createInput, initialContext: "handoff-claude" });
		await consume(claude.send(turn));
		await consume(claude.send({ ...turn, turnId: "turn-2" }));
		expect(claudePort.turns.map((item) => item.prompt)).toEqual(["handoff-claude\n\nhello", "hello"]);
	});

	it("forces Claude through default permissions plus fail-closed sandbox and reuses it for auxiliary work", async () => {
		const port = new ClaudePort(); const blocked = new ClaudeAgentSdkAdapter(port, () => false);
		await blocked.createSession(createInput);
		await expect(consume(blocked.send({ ...turn, workflow: "execute" }))).rejects.toThrow("失败关闭");
		const readyAdapter = new ClaudeAgentSdkAdapter(port, () => true);
		await readyAdapter.createSession(createInput);
		await readyAdapter.runAuxiliary("title", turn);
		expect(port.turns[0]?.permissionMode).toBe("default");
		expect(port.turns[0]?.sandbox).toEqual({ enabled: true, failIfUnavailable: true });
	});

	it("uses the exact bounded OhMyPi RPC launch and blocks Execute without sandbox", async () => {
		const launch = buildOhMyPiLaunch("/synthetic/omp", "/synthetic/vault");
		expect(launch.args).toEqual(["--mode", "rpc", "--cwd", "/synthetic/vault", "--approval-mode", "always-ask", "--no-extensions"]);
		expect(launch.args.join(" ")).not.toMatch(/yolo|auto-approve|add-dir/);
		const selectedLaunch = (buildOhMyPiLaunch as (...args: unknown[]) => { args: string[] })(
			"/synthetic/omp", "/synthetic/vault", "ask", "deepseek/deepseek-chat",
		);
		expect(selectedLaunch.args).toEqual([
			"--mode", "rpc", "--cwd", "/synthetic/vault", "--approval-mode", "always-ask", "--no-extensions",
			"--provider", "deepseek", "--model", "deepseek-chat",
		]);
		const adapter = new OhMyPiRpcAdapter(new OmpPort(), () => false);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		await expect(consume(adapter.send({ ...turn, workflow: "execute" }))).rejects.toThrow("失败关闭");
	});

	it("maps native OMP approval selects and responds with the exact option value", async () => {
		const port = new OmpPort(); const adapter = new OhMyPiRpcAdapter(port, () => true);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		const events = [];
		for await (const event of adapter.send(turn)) {
			events.push(event);
			if (event.type === "approval.requested") {
				await adapter.respondApproval({ requestId: "approval-1", decision: "allow" });
			}
		}
		expect(events.map((event) => event.type)).toContain("approval.requested");
		expect(port.responses.at(-1)).toEqual(["approval-1", { value: "Approve" }]);
	});
});
