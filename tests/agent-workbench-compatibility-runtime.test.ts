import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ FileSystemAdapter: class FileSystemAdapter {} }));

import { FileSystemAdapter } from "obsidian";
import { AdapterCompatibilityRuntime } from "../src/agent-workbench/ui/adapter-compatibility-runtime";
import type { Conversation, StreamChunk } from "../src/quyuan/claudian/core/types";

function conversation(): Conversation {
	return {
		id: "conversation-1",
		providerId: "claude",
		title: "Synthetic",
		createdAt: 1,
		updatedAt: 1,
		sessionId: "claude-native",
		providerState: {
			talosRuntimeId: "codex",
			talosNativeBindings: {
				claude: { runtimeId: "claude", sessionId: "claude-native" },
				codex: { runtimeId: "codex", sessionId: "codex-native" },
				ohmypi: { runtimeId: "ohmypi", sessionId: "omp-native", nativeResumeToken: "synthetic-session.jsonl" },
			},
			talosSyncedMessageCounts: { codex: 1 },
		},
		messages: [
			{ id: "m1", role: "user", content: "first", timestamp: 1 },
			{ id: "m2", role: "assistant", content: "second", timestamp: 2 },
		],
	};
}

describe("compatibility runtime binding projection", () => {
	it("restores the selected native binding without replacing the legacy provider session", () => {
		const runtime = new AdapterCompatibilityRuntime({} as never, "codex");
		const current = conversation();
		runtime.syncConversationState(current);
		expect(runtime.getSessionId()).toBe("codex-native");
		const updates = runtime.buildSessionUpdates({ conversation: current, sessionInvalidated: false }).updates;
		expect(updates.sessionId).toBe("claude-native");
		expect(updates.providerState).toMatchObject({
			talosRuntimeId: "codex",
			talosNativeBindings: {
				claude: { sessionId: "claude-native" },
				codex: { sessionId: "codex-native" },
				ohmypi: { sessionId: "omp-native" },
			},
		});
	});
});

describe("compatibility runtime crash recovery", () => {
	it("does not replay a failed turn and rebuilds the adapter on the next explicit turn", async () => {
		let binding: { runtimeId: "codex"; sessionId: string } | null = null;
		const disposeFirst = vi.fn(async () => undefined);
		let firstSendCount = 0;
		const first = {
			id: "codex",
			createSession: async () => (binding = { runtimeId: "codex", sessionId: "native-1" }),
			resumeSession: vi.fn(async () => undefined),
			async *send() { firstSendCount += 1; yield await Promise.reject(new Error("synthetic transport crash")); },
			dispose: disposeFirst,
		} as never;
		const second = {
			id: "codex",
			createSession: vi.fn(async () => ({ runtimeId: "codex", sessionId: "native-2" })),
			resumeSession: vi.fn(async () => undefined),
			async *send() {
				yield {
					schemaVersion: 1,
					eventId: "finished-2",
					conversationId: "portable-1",
					turnId: "turn-2",
					runtimeId: "codex",
					type: "turn.finished",
					timestamp: "2026-08-26T00:00:00.000Z",
					payload: {},
				};
			},
			cancel: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as never;
		const coordinator = {
			ensure: async (input: { conversationId: string }) => ({
				schemaVersion: 1,
				conversationId: input.conversationId,
				title: "Synthetic",
				createdAt: "2026-08-26T00:00:00.000Z",
				updatedAt: "2026-08-26T00:00:00.000Z",
				lifecycle: "active",
				selection: { runtimeId: "codex" },
			}),
			switchRuntime: vi.fn(async () => undefined),
			getBinding: vi.fn(async () => binding),
			setBinding: vi.fn(async (_conversationId: string, value: { runtimeId: "codex"; sessionId: string }) => { binding = value; }),
			clearBinding: vi.fn(async () => { binding = null; }),
			appendUser: vi.fn(async () => ({})),
			appendRuntimeEvent: vi.fn(async () => ({})),
		};
		const createRuntime = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
		const service = {
			probeRuntime: async () => ({ runtimeId: "codex", status: "ready" }),
			getConversationCoordinator: () => coordinator,
			createRuntime,
			getSelection: () => ({ runtimeId: "codex" }),
			getPermissionMode: () => "ask",
			getWorkflowMode: () => "plan",
			authorizeTool: async () => "deny",
		};
		const fsAdapter = Object.assign(new FileSystemAdapter(), { getBasePath: () => "/synthetic/vault" });
		const plugin = { app: { vault: { adapter: fsAdapter } }, getAgentWorkbenchService: () => service };
		const runtime = new AdapterCompatibilityRuntime(plugin as never, "codex");
		const collect = async () => {
			const chunks: StreamChunk[] = [];
			for await (const chunk of runtime.query(runtime.prepareTurn({ text: "hello" }))) chunks.push(chunk);
			return chunks;
		};
		const firstChunks = await collect();
		expect(firstChunks.some((chunk) => chunk.type === "error" && chunk.content.includes("未自动重发"))).toBe(true);
		expect(createRuntime).toHaveBeenCalledTimes(1);
		expect(firstSendCount).toBe(1);
		expect(disposeFirst).toHaveBeenCalledOnce();
		expect(coordinator.clearBinding).toHaveBeenCalledWith(expect.any(String), "codex", undefined);
		expect(binding).toBeNull();
		const secondChunks = await collect();
		expect(secondChunks.some((chunk) => chunk.type === "done")).toBe(true);
		expect(createRuntime).toHaveBeenCalledTimes(2);
		expect(firstSendCount).toBe(1);
		expect(second.resumeSession).not.toHaveBeenCalled();
		expect(second.createSession).toHaveBeenCalledOnce();
	});

	it("rebuilds the local runtime when authentication changes and requests a profile-scoped binding", async () => {
		let selection: { runtimeId: "codex"; providerProfileId?: string } = {
			runtimeId: "codex",
		};
		const firstDispose = vi.fn(async () => undefined);
		const first = {
			id: "codex",
			resumeSession: vi.fn(async () => undefined),
			dispose: firstDispose,
		} as never;
		const second = {
			id: "codex",
			resumeSession: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as never;
		const coordinator = {
			ensure: async (input: { conversationId: string }) => ({
				schemaVersion: 1,
				conversationId: input.conversationId,
				title: "Synthetic",
				createdAt: "2026-08-26T00:00:00.000Z",
				updatedAt: "2026-08-26T00:00:00.000Z",
				lifecycle: "active",
				selection: { runtimeId: "codex" },
			}),
			switchRuntime: vi.fn(async () => undefined),
			getBinding: vi.fn(async () => null),
			setBinding: vi.fn(async () => undefined),
		};
		const createRuntime = vi.fn()
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		const service = {
			probeRuntime: async () => ({ runtimeId: "codex", status: "ready" }),
			getConversationCoordinator: () => coordinator,
			createRuntime,
			getSelection: () => selection,
			getPermissionMode: () => "ask",
			authorizeTool: async () => "deny",
		};
		const fsAdapter = Object.assign(
			new FileSystemAdapter(),
			{ getBasePath: () => "/synthetic/vault" }
		);
		const plugin = {
			app: { vault: { adapter: fsAdapter } },
			getAgentWorkbenchService: () => service,
		};
		const runtime = new AdapterCompatibilityRuntime(plugin as never, "codex");
		expect(await runtime.ensureReady()).toBe(true);
		selection = { runtimeId: "codex", providerProfileId: "openai" };
		expect(await runtime.ensureReady()).toBe(true);
		expect(firstDispose).toHaveBeenCalledOnce();
		expect(createRuntime).toHaveBeenCalledTimes(2);
		expect(coordinator.getBinding.mock.calls.map((call) => call[2])).toEqual([
			undefined,
			"openai",
		]);
	});
});
