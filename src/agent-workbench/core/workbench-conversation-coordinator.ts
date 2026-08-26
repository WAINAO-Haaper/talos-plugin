import type { AgentEvent } from "../contracts/agent-events";
import type { ConversationManifest } from "../contracts/conversation";
import type { NativeSessionBinding, RuntimeId } from "../contracts/runtime-adapter";
import type { ClaudianReadonlyImporter, LegacyImportReport } from "../legacy/claudian-readonly-importer";
import { RuntimeBindingStore } from "../storage/runtime-binding-store";
import { ContextHandoffService } from "./context-handoff-service";
import { ConversationService } from "./conversation-service";

export interface CompatibilityConversationIdentity {
	conversationId: string;
	title?: string;
	createdAt?: number | string;
	updatedAt?: number | string;
	runtimeId: RuntimeId;
}

const FORBIDDEN_KEY = /(?:secret|token|password|authorization|cookie|executablePath|vaultRoot)/i;
const SECRET = /\b(?:bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,})\b/gi;
const POSIX_ABSOLUTE = /(^|[\s("'=:[{,])\/(?!\/)(?:[A-Za-z0-9._~+-]+\/)+[A-Za-z0-9._~+-]+/g;
const WINDOWS_ABSOLUTE = /\b[A-Za-z]:\\[^\s"'<>)}\]]+/g;

function iso(value: number | string | undefined, fallback: string): string {
	if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
	if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
	return fallback;
}

function sanitizeString(value: string, vaultRoot: string): string {
	let result = value;
	const normalizedRoot = vaultRoot.replace(/\\/g, "/").replace(/\/$/, "");
	if (normalizedRoot) result = result.split(normalizedRoot).join(".");
	result = result.replace(SECRET, "[凭据已省略]");
	result = result.replace(POSIX_ABSOLUTE, (_match, prefix: string) => prefix + "[本机路径已省略]");
	result = result.replace(WINDOWS_ABSOLUTE, "[本机路径已省略]");
	return result;
}

function sanitizeValue(value: unknown, vaultRoot: string): unknown {
	if (typeof value === "string") return sanitizeString(value, vaultRoot);
	if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, vaultRoot));
	if (!value || typeof value !== "object") return value;
	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (FORBIDDEN_KEY.test(key)) continue;
		result[key] = sanitizeValue(child, vaultRoot);
	}
	return result;
}

export class WorkbenchConversationCoordinator {
	private importReport: LegacyImportReport | null = null;
	private readonly handoffs = new ContextHandoffService();

	constructor(
		readonly conversations: ConversationService,
		readonly bindings: RuntimeBindingStore,
		private readonly importer?: ClaudianReadonlyImporter,
	) {}

	async initialize(): Promise<void> {
		await this.conversations.store.list();
		if (this.importer) this.importReport = await this.importer.import();
	}

	getImportReport(): LegacyImportReport | null {
		return this.importReport ? { ...this.importReport } : null;
	}

	async ensure(input: CompatibilityConversationIdentity): Promise<ConversationManifest> {
		const existing = (await this.conversations.store.list()).find((item) => item.conversationId === input.conversationId);
		if (existing) return existing;
		const now = new Date().toISOString();
		const manifest: ConversationManifest = {
			schemaVersion: 1,
			conversationId: input.conversationId,
			title: input.title?.trim() || "新会话",
			createdAt: iso(input.createdAt, now),
			updatedAt: iso(input.updatedAt, now),
			lifecycle: "active",
			selection: { runtimeId: input.runtimeId },
		};
		await this.conversations.store.create(manifest);
		return manifest;
	}

	async appendUser(input: {
		conversationId: string;
		turnId: string;
		runtimeId: RuntimeId;
		text: string;
		vaultRoot: string;
	}): Promise<AgentEvent> {
		return this.conversations.append({
			conversationId: input.conversationId,
			turnId: input.turnId,
			runtimeId: input.runtimeId,
			type: "user.message",
			payload: { text: sanitizeString(input.text, input.vaultRoot) },
		});
	}

	async appendRuntimeEvent(conversationId: string, event: AgentEvent, vaultRoot: string): Promise<AgentEvent> {
		const portable: AgentEvent = {
			...event,
			conversationId,
			payload: sanitizeValue(event.payload, vaultRoot) as Record<string, unknown>,
		};
		await this.conversations.store.append(portable);
		return portable;
	}

	async switchRuntime(conversationId: string, toRuntimeId: RuntimeId): Promise<void> {
		const projection = await this.conversations.store.load(conversationId);
		const fromRuntimeId = projection.manifest.selection.runtimeId;
		if (fromRuntimeId === toRuntimeId) return;
		const envelope = this.handoffs.create({
			conversationId,
			fromRuntimeId,
			toRuntimeId,
			events: projection.events,
		});
		await this.conversations.append({
			conversationId,
			turnId: "handoff-" + crypto.randomUUID(),
			runtimeId: fromRuntimeId,
			type: "handoff.created",
			payload: envelope as unknown as Record<string, unknown>,
		});
		await this.conversations.store.updateManifest({
			...projection.manifest,
			selection: { ...projection.manifest.selection, runtimeId: toRuntimeId },
			updatedAt: new Date().toISOString(),
		});
	}

	getBinding(conversationId: string, runtimeId: RuntimeId): Promise<NativeSessionBinding | null> {
		return this.bindings.get(conversationId, runtimeId);
	}

	setBinding(conversationId: string, binding: NativeSessionBinding): Promise<void> {
		return this.bindings.set(conversationId, binding);
	}
}
