import { describe, expect, it, vi } from "vitest";
import { DirectApiRuntimeAdapter } from "../src/agent-workbench/adapters/api/direct-api-runtime-adapter";
import type { ProviderProfile } from "../src/agent-workbench/contracts/provider-profile";
import { DesktopRuntimeFactory } from "../src/agent-workbench/discovery/desktop-runtime-factory";

const profile: ProviderProfile = {
	id: "openai-compatible",
	displayName: "OpenAI-compatible API",
	runtimeId: "codex",
	protocol: "openai-chat",
	endpoint: "https://gateway.test/v1",
	models: ["model-x"],
	secretRef: "talos-openai-api-key",
	enabled: true,
};

function sse(text: string): Response {
	return new Response([
		`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}`,
		"data: [DONE]",
		"",
	].join("\n\n"), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

describe("DirectApiRuntimeAdapter", () => {
	it("constructs the direct route without runtime discovery, sandbox probing or child processes", async () => {
		const discovery = { probe: vi.fn(() => {
			throw new Error("native discovery must not run");
		}) };
		const sandbox = {
			availability: vi.fn(() => {
				throw new Error("sandbox probe must not run");
			}),
			assertAvailable: vi.fn(),
			prepare: vi.fn(),
		};
		const factory = new DesktopRuntimeFactory(
			discovery as never,
			sandbox as never,
			() => "synthetic-secret",
			async () => sse("factory reply"),
		);
		await expect(factory.create("claude", {
			vaultRoot: "C:\\synthetic-vault",
			providerProfile: profile,
			approve: async () => "deny",
		})).rejects.toThrow("profile 与 runtime 不匹配");

		const adapter = await factory.create("codex", {
			vaultRoot: "C:\\synthetic-vault",
			providerProfile: profile,
			approve: async () => "deny",
		});
		expect(adapter).toBeInstanceOf(DirectApiRuntimeAdapter);
		expect(discovery.probe).not.toHaveBeenCalled();
		expect(sandbox.availability).not.toHaveBeenCalled();
		expect(sandbox.prepare).not.toHaveBeenCalled();
		await adapter.dispose();
	});

	it("runs a text-only Plan turn without CLI discovery or OS sandbox", async () => {
		const requests: Array<Record<string, unknown>> = [];
		const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = init?.body;
			if (typeof body !== "string") throw new Error("expected string body");
			requests.push(JSON.parse(body) as Record<string, unknown>);
			return sse("Windows reply");
		});
		const adapter = new DirectApiRuntimeAdapter({
			profile,
			resolveSecret: () => "synthetic-secret",
			fetcher,
		});
		const binding = await adapter.createSession({
			conversationId: "conversation-1",
			vaultRoot: "C:\\synthetic-vault",
			providerProfileId: profile.id,
		});
		expect(binding).toMatchObject({
			runtimeId: "codex",
			providerProfileId: profile.id,
			protocolVersion: "talos-direct-api-v1",
		});
		const events = [];
		for await (const event of adapter.send({
			conversationId: "conversation-1",
			turnId: "turn-1",
			text: "new question",
			history: [{ role: "user", text: "prior question" }],
			workflow: "plan",
		})) events.push(event);
		expect(events.map((event) => event.type)).toEqual([
			"assistant.delta",
			"assistant.final",
			"turn.finished",
		]);
		expect(events[1]?.payload).toEqual({ text: "Windows reply" });
		expect(requests[0]?.tools).toBeUndefined();
		expect(requests[0]?.messages).toEqual(expect.arrayContaining([
			expect.objectContaining({ role: "user", content: "prior question" }),
			expect.objectContaining({ role: "user", content: "new question" }),
		]));
		expect(adapter.capabilities().tools.shell).toBe("unavailable");
		await adapter.dispose();
	});

	it("fails closed in Execute mode without calling the API", async () => {
		const fetcher = vi.fn();
		const adapter = new DirectApiRuntimeAdapter({
			profile,
			resolveSecret: () => "synthetic-secret",
			fetcher,
		});
		await adapter.createSession({
			conversationId: "conversation-1",
			vaultRoot: "C:\\synthetic-vault",
			providerProfileId: profile.id,
		});
		const events = [];
		for await (const event of adapter.send({
			conversationId: "conversation-1",
			turnId: "turn-execute",
			text: "write a file",
			workflow: "execute",
		})) events.push(event);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "error",
			payload: { recoverable: true },
		});
		expect(String(events[0]?.payload.message)).toContain("Plan");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("surfaces protocol errors without a synthesized successful terminal event", async () => {
		const adapter = new DirectApiRuntimeAdapter({
			profile,
			resolveSecret: () => "synthetic-secret",
			fetcher: async () => new Response("<html>bad gateway</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}),
		});
		await adapter.createSession({
			conversationId: "conversation-1",
			vaultRoot: "C:\\synthetic-vault",
			providerProfileId: profile.id,
		});
		const events = [];
		for await (const event of adapter.send({
			conversationId: "conversation-1",
			turnId: "turn-error",
			text: "hello",
			workflow: "plan",
		})) events.push(event);
		expect(events.map((event) => event.type)).toEqual(["error"]);
		expect(String(events[0]?.payload.message)).toContain("响应格式不受支持");
	});
});
