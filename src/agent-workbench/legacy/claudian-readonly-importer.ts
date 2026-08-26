import { createHash } from "node:crypto";
import type { ConversationManifest } from "../contracts/conversation";
import { ConversationService } from "../core/conversation-service";

export interface LegacyReadAdapter {
	listFiles(root: string): Promise<string[]>;
	read(path: string): Promise<string>;
}

export interface LegacyImportState {
	schemaVersion: 1;
	imports: Record<string, { conversationId: string; sourceDigest: string; transcript: "full" | "partial" }>;
}

export interface LegacyImportStateHost {
	read(): Promise<LegacyImportState | null>;
	write(state: LegacyImportState): Promise<void>;
}

export interface LegacyImportReport {
	full: number;
	partial: number;
	corrupt: number;
	skipped: number;
	sourceFileCount: number;
	sourceAggregateBefore: string;
	sourceAggregateAfter: string;
}

interface LegacyMetadata {
	id: string;
	providerId?: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

interface LegacyMessage { id?: string; role: "user" | "assistant"; content: string; timestamp?: number; }

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function sanitizeText(value: string): { text: string; redacted: boolean } {
	let redacted = false;
	let text = value.replace(/(^|[\s("'=:[{,])\/(?!\/)(?:[A-Za-z0-9._~+-]+\/)+[A-Za-z0-9._~+-]+|[A-Za-z]:\\[^\s"'<>)}\]]+/g, (_match, prefix: string | undefined) => { redacted = true; return prefix ? `${prefix}[本机路径已省略]` : "[本机路径已省略]"; });
	text = text.replace(/\b(?:bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,})\b/gi, () => { redacted = true; return "[凭据已省略]"; });
	return { text, redacted };
}

function validMetadata(value: unknown): value is LegacyMetadata {
	const item = value as Partial<LegacyMetadata> | null;
	return Boolean(item && typeof item.id === "string" && typeof item.title === "string"
		&& typeof item.createdAt === "number" && typeof item.updatedAt === "number");
}

export class ClaudianReadonlyImporter {
	constructor(
		private readonly legacy: LegacyReadAdapter,
		private readonly conversations: ConversationService,
		private readonly stateHost: LegacyImportStateHost,
		private readonly roots = [".talos/quyuan/sessions", ".talos/quyuan/legacy-sessions"],
	) {}

	private async snapshot(): Promise<{ files: Map<string, string>; aggregate: string }> {
		const files = new Map<string, string>();
		for (const root of this.roots) {
			for (const path of (await this.legacy.listFiles(root)).sort()) files.set(path, await this.legacy.read(path));
		}
		const aggregate = digest([...files].map(([path, value]) => `${path}\0${digest(value)}`).join("\n"));
		return { files, aggregate };
	}

	async import(): Promise<LegacyImportReport> {
		const before = await this.snapshot();
		const state = (await this.stateHost.read()) ?? { schemaVersion: 1 as const, imports: {} };
		const existing = new Map((await this.conversations.store.list())
			.filter((manifest) => manifest.importedFrom)
			.map((manifest) => [manifest.importedFrom!.sourceDigest, manifest]));
		const report = { full: 0, partial: 0, corrupt: 0, skipped: 0, sourceFileCount: before.files.size, sourceAggregateBefore: before.aggregate, sourceAggregateAfter: "" };
		for (const [path, raw] of before.files) {
			if (!path.endsWith(".meta.json")) continue;
			const sidecarPath = path.replace(/\.meta\.json$/, ".messages.json");
			const sidecar = before.files.get(sidecarPath);
			const sourceDigest = digest(`${path}\0${raw}\0${sidecar ?? ""}`);
			if (state.imports[sourceDigest] || existing.has(sourceDigest)) { report.skipped += 1; continue; }
			let metadata: LegacyMetadata;
			try { const value: unknown = JSON.parse(raw); if (!validMetadata(value)) throw new Error("invalid"); metadata = value; }
			catch { report.corrupt += 1; continue; }
			let messages: LegacyMessage[] = [];
			let transcript: "full" | "partial" = "partial";
			if (sidecar !== undefined) {
				try {
					const value: unknown = JSON.parse(sidecar);
					if (!Array.isArray(value)) throw new Error("invalid messages");
					messages = value.filter((item): item is LegacyMessage => Boolean(item && typeof item === "object" && ["user", "assistant"].includes((item as LegacyMessage).role) && typeof (item as LegacyMessage).content === "string"));
					transcript = messages.length === value.length ? "full" : "partial";
				} catch { transcript = "partial"; }
			}
			const title = sanitizeText(metadata.title);
			if (title.redacted) transcript = "partial";
			const conversationId = `claudian-${digest(`${metadata.id}\0${sourceDigest}`).slice(0, 24)}`;
			const manifest: ConversationManifest = {
				schemaVersion: 1, conversationId, title: title.text.trim() || "导入会话",
				createdAt: new Date(metadata.createdAt).toISOString(), updatedAt: new Date(metadata.updatedAt).toISOString(),
				lifecycle: "active", selection: { runtimeId: metadata.providerId === "claude" ? "claude" : "codex" },
				importedFrom: { kind: "claudian", sourceDigest, transcript },
			};
			await this.conversations.store.create(manifest);
			for (const [index, message] of messages.entries()) {
				const sanitized = sanitizeText(message.content);
				if (sanitized.redacted) transcript = "partial";
				await this.conversations.append({
					eventId: `legacy-${digest(`${sourceDigest}:${message.id ?? index}`).slice(0, 32)}`,
					conversationId, turnId: `legacy-turn-${Math.floor(index / 2)}`, runtimeId: manifest.selection.runtimeId,
					type: message.role === "user" ? "user.message" : "assistant.final",
					timestamp: new Date(message.timestamp ?? metadata.updatedAt).toISOString(), payload: { text: sanitized.text, imported: true },
				});
			}
			if (transcript !== manifest.importedFrom!.transcript) {
				manifest.importedFrom = { ...manifest.importedFrom!, transcript };
				await this.conversations.store.updateManifest(manifest);
			}
			state.imports[sourceDigest] = { conversationId, sourceDigest, transcript };
			await this.stateHost.write(state);
			report[transcript] += 1;
		}
		const after = await this.snapshot();
		report.sourceAggregateAfter = after.aggregate;
		if (after.aggregate !== before.aggregate) throw new Error("旧 Claudian 源数据在导入期间发生变化");
		return report;
	}
}
