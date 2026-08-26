import { FileSystemAdapter } from "obsidian";
import type { RuntimeId } from "../contracts/runtime-adapter";
import { QueryBackedInlineEditService } from "../../quyuan/claudian/core/auxiliary/QueryBackedInlineEditService";
import { QueryBackedInstructionRefineService } from "../../quyuan/claudian/core/auxiliary/QueryBackedInstructionRefineService";
import { QueryBackedTitleGenerationService } from "../../quyuan/claudian/core/auxiliary/QueryBackedTitleGenerationService";
import { ProviderRegistry } from "../../quyuan/claudian/core/providers/ProviderRegistry";
import { decodeProviderModelSelectionId, encodeProviderModelSelectionId } from "../../quyuan/claudian/core/providers/modelSelection";
import type { ProviderChatUIConfig, ProviderConversationHistoryService, ProviderIconSvg, ProviderRegistration, ProviderTaskResultInterpreter } from "../../quyuan/claudian/core/providers/types";
import { CLAUDE_PROVIDER_ICON, OPENAI_PROVIDER_ICON, PI_PROVIDER_ICON } from "../../quyuan/claudian/shared/icons";
import type { Conversation } from "../../quyuan/claudian/core/types";
import type ClaudianPlugin from "../../quyuan/claudian/main";
import { codexProviderRegistration } from "../../quyuan/claudian/providers/codex/registration";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import { AdapterAuxQueryRunner } from "./adapter-aux-query-runner";
import { AdapterCompatibilityRuntime } from "./adapter-compatibility-runtime";

type WorkbenchPlugin = ClaudianPlugin & { getAgentWorkbenchService(): AgentWorkbenchService };

const RUNTIME_PROVIDER_ICONS = {
	claude: CLAUDE_PROVIDER_ICON,
	codex: OPENAI_PROVIDER_ICON,
	ohmypi: PI_PROVIDER_ICON,
} satisfies Record<RuntimeId, ProviderIconSvg>;

let registered = false;

function vaultRoot(plugin: ClaudianPlugin): string {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) throw new Error("本地智能体仅支持桌面 FileSystem Vault");
	return adapter.getBasePath();
}

function runner(plugin: ClaudianPlugin, runtimeId: RuntimeId) {
	const workbench = (plugin as WorkbenchPlugin).getAgentWorkbenchService();
	return new AdapterAuxQueryRunner(workbench, runtimeId, vaultRoot(plugin));
}

function ui(runtimeId: RuntimeId): ProviderChatUIConfig {
	const selection = encodeProviderModelSelectionId(runtimeId, "default");
	return {
		getModelOptions: () => [{ value: selection, label: `${runtimeId === "claude" ? "Claude" : runtimeId === "codex" ? "Codex" : "OhMyPi"} · 运行时默认模型` }],
		ownsModel: (model) => decodeProviderModelSelectionId(model)?.providerId === runtimeId,
		isAdaptiveReasoningModel: () => runtimeId !== "claude",
		getReasoningOptions: () => [{ value: "default", label: "运行时默认" }],
		getDefaultReasoningValue: () => "default",
		getContextWindowSize: () => 1,
		isDefaultModel: (model) => model === selection,
		applyModelDefaults: (model, settings) => { if (settings && typeof settings === "object") (settings as Record<string, unknown>).model = model; },
		normalizeModelVariant: (model) => model || selection,
		getCustomModelIds: () => new Set(),
		getPermissionModeToggle: () => null,
		getProviderIcon: () => RUNTIME_PROVIDER_ICONS[runtimeId],
	};
}

const noOpHistory: ProviderConversationHistoryService = {
	async hydrateConversationHistory() {}, async deleteConversationSession() {},
	resolveSessionIdForConversation: (conversation) => conversation?.sessionId ?? null,
	isPendingForkConversation: () => false,
	buildForkProviderState: (sessionId, resumeAt) => ({ sessionId, resumeAt }),
	buildPersistedProviderState: (conversation: Conversation) => conversation.providerState,
};

const taskInterpreter: ProviderTaskResultInterpreter = {
	hasAsyncLaunchMarker: () => false, extractAgentId: () => null, extractStructuredResult: () => null,
	resolveTerminalStatus: (_result, fallback) => fallback, extractTagValue: () => null,
};

function registration(runtimeId: RuntimeId, base?: ProviderRegistration): ProviderRegistration {
	return {
		displayName: runtimeId === "claude" ? "Claude" : runtimeId === "codex" ? "Codex" : "OhMyPi",
		blankTabOrder: runtimeId === "claude" ? 10 : runtimeId === "codex" ? 20 : 30,
		isEnabled: () => true,
		capabilities: new AdapterCompatibilityRuntime({} as WorkbenchPlugin, runtimeId).getCapabilities(),
		chatUIConfig: runtimeId === "codex" && base ? base.chatUIConfig : ui(runtimeId),
		settingsReconciler: base?.settingsReconciler ?? {
			reconcileModelWithEnvironment: () => ({ changed: false, invalidatedConversations: [] }),
			normalizeModelVariantSettings: () => false,
		},
		createRuntime: ({ plugin }) => new AdapterCompatibilityRuntime(plugin as WorkbenchPlugin, runtimeId),
		createTitleGenerationService: (plugin) => new QueryBackedTitleGenerationService({ createRunner: () => runner(plugin, runtimeId) }),
		createInstructionRefineService: (plugin) => new QueryBackedInstructionRefineService(runner(plugin, runtimeId)),
		createInlineEditService: (plugin) => new QueryBackedInlineEditService(runner(plugin, runtimeId)),
		historyService: base?.historyService ?? noOpHistory,
		taskResultInterpreter: base?.taskResultInterpreter ?? taskInterpreter,
		subagentLifecycleAdapter: base?.subagentLifecycleAdapter,
	};
}

export function registerTalosAdapterProviders(): void {
	if (registered) return;
	ProviderRegistry.register("claude", registration("claude"));
	ProviderRegistry.register("codex", registration("codex", codexProviderRegistration));
	ProviderRegistry.register("ohmypi", registration("ohmypi"));
	registered = true;
}
