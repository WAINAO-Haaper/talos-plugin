import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ FileSystemAdapter: class FileSystemAdapter {} }));

import { FileSystemAdapter } from "obsidian";
import { AdapterCompatibilityRuntime, runtimeErrorContent, runtimeNoticeContent } from "../src/agent-workbench/ui/adapter-compatibility-runtime";
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

describe("compatibility runtime notice mapping", () => {
	it("drops empty protocol notices and preserves meaningful notices", () => {
		expect(runtimeNoticeContent({ type: "notice", payload: {} } as never)).toBeNull();
		expect(runtimeNoticeContent({ type: "notice", payload: { message: "notice" } } as never)).toBeNull();
		expect(runtimeNoticeContent({ type: "notice", payload: { message: "已连接" } } as never)).toBe("已连接");
		expect(runtimeNoticeContent({ type: "runtime.status", payload: { willRetry: true, error: { message: "Reconnecting" } } } as never)).toBe("连接中断，正在重试：Reconnecting");
	});

	it("surfaces nested native errors instead of a generic runtime error", () => {
		expect(runtimeErrorContent({ runtimeId: "claude", payload: { message: "request failed" } } as never)).toBe("request failed");
		expect(runtimeErrorContent({ runtimeId: "codex", payload: { error: { message: "proxy rejected" } } } as never)).toBe("proxy rejected");
		expect(runtimeErrorContent({ runtimeId: "codex", payload: { turn: { error: { message: "turn failed" } } } } as never)).toBe("turn failed");
		expect(runtimeErrorContent({ runtimeId: "ohmypi", payload: { assistantMessageEvent: { error: { errorMessage: "provider failed" } } } } as never)).toBe("provider failed");
		expect(runtimeErrorContent({ runtimeId: "codex", payload: { error: { message: "TLS failed", additionalDetails: "UnknownIssuer", code: "E_TLS", codexErrorInfo: {} } } } as never)).toBe("TLS failed：UnknownIssuer（字段：code、codexErrorInfo）");
		expect(runtimeErrorContent({ runtimeId: "codex", payload: { message: "Bearer secret-token sk-12345678" } } as never)).toBe("Bearer [凭据已省略] [凭据已省略]");
	});
});

describe("compatibility runtime provider authorization", () => {
	it("marks only the internal Provider proxy bridge as trusted egress", async () => {
		const authorizeTool = vi.fn(async () => "allow" as const);
		const fsAdapter = Object.assign(new FileSystemAdapter(), { getBasePath: () => "/synthetic/vault" });
		const plugin = {
			app: { vault: { adapter: fsAdapter } },
			getAgentWorkbenchService: () => ({ authorizeTool }),
		};
		const runtime = new AdapterCompatibilityRuntime(plugin as never, "codex");
		const authorize = (runtime as unknown as {
			authorize(toolName: string, input: Record<string, unknown>, reason: string): Promise<"allow" | "allow-always" | "deny">;
		}).authorize.bind(runtime);
		await authorize("NetworkRequest", { url: "https://chatgpt.com:443" }, "provider-egress-proxy");
		await authorize("NetworkRequest", { url: "https://example.com" }, "WebFetch");
		expect(authorizeTool.mock.calls[0]?.[0]).toMatchObject({
			runtimeId: "codex",
			providerEgressRequest: true,
		});
		expect(authorizeTool.mock.calls[1]?.[0]).toMatchObject({ providerEgressRequest: false });
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

	it("clears an unresumable binding before the next explicit turn", async () => {
		let binding: { runtimeId: "codex"; sessionId: string } | null = {
			runtimeId: "codex",
			sessionId: "stale-native",
		};
		const stale = {
			id: "codex",
			resumeSession: vi.fn(async () => { throw new Error("no rollout found"); }),
			dispose: vi.fn(async () => undefined),
		} as never;
		const fresh = {
			id: "codex",
			resumeSession: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as never;
		const coordinator = {
			ensure: async (input: { conversationId: string }) => ({
				schemaVersion: 1,
				conversationId: input.conversationId,
				title: "Synthetic",
				createdAt: "2026-08-27T00:00:00.000Z",
				updatedAt: "2026-08-27T00:00:00.000Z",
				lifecycle: "active",
				selection: { runtimeId: "codex" },
			}),
			switchRuntime: vi.fn(async () => undefined),
			getBinding: vi.fn(async () => binding),
			setBinding: vi.fn(async () => undefined),
			clearBinding: vi.fn(async () => { binding = null; }),
		};
		const createRuntime = vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
		const service = {
			probeRuntime: async () => ({ runtimeId: "codex", status: "ready" }),
			getConversationCoordinator: () => coordinator,
			createRuntime,
			getSelection: () => ({ runtimeId: "codex" }),
			getPermissionMode: () => "ask",
			authorizeTool: async () => "deny",
		};
		const fsAdapter = Object.assign(new FileSystemAdapter(), { getBasePath: () => "/synthetic/vault" });
		const plugin = { app: { vault: { adapter: fsAdapter } }, getAgentWorkbenchService: () => service };
		const runtime = new AdapterCompatibilityRuntime(plugin as never, "codex");
		expect(await runtime.ensureReady()).toBe(true);
		expect(stale.resumeSession).toHaveBeenCalledOnce();
		expect(stale.dispose).toHaveBeenCalledOnce();
		expect(coordinator.clearBinding).toHaveBeenCalledWith(expect.any(String), "codex", undefined);
		expect(createRuntime).toHaveBeenCalledTimes(2);
		expect(fresh.resumeSession).not.toHaveBeenCalled();
		expect(runtime.getSessionId()).toBeNull();
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
