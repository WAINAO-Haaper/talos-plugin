import type { PermissionMode, WorkflowMode } from "../contracts/approval";
import type { ProviderProfile, RuntimeProfile } from "../contracts/provider-profile";
import { validateProviderProfile } from "../contracts/provider-profile";
import type { AgentRuntimeAdapter, ModelDescriptor, RuntimeId, RuntimeProbe } from "../contracts/runtime-adapter";
import { RuntimeRegistry } from "./runtime-registry";
import type { ApprovalBroker } from "../security/approval-broker";
import { normalizeToolAction } from "../security/tool-action-normalizer";
import type { RuntimeSelection, WorkbenchSettings, WorkbenchSettingsStore } from "../storage/workbench-settings-store";
import type { WorkbenchConversationCoordinator } from "./workbench-conversation-coordinator";
import { createAgentEvent, type AgentEvent } from "../contracts/agent-events";
import type { ConversationManifest, ConversationProjection, ConversationSelection } from "../contracts/conversation";
import type { AgentExecutionRequest } from "../contracts/execution-request";
import { projectMessages } from "../storage/conversation-projection";
import type { ConversationInputLedger } from "../storage/conversation-input-ledger";
import type { WorkbenchUiState, WorkbenchUiStateStore } from "../storage/workbench-ui-state-store";
import {
	AgentExecutionCoordinator,
	type AgentExecutionInteractions,
	type AgentExecutionCoordinatorOptions,
} from "./agent-execution-coordinator";

export interface AgentWorkbenchServiceOptions {
	runtimes?: AgentRuntimeAdapter[];
	probeRuntime?: (runtimeId: RuntimeId, profile?: RuntimeProfile, signal?: AbortSignal) => Promise<RuntimeProbe>;
	listModels?: (runtimeId: RuntimeId, provider?: ProviderProfile, signal?: AbortSignal) => Promise<ModelDescriptor[]>;
	createRuntime?: (runtimeId: RuntimeId, input: {
		vaultRoot: string;
		permissionMode?: PermissionMode;
		runtimeProfile?: RuntimeProfile;
		providerProfile?: ProviderProfile;
		model?: string;
		approve: (toolName: string, input: Record<string, unknown>, metadata?: Record<string, unknown>) => Promise<"allow" | "allow-always" | "deny">;
		answerQuestion?: (input: Record<string, unknown>, metadata: { requestId: string; toolUseId: string; signal?: AbortSignal }) => Promise<Record<string, string | string[]> | null>;
	}) => Promise<AgentRuntimeAdapter>;
	approvalBroker?: ApprovalBroker;
	settingsStore?: WorkbenchSettingsStore;
	conversationCoordinator?: WorkbenchConversationCoordinator;
	inputLedger?: ConversationInputLedger;
	uiStateStore?: WorkbenchUiStateStore;
	vaultRoot?: string;
	preflightEgress?: AgentExecutionCoordinatorOptions["preflightEgress"];
	onPersistenceError?: (error: unknown) => void;
}

export interface AgentWorkbenchInteractionPort {
	approveAction(input: {
		conversationId: string;
		runtimeId: RuntimeId;
		toolName: string;
		toolInput: Record<string, unknown>;
		reason: string;
		options?: Record<string, unknown>;
	}): Promise<"allow" | "allow-always" | "deny" | "cancel">;
	answerQuestion(event: AgentEvent): Promise<Record<string, string | string[]> | null>;
}

/**
 * TALOS-owned composition root for the agent workbench.
 *
 * Provider, session, permission and UI ownership all terminate here.
 */
export class AgentWorkbenchService {
	readonly runtimes: RuntimeRegistry;
	private initialized = false;
	private disposed = false;
	private selectedRuntimeId: RuntimeId = "codex";
	private selectedProviderProfileId: string | undefined;
	private selectedModel: string | undefined;
	private selectedReasoning: string | undefined;
	private selectedServiceTier: string | undefined;
	private workflow: WorkflowMode = "plan";
	private permission: PermissionMode = "ask";
	private settings: WorkbenchSettings | null = null;
	private persistence = Promise.resolve();
	private readonly execution: AgentExecutionCoordinator | null;
	private interactionPort: AgentWorkbenchInteractionPort | null = null;
	private systemContext = "";

	constructor(private readonly options: AgentWorkbenchServiceOptions) {
		this.runtimes = new RuntimeRegistry(options.runtimes ?? []);
		this.execution = options.conversationCoordinator && options.inputLedger && options.vaultRoot
			? new AgentExecutionCoordinator({
				conversations: options.conversationCoordinator,
				ledger: options.inputLedger,
				vaultRoot: options.vaultRoot,
				initialContext: () => this.systemContext || undefined,
				preflightEgress: options.preflightEgress,
				createRuntime: (runtimeId, conversationId, selection) => this.createRuntime(runtimeId, {
					vaultRoot: options.vaultRoot!,
					permissionMode: this.permission,
					approve: async (toolName, toolInput, metadata = {}) => {
						metadata = { ...metadata, conversationId };
						const approvalUiAttached = Boolean(
							this.interactionPort && this.execution?.hasActiveTurn(conversationId),
						);
						const selected = await this.authorizeTool({
							runtimeId,
							conversationId,
							vaultRoot: options.vaultRoot!,
							providerProfileId: selection.providerProfileId,
							toolName,
							toolInput,
							providerEgressRequest: metadata.reason === "provider-egress-proxy",
							approvalUiAttached,
							prompt: async () => {
								const decision = await this.interactionPort?.approveAction({
									conversationId,
									runtimeId,
									toolName,
									toolInput,
									reason: typeof metadata.reason === "string" ? metadata.reason : toolName,
									options: metadata,
								});
								return decision === "cancel" ? "deny" : decision ?? "deny";
							},
						});
						return selected;
					},
					answerQuestion: async (toolInput, metadata) => {
						if (!this.interactionPort || !this.execution?.hasActiveTurn(conversationId)) return null;
						if (metadata.signal?.aborted) return null;
						return this.interactionPort.answerQuestion(createAgentEvent({
							eventId: `claude-question-${crypto.randomUUID()}`,
							conversationId,
							turnId: metadata.toolUseId,
							runtimeId,
							type: "user.question",
							timestamp: new Date().toISOString(),
							nativeId: metadata.requestId,
							payload: toolInput,
						}));
					},
				}, selection),
				onRuntimeInvalidated: (_runtimeId, error) => options.onPersistenceError?.(error),
			})
			: null;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		if (this.disposed) throw new Error("TALOS 智能体工作台已释放");
		if (this.options.settingsStore) {
			this.settings = await this.options.settingsStore.load();
			this.selectedRuntimeId = this.settings.selection.runtimeId;
			this.selectedProviderProfileId = this.settings.selection.providerProfileId;
			this.selectedModel = this.settings.selection.model;
			this.selectedReasoning = this.settings.selection.reasoning;
			this.selectedServiceTier = this.settings.selection.serviceTier;
			this.workflow = this.settings.workflow;
			this.permission = this.settings.permission;
		}
		await this.options.conversationCoordinator?.initialize();
		this.initialized = true;
	}

	isReady(): boolean {
		return this.initialized && !this.disposed;
	}

	getSelectedRuntimeId(): RuntimeId {
		return this.selectedRuntimeId;
	}

	getVaultRoot(): string {
		if (!this.options.vaultRoot) throw new Error("TALOS 智能体 Vault 根目录未配置");
		return this.options.vaultRoot;
	}

	getSelection(): RuntimeSelection {
		return {
			runtimeId: this.selectedRuntimeId,
			...(this.selectedProviderProfileId ? { providerProfileId: this.selectedProviderProfileId } : {}),
			...(this.selectedModel ? { model: this.selectedModel } : {}),
			...(this.selectedReasoning ? { reasoning: this.selectedReasoning } : {}),
			...(this.selectedServiceTier ? { serviceTier: this.selectedServiceTier } : {}),
		};
	}

	restoreSelection(selection: ConversationSelection): void {
		this.selectedRuntimeId = selection.runtimeId;
		const profile = selection.providerProfileId
			? this.getProviderProfiles(selection.runtimeId).find((candidate) => candidate.id === selection.providerProfileId)
			: undefined;
		const missingRequestedProfile = Boolean(selection.providerProfileId && !profile);
		this.selectedProviderProfileId = profile?.id;
		this.selectedModel = missingRequestedProfile || (profile && selection.model && !profile.models.includes(selection.model))
			? undefined
			: selection.model;
		this.selectedReasoning = missingRequestedProfile ? undefined : selection.reasoning;
		this.selectedServiceTier = missingRequestedProfile ? undefined : selection.serviceTier;
		this.queueSettingsSave();
	}

	getProviderProfiles(runtimeId: RuntimeId): ProviderProfile[] {
		return (this.settings?.providers ?? []).filter((profile) => profile.enabled && profile.runtimeId === runtimeId).map((profile) => ({ ...profile, models: [...profile.models] }));
	}

	async syncProviderProfiles(
		profiles: ProviderProfile[],
		managedIds: readonly string[]
	): Promise<void> {
		if (!this.options.settingsStore) return;
		const base = this.settings ?? {
			schemaVersion: 1 as const,
			runtimes: [],
			providers: [],
			selection: { runtimeId: this.selectedRuntimeId },
			workflow: this.workflow,
			permission: this.permission,
		};
		const managed = new Set(managedIds);
		const nextProviders = [
			...base.providers.filter((profile) => !managed.has(profile.id)),
			...profiles.map((profile) => validateProviderProfile(profile)),
		];
		if (JSON.stringify(base.providers) === JSON.stringify(nextProviders)) return;

		const selected = nextProviders.find(
			(profile) =>
				profile.enabled &&
				profile.id === this.selectedProviderProfileId &&
				profile.runtimeId === this.selectedRuntimeId
		);
		if (!selected && this.selectedProviderProfileId) {
			this.selectedProviderProfileId = undefined;
			this.selectedModel = undefined;
			this.selectedReasoning = undefined;
			this.selectedServiceTier = undefined;
		} else if (
			selected &&
			this.selectedModel &&
			!selected.models.includes(this.selectedModel)
		) {
			this.selectedModel = undefined;
			this.selectedReasoning = undefined;
			this.selectedServiceTier = undefined;
		}
		const next: WorkbenchSettings = {
			...base,
			providers: nextProviders,
			selection: this.getSelection(),
		};
		this.settings = next;
		this.persistence = this.persistence
			.then(() => this.options.settingsStore?.save(next))
			.then(() => undefined);
		await this.persistence;
	}

	getSelectedProviderProfile(runtimeId = this.selectedRuntimeId): ProviderProfile | undefined {
		return this.getProviderProfiles(runtimeId).find((profile) => profile.id === this.selectedProviderProfileId);
	}

	getRuntimeProfile(runtimeId: RuntimeId): RuntimeProfile | undefined {
		return this.settings?.runtimes.find((profile) => profile.runtimeId === runtimeId);
	}

	getConversationCoordinator(): WorkbenchConversationCoordinator {
		if (!this.options.conversationCoordinator) throw new Error("统一会话存储未配置");
		return this.options.conversationCoordinator;
	}

	attachInteractionPort(port: AgentWorkbenchInteractionPort | null): void {
		this.interactionPort = port;
	}

	setSystemContext(value: string): void {
		this.systemContext = value.trim();
	}

	loadUiState(): Promise<WorkbenchUiState> {
		return this.options.uiStateStore?.load() ?? Promise.resolve({
			schemaVersion: 1,
			openConversationIds: [],
			historyOpen: false,
		});
	}

	saveUiState(value: WorkbenchUiState): Promise<void> {
		return this.options.uiStateStore?.save(value) ?? Promise.resolve();
	}

	private requireExecution(): AgentExecutionCoordinator {
		if (!this.execution) throw new Error("TALOS 原生执行协调器未配置");
		return this.execution;
	}

	async listConversations(): Promise<ConversationManifest[]> {
		return this.getConversationCoordinator().conversations.store.list();
	}

	async createConversation(title = "新会话"): Promise<ConversationManifest> {
		const conversations = this.getConversationCoordinator().conversations;
		const created = await conversations.create(title, this.selectedRuntimeId);
		const manifest: ConversationManifest = {
			...created,
			selection: this.getSelection(),
			updatedAt: new Date().toISOString(),
		};
		await conversations.store.updateManifest(manifest);
		return manifest;
	}

	async loadConversation(conversationId: string): Promise<ConversationProjection> {
		return this.getConversationCoordinator().conversations.store.load(conversationId);
	}

	async renameConversation(conversationId: string, title: string): Promise<void> {
		await this.getConversationCoordinator().conversations.rename(conversationId, title);
	}

	async setConversationLifecycle(conversationId: string, lifecycle: "active" | "archived" | "deleted"): Promise<void> {
		const conversations = this.getConversationCoordinator().conversations;
		if (lifecycle === "active") await conversations.restore(conversationId);
		else if (lifecycle === "archived") await conversations.archive(conversationId);
		else await conversations.softDelete(conversationId);
	}

	discardEmptyConversation(conversationId: string): Promise<boolean> {
		if (this.execution?.hasActiveTurn(conversationId)) return Promise.resolve(false);
		return this.getConversationCoordinator().conversations.discardEmpty(conversationId);
	}

	async switchConversationRuntime(conversationId: string, runtimeId: RuntimeId, model?: string): Promise<boolean> {
		const coordinator = this.getConversationCoordinator();
		const previous = this.getSelection();
		this.selectRuntime(runtimeId, model);
		const targetSelection = this.getSelection();
		try {
			const handoffCreated = await coordinator.switchRuntime(conversationId, runtimeId);
			const projection = await coordinator.conversations.store.load(conversationId);
			await coordinator.conversations.store.updateManifest({
				...projection.manifest,
				selection: targetSelection,
				updatedAt: new Date().toISOString(),
			});
			return handoffCreated;
		} catch (error) {
			if (JSON.stringify(this.getSelection()) === JSON.stringify(targetSelection)) {
				this.restoreSelection(previous);
			}
			throw error;
		}
	}

	async persistConversationSelection(conversationId: string): Promise<void> {
		const conversations = this.getConversationCoordinator().conversations;
		const selection = this.getSelection();
		const projection = await conversations.store.load(conversationId);
		await conversations.store.updateManifest({
			...projection.manifest,
			selection,
			updatedAt: new Date().toISOString(),
		});
	}

	executeConversationTurn(
		conversationId: string,
		request: Omit<AgentExecutionRequest, "conversationId" | "history" | "workflow" | "permissionMode"> & {
			history?: AgentExecutionRequest["history"];
		},
	): AsyncGenerator<AgentEvent> {
		const run = async function* (service: AgentWorkbenchService): AsyncGenerator<AgentEvent> {
			const projection = await service.loadConversation(conversationId);
			const history = request.history ?? projectMessages(projection.events.filter((event) => event.runtimeId === projection.manifest.selection.runtimeId))
				.filter((message) => message.role !== "system")
				.map((message) => ({ role: message.role as "user" | "assistant", text: message.text }));
			const interactions: AgentExecutionInteractions = {
				approve: (event) => service.interactionPort?.approveAction({
					conversationId,
					runtimeId: event.runtimeId,
					toolName: typeof event.payload.tool === "string" ? event.payload.tool : "tool",
					toolInput: event.payload,
					reason: typeof event.payload.reason === "string" ? event.payload.reason : "智能体请求执行工具",
					options: event.payload,
				}) ?? Promise.resolve("deny"),
				answer: (event) => service.interactionPort?.answerQuestion(event) ?? Promise.resolve(null),
			};
			yield* service.requireExecution().execute(projection.manifest, {
				...request,
				conversationId,
				history,
				workflow: service.workflow,
				permissionMode: service.permission,
			}, interactions);
		};
		return run(this);
	}

	cancelConversationTurn(conversationId: string): Promise<void> {
		return this.requireExecution().cancel(conversationId);
	}

	steerConversationTurn(conversationId: string, text: string): Promise<boolean> {
		return this.requireExecution().steer(conversationId, text);
	}

	compactConversation(conversationId: string): Promise<boolean> {
		return this.requireExecution().compact(conversationId);
	}

	async forkConversation(conversationId: string): Promise<ConversationManifest> {
		const source = await this.loadConversation(conversationId);
		let target = await this.createConversation(`${source.manifest.title} · 分支`);
		target = {
			...target,
			selection: source.manifest.selection,
			updatedAt: new Date().toISOString(),
		};
		await this.getConversationCoordinator().conversations.store.updateManifest(target);
		for (const message of projectMessages(source.events.filter((event) => event.runtimeId === source.manifest.selection.runtimeId))) {
			if (message.role === "system") continue;
			await this.getConversationCoordinator().conversations.append({
				conversationId: target.conversationId,
				turnId: `fork-${crypto.randomUUID()}`,
				runtimeId: source.manifest.selection.runtimeId,
				type: message.role === "user" ? "user.message" : "assistant.final",
				payload: { text: message.text, forkedFromEventId: message.eventId },
			});
		}
		const binding = await this.requireExecution().fork(source.manifest);
		if (binding) await this.getConversationCoordinator().setBinding(target.conversationId, binding);
		return target;
	}

	selectRuntime(runtimeId: RuntimeId, model?: string | null): void {
		if (runtimeId !== this.selectedRuntimeId) {
			this.selectedRuntimeId = runtimeId;
			this.selectedProviderProfileId = undefined;
			this.selectedModel = undefined;
			this.selectedReasoning = undefined;
			this.selectedServiceTier = undefined;
		}
		if (model !== undefined && this.selectedModel !== (model ?? undefined)) {
			this.selectedModel = model ?? undefined;
			this.selectedReasoning = undefined;
			this.selectedServiceTier = undefined;
		}
		this.queueSettingsSave();
	}

	selectProviderProfile(profileId?: string): void {
		const previous = this.selectedProviderProfileId;
		if (profileId) {
			const profile = this.getProviderProfiles(this.selectedRuntimeId).find((candidate) => candidate.id === profileId);
			if (!profile) throw new Error("Provider profile 不存在、未启用或与当前 runtime 不匹配");
			this.selectedProviderProfileId = profile.id;
			if (this.selectedModel && !profile.models.includes(this.selectedModel)) this.selectedModel = undefined;
		} else {
			this.selectedProviderProfileId = undefined;
		}
		if (previous !== this.selectedProviderProfileId) {
			this.selectedModel = undefined;
			this.selectedReasoning = undefined;
			this.selectedServiceTier = undefined;
		}
		this.queueSettingsSave();
	}

	selectModel(model?: string): void {
		const profile = this.getSelectedProviderProfile();
		if (model && profile && !profile.models.includes(model)) throw new Error("模型不属于当前 Provider profile");
		if (this.selectedModel !== model) {
			this.selectedReasoning = undefined;
			this.selectedServiceTier = undefined;
		}
		this.selectedModel = model;
		this.queueSettingsSave();
	}

	selectReasoning(reasoning?: string): void {
		this.selectedReasoning = reasoning?.trim() || undefined;
		this.queueSettingsSave();
	}

	selectServiceTier(serviceTier?: string): void {
		this.selectedServiceTier = serviceTier?.trim() || undefined;
		this.queueSettingsSave();
	}

	getWorkflowMode(): WorkflowMode { return this.workflow; }
	setWorkflowMode(value: WorkflowMode): void { this.workflow = value; this.queueSettingsSave(); }
	getPermissionMode(): PermissionMode { return this.permission; }
	setPermissionMode(value: PermissionMode): void { this.permission = value; this.queueSettingsSave(); }

	private queueSettingsSave(): void {
		if (!this.options.settingsStore) return;
		const base = this.settings ?? { schemaVersion: 1 as const, runtimes: [], providers: [], selection: { runtimeId: this.selectedRuntimeId }, workflow: this.workflow, permission: this.permission };
		const next: WorkbenchSettings = {
			...base,
			selection: this.getSelection(),
			workflow: this.workflow,
			permission: this.permission,
		};
		this.settings = next;
		this.persistence = this.persistence.then(() => this.options.settingsStore?.save(next)).then(() => undefined).catch((error: unknown) => {
			this.options.onPersistenceError?.(error);
		});
	}

	async flushSettings(): Promise<void> { await this.persistence; }

	async probeRuntime(runtimeId: RuntimeId, signal?: AbortSignal): Promise<RuntimeProbe> {
		const registered = this.runtimes.has(runtimeId) ? this.runtimes.get(runtimeId) : null;
		if (registered) return registered.probe(signal);
		return this.options.probeRuntime?.(runtimeId, this.getRuntimeProfile(runtimeId), signal) ?? { runtimeId, status: "not-installed", reason: "运行时未配置" };
	}

	async listModels(runtimeId: RuntimeId, signal?: AbortSignal): Promise<ModelDescriptor[]> {
		const provider = this.getSelectedProviderProfile(runtimeId);
		if (provider) return provider.models.map((id) => ({ id, label: id, providerProfileId: provider.id }));
		const registered = this.runtimes.has(runtimeId) ? this.runtimes.get(runtimeId) : null;
		if (registered) return registered.listModels(signal);
		return this.options.listModels?.(runtimeId, provider, signal) ?? [];
	}

	async createRuntime(
		runtimeId: RuntimeId,
		input: Parameters<NonNullable<AgentWorkbenchServiceOptions["createRuntime"]>>[1],
		selection: RuntimeSelection = this.getSelection(),
	): Promise<AgentRuntimeAdapter> {
		if (!this.options.createRuntime) throw new Error(`${runtimeId} 运行时工厂未配置`);
		const providerProfile = selection.providerProfileId
			? this.getProviderProfiles(runtimeId).find((profile) => profile.id === selection.providerProfileId)
			: undefined;
		return this.options.createRuntime(runtimeId, {
			...input,
			runtimeProfile: this.getRuntimeProfile(runtimeId),
			providerProfile,
			model: selection.model,
		});
	}

	async authorizeTool(input: {
		runtimeId: RuntimeId;
		conversationId: string;
		vaultRoot: string;
		toolName: string;
		providerProfileId?: string;
		toolInput: Record<string, unknown>;
		providerEgressRequest?: boolean;
		approvalUiAttached: boolean;
		prompt: () => Promise<"allow" | "allow-always" | "deny">;
	}): Promise<"allow" | "allow-always" | "deny"> {
		if (!this.options.approvalBroker) return "deny";
		const request = normalizeToolAction(input);
		const decision = await this.options.approvalBroker.evaluate(request, {
			workflow: this.workflow,
			permission: this.permission,
			conversationId: input.conversationId,
			providerEgressHosts: this.providerEgressHosts(input.runtimeId, input.providerProfileId),
			providerEgressRequest: input.providerEgressRequest,
			approvalUiAttached: input.approvalUiAttached,
		});
		if (decision.decision === "allow") return "allow";
		if (decision.decision === "deny") return "deny";
		const selected = await input.prompt();
		if (selected === "allow-always") await this.options.approvalBroker.rememberExactRule(request, {
			workflow: this.workflow, permission: this.permission, conversationId: input.conversationId, approvalUiAttached: true,
		});
		return selected;
	}

	private providerEgressHosts(runtimeId: RuntimeId, providerProfileId?: string): string[] {
		const defaults: Partial<Record<RuntimeId, string[]>> = {
			claude: ["api.anthropic.com"],
			codex: ["api.openai.com", "chatgpt.com"],
			ohmypi: ["api.deepseek.com", "open.bigmodel.cn"],
		};
		const selected = providerProfileId
			? this.getProviderProfiles(runtimeId).find((profile) => profile.id === providerProfileId)
			: this.getSelectedProviderProfile(runtimeId);
		if (selected?.endpoint) {
			try { return [new URL(selected.endpoint).hostname]; }
			catch { return []; }
		}
		return defaults[runtimeId] ?? [];
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.initialized = false;
		for (const runtime of this.runtimes.values()) {
			void runtime.dispose();
		}
		void this.execution?.dispose();
		this.interactionPort = null;
	}
}
