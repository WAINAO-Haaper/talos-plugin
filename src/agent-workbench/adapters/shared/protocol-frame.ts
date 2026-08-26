export interface ProtocolFrame {
	id?: string | number;
	method: string;
	params: Record<string, unknown>;
}

export function field(value: unknown, key: string): unknown {
	return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

export function textField(value: unknown, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const candidate = field(value, key);
		if (typeof candidate === "string") return candidate;
	}
	return undefined;
}
