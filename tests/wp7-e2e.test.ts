import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TalosAskService } from "../src/ai/ask-service";
import {
	VaultRetriever,
	type VaultDocumentPort,
} from "../src/ai/context/vault-retrieval";
import { MockProvider } from "../src/ai/provider/mock-provider";
import { ProviderFacade } from "../src/ai/provider/provider-facade";
import type {
	AskEvent,
	AskRequest,
	ProviderCapability,
	TalosProvider,
} from "../src/ai/provider/types";
import { proposeAnswerWriteback } from "../src/ai/writeback-policy";
import { createBuiltinActionRegistry } from "../src/action-core/builtin-actions";
import {
	CANONICAL_REGISTRY_PATH,
	CanonicalRegistryReader,
} from "../src/canonical/registry-reader";
import { VoiceSessionStore } from "../src/quyuan/voice-session-store";
import { MemoryRecoveryStore } from "../src/task-core/recovery-store";
import { MemoryTaskStore } from "../src/task-core/task-store";
import {
	TalosTaskRunner,
	type TaskTimerHost,
} from "../src/task-core/task-runner";
import { TalosPageRouter } from "../src/ui/page-router";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(testDirectory, "../fixtures/wp7-vault");
const nodeTimers: TaskTimerHost = {
	schedule: (callback, timeoutMs) => nodeSetTimeout(callback, timeoutMs),
	cancel: (handle) => nodeClearTimeout(handle as NodeJS.Timeout),
};

function loadFixture(root: string): Record<string, string> {
	const files: Record<string, string> = {};
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolute);
			} else {
				files[relative(root, absolute).replaceAll("\\", "/")] =
					readFileSync(absolute, "utf8");
			}
		}
	};
	visit(root);
	return files;
}

class MemoryVault implements VaultDocumentPort {
	readonly writes: string[] = [];
	private readonly files: Map<string, string>;

	constructor(initial: Record<string, string>) {
		this.files = new Map(Object.entries(initial));
	}

	async listPaths(): Promise<string[]> {
		return [...this.files.keys()];
	}

	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing fixture path: ${path}`);
		return value;
	}

	async write(path: string, value: string): Promise<void> {
		this.files.set(path, value);
		this.writes.push(path);
	}
}

class RecordingMockProvider implements TalosProvider {
	readonly kind = "mock" as const;
	readonly requests: AskRequest[] = [];
	private readonly delegate: MockProvider;

	constructor(
		readonly id: string,
		fixtures: AskEvent[][]
	) {
		this.delegate = new MockProvider({
			id,
			seed: 0,
			capabilities: [
				"chat",
				"stream",
				"tools",
				"usage",
				"cancel",
				"resume",
				"fork",
			],
			fixtures,
		});
	}

	capabilities(): ReadonlySet<ProviderCapability> {
		return this.delegate.capabilities();
	}

	async *chat(request: AskRequest): AsyncIterable<AskEvent> {
		this.requests.push(request);
		yield* this.delegate.chat(request);
	}

	async cancel(runId: string): Promise<void> {
		await this.delegate.cancel(runId);
	}

	async resume(sessionId: string): Promise<void> {
		await this.delegate.resume(sessionId);
	}
}

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

function noteInput(input: unknown): { targetPath: string; content: string } {
	if (
		!input ||
		typeof input !== "object" ||
		typeof (input as { targetPath?: unknown }).targetPath !== "string" ||
		typeof (input as { content?: unknown }).content !== "string"
	) {
		throw new Error("Invalid synthetic write input");
	}
	return input as { targetPath: string; content: string };
}

describe("WP7 deterministic mock acceptance", () => {
	it("composes the unified console without network calls or customer data", async () => {
		const router = new TalosPageRouter("overview");
		expect(router.current()).toEqual({ primary: "workbench" });
		expect(router.renderKey()).toBe("overview");

		const vault = new MemoryVault(loadFixture(fixtureRoot));
		const canonicalProjectionBefore = await vault.read(
			".talos/command-requests/talos-ask.json"
		);
		const canonical = await new CanonicalRegistryReader({
			read: (path) => vault.read(path),
		}).read();
		expect(canonical.commands).toHaveLength(13);
		expect(canonical.talosAsk).toMatchObject({
			id: "talos-ask",
			requestPath: ".talos/command-requests/talos-ask.json",
		});
		expect(await vault.read(CANONICAL_REGISTRY_PATH)).toContain("talos-ask");

		const taskStore = new MemoryTaskStore();
		const recoveryStore = new MemoryRecoveryStore();
		const transitions = new Map<string, string[]>();
		taskStore.subscribe((task) => {
			const states = transitions.get(task.idempotencyKey) ?? [];
			states.push(task.state);
			transitions.set(task.idempotencyKey, states);
		});
		const actionRegistry = createBuiltinActionRegistry({
			refreshStats: async () => ({ refreshed: true }),
			vaultLint: async () => ({ issues: 0 }),
			deepResearch: async () => ({ mocked: true }),
			createNote: async (input) => {
				const note = noteInput(input);
				await vault.write(note.targetPath, note.content);
				return { path: note.targetPath };
			},
			publishBackfill: async (input) => {
				const note = noteInput(input);
				await vault.write(note.targetPath, note.content);
				return { path: note.targetPath, published: false };
			},
			decideApproval: async () => ({ decided: true }),
			decidePreference: async () => ({ decided: true }),
		});
		const runner = new TalosTaskRunner(
			actionRegistry,
			taskStore,
			recoveryStore,
			nodeTimers
		);

		const bTask = await runner.run({
			actionId: "create-note",
			idempotencyKey: "wp7-b-one-click",
			input: {
				targetPath: "30 洞察/B类动作.md",
				content: "WP7 synthetic B-class result",
			},
			request: {
				readPaths: [],
				writePaths: ["30 洞察/B类动作.md"],
				effects: ["write"],
			},
		});
		expect(transitions.get("wp7-b-one-click")).toEqual([
			"ready",
			"queued",
			"running",
			"completed",
		]);
		expect(bTask).toMatchObject({
			state: "completed",
			approvalRequired: false,
			riskDecision: "snapshot-and-run",
		});
		expect(bTask.recoveryId).toBeTruthy();
		expect(recoveryStore.get(bTask.recoveryId ?? "")?.targetPaths).toEqual([
			"30 洞察/B类动作.md",
		]);

		const approvalTarget = "70 输出/批准后写入.md";
		const writesBeforeProposal = vault.writes.length;
		const proposal = await runner.run({
			actionId: "publish-backfill",
			idempotencyKey: "wp7-c-proposal",
			input: {
				targetPath: approvalTarget,
				content: "WP7 synthetic approved result",
			},
			request: {
				readPaths: ["50 工作流/待审批.md"],
				writePaths: [approvalTarget],
				effects: ["external-publish"],
			},
		});
		expect(proposal).toMatchObject({
			state: "ready",
			approvalRequired: true,
		});
		expect(vault.writes).toHaveLength(writesBeforeProposal);

		const approved = await runner.run({
			actionId: "publish-backfill",
			idempotencyKey: "wp7-c-approved",
			approvalGranted: true,
			input: {
				targetPath: approvalTarget,
				content: "WP7 synthetic approved result",
			},
			request: {
				readPaths: ["50 工作流/待审批.md"],
				writePaths: [approvalTarget],
				effects: ["external-publish"],
			},
		});
		expect(approved.state).toBe("completed");
		expect(await vault.read(approvalTarget)).toBe(
			"WP7 synthetic approved result"
		);

		for (const [intent, title] of [
			["knowledge", "合成洞察"],
			["output", "合成输出"],
		] as const) {
			const writeback = proposeAnswerWriteback({
				intent,
				title,
				content: `WP7 synthetic ${intent} writeback`,
			});
			expect(writeback?.approvalRequired).toBe(true);
			if (!writeback) throw new Error("Missing writeback proposal");
			await runner.run({
				actionId: "create-note",
				idempotencyKey: `wp7-writeback-${intent}`,
				approvalGranted: true,
				input: {
					targetPath: writeback.targetPath,
					content: writeback.content,
				},
				request: {
					readPaths: [],
					writePaths: [writeback.targetPath],
					effects: ["write"],
				},
			});
		}
		expect(vault.writes).toEqual(
			expect.arrayContaining([
				"30 洞察/合成洞察.md",
				"70 输出/合成输出.md",
			])
		);

		const retriever = new VaultRetriever(vault, { maxExcerptChars: 500 });
		const retrieval = await retriever.retrieve({ query: "WP7 synthetic" });
		const retrievedPaths = retrieval.hits.map((hit) => hit.path);
		expect(retrievedPaths).toEqual(
			expect.arrayContaining([
				"00 收件箱/输入.md",
				"10 身份/候选信息.md",
				"10 身份/推断信息.md",
				"20 知识/架构.md",
				"30 洞察/既有洞察.md",
				"40 项目/WP7.md",
				"50 工作流/例行流程.md",
				"60 素材/参考.md",
				"70 输出/既有输出.md",
				"90 归档/历史.md",
			])
		);
		expect(retrieval.blocked).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: ".env.fixture" }),
				expect.objectContaining({
					path: ".talos/private/mock-provider.json",
				}),
			])
		);

		const providerFixture: AskEvent[][] = [
			[
				{ type: "text", text: "synthetic answer" },
				{
					type: "tool-request",
					toolCallId: "write-proposal",
					name: "Write",
					input: {
						file_path: "70 输出/mock-answer.md",
						content: "synthetic draft",
					},
				},
				{
					type: "tool-result",
					toolCallId: "write-proposal",
					output: "approval required",
					isError: true,
				},
				{ type: "done" },
			],
		];
		const alpha = new RecordingMockProvider("mock-alpha", providerFixture);
		const beta = new RecordingMockProvider("mock-beta", [
			[
				{ type: "text", text: "synthetic switched answer" },
				{ type: "done" },
			],
		]);
		const facade = new ProviderFacade(() => 100);
		facade.register(alpha);
		facade.register(beta);
		const toolProposals: string[] = [];
		const audits: Array<{ blockedReasons: string[] }> = [];
		const ask = new TalosAskService({
			facade,
			retriever,
			manualReview: () => true,
			auditSink: (record) => {
				audits.push({ blockedReasons: record.audit.blockedReasons });
			},
			toolGateway: {
				async propose(input) {
					toolProposals.push(`${input.namespace}:${input.toolCallId}`);
					return { taskId: `proposal-${toolProposals.length}` };
				},
			},
		});

		await collect(
			ask.ask({
				sessionId: "shared",
				namespace: "chat",
				runId: "wp7-chat-alpha",
				turnId: "turn-chat-alpha",
				providerId: "mock-alpha",
				query: "WP7 synthetic",
			})
		);
		await collect(
			ask.ask({
				sessionId: "shared",
				namespace: "voice",
				runId: "wp7-voice-alpha",
				turnId: "turn-voice-alpha",
				providerId: "mock-alpha",
				query: "WP7 synthetic",
			})
		);
		await collect(
			ask.ask({
				sessionId: "shared",
				namespace: "chat",
				runId: "wp7-chat-beta",
				turnId: "turn-chat-beta",
				providerId: "mock-beta",
				query: "WP7 synthetic",
			})
		);
		const reviewEvents = await collect(
			ask.review("wp7-chat-alpha", "mock-alpha")
		);

		expect(alpha.requests[0]?.sessionId).toBe("chat:shared");
		expect(alpha.requests[1]?.sessionId).toBe("voice:shared");
		expect(facade.getSession("chat:shared").switchPoints).toEqual([
			expect.objectContaining({
				fromProviderId: "mock-alpha",
				toProviderId: "mock-beta",
				atTurnId: "turn-chat-beta",
			}),
		]);
		expect(toolProposals).toEqual([
			"chat:write-proposal",
			"voice:write-proposal",
		]);
		expect(reviewEvents).toContainEqual({
			type: "tool-skipped",
			toolCallId: "write-proposal",
			reason: "review-mode",
		});
		expect(reviewEvents.some((event) => event.type === "tool-request")).toBe(
			false
		);
		expect(alpha.requests[0]?.text).toContain("10 身份/候选信息.md");
		expect(alpha.requests[0]?.text).toContain("10 身份/推断信息.md");
		const fakeSecret = await vault.read(".env.fixture");
		const privatePayload = await vault.read(
			".talos/private/mock-provider.json"
		);
		expect(
			[...alpha.requests, ...beta.requests].some(
				(request) =>
					request.text.includes(fakeSecret.trim()) ||
					request.text.includes(privatePayload.trim())
			)
		).toBe(false);
		expect(audits.every((audit) => audit.blockedReasons.length === 0)).toBe(
			true
		);

		let voicePersistence = "";
		const voiceStore = new VoiceSessionStore(
			{
				read: () => voicePersistence,
				write: (value) => {
					voicePersistence = value;
				},
			},
			() => 200
		);
		await voiceStore.appendMessage({
			id: "voice-only",
			role: "user",
			text: "WP7 synthetic voice turn",
			modality: "speech",
			createdAt: 200,
		});
		expect(voiceStore.snapshot()).toMatchObject({
			namespace: "voice",
			messages: [{ id: "voice-only", modality: "speech" }],
		});
		expect(voicePersistence).not.toContain("chat:shared");

		expect(await vault.read(".talos/command-requests/talos-ask.json")).toBe(
			canonicalProjectionBefore
		);
		expect(vault.writes).not.toContain(
			".talos/command-requests/talos-ask.json"
		);
	});
});
