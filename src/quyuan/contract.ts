export type QuyuanProviderId = "claude" | "codex" | "opencode" | "pi";

export type QuyuanCapability =
	| "send"
	| "stream"
	| "cancel"
	| "resume"
	| "history"
	| "fork"
	| "compact"
	| "rewind"
	| "plan-mode"
	| "inline-edit"
	| "diff"
	| "images"
	| "file-context"
	| "selection-context"
	| "external-context"
	| "slash-commands"
	| "skills"
	| "instruction-mode"
	| "mcp"
	| "subagents"
	| "permission-approval"
	| "ask-user"
	| "markdown-rendering"
	| "tool-rendering";

export const QUYUAN_REQUIRED_CAPABILITIES: readonly QuyuanCapability[] = [
	"send",
	"stream",
	"cancel",
	"resume",
	"history",
	"fork",
	"compact",
	"plan-mode",
	"inline-edit",
	"diff",
	"images",
	"file-context",
	"selection-context",
	"external-context",
	"slash-commands",
	"skills",
	"instruction-mode",
	"mcp",
	"subagents",
	"permission-approval",
	"ask-user",
	"markdown-rendering",
	"tool-rendering",
] as const;

export const PROVIDER_SPECIFIC_CAPABILITIES: Readonly<
	Record<QuyuanProviderId, readonly QuyuanCapability[]>
> = {
	claude: ["rewind", "mcp", "subagents"],
	codex: ["fork", "plan-mode", "inline-edit", "skills", "subagents"],
	opencode: ["send", "stream", "resume", "history"],
	pi: ["send", "stream", "resume", "history"],
};

export interface QuyuanCapabilitySnapshot {
	provider: QuyuanProviderId;
	supported: ReadonlySet<QuyuanCapability>;
}

export interface QuyuanContractResult {
	ok: boolean;
	missing: QuyuanCapability[];
	providerMissing: QuyuanCapability[];
}

export function checkQuyuanCapabilityContract(
	snapshot: QuyuanCapabilitySnapshot
): QuyuanContractResult {
	const missing = QUYUAN_REQUIRED_CAPABILITIES.filter(
		(capability) => !snapshot.supported.has(capability)
	);
	const providerMissing = PROVIDER_SPECIFIC_CAPABILITIES[snapshot.provider].filter(
		(capability) => !snapshot.supported.has(capability)
	);
	return {
		ok: missing.length === 0 && providerMissing.length === 0,
		missing,
		providerMissing,
	};
}

