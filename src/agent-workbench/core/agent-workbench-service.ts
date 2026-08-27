import type { PermissionMode, WorkflowMode } from "../contracts/approval";
import type { ProviderProfile, RuntimeProfile } from "../contracts/provider-profile";
import { validateProviderProfile } from "../contracts/provider-profile";
import type { AgentRuntimeAdapter, ModelDescriptor, RuntimeId, RuntimeProbe } from "../contracts/runtime-adapter";
import { RuntimeRegistry } from "./runtime-registry";
import type { ApprovalBroker } from "../security/approval-broker";
import { normalizeToolAction } from "../security/tool-action-normalizer";
import type { RuntimeSelection, WorkbenchSettings, WorkbenchSettingsStore } from "../storage/workbench-settings-store";
import type { WorkbenchConversationCoordinator } from "./workbench-conversation-coordinator";

export interface CompatibilityLifecycle {
	initialize(): Promise<void>;
	dispose(): void;
}

export interface AgentWorkbenchServiceOptions {
	compatibility: CompatibilityLifecycle;
	runtimes?: AgentRuntimeAdapter[];
	probeRuntime?: (runtimeId: RuntimeId, profile?: RuntimeProfile, signal?: AbortSignal) => Promise<RuntimeProbe>;
	listModels?: (runtimeId: RuntimeId, provider?: ProviderProfile, signal?: AbortSignal) => Promise<ModelDescriptor[]>;
	createRuntime?: (runtimeId: RuntimeId, input: {
		vaultRoot: string;
		permissionMode?: PermissionMode;
		runtimeProfile?: RuntimeProfile;
		providerProfile?: ProviderProfile;
		approve: (toolName: string, input: Record<string, unknown>, metadata?: Record<string, unknown>) => Promise<"allow" | "allow-always" | "deny">;
	}) => Promise<AgentRuntimeAdapter>;
	approvalBroker?: ApprovalBroker;
	settingsStore?: WorkbenchSettingsStore;
	conversationCoordinator?: WorkbenchConversationCoordinator;
	onPersistenceError?: (error: unknown) => void;
}

/**
 * TALOS-owned composition root for the agent workbench.
 *
 * The compatibility lifecycle is deliberately opaque: the new core never
 * imports Claudian provider/session/permission implementations.
 */
export class AgentWorkbenchService {
	readonly runtimes: RuntimeRegistry;
	private initialized = false;
	private disposed = false;
	private selectedRuntimeId: RuntimeId = "codex";
	private selectedProviderProfileId: string | undefined;
	private selectedModel: string | undefined;
	private workflow: WorkflowMode = "plan";
	private permission: PermissionMode = "ask";
	private settings: WorkbenchSettings | null = null;
	private persistence = Promise.resolve();

	constructor(private readonly options: AgentWorkbenchServiceOptions) {
		this.runtimes = new RuntimeRegistry(options.runtimes ?? []);
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		if (this.disposed) throw new Error("TALOS 智能体工作台已释放");
		if (this.options.settingsStore) {
			this.settings = await this.options.settingsStore.load();
			this.selectedRuntimeId = this.settings.selection.runtimeId;
			this.selectedProviderProfileId = this.settings.selection.providerProfileId;
			this.selectedModel = this.settings.selection.model;
			this.workflow = this.settings.workflow;
			this.permission = this.settings.permission;
		}
		await this.options.conversationCoordinator?.initialize();
		await this.options.compatibility.initialize();
		this.initialized = true;
	}

	isReady(): boolean {
		return this.initialized && !this.disposed;
	}

	getSelectedRuntimeId(): RuntimeId {
		return this.selectedRuntimeId;
	}

	getSelection(): RuntimeSelection { return { runtimeId: this.selectedRuntimeId, ...(this.selectedProviderProfileId ? { providerProfileId: this.selectedProviderProfileId } : {}), ...(this.selectedModel ? { model: this.selectedModel } : {}) }; }

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
		} else if (
			selected &&
			this.selectedModel &&
			!selected.models.includes(this.selectedModel)
		) {
			this.selectedModel = undefined;
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

	selectRuntime(runtimeId: RuntimeId, model?: string | null): void {
		if (runtimeId !== this.selectedRuntimeId) {
			this.selectedRuntimeId = runtimeId;
			this.selectedProviderProfileId = undefined;
			this.selectedModel = undefined;
		}
		if (model !== undefined) this.selectedModel = model ?? undefined;
		this.queueSettingsSave();
	}

	selectProviderProfile(profileId?: string): void {
		if (profileId) {
			const profile = this.getProviderProfiles(this.selectedRuntimeId).find((candidate) => candidate.id === profileId);
			if (!profile) throw new Error("Provider profile 不存在、未启用或与当前 runtime 不匹配");
			this.selectedProviderProfileId = profile.id;
			if (this.selectedModel && !profile.models.includes(this.selectedModel)) this.selectedModel = undefined;
		} else {
			this.selectedProviderProfileId = undefined;
		}
		this.queueSettingsSave();
	}

	selectModel(model?: string): void {
		const profile = this.getSelectedProviderProfile();
		if (model && profile && !profile.models.includes(model)) throw new Error("模型不属于当前 Provider profile");
		this.selectedModel = model;
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

	async createRuntime(runtimeId: RuntimeId, input: Parameters<NonNullable<AgentWorkbenchServiceOptions["createRuntime"]>>[1]): Promise<AgentRuntimeAdapter> {
		if (!this.options.createRuntime) throw new Error(`${runtimeId} 运行时工厂未配置`);
		return this.options.createRuntime(runtimeId, { ...input, runtimeProfile: this.getRuntimeProfile(runtimeId), providerProfile: this.getSelectedProviderProfile(runtimeId) });
	}

	async authorizeTool(input: {
		runtimeId: RuntimeId;
		conversationId: string;
		vaultRoot: string;
		toolName: string;
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
			providerEgressHosts: this.providerEgressHosts(input.runtimeId),
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

	private providerEgressHosts(runtimeId: RuntimeId): string[] {
		const defaults: Partial<Record<RuntimeId, string[]>> = {
			claude: ["api.anthropic.com"],
			codex: ["api.openai.com", "chatgpt.com"],
			ohmypi: ["api.deepseek.com", "open.bigmodel.cn"],
		};
		const selected = this.getSelectedProviderProfile(runtimeId);
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
		this.options.compatibility.dispose();
	}
}
