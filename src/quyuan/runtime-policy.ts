export type TalosRuntimeChannel = "chat" | "voice" | "auxiliary";

export type TalosApprovalPolicy = "never" | "untrusted" | "on-request";

export interface EffectiveRuntimePolicy {
	channel: TalosRuntimeChannel;
	requestedPermissionMode: string;
	effectivePermissionMode: "normal" | "plan";
	approvalPolicy: TalosApprovalPolicy;
	sandbox: "read-only" | "workspace-write";
	networkAccess: boolean;
	allowShell: boolean;
	allowMutations: boolean;
	uiLabel: string;
}

export const TALOS_RUNTIME_CHANNEL_SETTING = "talosRuntimeChannel";

// Explicit 2026-08-26 user authorization: voice media may use the configured
// Realtime provider. A later bounded authorization allows only current-turn
// Qwen search queries after an explicit spoken command. The agent/tool process
// remains independently network-isolated below.
export const VOICE_NETWORK_IO_ALLOWED = true as const;
export const VOICE_QWEN_WEB_SEARCH_ALLOWED: boolean = true;

export interface RealtimeVoiceIoSettings {
	voiceAgentCommand: string;
	voicePermission: string;
	ttsEngine: string;
	jarvisSttEngine: string;
	quyuanAsrEngine: string;
	quyuanLocalAsrNetworkConsent: boolean;
	quyuanVadNetworkConsent: boolean;
}

export function enforceRealtimeVoiceIoSettings<T extends RealtimeVoiceIoSettings>(
	settings: T
): T {
	settings.voiceAgentCommand = "";
	settings.voicePermission = "readonly";
	settings.ttsEngine = "realtime";
	settings.jarvisSttEngine = "realtime";
	settings.quyuanAsrEngine = "qwen-realtime";
	settings.quyuanLocalAsrNetworkConsent = false;
	settings.quyuanVadNetworkConsent = false;
	return settings;
}

const VOICE_READ_TOOLS = new Set([
	"read",
	"glob",
	"grep",
	"search",
]);

const SHELL_TOOLS = new Set([
	"bash",
	"command_execution",
	"unified_exec",
	"shell_tool",
]);

const MUTATION_TOOLS = new Set([
	"write",
	"edit",
	"multiedit",
	"notebookedit",
	"applypatch",
	"apply_patch",
	"inline-edit",
	"delete",
	"move",
	"file_change",
]);

export function runtimeChannelFromSettings(
	settings: Record<string, unknown>
): TalosRuntimeChannel {
	const value = settings[TALOS_RUNTIME_CHANNEL_SETTING];
	if (value === "voice" || value === "auxiliary") return value;
	return "chat";
}

/**
 * Resolve the policy that actually reaches the provider runtime. Persisted user
 * settings are treated as preferences and can never widen the TALOS channel cap.
 */
export function resolveEffectiveRuntimePolicy(input: {
	channel: TalosRuntimeChannel;
	permissionMode?: unknown;
	sandboxMode?: unknown;
}): EffectiveRuntimePolicy {
	const requestedPermissionMode =
		typeof input.permissionMode === "string" ? input.permissionMode : "normal";

	if (input.channel === "voice") {
		return {
			channel: "voice",
			requestedPermissionMode,
			effectivePermissionMode: "normal",
			approvalPolicy: "never",
			sandbox: "read-only",
			// Provider media egress is governed by VOICE_NETWORK_IO_ALLOWED.
			// The Codex/tool process itself remains network-isolated.
			networkAccess: false,
			allowShell: false,
			allowMutations: false,
			uiLabel: "语音只读 · 音频/明确检索联网 · 禁写/命令",
		};
	}

	if (input.channel === "auxiliary") {
		return {
			channel: "auxiliary",
			requestedPermissionMode,
			effectivePermissionMode: "normal",
			approvalPolicy: "never",
			sandbox: "read-only",
			networkAccess: false,
			allowShell: false,
			allowMutations: false,
			uiLabel: "辅助调用 · 只读",
		};
	}

	const plan = requestedPermissionMode === "plan";
	const sandbox =
		!plan && input.sandboxMode === "workspace-write"
			? "workspace-write"
			: "read-only";
	return {
		channel: "chat",
		requestedPermissionMode,
		effectivePermissionMode: plan ? "plan" : "normal",
		// `yolo` is deliberately clamped: it cannot bypass the selected sandbox,
		// and every permitted mutation still crosses the TALOS approval callback.
		approvalPolicy: "untrusted",
		sandbox,
		networkAccess: false,
		allowShell: !plan,
		allowMutations: sandbox === "workspace-write",
		uiLabel: plan
			? "Plan · 只读"
			: sandbox === "workspace-write"
				? "Safe · A 自动 / B-C 审批"
				: "Safe · 只读",
	};
}

export type RuntimeToolBoundaryDecision = "allow" | "approval" | "deny";

export function evaluateRuntimeToolBoundary(
	policy: EffectiveRuntimePolicy,
	toolName: string
): RuntimeToolBoundaryDecision {
	const normalized = toolName.trim().toLowerCase();

	if (policy.channel === "voice" || policy.channel === "auxiliary") {
		return VOICE_READ_TOOLS.has(normalized) ? "allow" : "deny";
	}

	if (SHELL_TOOLS.has(normalized)) {
		return policy.allowShell ? "approval" : "deny";
	}
	if (normalized === "permissions") {
		return "deny";
	}
	if (MUTATION_TOOLS.has(normalized)) {
		return policy.allowMutations ? "approval" : "deny";
	}
	return "allow";
}
