import {
	inspectVaultContent,
	type SecretBlockReason,
} from "../context/secret-policy";

export interface ProviderEgressInput {
	providerId: string;
	vaultAccess: "full" | "denied";
	paths: string[];
	text: string;
	configDir?: string;
}

export interface ProviderEgressAudit {
	providerId: string;
	modules: string[];
	redactions: {
		email: number;
		phone: number;
		identityNumber: number;
		absolutePath: number;
	};
	blockedReasons: Array<
		SecretBlockReason | "vault-access-denied"
	>;
	contentDigest: string;
}

export interface ProviderEgressResult {
	allowed: boolean;
	redactedText: string;
	audit: ProviderEgressAudit;
}

async function sha256(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function modules(paths: string[]): string[] {
	return [
		...new Set(
			paths
				.map((path) => path.replace(/\\/g, "/").split("/")[0])
				.filter((value): value is string => !!value)
		),
	].sort((left, right) => left.localeCompare(right));
}

function redact(
	text: string,
	pattern: RegExp,
	replacement: string
): { text: string; count: number } {
	let count = 0;
	return {
		text: text.replace(pattern, () => {
			count += 1;
			return replacement;
		}),
		count,
	};
}

export async function auditProviderEgress(
	input: ProviderEgressInput
): Promise<ProviderEgressResult> {
	const digest = await sha256(input.text);
	const baseAudit: ProviderEgressAudit = {
		providerId: input.providerId,
		modules: modules(input.paths),
		redactions: {
			email: 0,
			phone: 0,
			identityNumber: 0,
			absolutePath: 0,
		},
		blockedReasons: [],
		contentDigest: digest,
	};
	if (input.vaultAccess !== "full") {
		return {
			allowed: false,
			redactedText: "",
			audit: {
				...baseAudit,
				blockedReasons: ["vault-access-denied"],
			},
		};
	}

	const inspection = inspectVaultContent(
		input.paths[0] ?? "provider-context.md",
		input.text,
		{ configDir: input.configDir }
	);
	if (inspection.blocked) {
		return {
			allowed: false,
			redactedText: "",
			audit: {
				...baseAudit,
				blockedReasons: inspection.reasons,
			},
		};
	}

	let redacted = input.text;
	const email = redact(
		redacted,
		/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
		"[EMAIL]"
	);
	redacted = email.text;
	const phone = redact(
		redacted,
		/(?<!\d)1[3-9]\d{9}(?!\d)/g,
		"[PHONE]"
	);
	redacted = phone.text;
	const identityNumber = redact(
		redacted,
		/(?<!\d)\d{17}[\dXx](?!\d)/g,
		"[IDENTITY_NUMBER]"
	);
	redacted = identityNumber.text;
	const absolutePath = redact(
		redacted,
		/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)(?:[/\\][^\s]*)?/g,
		"[HOME_PATH]"
	);
	redacted = absolutePath.text;

	return {
		allowed: true,
		redactedText: redacted,
		audit: {
			...baseAudit,
			redactions: {
				email: email.count,
				phone: phone.count,
				identityNumber: identityNumber.count,
				absolutePath: absolutePath.count,
			},
		},
	};
}
