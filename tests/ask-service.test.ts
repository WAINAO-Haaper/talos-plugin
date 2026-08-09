import { describe, expect, it } from "vitest";
import { TalosAskService } from "../src/ai/ask-service";
import { ProviderFacade } from "../src/ai/provider/provider-facade";
import type {
	AskEvent,
	AskRequest,
	TalosProvider,
} from "../src/ai/provider/types";
import type {
	VaultRetrievalInput,
	VaultRetrievalResult,
} from "../src/ai/context/vault-retrieval";

class RecordingProvider implements TalosProvider {
	readonly kind = "mock" as const;
	readonly requests: AskRequest[] = [];
	cancelled: string[] = [];

	constructor(readonly id: string) {}

	capabilities() {
		return new Set(["chat", "stream", "tools", "cancel"] as const);
	}

	async *chat(request: AskRequest): AsyncIterable<AskEvent> {
		this.requests.push(request);
		yield { type: "text", text: `${this.id}:answer` };
		yield {
			type: "tool-request",
			toolCallId: "tool-1",
			name: "Write",
			input: { file_path: "70 输出/draft.md", content: "draft" },
		};
		yield {
			type: "tool-result",
			toolCallId: "tool-1",
			output: "not executed",
			isError: true,
		};
		yield { type: "done", sessionId: request.sessionId };
	}

	async cancel(runId: string): Promise<void> {
		this.cancelled.push(runId);
	}

	async resume(): Promise<void> {}
}

function retriever(result: VaultRetrievalResult) {
	const inputs: VaultRetrievalInput[] = [];
	return {
		inputs,
		async retrieve(input: VaultRetrievalInput) {
			inputs.push(input);
			return result;
		},
	};
}

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

describe("TalosAskService", () => {
	it("uses one service for isolated chat and voice namespaces", async () => {
		const provider = new RecordingProvider("mock-main");
		const facade = new ProviderFacade();
		facade.register(provider);
		const retrieval = retriever({
			hits: [
				{
					path: "30 洞察/context.md",
					excerpt: "已确认上下文",
					truncated: false,
					source: "keyword",
					score: 200,
					reasons: ["keyword-match"],
				},
			],
			blocked: [],
		});
		const proposals: string[] = [];
		const service = new TalosAskService({
			facade,
			retriever: retrieval,
			manualReview: () => true,
			toolGateway: {
				async propose(input) {
					proposals.push(`${input.namespace}:${input.name}`);
					return { taskId: `task-${proposals.length}` };
				},
			},
		});

		await collect(
			service.ask({
				sessionId: "same",
				namespace: "chat",
				runId: "chat-run",
				turnId: "chat-turn",
				providerId: "mock-main",
				query: "总结",
			})
		);
		await collect(
			service.ask({
				sessionId: "same",
				namespace: "voice",
				runId: "voice-run",
				turnId: "voice-turn",
				providerId: "mock-main",
				query: "继续",
			})
		);

		expect(provider.requests).toHaveLength(2);
		expect(provider.requests[0]?.sessionId).toBe("chat:same");
		expect(provider.requests[1]?.sessionId).toBe("voice:same");
		expect(provider.requests[0]?.text).toContain("已确认上下文");
		expect(provider.requests[0]?.toolsAllowed).toBe(false);
		expect(proposals).toEqual(["chat:Write", "voice:Write"]);
	});

	it("switches providers without duplicating a session", async () => {
		const first = new RecordingProvider("first");
		const second = new RecordingProvider("second");
		const facade = new ProviderFacade(() => 100);
		facade.register(first);
		facade.register(second);
		const service = new TalosAskService({
			facade,
			retriever: retriever({ hits: [], blocked: [] }),
			manualReview: () => true,
			toolGateway: {
				async propose() {
					return { taskId: "task" };
				},
			},
		});

		await collect(
			service.ask({
				sessionId: "session",
				namespace: "chat",
				runId: "run-1",
				turnId: "turn-1",
				providerId: "first",
				query: "one",
			})
		);
		await collect(
			service.ask({
				sessionId: "session",
				namespace: "chat",
				runId: "run-2",
				turnId: "turn-2",
				providerId: "second",
				query: "two",
			})
		);

		expect(first.requests).toHaveLength(1);
		expect(second.requests).toHaveLength(1);
		expect(facade.getSession("chat:session").switchPoints).toHaveLength(1);
	});

	it("proposes the same provider tool id again in a later run", async () => {
		const provider = new RecordingProvider("mock-main");
		const facade = new ProviderFacade();
		facade.register(provider);
		const proposals: string[] = [];
		const service = new TalosAskService({
			facade,
			retriever: retriever({ hits: [], blocked: [] }),
			manualReview: () => true,
			toolGateway: {
				async propose(input) {
					proposals.push(`${input.runId}:${input.toolCallId}`);
					return { taskId: `task-${proposals.length}` };
				},
			},
		});

		await collect(
			service.ask({
				sessionId: "session",
				namespace: "chat",
				runId: "run-1",
				turnId: "turn-1",
				providerId: "mock-main",
				query: "first",
			})
		);
		await collect(
			service.ask({
				sessionId: "session",
				namespace: "chat",
				runId: "run-2",
				turnId: "turn-2",
				providerId: "mock-main",
				query: "second",
			})
		);

		expect(proposals).toEqual(["run-1:tool-1", "run-2:tool-1"]);
	});

	it("never places blocked excerpts in provider context", async () => {
		const provider = new RecordingProvider("mock");
		const facade = new ProviderFacade();
		facade.register(provider);
		const service = new TalosAskService({
			facade,
			retriever: retriever({
				hits: [
					{
						path: "30 洞察/leak.md",
						excerpt:
							"Authorization: Bearer fake-bearer-token-value",
						truncated: false,
						source: "keyword",
						score: 1,
						reasons: [],
					},
				],
				blocked: [],
			}),
			manualReview: () => true,
			toolGateway: {
				async propose() {
					return { taskId: "task" };
				},
			},
		});

		await collect(
			service.ask({
				sessionId: "session",
				namespace: "chat",
				runId: "run",
				turnId: "turn",
				providerId: "mock",
				query: "question",
			})
		);

		expect(provider.requests[0]?.text).not.toContain("fake-bearer");
	});

	it("binds the active provider module matrix and persists run metadata", async () => {
		const provider = new RecordingProvider("openai-compatible");
		const facade = new ProviderFacade();
		facade.register(provider);
		const auditRecords: Array<{
			runId: string;
			turnId: string;
			sessionId: string;
			namespace: string;
			audit: { deniedModules: string[] };
		}> = [];
		const service = new TalosAskService({
			facade,
			retriever: retriever({
				hits: [
					{
						path: "10 身份/身份.md",
						excerpt: "身份上下文",
						truncated: false,
						source: "keyword",
						score: 1,
						reasons: [],
					},
				],
				blocked: [],
			}),
			manualReview: () => true,
			moduleAccess: (providerId) =>
				providerId === "openai-compatible"
					? { identity: false }
					: {},
			vaultSchema: () => ({ identity: "10 身份" }),
			auditSink: async (record) => {
				auditRecords.push(record);
			},
			toolGateway: {
				async propose() {
					return { taskId: "task" };
				},
			},
		});

		const events = await collect(
			service.ask({
				sessionId: "session",
				namespace: "chat",
				runId: "run-module-denied",
				turnId: "turn-module-denied",
				providerId: "openai-compatible",
				query: "读取身份",
			})
		);

		expect(provider.requests).toHaveLength(0);
		expect(events).toEqual([
			{
				type: "error",
				message: "Provider 出库隐私审计未通过",
				retryable: false,
			},
			{ type: "done", sessionId: "chat:session" },
		]);
		expect(auditRecords).toMatchObject([
			{
				runId: "run-module-denied",
				turnId: "turn-module-denied",
				sessionId: "chat:session",
				namespace: "chat",
				audit: { deniedModules: ["identity"] },
			},
		]);
	});
});
