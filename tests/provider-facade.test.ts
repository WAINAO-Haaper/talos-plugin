import { describe, expect, it } from "vitest";
import { ProviderFacade } from "../src/ai/provider/provider-facade";
import { MockProvider } from "../src/ai/provider/mock-provider";
import {
	ClaudianProviderAdapter,
	createClaudianProviderAdapters,
	type ClaudianRegistryPort,
	type ClaudianRuntimePort,
} from "../src/ai/provider/claudian-provider-adapter";
import type {
	AskEvent,
	ProviderCapability,
	TalosProviderKind,
} from "../src/ai/provider/types";

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

function mock(
	id: string,
	kind: TalosProviderKind,
	events: AskEvent[],
	capabilities: ProviderCapability[] = [
		"chat",
		"stream",
		"tools",
		"usage",
		"cancel",
		"resume",
		"fork",
	]
): MockProvider {
	return new MockProvider({
		id,
		kind,
		seed: 0,
		capabilities,
		fixtures: [events],
	});
}

describe("ProviderFacade", () => {
	it("registers API, CLI, and mock providers without replacing their runtimes", () => {
		const facade = new ProviderFacade();
		facade.register(mock("cloud-api", "api", [{ type: "done" }]));
		facade.register(mock("claude-cli", "cli", [{ type: "done" }]));
		facade.register(mock("fixture", "mock", [{ type: "done" }]));

		expect(facade.listProviders()).toEqual([
			{ id: "cloud-api", kind: "api" },
			{ id: "claude-cli", kind: "cli" },
			{ id: "fixture", kind: "mock" },
		]);
	});

	it("reports missing capabilities so the UI can disable unsupported actions", () => {
		const facade = new ProviderFacade();
		facade.register(
			mock(
				"text-only",
				"api",
				[{ type: "done" }],
				["chat", "stream", "cancel"]
			)
		);

		expect(
			facade.getAvailability("text-only", ["chat", "tools", "resume"])
		).toEqual({
			enabled: false,
			missing: ["tools", "resume"],
		});
	});

	it("records provider switch points and lets forks choose another provider", async () => {
		const facade = new ProviderFacade(() => 100);
		facade.register(mock("claude-cli", "cli", [{ type: "text", text: "A" }, { type: "done" }]));
		facade.register(mock("openai-api", "api", [{ type: "text", text: "B" }, { type: "done" }]));
		facade.createSession({ sessionId: "session-1", providerId: "claude-cli" });

		await collect(
			facade.chat("session-1", {
				runId: "run-1",
				turnId: "turn-1",
				text: "先回答",
			})
		);
		facade.switchProvider("session-1", "openai-api", "turn-2");
		const fork = facade.forkSession({
			sourceSessionId: "session-1",
			sessionId: "session-2",
			providerId: "claude-cli",
			atTurnId: "turn-2",
		});

		expect(facade.getSession("session-1").switchPoints).toEqual([
			{
				fromProviderId: "claude-cli",
				toProviderId: "openai-api",
				atTurnId: "turn-2",
				changedAt: 100,
			},
		]);
		expect(fork).toMatchObject({
			sessionId: "session-2",
			providerId: "claude-cli",
			forkedFrom: { sessionId: "session-1", atTurnId: "turn-2" },
		});
	});

	it("does not repeat completed tools after a provider switch", async () => {
		const repeatedTool: AskEvent[] = [
			{
				type: "tool-request",
				toolCallId: "tool-1",
				name: "Write",
				input: { file_path: "30 洞察/a.md" },
			},
			{
				type: "tool-result",
				toolCallId: "tool-1",
				output: "ok",
				isError: false,
			},
			{ type: "done" },
		];
		const facade = new ProviderFacade();
		facade.register(mock("first", "cli", repeatedTool));
		facade.register(mock("second", "api", repeatedTool));
		facade.createSession({ sessionId: "session", providerId: "first" });

		await collect(
			facade.chat("session", {
				runId: "run-1",
				turnId: "turn-1",
				text: "执行一次",
			})
		);
		facade.switchProvider("session", "second", "turn-2");
		const secondEvents = await collect(
			facade.chat("session", {
				runId: "run-2",
				turnId: "turn-2",
				text: "继续",
			})
		);

		expect(
			secondEvents.filter((event) => event.type === "tool-request")
		).toEqual([]);
		expect(secondEvents).toContainEqual({
			type: "tool-skipped",
			toolCallId: "tool-1",
			reason: "already-executed",
		});
		expect(facade.getSession("session").completedToolIds).toEqual(["tool-1"]);
	});

	it("creates an independent review turn that never executes tools", async () => {
		const facade = new ProviderFacade();
		facade.register(
			mock("reviewer", "api", [
				{ type: "text", text: "复核意见" },
				{
					type: "tool-request",
					toolCallId: "review-tool",
					name: "Write",
					input: { file_path: "70 输出/review.md" },
				},
				{
					type: "tool-result",
					toolCallId: "review-tool",
					output: "should not execute",
					isError: false,
				},
				{ type: "done" },
			])
		);
		facade.createSession({ sessionId: "session", providerId: "reviewer" });

		const events = await collect(
			facade.reviewTurn("session", "reviewer", {
				runId: "review-run",
				turnId: "review-turn",
				text: "请复核上一轮",
				reviewOfTurnId: "turn-1",
			})
		);

		expect(events.some((event) => event.type === "tool-request")).toBe(false);
		expect(events.some((event) => event.type === "tool-result")).toBe(false);
		expect(events).toContainEqual({
			type: "tool-skipped",
			toolCallId: "review-tool",
			reason: "review-mode",
		});
		expect(facade.getSession("session").reviews).toEqual([
			{
				providerId: "reviewer",
				turnId: "review-turn",
				reviewOfTurnId: "turn-1",
			},
		]);
		expect(facade.getSession("session").completedToolIds).toEqual([]);
	});
});

describe("ClaudianProviderAdapter", () => {
	it("maps the existing registry/runtime without taking ownership of native history", async () => {
		const history = [{ id: "native-history-ref" }];
		const providerStateRef = { native: "state" };
		let historySeen: unknown;
		let syncedState: unknown;
		let workspaceLookups = 0;
		let approval:
			| ((toolName: string, input: Record<string, unknown>) => Promise<string>)
			| null = null;
		const runtime: ClaudianRuntimePort = {
			prepareTurn: (request) => ({
				request,
				persistedContent: request.text,
				prompt: request.text,
				isCompact: false,
				mcpMentions: new Set(),
			}),
			syncConversationState: (state) => {
				syncedState = state;
			},
			ensureReady: async () => true,
			query: async function* (_turn, nativeHistory) {
				historySeen = nativeHistory;
				yield { type: "text", content: "native text" };
				yield {
					type: "tool_use",
					id: "native-tool",
					name: "Read",
					input: { file_path: "30 洞察/a.md" },
				};
				yield {
					type: "tool_result",
					id: "native-tool",
					content: "ok",
					isError: false,
				};
				yield {
					type: "usage",
					usage: {
						inputTokens: 12,
						contextWindow: 1000,
						contextTokens: 12,
						percentage: 1.2,
					},
					sessionId: "native-session",
				};
				yield { type: "done" };
			},
			cancel: () => undefined,
			getSessionId: () => "native-session",
			setApprovalCallback: (callback) => {
				approval = callback;
			},
		};
		const registry: ClaudianRegistryPort = {
			getRegisteredProviderIds: () => ["claude"],
			createRuntime: () => runtime,
			getCapabilities: () => ({
				providerId: "claude",
				supportsPersistentRuntime: true,
				supportsNativeHistory: true,
				supportsPlanMode: true,
				supportsRewind: true,
				supportsFork: true,
				supportsProviderCommands: true,
				supportsImageAttachments: true,
				supportsInstructionMode: true,
				supportsMcpTools: true,
				reasoningControl: "effort",
			}),
			getWorkspaceServices: () => {
				workspaceLookups += 1;
				return { commandCatalog: {} };
			},
		};
		const adapter = new ClaudianProviderAdapter({
			providerId: "claude",
			plugin: {} as never,
			registry,
		});

		const events = await collect(
			adapter.chat({
				runId: "native-run",
				turnId: "turn",
				sessionId: "talos-session",
				text: "hello",
				historyRef: history,
				providerStateRef,
				toolsAllowed: false,
			})
		);

		expect(historySeen).toBe(history);
		expect(syncedState).toEqual({
			sessionId: "talos-session",
			providerState: providerStateRef,
		});
		expect(events.map((event) => event.type)).toEqual([
			"text",
			"tool-request",
			"tool-result",
			"usage",
			"done",
		]);
		expect(adapter.capabilities()).toEqual(
			new Set([
				"chat",
				"stream",
				"tools",
				"usage",
				"cancel",
				"resume",
				"fork",
			])
		);
		expect(workspaceLookups).toBeGreaterThan(0);
		await expect(approval?.("Write", {})).resolves.toBe("deny");
	});

	it("routes cancel by run id and resumes the next native runtime", async () => {
		let cancelCalls = 0;
		const syncedSessions: Array<string | null> = [];
		const runtime: ClaudianRuntimePort = {
			prepareTurn: (request) => ({
				request,
				persistedContent: request.text,
				prompt: request.text,
				isCompact: false,
				mcpMentions: new Set(),
			}),
			syncConversationState: (state) => {
				syncedSessions.push(state?.sessionId ?? null);
			},
			ensureReady: async () => true,
			query: async function* () {
				yield { type: "done" };
			},
			cancel: () => {
				cancelCalls += 1;
			},
			getSessionId: () => null,
			setApprovalCallback: () => undefined,
		};
		const registry: ClaudianRegistryPort = {
			getRegisteredProviderIds: () => ["codex"],
			createRuntime: () => runtime,
			getCapabilities: () => ({
				providerId: "codex",
				supportsPersistentRuntime: true,
				supportsNativeHistory: true,
				supportsPlanMode: true,
				supportsRewind: false,
				supportsFork: true,
				supportsProviderCommands: true,
				supportsImageAttachments: true,
				supportsInstructionMode: true,
				supportsMcpTools: true,
				reasoningControl: "effort",
			}),
			getWorkspaceServices: () => null,
		};
		const adapter = new ClaudianProviderAdapter({
			providerId: "codex",
			plugin: {} as never,
			registry,
		});

		await collect(
			adapter.chat({
				runId: "run-1",
				turnId: "turn-1",
				text: "first",
			})
		);
		await adapter.cancel("run-1");
		await adapter.resume("native-resume");
		await collect(
			adapter.chat({
				runId: "run-2",
				turnId: "turn-2",
				text: "second",
			})
		);

		expect(cancelCalls).toBe(1);
		expect(syncedSessions).toEqual([null, "native-resume"]);
	});

	it("discovers existing CLI providers from Claudian's registry instead of duplicating the catalog", () => {
		const registry = {
			getRegisteredProviderIds: () =>
				["claude", "codex", "opencode", "pi"] as const,
			createRuntime: () => {
				throw new Error("not needed");
			},
			getCapabilities: () => {
				throw new Error("not needed");
			},
			getWorkspaceServices: () => null,
		} satisfies ClaudianRegistryPort;

		const adapters = createClaudianProviderAdapters(
			{} as never,
			registry
		);

		expect(adapters.map((adapter) => adapter.id)).toEqual([
			"claude",
			"codex",
			"opencode",
			"pi",
		]);
	});
});
