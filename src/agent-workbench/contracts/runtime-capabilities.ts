export type CapabilitySupport = "native" | "talos-emulated" | "unavailable";

export interface RuntimeCapabilities {
	session: Record<"resume" | "fork" | "compact" | "rewind" | "steer", CapabilitySupport>;
	input: Record<"text" | "image" | "vaultFile" | "selection", CapabilitySupport>;
	tools: Record<"shell" | "edit" | "mcp" | "skills" | "subagents" | "askUser", CapabilitySupport>;
	control: Record<"plan" | "reasoning" | "serviceTier" | "usage", CapabilitySupport>;
	security: Record<"nativeApproval" | "nativeSandbox" | "networkPolicy" | "externalPathGrant", CapabilitySupport>;
}

export function unavailableCapabilities(): RuntimeCapabilities {
	const unavailable = "unavailable" as const;
	return {
		session: { resume: unavailable, fork: unavailable, compact: unavailable, rewind: unavailable, steer: unavailable },
		input: { text: "native", image: unavailable, vaultFile: unavailable, selection: unavailable },
		tools: { shell: unavailable, edit: unavailable, mcp: unavailable, skills: unavailable, subagents: unavailable, askUser: unavailable },
		control: { plan: unavailable, reasoning: unavailable, serviceTier: unavailable, usage: unavailable },
		security: { nativeApproval: unavailable, nativeSandbox: unavailable, networkPolicy: unavailable, externalPathGrant: "talos-emulated" },
	};
}
