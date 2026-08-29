import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConversationManagementService } from "../src/agent-workbench/core/conversation-management-service";
import { ConversationService } from "../src/agent-workbench/core/conversation-service";
import { ClaudianReadonlyImporter, type LegacyImportState, type LegacyReadAdapter } from "../src/agent-workbench/legacy/claudian-readonly-importer";
import { PortableConversationStore, type PortableFileAdapter } from "../src/agent-workbench/storage/portable-conversation-store";

class MemoryPortableFiles implements PortableFileAdapter {
	files = new Map<string, string>(); folders = new Set<string>();
	async exists(path: string) { return this.files.has(path) || this.folders.has(path); }
	async read(path: string) { const value = this.files.get(path); if (value === undefined) throw new Error("missing"); return value; }
	async write(path: string, value: string) { this.files.set(path, value); }
	async rename(from: string, to: string) { this.files.set(to, await this.read(from)); this.files.delete(from); }
	async replace(from: string, to: string) { await this.rename(from, to); }
	async remove(path: string) { this.files.delete(path); }
	async mkdir(path: string) { this.folders.add(path); }
	async list(path: string) {
		const prefix = `${path}/`; const files = new Set<string>(); const folders = new Set<string>();
		for (const key of [...this.files.keys(), ...this.folders]) {
			if (!key.startsWith(prefix)) continue;
			const suffix = key.slice(prefix.length); const slash = suffix.indexOf("/");
			if (slash < 0 && this.files.has(key)) files.add(suffix); else if (slash >= 0) folders.add(suffix.slice(0, slash)); else if (suffix) folders.add(suffix);
		}
		return { files: [...files], folders: [...folders] };
	}
}

class LegacyFiles implements LegacyReadAdapter {
	constructor(readonly files: Map<string, string>) {}
	async listFiles(root: string) { return [...this.files.keys()].filter((path) => path.startsWith(`${root}/`)); }
	async read(path: string) { const value = this.files.get(path); if (value === undefined) throw new Error("missing"); return value; }
	digest() { return createHash("sha256").update([...this.files].sort().map(([path, value]) => `${path}\0${value}`).join("\n")).digest("hex"); }
}

function syntheticLegacy() {
	const root = ".talos/quyuan/sessions";
	return new LegacyFiles(new Map([
		[`${root}/full.meta.json`, JSON.stringify({ id: "full", providerId: "claude", title: "完整历史", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000 })],
		[`${root}/full.messages.json`, JSON.stringify([{ id: "u1", role: "user", content: "synthetic question", timestamp: 1_700_000_000_100 }, { id: "a1", role: "assistant", content: "synthetic answer", timestamp: 1_700_000_000_200 }])],
		[`${root}/partial.meta.json`, JSON.stringify({ id: "partial", providerId: "codex", title: "仅元数据历史", createdAt: 1_700_000_002_000, updatedAt: 1_700_000_003_000 })],
		[`${root}/corrupt.meta.json`, "{broken"],
	]));
}

describe("ClaudianReadonlyImporter", () => {
	it("imports full/partial data idempotently while preserving every legacy byte", async () => {
		const legacy = syntheticLegacy(); const before = legacy.digest();
		const conversations = new ConversationService(new PortableConversationStore(new MemoryPortableFiles()), { now: () => "2026-08-26T00:00:00.000Z", id: () => "generated" });
		let state: LegacyImportState | null = null;
		const stateWrites: LegacyImportState[] = [];
		const importer = new ClaudianReadonlyImporter(legacy, conversations, { read: async () => state, write: async (value) => {
			state = structuredClone(value);
			stateWrites.push(structuredClone(value));
		} });
		const first = await importer.import();
		expect(first).toMatchObject({ full: 1, partial: 1, corrupt: 1, skipped: 0 });
		expect(first.sourceAggregateAfter).toBe(first.sourceAggregateBefore);
		expect(legacy.digest()).toBe(before);
		expect(Object.values(stateWrites.at(-1)?.imports ?? {}).map((entry) => entry.legacyConversationId).sort()).toEqual(["full", "partial"]);
		const second = await importer.import();
		expect(second).toMatchObject({ full: 0, partial: 0, corrupt: 1, skipped: 2 });
		expect(await conversations.store.list()).toHaveLength(2);
		expect(legacy.digest()).toBe(before);
		// The legacy reader remains able to parse the original source after a binary rollback.
		expect(JSON.parse(await legacy.read(".talos/quyuan/sessions/full.meta.json"))).toMatchObject({ id: "full" });
	});

	it("reimports sidecar-only changes and redacts paths from messages and titles", async () => {
		const legacy = syntheticLegacy();
		const conversations = new ConversationService(new PortableConversationStore(new MemoryPortableFiles()), { now: () => "2026-08-26T00:00:00.000Z", id: () => "generated" });
		let state: LegacyImportState | null = null;
		const importer = new ClaudianReadonlyImporter(legacy, conversations, { read: async () => state, write: async (value) => { state = structuredClone(value); } });
		await importer.import();
		const messagesPath = ".talos/quyuan/sessions/full.messages.json";
		legacy.files.set(messagesPath, JSON.stringify([
			{ id: "u1", role: "user", content: "inspect /etc/passwd", timestamp: 1_700_000_000_100 },
			{ id: "a1", role: "assistant", content: "synthetic answer", timestamp: 1_700_000_000_200 },
		]));
		expect(await importer.import()).toMatchObject({ full: 0, partial: 1, corrupt: 1, skipped: 1 });
		const metadataPath = ".talos/quyuan/sessions/full.meta.json";
		const metadata = JSON.parse(await legacy.read(metadataPath)) as Record<string, unknown>;
		legacy.files.set(metadataPath, JSON.stringify({ ...metadata, title: "legacy /etc/passwd" }));
		expect(await importer.import()).toMatchObject({ full: 0, partial: 1, corrupt: 1, skipped: 1 });
		const manifests = await conversations.store.list();
		expect(manifests).toHaveLength(4);
		for (const manifest of manifests) {
			const portable = JSON.stringify(await conversations.store.load(manifest.conversationId));
			expect(portable).not.toContain("/etc/passwd");
		}
	});

	it("manages imported conversations through overlays and exports previews only inside the Vault", async () => {
		const legacy = syntheticLegacy();
		const conversations = new ConversationService(new PortableConversationStore(new MemoryPortableFiles()), { now: () => "2026-08-26T00:00:00.000Z", id: () => "generated" });
		let state: LegacyImportState | null = null; const exports = new Map<string, string>();
		await new ClaudianReadonlyImporter(legacy, conversations, { read: async () => state, write: async (value) => { state = structuredClone(value); } }).import();
		const management = new ConversationManagementService(conversations, { write: async (path, content) => { exports.set(path, content); } });
		const [full] = await management.search("synthetic answer");
		expect(full?.title).toBe("完整历史");
		if (!full) throw new Error("expected imported full conversation");
		await conversations.rename(full.conversationId, "新标题");
		await conversations.archive(full.conversationId);
		expect((await conversations.store.load(full.conversationId)).manifest).toMatchObject({ title: "新标题", lifecycle: "archived" });
		await conversations.restore(full.conversationId); await conversations.softDelete(full.conversationId);
		expect((await conversations.store.load(full.conversationId)).manifest.lifecycle).toBe("deleted");
		await management.exportPreview(full.conversationId, "70 输出/synthetic-export.md");
		expect(exports.get("70 输出/synthetic-export.md")).toContain("synthetic answer");
		await expect(management.exportPreview(full.conversationId, "/tmp/out.md")).rejects.toThrow("相对路径");
	});
});
