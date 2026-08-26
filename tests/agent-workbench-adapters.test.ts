import { describe, expect, it } from "vitest";
import type { AgentRuntimeAdapter, CreateSessionInput, RuntimeProbe, RuntimeTurn } from "../src/agent-workbench/contracts/runtime-adapter";
import { ClaudeAgentSdkAdapter, type ClaudeAgentSdkPort, type ClaudeTurnInput } from "../src/agent-workbench/adapters/claude/claude-agent-sdk-adapter";
import { CodexAppServerAdapter, type CodexAppServerPort } from "../src/agent-workbench/adapters/codex/codex-app-server-adapter";
import { buildOhMyPiLaunch, OhMyPiRpcAdapter, type OhMyPiRpcPort } from "../src/agent-workbench/adapters/ohmypi/ohmypi-rpc-adapter";
import type { ProtocolFrame } from "../src/agent-workbench/adapters/shared/protocol-frame";

const ready = (runtimeId: "claude" | "codex" | "ohmypi"): RuntimeProbe => ({ runtimeId, status: "ready", version: "1.2.3" });

class CodexPort implements CodexAppServerPort {
	calls: Array<[string, Record<string, unknown>]> = [];
	turnParams: Record<string, unknown>[] = [];
	responses: Array<[string | number, unknown]> = [];
	async probe() { return ready("codex"); }
	async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		this.calls.push([method, params]);
		if (method === "thread/start") return { thread: { id: "codex-1" }, activePermissionProfile: { id: "talos-agent-workbench-v1" } } as T;
		if (method === "thread/resume") return { activePermissionProfile: { id: "talos-agent-workbench-v1" } } as T;
		if (method === "thread/fork") return { thread: { id: "codex-fork" } } as T;
		if (method === "model/list") return { data: [{ id: "gpt-test" }] } as T;
		return {} as T;
	}
	async *turn(params: Record<string, unknown>): AsyncIterable<ProtocolFrame> {
		this.turnParams.push(params);
		yield { method: "item/agentMessage/delta", params: { delta: "hello" } };
		yield { method: "item/reasoning/textDelta", params: { delta: "thinking" } };
		yield { id: 7, method: "item/commandExecution/requestApproval", params: { command: "pwd" } };
		yield { method: "item/tool/requestUserInput", params: { questions: [] } };
		yield { method: "thread/tokenUsage/updated", params: { total: 12 } };
		yield { method: "turn/completed", params: { status: "completed" } };
	}
	async respond(id: string | number, value: unknown) { this.responses.push([id, value]); }
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
	it("maps Codex server events and preserves persistent approval", async () => {
		const port = new CodexPort(); const adapter = new CodexAppServerAdapter(port);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		const types = [];
		for await (const event of adapter.send(turn)) types.push(event.type);
		expect(types).toEqual(["assistant.delta", "thinking.delta", "approval.requested", "user.question", "usage.updated", "turn.finished"]);
		await adapter.resolveApproval(7, "allow-always");
		expect(port.responses.at(-1)).toEqual([7, { decision: "acceptForSession" }]);
		await adapter.resolveApproval(8, "allow-always", "permissions", { fileSystem: { read: ["vault"] } });
		expect(port.responses.at(-1)?.[1]).toMatchObject({ scope: "session" });
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
		expect(launch.args).toEqual(["--mode", "rpc", "--cwd", "/synthetic/vault", "--approval-mode", "always-ask"]);
		expect(launch.args.join(" ")).not.toMatch(/yolo|auto-approve|add-dir/);
		const adapter = new OhMyPiRpcAdapter(new OmpPort(), () => false);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		await expect(consume(adapter.send({ ...turn, workflow: "execute" }))).rejects.toThrow("失败关闭");
	});

	it("maps native OMP approval selects and responds with the exact option value", async () => {
		const port = new OmpPort(); const adapter = new OhMyPiRpcAdapter(port, () => true);
		await adapter.createSession({ ...createInput, model: "synthetic/omp-test" });
		const events = []; for await (const event of adapter.send(turn)) events.push(event);
		expect(events.map((event) => event.type)).toContain("approval.requested");
		await adapter.respondApproval({ requestId: "approval-1", decision: "allow" });
		expect(port.responses.at(-1)).toEqual(["approval-1", { value: "Approve" }]);
	});
});
