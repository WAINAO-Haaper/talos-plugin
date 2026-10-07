// TALOS 插件Provider 门面、Provider 中心与 talos-ask；由 TalosPlugin 委托调用。
import { AgentWorkbenchService } from "../agent-workbench/core/agent-workbench-service";
import { AnthropicApiProvider } from "../ai/provider/anthropic-api-provider";
import { Notice } from "obsidian";
import { OpenAiCompatibleProvider } from "../ai/provider/openai-compatible-provider";
import { type ProviderCenterSnapshot, buildProviderCenterSnapshot } from "../ui/provider-center";
import type { ProviderConfigFile } from "../ai/provider/provider-config-store";
import { ProviderFacade } from "../ai/provider/provider-facade";
import { TALOS_MANAGED_PROVIDER_PROFILE_IDS, buildTalosProviderProfiles, preferredDirectApiProfile } from "../agent-workbench/config/talos-provider-profiles";
import { TRUSTED_PROVIDER_FETCH, TalosAskPromptModal, isRecord } from "./plugin-support";
import { TalosAskCommand } from "../canonical/talos-ask-command";
import { TalosAskService } from "../ai/ask-service";
import { VaultRetriever } from "../ai/context/vault-retrieval";
import { buildProviderConfig } from "../ai/provider/provider-config-runtime";
import { createAgentWorkbenchProviderAdapters } from "../ai/provider/agent-workbench-provider-adapter";
import { createVaultCanonicalRegistryReader } from "../canonical/registry-reader";
import { createVaultCanonicalRequestWriter } from "../canonical/request-writer";
import { createVaultProviderEgressAuditStore } from "../ai/privacy/provider-egress-audit-store";
import { migrateLegacyCodexCredential } from "../agent-workbench/legacy/legacy-codex-credential-migrator";
import { providerSecretStoreFromApp } from "../ai/provider/secret-storage-runtime";
import type TalosPlugin from "../main";
import { recordQuyuanRuntimeError } from "./quyuan-diagnostics";

export async function applyWindowsDirectApiFallback(plugin: TalosPlugin, service: AgentWorkbenchService): Promise<void> {
	if (process.platform !== "win32" || service.getSelection().providerProfileId) return;
	const selected = preferredDirectApiProfile([
		...service.getProviderProfiles("codex"),
		...service.getProviderProfiles("claude"),
	], plugin.talosSettings.engineProvider);
	if (!selected) return;
	service.selectRuntime(selected.runtimeId);
	service.selectProviderProfile(selected.id);
	service.selectModel(selected.models[0]);
	service.setWorkflowMode("plan");
	await service.flushSettings();
	new Notice(`Windows 已切换到 ${selected.displayName}；Direct API 为 Plan-only，不会启动本机 CLI。`);
}

/** One-way legacy credential bridge; native runtime profiles own all new settings. */
export async function syncCodexHarnessEnvironment(plugin: TalosPlugin): Promise<void> {
	try {
		const result = await migrateLegacyCodexCredential({
			adapter: plugin.app.vault.adapter,
			settings: plugin.talosSettings,
			store: providerSecretStoreFromApp(plugin.app),
		});
		if (result.migrated) {
			const loaded: unknown = await plugin.loadData();
			const stored = isRecord(loaded) ? loaded : {};
			await plugin.saveData({ ...stored, talos: plugin.talosSettings });
		}
	} catch (error) {
		recordQuyuanRuntimeError(plugin, "nativeCodexCredentialMigration", error);
	}
}

export async function syncAgentWorkbenchProviderProfiles(plugin: TalosPlugin): Promise<void> {
	const service = plugin.agentWorkbenchService;
	if (!service?.isReady()) return;
	const secretStore = providerSecretStoreFromApp(plugin.app);
	try {
		await service.syncProviderProfiles(
			buildTalosProviderProfiles(
				plugin.talosSettings,
				(reference) => secretStore?.has(reference) ?? false
			),
			TALOS_MANAGED_PROVIDER_PROFILE_IDS
		);
		await applyWindowsDirectApiFallback(plugin, service);
	} catch (error) {
		recordQuyuanRuntimeError(plugin, 
			"AgentWorkbenchService.providerProfiles",
			error
		);
	}
}

export function getTalosProviderFacade(plugin: TalosPlugin): ProviderFacade {
	if (plugin.talosProviderFacade) return plugin.talosProviderFacade;
	const facade = new ProviderFacade();
	if (plugin.quyuanWorkbenchReady && plugin.agentWorkbenchService) {
		for (const provider of createAgentWorkbenchProviderAdapters(
			plugin.agentWorkbenchService,
			plugin.agentWorkbenchService.getVaultRoot(),
		)) {
			facade.register(provider);
		}
	}
	const secrets = providerSecretStoreFromApp(plugin.app);
	const governedToolRunner = {
		async run(): Promise<{ content: string; isError: boolean }> {
			return {
				content: "工具请求必须进入 TALOS 任务审批，canonical 入口不直接执行",
				isError: true,
			};
		},
	};
	if (secrets) {
		facade.register(
			new AnthropicApiProvider({
				id: "claude-api",
				endpoint:
					plugin.talosSettings.anthropicBaseUrl.trim() ||
					"https://api.anthropic.com",
				model:
					plugin.talosSettings.jarvisModel.trim() ||
					"claude-sonnet-4-6",
				systemPrompt: plugin.quyuanSoul?.systemContext ?? "",
				secretRef:
					plugin.talosSettings.providerSecretRefs.anthropicApiKey ||
					"talos-anthropic-api-key",
				secrets,
				toolRunner: governedToolRunner,
				thinkingLevel: plugin.talosSettings.jarvisThinkingLevel,
				fetcher: TRUSTED_PROVIDER_FETCH,
			})
		);
		facade.register(
			new OpenAiCompatibleProvider({
				id: "openai-compatible",
				endpoint:
					plugin.talosSettings.openaiBaseUrl.trim() ||
					"https://api.openai.com",
				model: plugin.talosSettings.openaiModel.trim() || "gpt-4o",
				systemPrompt: plugin.quyuanSoul?.systemContext ?? "",
				secretRef:
					plugin.talosSettings.providerSecretRefs.openaiApiKey ||
					"talos-openai-api-key",
				secrets,
				toolRunner: governedToolRunner,
				thinkingLevel: plugin.talosSettings.jarvisThinkingLevel,
				fetcher: TRUSTED_PROVIDER_FETCH,
			})
		);
	}
	plugin.talosProviderFacade = facade;
	return facade;
}

export function getProviderCenterSnapshot(plugin: TalosPlugin): ProviderCenterSnapshot {
	const facade = getTalosProviderFacade(plugin);
	const config: ProviderConfigFile = buildProviderConfig(
		plugin.talosSettings
	);
	const known = new Set(config.providers.map((provider) => provider.id));
	const capabilities = [
		"chat",
		"stream",
		"tools",
		"usage",
		"cancel",
		"resume",
		"fork",
	] as const;
	for (const provider of facade.listProviders()) {
		if (known.has(provider.id)) continue;
		const missing = new Set(
			facade.getAvailability(provider.id, [...capabilities]).missing
		);
		config.providers.push({
			id: provider.id,
			name:
				provider.id === "codex"
					? "Codex harness · 本机"
					: `${provider.id} · 本机 Provider`,
			kind: provider.kind,
			endpoint: "local://cli",
			model: plugin.talosSettings.jarvisModel.trim() || "CLI 默认模型",
			capabilities: capabilities.filter(
				(capability) => !missing.has(capability)
			),
			isDefault:
				provider.id === plugin.selectedTalosAskProviderId(),
			secretRef: "talos-local-cli",
			vaultAccess: plugin.talosSettings.providerVaultAccess
				? "full"
				: "denied",
			moduleAccess: {
				...(plugin.talosSettings.providerModuleAccess[provider.id] ??
					{}),
			},
		});
	}
	return buildProviderCenterSnapshot({
		facade,
		config,
		secrets: providerSecretStoreFromApp(plugin.app),
	});
}

export async function changeConsoleProviderModel(plugin: TalosPlugin, providerId: string, model: string): Promise<void> {
	const normalized = model.trim();
	if (!normalized) throw new Error("模型名称不能为空");
	if (providerId === "openai-compatible") {
		plugin.talosSettings.openaiModel = normalized;
	} else {
		plugin.talosSettings.jarvisModel = normalized;
	}
	await plugin.saveTalosSettings();
}

export function getTalosAskService(plugin: TalosPlugin): TalosAskService {
	if (plugin.talosAskService) return plugin.talosAskService;
	if (!plugin.quyuanSoul) {
		throw new Error(
			`屈原人格未启动：${plugin.quyuanSoulError || "强制上下文仍在加载"}`
		);
	}

	const facade = getTalosProviderFacade(plugin);

	const retriever = new VaultRetriever(
		{
			listPaths: async () =>
				plugin.app.vault.getMarkdownFiles().map((file) => file.path),
			read: (path) => plugin.app.vault.adapter.read(path),
		},
		{ configDir: plugin.app.vault.configDir }
	);
	const auditStore = createVaultProviderEgressAuditStore(plugin.app);
	plugin.talosAskService = new TalosAskService({
		facade,
		retriever,
		manualReview: () => true,
		vaultAccess: () =>
			plugin.talosSettings.providerVaultAccess ? "full" : "denied",
		moduleAccess: (providerId) =>
			plugin.talosSettings.providerModuleAccess[providerId] ?? {},
		vaultSchema: () => plugin.talosSettings.vaultSchema,
		auditSink: (record) => auditStore.append(record),
		configDir: plugin.app.vault.configDir,
		toolGateway: {
			propose: async (input) =>
				plugin.getConsoleActionRuntime().proposeProviderTool(input),
		},
	});
	return plugin.talosAskService;
}

export function getTalosAskCommand(plugin: TalosPlugin): TalosAskCommand {
	if (plugin.talosAskCommand) return plugin.talosAskCommand;
	plugin.talosAskCommand = new TalosAskCommand({
		registryReader: createVaultCanonicalRegistryReader(plugin.app),
		requestWriter: createVaultCanonicalRequestWriter(plugin.app),
		askService: {
			ask: (input) => getTalosAskService(plugin).ask(input),
		},
	});
	return plugin.talosAskCommand;
}

export async function executeTalosAskCommand(plugin: TalosPlugin): Promise<void> {
	await plugin.startFirstRunContextInitialization();
	const query = await new TalosAskPromptModal(plugin.app).openAndWait();
	if (!query) return;
	try {
		const text: string[] = [];
		let errorMessage = "";
		let proposedTools = 0;
		for await (const event of getTalosAskCommand(plugin).execute({
			channel: "obsidian",
			providerId: plugin.selectedTalosAskProviderId(),
			query,
			writebackIntent: "display-only",
			approvalState: "not-required",
			currentPath: plugin.app.workspace.getActiveFile()?.path,
		})) {
			if (event.type === "text") text.push(event.text);
			if (event.type === "error") errorMessage = event.message;
			if (event.type === "tool-request") proposedTools += 1;
		}
		if (errorMessage) {
			new Notice(`TALOS 问答失败：${errorMessage}`, 10000);
			return;
		}
		const answer = text.join("").trim() || "（Provider 未返回文本）";
		const proposal = proposedTools
			? `\n${proposedTools} 个工具请求已进入待审批任务。`
			: "";
		new Notice(`${answer.slice(0, 1200)}${proposal}`, 15000);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`TALOS canonical 问答不可用：${message}`, 12000);
	}
}
