import { assembleVaultContext } from "./context/context-assembler";
import type {
	VaultRetrievalInput,
	VaultRetrievalResult,
} from "./context/vault-retrieval";
import type { ProviderFacade } from "./provider/provider-facade";
import type { AskEvent } from "./provider/types";
import {
	auditProviderEgress,
} from "./privacy/provider-egress-gate";
import type { ProviderEgressAuditAppendInput } from "./privacy/provider-egress-audit-store";
import type {
	TalosSchemaKey,
	TalosVaultSchema,
} from "../data/schema";

export type AskNamespace = "chat" | "voice" | "command";

export interface AskInput extends VaultRetrievalInput {
	sessionId: string;
	namespace: AskNamespace;
	runId: string;
	turnId: string;
	providerId: string;
	query: string;
}

export interface ToolProposalInput {
	runId: string;
	turnId: string;
	sessionId: string;
	namespace: AskNamespace;
	providerId: string;
	toolCallId: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolProposalGateway {
	propose(input: ToolProposalInput): Promise<{ taskId: string }>;
}

export interface AskRetriever {
	retrieve(input: VaultRetrievalInput): Promise<VaultRetrievalResult>;
}

export interface TalosAskServiceOptions {
	facade: ProviderFacade;
	retriever: AskRetriever;
	toolGateway: ToolProposalGateway;
	manualReview: () => boolean;
	vaultAccess?: () => "full" | "denied";
	moduleAccess?: (
		providerId: string
	) => Partial<Record<TalosSchemaKey, boolean>>;
	vaultSchema?: () => Partial<TalosVaultSchema>;
	auditSink?: (
		record: ProviderEgressAuditAppendInput
	) => void | Promise<void>;
	configDir?: string;
}

interface RunRecord {
	sessionKey: string;
	runId: string;
	turnId: string;
	providerId: string;
	text: string;
}

export class TalosAskService {
	private readonly sessions = new Map<string, string>();
	private readonly proposedTools = new Map<string, Set<string>>();
	private readonly runs = new Map<string, RunRecord>();

	constructor(private readonly options: TalosAskServiceOptions) {}

	async *ask(input: AskInput): AsyncIterable<AskEvent> {
		const sessionKey = `${input.namespace}:${input.sessionId}`;
		const activeProvider = this.sessions.get(sessionKey);
		if (!activeProvider) {
			this.options.facade.createSession({
				sessionId: sessionKey,
				providerId: input.providerId,
			});
			this.sessions.set(sessionKey, input.providerId);
		} else if (activeProvider !== input.providerId) {
			this.options.facade.switchProvider(
				sessionKey,
				input.providerId,
				input.turnId
			);
			this.sessions.set(sessionKey, input.providerId);
		}

		const retrieval = await this.options.retriever.retrieve({
			query: input.query,
			attachmentPaths: input.attachmentPaths,
			currentPath: input.currentPath,
			engineResultPaths: input.engineResultPaths,
			recentConfirmedPaths: input.recentConfirmedPaths,
		});
		const assembled = assembleVaultContext(input.query, retrieval, {
			configDir: this.options.configDir,
		});
		const egress = await auditProviderEgress({
			providerId: input.providerId,
			vaultAccess: this.options.vaultAccess?.() ?? "full",
			paths: assembled.usedPaths,
			text: assembled.text,
			moduleAccess: this.options.moduleAccess?.(input.providerId),
			vaultSchema: this.options.vaultSchema?.(),
			configDir: this.options.configDir,
		});
		await this.options.auditSink?.({
			runId: input.runId,
			turnId: input.turnId,
			sessionId: sessionKey,
			namespace: input.namespace,
			audit: egress.audit,
		});
		if (!egress.allowed) {
			yield {
				type: "error",
				message: "Provider 出库隐私审计未通过",
				retryable: false,
			};
			yield { type: "done", sessionId: sessionKey };
			return;
		}
		this.runs.set(input.runId, {
			sessionKey,
			runId: input.runId,
			turnId: input.turnId,
			providerId: input.providerId,
			text: egress.redactedText,
		});

		const proposed =
			this.proposedTools.get(sessionKey) ?? new Set<string>();
		this.proposedTools.set(sessionKey, proposed);
		const manualReview = this.options.manualReview();
		for await (const event of this.options.facade.chat(sessionKey, {
			runId: input.runId,
			turnId: input.turnId,
			text: egress.redactedText,
			toolsAllowed: !manualReview,
		})) {
			if (
				event.type === "tool-request" &&
				manualReview &&
				!proposed.has(event.toolCallId)
			) {
				proposed.add(event.toolCallId);
				await this.options.toolGateway.propose({
					runId: input.runId,
					turnId: input.turnId,
					sessionId: sessionKey,
					namespace: input.namespace,
					providerId: input.providerId,
					toolCallId: event.toolCallId,
					name: event.name,
					input: event.input,
				});
			}
			yield event;
		}
	}

	async *review(
		runId: string,
		providerId: string
	): AsyncIterable<AskEvent> {
		const run = this.runs.get(runId);
		if (!run) throw new Error(`Ask run "${runId}" does not exist`);
		yield* this.options.facade.reviewTurn(run.sessionKey, providerId, {
			runId: `${runId}:review`,
			turnId: `${run.turnId}:review`,
			reviewOfTurnId: run.turnId,
			text: `请独立复核以下问答上下文，不执行工具：\n\n${run.text}`,
			toolsAllowed: false,
		});
	}
}
