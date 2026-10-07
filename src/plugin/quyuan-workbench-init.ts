// TALOS 插件屈原完整工作台与人格上下文初始化；由 TalosPlugin 委托调用。
import { AgentWorkbenchService } from "../agent-workbench/core/agent-workbench-service";
import { ApprovalBroker } from "../agent-workbench/security/approval-broker";
import { ClaudianReadonlyImporter, type LegacyImportState } from "../agent-workbench/legacy/claudian-readonly-importer";
import { ConversationInputLedger } from "../agent-workbench/storage/conversation-input-ledger";
import { ConversationService } from "../agent-workbench/core/conversation-service";
import { DesktopRuntimeFactory } from "../agent-workbench/discovery/desktop-runtime-factory";
import { ExternalAccessGrantStore } from "../agent-workbench/security/external-access-grant";
import { FileSystemAdapter } from "obsidian";
import { JsonlSecurityAuditSink } from "../agent-workbench/security/jsonl-security-audit-sink";
import { NodeRuntimeProbeHost } from "../agent-workbench/discovery/node-runtime-probe-host";
import { NodeSandboxProbeHost, ProcessSandbox } from "../agent-workbench/security/process-sandbox";
import { ObsidianLegacyReadAdapter, ObsidianWorkbenchStorage } from "../agent-workbench/storage/obsidian-workbench-storage";
import { PermissionRuleStore } from "../agent-workbench/security/permission-rule-store";
import { PortableConversationStore } from "../agent-workbench/storage/portable-conversation-store";
import { RuntimeBindingStore } from "../agent-workbench/storage/runtime-binding-store";
import { RuntimeDiscoveryService } from "../agent-workbench/discovery/runtime-discovery-service";
import { TRUSTED_PROVIDER_FETCH } from "./plugin-support";
import { VaultBoundary } from "../agent-workbench/security/vault-boundary";
import { WorkbenchConversationCoordinator } from "../agent-workbench/core/workbench-conversation-coordinator";
import { WorkbenchSettingsStore } from "../agent-workbench/storage/workbench-settings-store";
import { WorkbenchUiStateStore, migrateLegacyTabManagerState } from "../agent-workbench/storage/workbench-ui-state-store";
import { loadQuyuanSoulContextWithFallback } from "../quyuan/persona-context";
import { providerSecretStoreFromApp } from "../ai/provider/secret-storage-runtime";
import type TalosPlugin from "../main";
import { evaluateQuyuanToolPolicy } from "./quyuan-voice-tools";
import { auditQuyuanChatEgress } from "./quyuan-egress-audit";
import { recordQuyuanRuntimeError } from "./quyuan-diagnostics";
import { syncAgentWorkbenchProviderProfiles, syncCodexHarnessEnvironment } from "./provider-runtime";

export async function initializeQuyuanWorkbench(plugin: TalosPlugin): Promise<{ service: AgentWorkbenchService }> {
	plugin.quyuanWorkbenchReady = false;
	plugin.quyuanWorkbenchError = "";
	try {
		if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
			throw new Error("TALOS 多智能体本地运行时仅支持桌面 FileSystem Vault");
		}
		const vaultRoot = plugin.app.vault.adapter.getBasePath();
		const discovery = new RuntimeDiscoveryService(new NodeRuntimeProbeHost());
		const secretStore = providerSecretStoreFromApp(plugin.app);
		const runtimeFactory = new DesktopRuntimeFactory(
			discovery,
			new ProcessSandbox(new NodeSandboxProbeHost()),
			(reference) => secretStore?.get(reference) ?? null,
			TRUSTED_PROVIDER_FETCH,
		);
		const portableStorage = new ObsidianWorkbenchStorage(plugin.app.vault.adapter, vaultRoot);
		const workbenchStateRoot = ".talos/agent-workbench/v1";
		plugin.agentWorkbenchStorage = portableStorage;
		const storedSurface = await portableStorage.readJson<{
			activeChannel?: unknown;
		}>(`${workbenchStateRoot}/chat-surface.json`);
		if (storedSurface?.activeChannel === "codex" || storedSurface?.activeChannel === "dsh") {
			plugin.agentWorkbenchSurface = storedSurface.activeChannel;
		} else {
			plugin.agentWorkbenchSurface = plugin.talosSettings.harnessSurface === "codex" ? "codex" : "dsh";
		}
		const permissionRules = new PermissionRuleStore({
			read: () => portableStorage.readJson(`${workbenchStateRoot}/permission-rules.json`),
			write: (rules) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/permission-rules.json`, rules),
		});
		const approvalBroker = new ApprovalBroker(
			new VaultBoundary(vaultRoot, undefined, 20, plugin.app.vault.configDir),
			permissionRules,
			new ExternalAccessGrantStore(),
			new JsonlSecurityAuditSink(vaultRoot),
		);
		const workbenchSettings = new WorkbenchSettingsStore({
			read: () => portableStorage.readJson(`${workbenchStateRoot}/settings.json`),
			write: (value) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/settings.json`, value),
		}, { has: (reference) => secretStore?.has(reference) ?? false });
		const conversations = new ConversationService(new PortableConversationStore(portableStorage));
		const nativeBindings = new RuntimeBindingStore({
			read: () => portableStorage.readJson<Record<string, unknown>>(`${workbenchStateRoot}/runtime-bindings.json`),
			write: (value) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/runtime-bindings.json`, value),
		});
		const inputLedger = new ConversationInputLedger({
			read: () => portableStorage.readJson(`${workbenchStateRoot}/input-ledger.json`),
			write: (value) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/input-ledger.json`, value),
		});
		const uiStateStore = new WorkbenchUiStateStore({
			read: async () => {
				const current = await portableStorage.readJson(`${workbenchStateRoot}/ui-state.json`);
				if (current) return current;
				return migrateLegacyTabManagerState(
					await portableStorage.readJson(`${workbenchStateRoot}/tab-manager-state.json`),
					await portableStorage.readJson(`${workbenchStateRoot}/import-manifest.json`),
				);
			},
			write: (value) => portableStorage.writeJsonAtomic(`${workbenchStateRoot}/ui-state.json`, value),
		});
		const importManifestPath = ".talos/agent-workbench/v1/import-manifest.json";
		const legacyImporter = new ClaudianReadonlyImporter(
			new ObsidianLegacyReadAdapter(plugin.app.vault.adapter),
			conversations,
			{
				read: () => portableStorage.readJson<LegacyImportState>(importManifestPath),
				write: (state) => portableStorage.writeJsonAtomic(importManifestPath, state),
			},
		);
		const conversationCoordinator = new WorkbenchConversationCoordinator(
			conversations,
			nativeBindings,
			legacyImporter,
		);
		const service = new AgentWorkbenchService({
			approvalBroker,
			evaluateToolGovernance: (toolName, input) => evaluateQuyuanToolPolicy(plugin, toolName, input),
			conversationCoordinator,
			inputLedger,
			uiStateStore,
			vaultRoot,
			preflightEgress: (input) => {
				const editorSourcePaths = input.context?.selections?.flatMap((selection) => selection.source === "editor" && selection.path ? [selection.path] : []) ?? [];
				const canvasSourcePaths = input.context?.selections?.flatMap((selection) => selection.source === "canvas" && selection.path ? [selection.path] : []) ?? [];
				return auditQuyuanChatEgress(plugin, {
					providerId: input.providerProfileId ?? input.runtimeId,
					prompt: input.prompt,
					...(input.history?.length ? { historyText: JSON.stringify(input.history) } : {}),
					currentNotePath: input.context?.linkedContent?.path,
					editorSourcePaths,
					canvasSourcePaths,
					externalContextPaths: input.context?.externalContextPaths,
					hasImages: input.hasImages,
					hasMcpMentions: Boolean(input.context?.enabledMcpServers?.length),
					hasBrowserContext: input.context?.selections?.some((selection) => selection.source === "browser") ?? false,
					sessionId: input.conversationId,
				});
			},
			settingsStore: workbenchSettings,
			onPersistenceError: (error) => recordQuyuanRuntimeError(plugin, "AgentWorkbenchService.settings", error),
			probeRuntime: (runtimeId, profile, signal) => {
				if (signal?.aborted) {
					return Promise.resolve({
						runtimeId,
						status: "crashed" as const,
						reason: "运行时探测已取消",
					});
				}
				return runtimeFactory.probe(runtimeId, profile);
			},
			listModels: async (runtimeId) => {
				const runtime = await runtimeFactory.create(runtimeId, { vaultRoot, configDir: plugin.app.vault.configDir, approve: async () => "deny" });
				try { return await runtime.listModels(); } finally { await runtime.dispose(); }
			},
			createRuntime: (runtimeId, input) => runtimeFactory.create(runtimeId, { ...input, configDir: plugin.app.vault.configDir }),
		});
		plugin.agentWorkbenchService = service;
		await service.initialize();
		await syncCodexHarnessEnvironment(plugin);
		await syncAgentWorkbenchProviderProfiles(plugin);
		plugin.quyuanWorkbenchReady = true;
		plugin.talosProviderFacade = null;
		plugin.talosAskService = null;
		plugin.quyuanWorkbenchError = "";
		return { service };
	} catch (error) {
		plugin.agentWorkbenchService?.dispose();
		plugin.agentWorkbenchService = null;
		plugin.quyuanWorkbenchReady = false;
		plugin.talosProviderFacade = null;
		plugin.talosAskService = null;
		plugin.quyuanWorkbenchError =
			error instanceof Error ? error.message : String(error);
		recordQuyuanRuntimeError(plugin, "AgentWorkbenchService.initialize", error);
		console.error("TALOS Quyuan workbench failed to initialize", error);
		throw error;
	}
}

export async function initializeQuyuanSoul(plugin: TalosPlugin): Promise<void> {
	try {
		const P = plugin.paths;
		plugin.quyuanSoul = await loadQuyuanSoulContextWithFallback(
			plugin.app,
			[P.personaFile, P.personaMemoryFile, P.contextFile],
			[
				P.join("identity", "身份.md"),
				P.join("identity", "偏好与边界.md"),
				P.join("identity", "目标.md"),
			]
		);
		plugin.talosProviderFacade = null;
		plugin.talosAskService = null;
		plugin.quyuanSoulError = "";
	} catch (error) {
		plugin.quyuanSoul = null;
		plugin.quyuanSoulError =
			error instanceof Error ? error.message : String(error);
		recordQuyuanRuntimeError(plugin, "initializeQuyuanSoul", error);
	}
}
