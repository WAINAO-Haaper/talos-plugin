// TALOS 插件屈原 Provider 出库审计与用量记录；由 TalosPlugin 委托调用。
import type { ProviderEgressSourceKind } from "../ai/privacy/provider-egress-gate";
import { type ProviderUsageMetrics, createVaultProviderUsageAuditStore } from "../ai/privacy/provider-usage-audit-store";
import { createVaultProviderEgressAuditStore } from "../ai/privacy/provider-egress-audit-store";
import { preflightChatProviderEgress } from "../ai/privacy/chat-provider-egress-preflight";
import type TalosPlugin from "../main";

export async function auditQuyuanProviderEgress(plugin: TalosPlugin, input: {
		namespace: "chat" | "voice" | "auxiliary";
		kind: ProviderEgressSourceKind;
		providerId: string;
		prompt: string;
		historyText?: string;
		contextPaths?: string[];
		sourcePaths?: string[];
		sourceKinds?: ProviderEgressSourceKind[];
		externalContextPaths?: string[];
		hasImages?: boolean;
		hasMcpMentions?: boolean;
		hasBrowserContext?: boolean;
		sessionId?: string;
	}): Promise<{ allowed: boolean; message?: string }> {
	// Microphone media and the explicitly granted voice-only Vault snippet
	// channel are independently authorized. Neither grant changes the global
	// text-provider switch, and Vault egress still has to name exact source
	// paths and pass the provider/module/secret gate below.
	const isAuthorizedVoiceAudio =
		input.namespace === "voice" && input.kind === "voice-audio";
	const isAuthorizedVoiceVaultSnippet =
		input.namespace === "voice" && input.kind === "vault-snippet";
	const isAuthorizedVoiceWebSearchQuery =
		input.namespace === "voice" && input.kind === "web-search-query";
	const result = await preflightChatProviderEgress({
		providerId: input.providerId,
		vaultAccess: isAuthorizedVoiceAudio
			|| isAuthorizedVoiceVaultSnippet
			|| isAuthorizedVoiceWebSearchQuery
			|| plugin.talosSettings.providerVaultAccess
			? "full"
			: "denied",
		moduleAccess:
			plugin.talosSettings.providerModuleAccess[input.providerId] ?? {},
		vaultSchema: plugin.talosSettings.vaultSchema,
		configDir: plugin.app.vault.configDir,
		prompt: input.prompt,
		historyText: input.historyText,
		contextPaths: input.contextPaths,
		sourcePaths: input.sourcePaths,
		sourceKinds: input.sourceKinds,
		externalContextPaths: input.externalContextPaths,
		hasImages: input.hasImages,
		hasMcpMentions: input.hasMcpMentions,
		hasBrowserContext: input.hasBrowserContext,
		readContext: (path) => plugin.app.vault.adapter.read(path),
	});

	plugin.quyuanChatAuditSequence += 1;
	const stamp = Date.now();
	const suffix = `${stamp}-${plugin.quyuanChatAuditSequence}`;
	const session = (input.sessionId || "new")
		.replace(/[^a-zA-Z0-9._:-]/g, "-")
		.slice(0, 140);
	await createVaultProviderEgressAuditStore(plugin.app).append({
		runId: `${input.namespace}-${input.kind}-run-${suffix}`,
		turnId: `${input.namespace}-${input.kind}-turn-${suffix}`,
		sessionId: `${input.namespace}:${session || "new"}`,
		namespace: input.namespace,
		audit: result.audit,
	});

	if (result.allowed) return { allowed: true };
	return {
		allowed: false,
		message: `Provider 出库隐私审计未通过：${
			result.audit.blockedReasons.join("、") || "安全策略拒绝"
		}`,
	};
}

export async function recordQuyuanProviderUsage(plugin: TalosPlugin, input: {
		namespace: "voice";
		providerId: string;
		operation: string;
		model: string;
		usage: ProviderUsageMetrics;
		sessionId?: string;
	}): Promise<void> {
	plugin.quyuanChatAuditSequence += 1;
	const stamp = Date.now();
	const suffix = String(stamp) + "-" + plugin.quyuanChatAuditSequence;
	const session = (input.sessionId || "new")
		.replace(/[^a-zA-Z0-9._:-]/g, "-")
		.slice(0, 140);
	await createVaultProviderUsageAuditStore(plugin.app).append({
		runId: input.namespace + "-" + input.operation + "-" + suffix,
		sessionId: input.namespace + ":" + (session || "new"),
		namespace: input.namespace,
		providerId: input.providerId,
		operation: input.operation,
		model: input.model,
		usage: input.usage,
	});
}

export async function auditQuyuanChatEgress(plugin: TalosPlugin, input: {
		providerId: string;
		prompt: string;
		historyText?: string;
		currentNotePath?: string;
		editorSourcePaths?: string[];
		canvasSourcePaths?: string[];
		externalContextPaths?: string[];
		hasImages?: boolean;
		hasMcpMentions?: boolean;
		hasBrowserContext?: boolean;
		sessionId?: string;
	}): Promise<{ allowed: boolean; message?: string }> {
	const sourceKinds: ProviderEgressSourceKind[] = ["prompt"];
	if (input.historyText) sourceKinds.push("history");
	if (input.currentNotePath) sourceKinds.push("current-note");
	if (input.editorSourcePaths?.length) sourceKinds.push("editor-selection");
	if (input.canvasSourcePaths?.length) sourceKinds.push("canvas-selection");
	if (input.hasBrowserContext) sourceKinds.push("browser-selection");
	if (input.hasImages) sourceKinds.push("attachment");
	if ((input.externalContextPaths?.length ?? 0) > 0) {
		sourceKinds.push("external-context");
	}
	return auditQuyuanProviderEgress(plugin, {
		namespace: "chat",
		kind: "prompt",
		providerId: input.providerId,
		prompt: input.prompt,
		historyText: input.historyText,
		contextPaths: input.currentNotePath
			? [input.currentNotePath]
			: [],
		sourcePaths: [
			...(input.editorSourcePaths ?? []),
			...(input.canvasSourcePaths ?? []),
		],
		sourceKinds,
		externalContextPaths: input.externalContextPaths,
		hasImages: input.hasImages,
		hasMcpMentions: input.hasMcpMentions,
		hasBrowserContext: input.hasBrowserContext,
		sessionId: input.sessionId,
	});
}
