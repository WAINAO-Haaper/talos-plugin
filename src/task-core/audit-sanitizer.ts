const SENSITIVE_KEY =
	/(authorization|api[-_]?key|token|secret|cookie|password|credential)/i;
const SENSITIVE_VALUE =
	/(?:Bearer\s+\S+|sk-(?:ant-)?[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|(?:token|api[-_]?key)\s*=\s*\S+)/gi;
const HOME_PATH = /^\/(?:Users|home)\/[^/]+(?<suffix>\/.*)?$/;

function sanitizeString(value: string): string {
	if (SENSITIVE_VALUE.test(value)) {
		SENSITIVE_VALUE.lastIndex = 0;
		return value.replace(SENSITIVE_VALUE, "[REDACTED]");
	}
	SENSITIVE_VALUE.lastIndex = 0;
	const home = HOME_PATH.exec(value);
	if (home) return `[HOME]${home.groups?.suffix || ""}`;
	return value;
}

export function sanitizeAuditValue(value: unknown): unknown {
	if (typeof value === "string") return sanitizeString(value);
	if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item));
	if (!value || typeof value !== "object") return value;

	const sanitized: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		sanitized[key] = SENSITIVE_KEY.test(key)
			? "[REDACTED]"
			: sanitizeAuditValue(nested);
	}
	return sanitized;
}
