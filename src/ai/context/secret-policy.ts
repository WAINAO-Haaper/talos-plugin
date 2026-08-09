export type SecretBlockReason =
	| "unsafe-path"
	| "environment-file"
	| "plugin-data"
	| "talos-private"
	| "secret-storage"
	| "credential-file"
	| "bearer-token"
	| "sensitive-header"
	| "cookie"
	| "private-key"
	| "api-key";

export interface SecretInspection {
	blocked: boolean;
	reasons: SecretBlockReason[];
}

export interface SecretPolicyOptions {
	configDir?: string;
}

function blocked(reason: SecretBlockReason): SecretInspection {
	return { blocked: true, reasons: [reason] };
}

const ALLOWED: SecretInspection = { blocked: false, reasons: [] };

export function inspectVaultPath(
	path: string,
	options: SecretPolicyOptions = {}
): SecretInspection {
	const normalized = path.trim().replace(/\\/g, "/");
	const pathSegments = normalized.split("/");
	if (
		normalized.startsWith("/") ||
		/^[a-zA-Z]:\//.test(normalized) ||
		normalized.includes("\0") ||
		pathSegments.some(
			(segment, index) =>
				segment === "." ||
				segment === ".." ||
				(segment === "" && index > 0)
		)
	) {
		return blocked("unsafe-path");
	}
	const lower = normalized.toLowerCase();
	const segments = lower.split("/");
	const filename = segments[segments.length - 1] ?? "";

	if (/^\.env(?:\.|$)/.test(filename)) {
		return blocked("environment-file");
	}
	const configDir = options.configDir
		?.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.toLowerCase();
	if (
		configDir &&
		lower.startsWith(`${configDir}/plugins/`) &&
		filename === "data.json"
	) {
		return blocked("plugin-data");
	}
	if (lower === ".talos/private" || lower.startsWith(".talos/private/")) {
		return blocked("talos-private");
	}
	if (segments.some((segment) => segment === "secretstorage")) {
		return blocked("secret-storage");
	}
	const stem = filename.replace(/\.[^.]+$/, "");
	if (
		/(^|[-_.])(credential|credentials|token|tokens|api[-_]?key|secret|secrets)([-_.]|$)/i.test(
			stem
		)
	) {
		return blocked("credential-file");
	}
	return ALLOWED;
}

export function inspectVaultContent(
	path: string,
	content: string,
	options: SecretPolicyOptions = {}
): SecretInspection {
	const pathResult = inspectVaultPath(path, options);
	if (pathResult.blocked) return pathResult;

	if (/\bauthorization\s*:\s*bearer\s+\S+/i.test(content)) {
		return blocked("bearer-token");
	}
	if (
		/^\s*(?:x-api-key|api-key|authorization)\s*:\s*\S+/im.test(
			content
		)
	) {
		return blocked("sensitive-header");
	}
	if (/^\s*(?:cookie|set-cookie)\s*:\s*\S+/im.test(content)) {
		return blocked("cookie");
	}
	if (
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(
			content
		)
	) {
		return blocked("private-key");
	}
	if (
		/\b(?:sk-ant-|sk-proj-|sk-live-|sk-)[a-z0-9_-]{12,}\b/i.test(
			content
		)
	) {
		return blocked("api-key");
	}
	return ALLOWED;
}
