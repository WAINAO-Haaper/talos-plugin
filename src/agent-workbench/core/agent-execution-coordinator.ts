import type { AgentEvent } from "../contracts/agent-events";
import type { ConversationManifest } from "../contracts/conversation";
import type { AgentExecutionRequest } from "../contracts/execution-request";
import { executionText, runtimePrompt } from "../contracts/execution-request";
import type {
	AgentRuntimeAdapter,
	NativeSessionBinding,
	RuntimeId,
	RuntimeTurn,
} from "../contracts/runtime-adapter";
import {
	ConversationInputLedger,
	createConversationInputRecord,
} from "../storage/conversation-input-ledger";
import type { WorkbenchConversationCoordinator } from "./workbench-conversation-coordinator";

export interface AgentExecutionInteractions {
	approve?(event: AgentEvent): Promise<"allow" | "allow-always" | "deny" | "cancel">;
	answer?(event: AgentEvent): Promise<Record<string, string | string[]> | null>;
}

export interface AgentExecutionCoordinatorOptions {
	conversations: WorkbenchConversationCoordinator;
	ledger: ConversationInputLedger;
	vaultRoot: string;
	createRuntime(
		runtimeId: RuntimeId,
		conversationId: string,
		selection: ConversationManifest["selection"],
	): Promise<AgentRuntimeAdapter>;
	initialContext?(): string | undefined;
	preflightEgress?(input: {
		runtimeId: RuntimeId;
		conversationId: string;
		prompt: string;
		history?: RuntimeTurn["history"];
		context?: RuntimeTurn["context"];
		hasImages: boolean;
	}): Promise<{ allowed: boolean; message?: string }>;
	onRuntimeInvalidated?(runtimeId: RuntimeId, error: unknown): void;
}

const TRANSIENT_RUNTIME_EVENTS = new Set<AgentEvent["type"]>([
	"assistant.delta",
	"thinking.delta",
	"tool.updated",
	"usage.updated",
]);

function shouldPersistRuntimeEvent(event: AgentEvent): boolean {
	return !TRANSIENT_RUNTIME_EVENTS.has(event.type);
}

interface RuntimeLease {
	key: string;
	conversationId: string;
	runtimeId: RuntimeId;
	providerProfileId?: string;
	runtime: AgentRuntimeAdapter;
	binding: NativeSessionBinding;
	generation: number;
	seenEventIds: Set<string>;
	seenNativeEventKeys: Set<string>;
}

interface ActiveExecution {
	conversationId: string;
	turnId: string;
	leaseKey: string;
	generation: number;
	abort: AbortController;
}

function leaseKey(conversationId: string, runtimeId: RuntimeId, providerProfileId?: string): string {
	return `${conversationId}:${runtimeId}:${providerProfileId ?? "native"}`;
}

function titleFromText(value: string): string {
	const line = value.replace(/\s+/g, " ").trim();
	if (!line) return "图片会话";
	return line.length > 42 ? `${line.slice(0, 42)}…` : line;
}

function providerErrorMessage(event: AgentEvent): string {
	if (typeof event.payload.message === "string") return event.payload.message;
	const error = event.payload.error;
	if (error && typeof error === "object" && !Array.isArray(error) && typeof (error as Record<string, unknown>).message === "string") {
		return (error as Record<string, unknown>).message as string;
	}
	return "Provider 回合失败";
}

/**
 * TALOS-owned requested-turn coordinator.
 *
 * It stages local input before provider handoff, accepts it only after the
 * provider produces the first event, and fences every late event by the
 * conversation, lease generation and turn identity that created it.
 */
export class AgentExecutionCoordinator {
	private readonly leases = new Map<string, RuntimeLease>();
	private readonly active = new Map<string, ActiveExecution>();
	private readonly preparing = new Map<string, AbortController>();
	private nextGeneration = 0;
	disposed = false;

	constructor(private readonly options: AgentExecutionCoordinatorOptions) {}

	hasActiveTurn(conversationId: string): boolean {
		return this.active.has(conversationId) || this.preparing.has(conversationId);
	}

	private assertAvailable(): void {
		if (this.disposed) throw new Error("TALOS 执行协调器已释放");
	}

	private isCurrent(execution: ActiveExecution): boolean {
		const current = this.active.get(execution.conversationId);
		const lease = this.leases.get(execution.leaseKey);
		return current === execution && lease?.generation === execution.generation;
	}

	private async invalidateLease(lease: RuntimeLease, error: unknown): Promise<void> {
		if (this.leases.get(lease.key) === lease) this.leases.delete(lease.key);
		await this.options.conversations.clearBinding(
			lease.conversationId,
			lease.runtimeId,
			lease.providerProfileId,
		).catch(() => undefined);
		await lease.runtime.dispose().catch(() => undefined);
		this.options.onRuntimeInvalidated?.(lease.runtimeId, error);
	}

	private async releaseLease(lease: RuntimeLease): Promise<void> {
		if (this.leases.get(lease.key) !== lease) return;
		this.leases.delete(lease.key);
		await lease.runtime.dispose().catch(() => undefined);
	}

	private async acquireLease(
		conversation: ConversationManifest,
		selection: ConversationManifest["selection"],
	): Promise<RuntimeLease> {
		const key = leaseKey(conversation.conversationId, selection.runtimeId, selection.providerProfileId);
		const existing = this.leases.get(key);
		if (existing) return existing;
		let runtime = await this.options.createRuntime(selection.runtimeId, conversation.conversationId, selection);
		let binding = await this.options.conversations.getBinding(
			conversation.conversationId,
			selection.runtimeId,
			selection.providerProfileId,
		);
		if (binding) {
			try {
				await runtime.resumeSession(binding);
			} catch {
				await runtime.dispose().catch(() => undefined);
				await this.options.conversations.clearBinding(
					conversation.conversationId,
					selection.runtimeId,
					selection.providerProfileId,
				).catch(() => undefined);
				runtime = await this.options.createRuntime(selection.runtimeId, conversation.conversationId, selection);
				binding = null;
			}
		}
		if (!binding) {
			binding = await runtime.createSession({
				conversationId: conversation.conversationId,
				vaultRoot: this.options.vaultRoot,
				model: selection.model,
				providerProfileId: selection.providerProfileId,
				initialContext: this.options.initialContext?.(),
			});
			await this.options.conversations.setBinding(conversation.conversationId, binding);
		}
		const lease: RuntimeLease = {
			key,
			conversationId: conversation.conversationId,
			runtimeId: selection.runtimeId,
			providerProfileId: selection.providerProfileId,
			runtime,
			binding,
			generation: ++this.nextGeneration,
			seenEventIds: new Set(),
			seenNativeEventKeys: new Set(),
		};
		this.leases.set(key, lease);
		return lease;
	}

	async *execute(
		conversation: ConversationManifest,
		request: AgentExecutionRequest,
		interactions: AgentExecutionInteractions = {},
	): AsyncGenerator<AgentEvent> {
		this.assertAvailable();
		const displayText = executionText(request.input);
		if (!displayText && !request.input.some((block) => block.type === "image")) {
			throw new Error("消息或图片不能为空");
		}
		const conversationId = conversation.conversationId;
		if (this.active.has(conversationId) || this.preparing.has(conversationId)) {
			throw new Error("当前会话已有回合正在执行");
		}
		const abort = new AbortController();
		const relayAbort = () => abort.abort(request.signal?.reason);
		if (request.signal?.aborted) abort.abort(request.signal.reason);
		else request.signal?.addEventListener("abort", relayAbort, { once: true });
		this.preparing.set(conversationId, abort);
		const prepared = await (async () => {
			try {
				const model = request.model ?? conversation.selection.model;
				const reasoning = request.reasoning ?? conversation.selection.reasoning;
				const serviceTier = request.serviceTier ?? conversation.selection.serviceTier;
				const selection: ConversationManifest["selection"] = {
					runtimeId: conversation.selection.runtimeId,
					...(conversation.selection.providerProfileId ? { providerProfileId: conversation.selection.providerProfileId } : {}),
					...(model ? { model } : {}),
					...(reasoning ? { reasoning } : {}),
					...(serviceTier ? { serviceTier } : {}),
				};
				if (JSON.stringify(conversation.selection) !== JSON.stringify(selection)) {
					conversation = { ...conversation, selection, updatedAt: new Date().toISOString() };
					await this.options.conversations.conversations.store.updateManifest(conversation);
				}
				const recordId = crypto.randomUUID();
				const turnId = crypto.randomUUID();
				const turn: RuntimeTurn = {
					conversationId,
					turnId,
					input: request.input,
					text: displayText,
					context: request.context,
					history: request.history,
					model: request.model ?? selection.model,
					reasoning: request.reasoning ?? selection.reasoning,
					serviceTier: request.serviceTier ?? selection.serviceTier,
					workflow: request.workflow,
					permissionMode: request.permissionMode,
					toolPolicy: request.toolPolicy,
				};
				const preflight = await this.options.preflightEgress?.({
					runtimeId: selection.runtimeId,
					conversationId,
					prompt: runtimePrompt(turn),
					history: request.history,
					context: request.context,
					hasImages: request.input.some((block) => block.type === "image"),
				});
				if (preflight && !preflight.allowed) throw new Error(preflight.message ?? "Provider 出库隐私审计未通过");
				if (abort.signal.aborted) return null;
				const staged = createConversationInputRecord({
					recordId,
					conversationId,
					turnId,
					runtimeId: selection.runtimeId,
					createdAt: new Date().toISOString(),
					displayText,
					blocks: request.input,
					context: request.context,
				});
				await this.options.ledger.stage(staged);
				let lease: RuntimeLease;
				try {
					lease = await this.acquireLease(conversation, selection);
				} catch (error) {
					await this.options.ledger.discard(recordId).catch(() => undefined);
					throw error;
				}
				if (abort.signal.aborted) {
					await this.options.ledger.discard(recordId).catch(() => undefined);
					await this.releaseLease(lease);
					return null;
				}
				const execution: ActiveExecution = {
					conversationId,
					turnId,
					leaseKey: lease.key,
					generation: lease.generation,
					abort,
				};
				this.active.set(conversationId, execution);
				return { selection, recordId, turnId, turn, staged, lease, execution };
			} catch (error) {
				request.signal?.removeEventListener("abort", relayAbort);
				if (abort.signal.aborted) return null;
				throw error;
			} finally {
				if (this.preparing.get(conversationId) === abort) this.preparing.delete(conversationId);
			}
		})();
		if (!prepared) {
			request.signal?.removeEventListener("abort", relayAbort);
			return;
		}
		const { selection, recordId, turnId, turn, staged, lease, execution } = prepared;
		let accepted = false;
		let finished = false;
		let providerFailure: AgentEvent | null = null;
		turn.signal = abort.signal;

		try {
			for await (const nativeEvent of lease.runtime.send(turn)) {
				if (!this.isCurrent(execution)) continue;
				if (nativeEvent.conversationId !== conversationId || nativeEvent.turnId !== turnId || nativeEvent.runtimeId !== selection.runtimeId) continue;
				if (lease.seenEventIds.has(nativeEvent.eventId)) continue;
				const nativeEventKey = nativeEvent.nativeId
					? `${nativeEvent.type}:${nativeEvent.nativeId}`
					: null;
				if (nativeEventKey && lease.seenNativeEventKeys.has(nativeEventKey)) continue;
				lease.seenEventIds.add(nativeEvent.eventId);
				if (nativeEventKey) lease.seenNativeEventKeys.add(nativeEventKey);
				if (!accepted) {
					accepted = true;
					await this.options.ledger.accept(recordId, {
						acceptedAt: new Date().toISOString(),
						nativeUserMessageId: nativeEvent.nativeId || undefined,
					});
					const userEvent = await this.options.conversations.appendUser({
						conversationId: conversation.conversationId,
						turnId,
						runtimeId: selection.runtimeId,
						text: displayText || "[图片]",
						vaultRoot: this.options.vaultRoot,
						metadata: {
							recordId,
							images: staged.images,
							contextPaths: staged.contextPaths,
						},
					});
					yield userEvent;
					const startEvent = await this.options.conversations.conversations.append({
						conversationId: conversation.conversationId,
						turnId,
						runtimeId: selection.runtimeId,
						type: "assistant.start",
						payload: {
							sessionInstanceId: lease.key,
							executionGeneration: lease.generation,
							recordId,
						},
					});
					yield startEvent;
					if (conversation.title === "新会话") {
						await this.options.conversations.conversations.rename(conversation.conversationId, titleFromText(displayText));
					}
				}
				if (shouldPersistRuntimeEvent(nativeEvent)) {
					await this.options.conversations.appendRuntimeEvent(
						conversation.conversationId,
						nativeEvent,
						this.options.vaultRoot,
					);
				}
				yield nativeEvent;
				if (nativeEvent.type === "approval.requested") {
					const decision = await interactions.approve?.(nativeEvent) ?? "deny";
					if (nativeEvent.nativeId && lease.runtime.respondApproval) {
						await lease.runtime.respondApproval({ requestId: nativeEvent.nativeId, decision });
					}
					const resolved = await this.options.conversations.conversations.append({
						conversationId: conversation.conversationId,
						turnId,
						runtimeId: selection.runtimeId,
						type: "approval.resolved",
						payload: { requestEventId: nativeEvent.eventId, decision },
					});
					yield resolved;
				}
				if (nativeEvent.type === "user.question") {
					const answers = await interactions.answer?.(nativeEvent) ?? null;
					if (nativeEvent.nativeId && lease.runtime.respondUserInput) {
						await lease.runtime.respondUserInput({ requestId: nativeEvent.nativeId, answers });
					}
				}
				if (nativeEvent.type === "error") { providerFailure = nativeEvent; finished = true; break; }
				if (nativeEvent.type === "turn.finished") { finished = true; break; }
			}
			if (!accepted) {
				await this.options.ledger.discard(recordId);
				throw new Error("运行时未接受本次输入");
			}
			if (providerFailure) {
				await this.invalidateLease(lease, new Error(providerErrorMessage(providerFailure)));
				return;
			}
			if (!finished) {
				const terminal = await this.options.conversations.conversations.append({
					conversationId: conversation.conversationId,
					turnId,
					runtimeId: selection.runtimeId,
					type: "turn.finished",
					payload: { status: abort.signal.aborted ? "cancelled" : "completed", synthesized: true },
				});
				yield terminal;
			}
		} catch (error) {
			if (!accepted) await this.options.ledger.discard(recordId).catch(() => undefined);
			if (abort.signal.aborted) {
				if (accepted && !finished) {
					const terminal = await this.options.conversations.conversations.append({
						conversationId: conversation.conversationId,
						turnId,
						runtimeId: selection.runtimeId,
						type: "turn.finished",
						payload: { status: "cancelled", synthesized: true },
					});
					yield terminal;
				}
				return;
			}
			await this.invalidateLease(lease, error);
			const message = error instanceof Error ? error.message : String(error);
			const errorEvent = await this.options.conversations.conversations.append({
				conversationId: conversation.conversationId,
				turnId,
				runtimeId: selection.runtimeId,
				type: "error",
				payload: { message, recoverable: true, accepted },
			});
			yield errorEvent;
		} finally {
			request.signal?.removeEventListener("abort", relayAbort);
			await this.releaseLease(lease);
			if (this.active.get(conversation.conversationId) === execution) {
				this.active.delete(conversation.conversationId);
			}
		}
	}

	async cancel(conversationId: string, reason = "user"): Promise<void> {
		this.preparing.get(conversationId)?.abort(reason);
		const active = this.active.get(conversationId);
		if (!active) return;
		active.abort.abort(reason);
		await this.leases.get(active.leaseKey)?.runtime.cancel(reason);
	}

	async steer(conversationId: string, text: string): Promise<boolean> {
		const active = this.active.get(conversationId);
		const runtime = active ? this.leases.get(active.leaseKey)?.runtime : null;
		if (!active || !runtime?.steer) return false;
		const preflight = await this.options.preflightEgress?.({
			runtimeId: runtime.id,
			conversationId,
			prompt: text,
			hasImages: false,
		});
		if (preflight && !preflight.allowed) throw new Error(preflight.message ?? "Provider 出库隐私审计未通过");
		await runtime.steer({ turnId: active.turnId, text });
		return true;
	}

	async compact(conversationId: string): Promise<boolean> {
		const projection = await this.options.conversations.conversations.store.load(conversationId);
		const selection = projection.manifest.selection;
		const lease = await this.acquireLease(projection.manifest, selection);
		try {
			if (!lease.runtime.compact) return false;
			await lease.runtime.compact({ binding: lease.binding });
			return true;
		} finally {
			await this.releaseLease(lease);
		}
	}

	async fork(conversation: ConversationManifest): Promise<NativeSessionBinding | null> {
		const lease = await this.acquireLease(conversation, conversation.selection);
		try {
			if (!lease.runtime.fork) return null;
			return await lease.runtime.fork({ binding: lease.binding });
		} finally {
			// Some native runtimes switch their process to the branch as part of fork.
			// Releasing the shared process keeps source and target bindings independent.
			await this.releaseLease(lease);
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const abort of this.preparing.values()) abort.abort("plugin-unload");
		this.preparing.clear();
		for (const execution of this.active.values()) execution.abort.abort("plugin-unload");
		this.active.clear();
		const leases = [...this.leases.values()];
		this.leases.clear();
		await Promise.all(leases.map((lease) => lease.runtime.dispose().catch(() => undefined)));
	}
}
