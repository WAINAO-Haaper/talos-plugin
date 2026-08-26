import type { App } from "obsidian";

export interface ProviderUsageMetrics {
	inputTextTokens?: number;
	inputAudioTokens?: number;
	outputTextTokens?: number;
	outputAudioTokens?: number;
	totalTokens?: number;
	searchRequests?: number;
	sourceCount?: number;
}

export interface ProviderUsageAuditPersistence {
	ensureDirectory(path: string): void | Promise<void>;
	append(path: string, value: string): void | Promise<void>;
}

export interface ProviderUsageAuditAppendInput {
	runId: string;
	sessionId: string;
	namespace: "chat" | "voice" | "auxiliary" | "command";
	providerId: string;
	operation: string;
	model: string;
	usage: ProviderUsageMetrics;
}

const AUDIT_DIRECTORY = ".talos/audit";
const AUDIT_PATH = `${AUDIT_DIRECTORY}/provider-usage.jsonl`;
const SAFE_ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const USAGE_METRIC_KEYS = new Set([
	"inputTextTokens",
	"inputAudioTokens",
	"outputTextTokens",
	"outputAudioTokens",
	"totalTokens",
	"searchRequests",
	"sourceCount",
]);

function assertSafeId(label: string, value: string): void {
	if (!SAFE_ID.test(value)) {
		throw new Error(`Invalid provider usage audit ${label}`);
	}
}

function assertUsage(usage: ProviderUsageMetrics): void {
	for (const [name, value] of Object.entries(usage)) {
		if (!USAGE_METRIC_KEYS.has(name)) {
			throw new Error("Invalid provider usage audit " + name);
		}
		if (
			value !== undefined
			&& (!Number.isSafeInteger(value) || value < 0)
		) {
			throw new Error(`Invalid provider usage audit ${name}`);
		}
	}
}

export class ProviderUsageAuditStore {
	constructor(
		private readonly persistence: ProviderUsageAuditPersistence,
		private readonly now: () => string = () => new Date().toISOString()
	) {}

	async append(input: ProviderUsageAuditAppendInput): Promise<void> {
		assertSafeId("runId", input.runId);
		assertSafeId("sessionId", input.sessionId);
		assertSafeId("providerId", input.providerId);
		assertSafeId("operation", input.operation);
		assertSafeId("model", input.model);
		assertUsage(input.usage);
		const record = {
			version: 1,
			at: this.now(),
			runId: input.runId,
			sessionId: input.sessionId,
			namespace: input.namespace,
			providerId: input.providerId,
			operation: input.operation,
			model: input.model,
			usage: { ...input.usage },
		};
		await this.persistence.ensureDirectory(AUDIT_DIRECTORY);
		await this.persistence.append(AUDIT_PATH, `${JSON.stringify(record)}\n`);
	}
}

export function createVaultProviderUsageAuditStore(
	app: App
): ProviderUsageAuditStore {
	const adapter = app.vault.adapter;
	return new ProviderUsageAuditStore({
		ensureDirectory: async () => {
			if (!(await adapter.exists(".talos"))) {
				await adapter.mkdir(".talos");
			}
			if (!(await adapter.exists(AUDIT_DIRECTORY))) {
				await adapter.mkdir(AUDIT_DIRECTORY);
			}
		},
		append: (path, value) => adapter.append(path, value),
	});
}
