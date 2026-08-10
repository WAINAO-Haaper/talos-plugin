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
	TalosProvider,
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

	it("cancels a running request on its original provider after a session switch", async () => {
		let releaseFirstRun = () => undefined;
		let firstCancelCalls = 0;
		let secondCancelCalls = 0;
		const firstProvider: TalosProvider = {
			id: "first",
			kind: "api",
			capabilities: () => new Set(["chat", "stream", "cancel"]),
			chat: async function* () {
				const cancellation = new Promise<void>((resolve) => {
					releaseFirstRun = resolve;
				});
				yield { type: "text", text: "started" };
				await cancellation;
				yield { type: "done" };
			},
			async cancel() {
				firstCancelCalls += 1;
				releaseFirstRun();
			},
			async resume() {},
		};
		const secondProvider: TalosProvider = {
			id: "second",
			kind: "api",
			capabilities: () => new Set(["chat", "stream", "cancel"]),
			chat: async function* () {
				yield { type: "done" };
			},
			async cancel() {
				secondCancelCalls += 1;
			},
			async resume() {},
		};
		const facade = new ProviderFacade();
		facade.register(firstProvider);
		facade.register(secondProvider);
		facade.createSession({ sessionId: "session", providerId: "first" });
		const iterator = facade.chat("session", {
			runId: "run",
			turnId: "turn",
			text: "start",
		})[Symbol.asyncIterator]();

		await expect(iterator.next()).resolves.toEqual({
			done: false,
			value: { type: "text", text: "started" },
		});
		facade.switchProvider("session", "second", "turn-2");
		await facade.cancel("session", "run");
		await iterator.next();
		await iterator.next();

		expect(firstCancelCalls).toBe(1);
		expect(secondCancelCalls).toBe(0);
	});
});

describe("ClaudianProviderAdapter", () => {
	it("maps the existing registry/runtime without taking ownership of native history", async () => {
		const history = [{ id: "native-history-ref" }];
		const providerStateRef = {
			native: "state",
			providerSessionId: "native-state-session",
		};
		let historySeen: unknown;
		let syncedState: unknown;
		let workspaceLookups = 0;
		let cleanupCalls = 0;
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
			cleanup: () => {
				cleanupCalls += 1;
			},
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
			sessionId: "native-state-session",
			providerState: providerStateRef,
		});
		expect(cleanupCalls).toBe(1);
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

	it("keeps TALOS logical session ids out of native runtimes and reuses the native session", async () => {
		const nativeSessionId = "019fe914-8c2b-7ff3-ac07-4700adb1d326";
		const syncedSessions: Array<string | null> = [];
		let cleanupCalls = 0;
		const registry: ClaudianRegistryPort = {
			getRegisteredProviderIds: () => ["codex"],
			createRuntime: () => {
				let runtimeSessionId: string | null = null;
				return {
					prepareTurn: (request) => ({
						request,
						persistedContent: request.text,
						prompt: request.text,
						isCompact: false,
						mcpMentions: new Set(),
					}),
					syncConversationState: (state) => {
						runtimeSessionId = state?.sessionId ?? null;
						syncedSessions.push(runtimeSessionId);
					},
					ensureReady: async () => true,
					query: async function* () {
						runtimeSessionId ??= nativeSessionId;
						yield { type: "done" };
					},
					cancel: () => undefined,
					getSessionId: () => runtimeSessionId,
					cleanup: () => {
						cleanupCalls += 1;
					},
					setApprovalCallback: () => undefined,
				};
			},
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

		for (const runId of ["run-1", "run-2"]) {
			await collect(
				adapter.chat({
					runId,
					turnId: runId,
					sessionId: "command:canonical",
					text: "hello",
				})
			);
		}

		expect(syncedSessions).toEqual([null, nativeSessionId]);
		expect(syncedSessions).not.toContain("command:canonical");
		expect(cleanupCalls).toBe(2);
	});

	it("routes cancel by run id and resumes the next native runtime", async () => {
		let cancelCalls = 0;
		let cleanupCalls = 0;
		let releaseQuery = () => undefined;
		const syncedSessions: Array<string | null> = [];
		const queryReleased = new Promise<void>((resolve) => {
			releaseQuery = resolve;
		});
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
				yield { type: "text", content: "started" };
				await queryReleased;
				yield { type: "done" };
			},
			cancel: () => {
				cancelCalls += 1;
				releaseQuery();
			},
			getSessionId: () => "native-resume",
			cleanup: () => {
				cleanupCalls += 1;
			},
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

		const iterator = adapter.chat({
				runId: "run-1",
				turnId: "turn-1",
				sessionId: "logical-resume",
				text: "first",
			})[Symbol.asyncIterator]();
		await expect(iterator.next()).resolves.toMatchObject({
			done: false,
			value: { type: "text", text: "started" },
		});
		await adapter.cancel("run-1");
		await iterator.next();
		await iterator.next();
		await adapter.resume("logical-resume");
		await collect(
			adapter.chat({
				runId: "run-2",
				turnId: "turn-2",
				text: "second",
			})
		);

		expect(cancelCalls).toBe(1);
		expect(syncedSessions).toEqual([null, "native-resume"]);
		expect(cleanupCalls).toBe(2);
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
