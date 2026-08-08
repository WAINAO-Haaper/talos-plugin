import { inspectVaultPath } from "../context/secret-policy";
import {
	auditProviderEgress,
	type ProviderEgressAudit,
	type ProviderEgressInput,
	type ProviderEgressResult,
} from "./provider-egress-gate";

export interface ChatProviderEgressPreflightInput
	extends Omit<ProviderEgressInput, "paths" | "text"> {
	prompt: string;
	historyText?: string;
	contextPaths?: string[];
	externalContextPaths?: string[];
	hasImages?: boolean;
	hasMcpMentions?: boolean;
	readContext(path: string): Promise<string>;
}

function uniqueVaultPaths(paths: string[] | undefined): string[] {
	return [
		...new Set(
			(paths ?? [])
				.map((path) =>
					path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
				)
				.filter(Boolean)
		),
	];
}

function redactionCount(audit: ProviderEgressAudit): number {
	return Object.values(audit.redactions).reduce(
		(total, count) => total + count,
		0
	);
}

function withBlockedReasons(
	result: ProviderEgressResult,
	reasons: ProviderEgressAudit["blockedReasons"]
): ProviderEgressResult {
	const blockedReasons = [...new Set([...result.audit.blockedReasons, ...reasons])];
	if (blockedReasons.length === 0) return result;
	return {
		allowed: false,
		redactedText: "",
		audit: {
			...result.audit,
			blockedReasons,
		},
	};
}

export async function preflightChatProviderEgress(
	input: ChatProviderEgressPreflightInput
): Promise<ProviderEgressResult> {
	const contextPaths = uniqueVaultPaths(input.contextPaths);
	const extraReasons: ProviderEgressAudit["blockedReasons"] = [];

	if ((input.externalContextPaths?.length ?? 0) > 0) {
		extraReasons.push("external-context-not-audited");
	}
	if (input.hasImages) extraReasons.push("image-egress-not-audited");
	if (input.hasMcpMentions) extraReasons.push("mcp-egress-not-audited");

	const blockedPathReasons = [
		...new Set(
			contextPaths.flatMap(
				(path) =>
					inspectVaultPath(path, {
						configDir: input.configDir,
					}).reasons
			)
		),
	];
	if (blockedPathReasons.length > 0) {
		const blocked = await auditProviderEgress({
			providerId: input.providerId,
			vaultAccess: input.vaultAccess,
			moduleAccess: input.moduleAccess,
			vaultSchema: input.vaultSchema,
			configDir: input.configDir,
			paths: contextPaths,
			text: input.prompt,
		});
		return withBlockedReasons(blocked, extraReasons);
	}

	const context: string[] = [];
	for (const path of contextPaths) {
		try {
			context.push(`Context: ${path}\n${await input.readContext(path)}`);
		} catch {
			extraReasons.push("context-read-failed");
		}
	}

	const payload = [
		input.prompt,
		input.historyText?.trim()
			? `Conversation history:\n${input.historyText}`
			: "",
		...context,
	]
		.filter(Boolean)
		.join("\n\n");
	const result = await auditProviderEgress({
		providerId: input.providerId,
		vaultAccess: input.vaultAccess,
		moduleAccess: input.moduleAccess,
		vaultSchema: input.vaultSchema,
		configDir: input.configDir,
		paths: contextPaths,
		text: payload,
	});

	if (result.allowed && redactionCount(result.audit) > 0) {
		extraReasons.push("redaction-required");
	}
	return withBlockedReasons(result, extraReasons);
}
