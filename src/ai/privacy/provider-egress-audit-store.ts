import type { App } from "obsidian";
import type { ProviderEgressAudit } from "./provider-egress-gate";

export interface ProviderEgressAuditPersistence {
	ensureDirectory(path: string): void | Promise<void>;
	append(path: string, value: string): void | Promise<void>;
}

export interface ProviderEgressAuditAppendInput {
	runId: string;
	turnId: string;
	sessionId: string;
	namespace: "chat" | "voice" | "auxiliary" | "command";
	audit: ProviderEgressAudit;
}

const AUDIT_DIRECTORY = ".talos/audit";
const AUDIT_PATH = `${AUDIT_DIRECTORY}/provider-egress.jsonl`;
const SAFE_ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const SAFE_DIGEST = /^[a-f0-9]{64}$/;

function assertSafeId(label: string, value: string): void {
	if (!SAFE_ID.test(value)) {
		throw new Error(`Invalid provider egress audit ${label}`);
	}
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function assertAudit(audit: ProviderEgressAudit): void {
	assertSafeId("providerId", audit.providerId);
	if (!SAFE_DIGEST.test(audit.contentDigest)) {
		throw new Error("Invalid provider egress audit contentDigest");
	}
	for (const module of audit.modules) {
		if (
			!module ||
			module.length > 160 ||
			hasControlCharacter(module)
		) {
			throw new Error("Invalid provider egress audit module");
		}
	}
	for (const sourceKind of audit.sourceKinds) {
		assertSafeId("sourceKind", sourceKind);
	}
}

export class ProviderEgressAuditStore {
	constructor(
		private readonly persistence: ProviderEgressAuditPersistence,
		private readonly now: () => string = () => new Date().toISOString()
	) {}

	async append(input: ProviderEgressAuditAppendInput): Promise<void> {
		assertSafeId("runId", input.runId);
		assertSafeId("turnId", input.turnId);
		assertSafeId("sessionId", input.sessionId);
		assertAudit(input.audit);
		const record = {
			version: 2,
			at: this.now(),
			runId: input.runId,
			turnId: input.turnId,
			sessionId: input.sessionId,
			namespace: input.namespace,
			providerId: input.audit.providerId,
			modules: [...input.audit.modules],
			sourceKinds: [...input.audit.sourceKinds],
			redactions: { ...input.audit.redactions },
			blockedReasons: [...input.audit.blockedReasons],
			deniedModules: [...input.audit.deniedModules],
			contentDigest: input.audit.contentDigest,
		};
		await this.persistence.ensureDirectory(AUDIT_DIRECTORY);
		await this.persistence.append(
			AUDIT_PATH,
			`${JSON.stringify(record)}\n`
		);
	}
}

export function createVaultProviderEgressAuditStore(
	app: App
): ProviderEgressAuditStore {
	const adapter = app.vault.adapter;
	return new ProviderEgressAuditStore({
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
