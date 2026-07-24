import type {
	ProviderCapability,
	TalosProviderKind,
} from "./types";

export interface StoredProviderConfig {
	id: string;
	name: string;
	kind: TalosProviderKind;
	endpoint: string;
	model: string;
	capabilities: ProviderCapability[];
	isDefault: boolean;
	secretRef: string;
	vaultAccess: "full" | "denied";
}

export interface ProviderConfigFile {
	version: 1;
	providers: StoredProviderConfig[];
}

export interface ProviderConfigPersistence {
	read(): string | Promise<string>;
	write(value: string): void | Promise<void>;
}

const ALLOWED_PROVIDER_KEYS = new Set([
	"id",
	"name",
	"kind",
	"endpoint",
	"model",
	"capabilities",
	"isDefault",
	"secretRef",
	"vaultAccess",
]);
const SENSITIVE_KEY = /(^|[-_])(api[-_]?key|token|authorization|password|secret)($|[-_])/i;
const SENSITIVE_VALUE = /(?:authorization\s*:|bearer\s+|[?&](?:api_?key|token)=)/i;

function assertSafeProvider(
	provider: StoredProviderConfig & Record<string, unknown>
): void {
	for (const [key, value] of Object.entries(provider)) {
		if (!ALLOWED_PROVIDER_KEYS.has(key) || SENSITIVE_KEY.test(key)) {
			throw new Error(`Provider config contains forbidden field: ${key}`);
		}
		if (
			key !== "secretRef" &&
			typeof value === "string" &&
			SENSITIVE_VALUE.test(value)
		) {
			throw new Error(`Provider config contains sensitive value in: ${key}`);
		}
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(provider.secretRef)) {
		throw new Error("Provider config secretRef must be a SecretStorage id");
	}
}

export class ProviderConfigStore {
	constructor(private readonly persistence: ProviderConfigPersistence) {}

	async save(config: ProviderConfigFile): Promise<void> {
		for (const provider of config.providers) {
			assertSafeProvider(
				provider as StoredProviderConfig & Record<string, unknown>
			);
		}
		await this.persistence.write(JSON.stringify(config, null, 2));
	}

	async load(): Promise<ProviderConfigFile> {
		const raw = await this.persistence.read();
		if (!raw.trim()) return { version: 1, providers: [] };
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("version" in parsed) ||
			parsed.version !== 1 ||
			!("providers" in parsed) ||
			!Array.isArray(parsed.providers)
		) {
			throw new Error("Invalid provider config");
		}
		const config = parsed as ProviderConfigFile;
		for (const provider of config.providers) {
			assertSafeProvider(
				provider as StoredProviderConfig & Record<string, unknown>
			);
		}
		return config;
	}
}
