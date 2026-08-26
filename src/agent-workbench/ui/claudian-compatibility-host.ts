import type { App, PluginManifest } from "obsidian";
import ClaudianPlugin from "../../quyuan/claudian/main";
import type { Conversation } from "../../quyuan/claudian/core/types";
import type { ProviderId } from "../../quyuan/claudian/core/providers/types";
import type { RuntimeId } from "../contracts/runtime-adapter";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import type { ProviderUsageMetrics } from "../../ai/privacy/provider-usage-audit-store";
import type { VaultPaths } from "../../data/schema";
import type { VoiceVaultToolName } from "../../quyuan/voice-vault-tools";
import { registerTalosAdapterProviders } from "./adapter-provider-registration";

export interface ClaudianCompatibilityDelegate {
	app: App;
	manifest: PluginManifest;
	getAgentWorkbenchService(): AgentWorkbenchService;
	prepareQuyuanInlineEdit(path: string): Promise<{ decision: "allow" | "deny"; reason: string }>;
	recordQuyuanToolUse(toolName: string, input: Record<string, unknown>): void;
	auditQuyuanChatEgress(input: Record<string, unknown>): Promise<unknown>;
	auditQuyuanProviderEgress(input: Record<string, unknown>): Promise<unknown>;
	recordQuyuanRuntimeError(scope: string, error: unknown): void;
	writeQuyuanDiagnostics(openReport?: boolean): Promise<string>;
	onQuyuanAssistantText(content: string): void;
	onQuyuanAssistantDone(): void;
	getQuyuanVoiceEnabled(): boolean;
	setQuyuanVoiceEnabled(enabled: boolean): Promise<void>;
	toggleQuyuanVoiceInput(handlers: {
		onInterim: (text: string) => void;
		onFinal: (text: string) => void;
		onStateChange: (listening: boolean, error?: string) => void;
	}): void;
	stopQuyuanVoiceInput(): void;
	stopQuyuanSpeech(): void;
	evaluateQuyuanToolPolicy(toolName: string, input: Record<string, unknown>): unknown;
	decorateClaudianEnvironment(providerId: ProviderId, base: string): string;
	activateQuyuanV2View(): Promise<void>;
	exchangeQuyuanRealtimeSdp(input: {
		model: string;
		instructions: string;
		offerSdp: string;
	}): Promise<{ answerSdp: string }>;
	executeQuyuanVoiceVaultTool(input: {
		name: VoiceVaultToolName;
		args: Record<string, unknown>;
		sessionId?: string;
	}): Promise<string>;
	executeQuyuanVoiceWebSearch(input: {
		query: string;
		callId: string;
		sessionId?: string;
	}): Promise<string>;
	recordQuyuanProviderUsage(input: {
		namespace: "voice";
		providerId: string;
		operation: string;
		model: string;
		usage: ProviderUsageMetrics;
		sessionId?: string;
	}): Promise<void>;
	readonly paths: VaultPaths;
}

/** Transitional display host. It is owned and unloaded by TALOS. */
export class ClaudianCompatibilityHost extends ClaudianPlugin {
	private initializePromise: Promise<void> | null = null;

	constructor(private readonly delegate: ClaudianCompatibilityDelegate) {
		super(delegate.app, delegate.manifest);
	}
	getAgentWorkbenchService(): AgentWorkbenchService {
		return this.delegate.getAgentWorkbenchService();
	}

	private runtimeId(providerId: ProviderId): RuntimeId {
		if (providerId === "claude" || providerId === "ohmypi") return providerId;
		return "codex";
	}

	private portableConversationId(conversation: Conversation): string {
		const state = conversation.providerState;
		if (state && typeof state === "object" && !Array.isArray(state)) {
			const candidate = state.talosConversationId;
			if (typeof candidate === "string" && candidate) return candidate;
		}
		return conversation.id;
	}

	private async projectConversation(conversation: Conversation): Promise<void> {
		const coordinator = this.delegate.getAgentWorkbenchService().getConversationCoordinator();
		const runtimeId = this.runtimeId(conversation.providerId);
		const manifest = await coordinator.ensure({
			conversationId: this.portableConversationId(conversation),
			title: conversation.title,
			createdAt: conversation.createdAt,
			updatedAt: conversation.updatedAt,
			runtimeId,
		});
		if (manifest.title !== conversation.title) {
			await coordinator.conversations.rename(manifest.conversationId, conversation.title);
		}
		await coordinator.switchRuntime(manifest.conversationId, runtimeId);
	}

	async createConversation(options?: { providerId?: ProviderId; sessionId?: string }): Promise<Conversation> {
		const conversation = await super.createConversation(options);
		await this.projectConversation(conversation);
		return conversation;
	}

	async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
		await super.updateConversation(id, updates);
		const conversation = this.getConversationSync(id);
		if (conversation) await this.projectConversation(conversation);
	}

	async renameConversation(id: string, title: string): Promise<void> {
		await super.renameConversation(id, title);
		const conversation = this.getConversationSync(id);
		if (conversation) await this.projectConversation(conversation);
	}

	async deleteConversation(id: string): Promise<void> {
		const conversation = this.getConversationSync(id);
		if (!conversation) return super.deleteConversation(id);
		await this.projectConversation(conversation);
		const portableId = this.portableConversationId(conversation);
		await super.deleteConversation(id);
		await this.delegate.getAgentWorkbenchService()
			.getConversationCoordinator().conversations.softDelete(portableId);
	}

	protected shouldRegisterWorkbenchRibbon(): boolean {
		return false;
	}

	protected shouldRegisterWorkbenchSettingTab(): boolean {
		return false;
	}

	protected isCompatibilityReadOnly(): boolean {
		return true;
	}

	initialize(): Promise<void> {
		registerTalosAdapterProviders();
		this.initializePromise ??= Promise.resolve(super.onload()).then(() => undefined);
		return this.initializePromise;
	}

	dispose(): void {
		super.onunload();
	}

	prepareQuyuanInlineEdit(path: string) { return this.delegate.prepareQuyuanInlineEdit(path); }
	recordQuyuanToolUse(toolName: string, input: Record<string, unknown>) { this.delegate.recordQuyuanToolUse(toolName, input); }
	auditQuyuanChatEgress(input: Record<string, unknown>) { return this.delegate.auditQuyuanChatEgress(input); }
	auditQuyuanProviderEgress(input: Record<string, unknown>) { return this.delegate.auditQuyuanProviderEgress(input); }
	recordQuyuanRuntimeError(scope: string, error: unknown) { this.delegate.recordQuyuanRuntimeError(scope, error); }
	writeQuyuanDiagnostics(openReport = true) { return this.delegate.writeQuyuanDiagnostics(openReport); }
	onQuyuanAssistantText(content: string) { this.delegate.onQuyuanAssistantText(content); }
	onQuyuanAssistantDone() { this.delegate.onQuyuanAssistantDone(); }
	getQuyuanVoiceEnabled() { return this.delegate.getQuyuanVoiceEnabled(); }
	setQuyuanVoiceEnabled(enabled: boolean) { return this.delegate.setQuyuanVoiceEnabled(enabled); }
	toggleQuyuanVoiceInput(handlers: Parameters<ClaudianCompatibilityDelegate["toggleQuyuanVoiceInput"]>[0]) { this.delegate.toggleQuyuanVoiceInput(handlers); }
	stopQuyuanVoiceInput() { this.delegate.stopQuyuanVoiceInput(); }
	stopQuyuanSpeech() { this.delegate.stopQuyuanSpeech(); }
	evaluateQuyuanToolPolicy(toolName: string, input: Record<string, unknown>) { return this.delegate.evaluateQuyuanToolPolicy(toolName, input); }
	activateQuyuanV2View() { return this.delegate.activateQuyuanV2View(); }
	exchangeQuyuanRealtimeSdp(input: Parameters<ClaudianCompatibilityDelegate["exchangeQuyuanRealtimeSdp"]>[0]) { return this.delegate.exchangeQuyuanRealtimeSdp(input); }
	executeQuyuanVoiceVaultTool(input: Parameters<ClaudianCompatibilityDelegate["executeQuyuanVoiceVaultTool"]>[0]) { return this.delegate.executeQuyuanVoiceVaultTool(input); }
	executeQuyuanVoiceWebSearch(input: Parameters<ClaudianCompatibilityDelegate["executeQuyuanVoiceWebSearch"]>[0]) { return this.delegate.executeQuyuanVoiceWebSearch(input); }
	recordQuyuanProviderUsage(input: Parameters<ClaudianCompatibilityDelegate["recordQuyuanProviderUsage"]>[0]) { return this.delegate.recordQuyuanProviderUsage(input); }
	get paths(): VaultPaths { return this.delegate.paths; }

	getActiveEnvironmentVariables(providerId?: ProviderId): string {
		const resolved = providerId ?? "codex";
		return this.delegate.decorateClaudianEnvironment(
			resolved,
			super.getActiveEnvironmentVariables(providerId),
		);
	}
}
