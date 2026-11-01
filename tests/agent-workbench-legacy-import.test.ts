import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConversationManagementService } from "../src/agent-workbench/core/conversation-management-service";
import { ConversationService } from "../src/agent-workbench/core/conversation-service";
import type { ConversationManifest } from "../src/agent-workbench/contracts/conversation";
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
	it.each(["matching-source", "unknown-source", "conflicting-source"] as const)("handles an index publication failure with %s without claiming unrelated data", async (identity) => {
		const legacy = new LegacyFiles(new Map([...syntheticLegacy().files].filter(([file]) => file.includes("/full."))));
		const sourceBefore = legacy.digest();
		const files = new MemoryPortableFiles();
		const store = new PortableConversationStore(files);
		const conversations = new ConversationService(store);
		let state: LegacyImportState | null = null;
		const stateWrites: LegacyImportState[] = [];
		const stateHost = { read: async () => structuredClone(state), write: async (value: LegacyImportState) => {
			state = structuredClone(value); stateWrites.push(structuredClone(value));
		} };
		const indexPath = ".talos/agent-workbench/v1/index.json";
		const replace = files.replace.bind(files);
		let manifestPublished = false;
		let failIndex = true;
		files.replace = async (from, to) => {
			if (to === indexPath && manifestPublished && failIndex) {
				failIndex = false;
				throw new Error("synthetic index replace failure");
			}
			await replace(from, to);
			if (to.endsWith("/manifest.json")) manifestPublished = true;
		};
		await expect(new ClaudianReadonlyImporter(legacy, conversations, stateHost).import()).rejects.toThrow("synthetic index replace failure");
		expect(stateWrites).toEqual([]);
		expect(await store.list()).toEqual([]);
		const manifestPath = [...files.files.keys()].find((file) => file.endsWith("/manifest.json"));
		if (!manifestPath) throw new Error("expected published manifest");
		const saved = JSON.parse(files.files.get(manifestPath)!) as ConversationManifest;
		const edited: ConversationManifest = {
			...saved, title: "User title in unindexed manifest", lifecycle: "archived",
			selection: { runtimeId: "ohmypi", model: "user-model" }, updatedAt: "2099-01-01T00:00:00.000Z",
		};
		if (identity === "unknown-source") delete edited.importedFrom;
		if (identity === "conflicting-source") edited.importedFrom = { ...saved.importedFrom!, sourceDigest: "unrelated-source" };
		const editedBytes = JSON.stringify(edited);
		files.files.set(manifestPath, editedBytes);
		const staleIndex = files.files.get(indexPath);
		const reopened = new ConversationService(new PortableConversationStore(files));
		const retry = new ClaudianReadonlyImporter(legacy, reopened, stateHost);
		if (identity !== "matching-source") {
			await expect(retry.import()).rejects.toThrow("来源身份不匹配");
			expect(files.files.get(manifestPath)).toBe(editedBytes);
			expect(files.files.get(indexPath)).toBe(staleIndex);
			expect(stateWrites).toEqual([]);
			expect([...files.files.keys()].filter((file) => file.includes("/events/") && file.endsWith(".json"))).toEqual([]);
		} else {
			expect(await retry.import()).toMatchObject({ full: 1, partial: 0, skipped: 0 });
			const projection = await reopened.store.load(saved.conversationId);
			expect(projection.manifest).toEqual(edited);
			expect(projection.events.map((event) => event.payload.text)).toEqual(["synthetic question", "synthetic answer"]);
			expect(projection.events.map((event) => event.runtimeId)).toEqual(["claude", "claude"]);
			expect(await reopened.store.list()).toEqual([edited]);
			expect(stateWrites).toHaveLength(1);
			expect(await retry.import()).toMatchObject({ skipped: 1, full: 0 });
			expect((await reopened.store.load(saved.conversationId)).events).toEqual(projection.events);
		}
		expect(legacy.digest()).toBe(sourceBefore);
	});

	it.each(["before-write", "after-write"] as const)("resumes an import interrupted %s without duplicating events or reverting user fields", async (failurePoint) => {
		const legacy = new LegacyFiles(new Map([...syntheticLegacy().files].filter(([file]) => file.includes("/full."))));
		legacy.files.set(".talos/quyuan/sessions/full.messages.json", JSON.stringify([
			{ id: "u1", role: "user", content: "Keep this question", timestamp: 1_700_000_000_100 },
			{ id: "a1", role: "assistant", content: "inspect /etc/passwd", timestamp: 1_700_000_000_200 },
		]));
		const sourceBefore = legacy.digest();
		const files = new MemoryPortableFiles();
		const store = new PortableConversationStore(files);
		const conversations = new ConversationService(store);
		let state: LegacyImportState | null = null;
		const stateWrites: LegacyImportState[] = [];
		const stateHost = { read: async () => structuredClone(state), write: async (value: LegacyImportState) => {
			state = structuredClone(value);
			stateWrites.push(structuredClone(value));
		} };
		const append = conversations.append.bind(conversations);
		let interrupt = true;
		conversations.append = async (input) => {
			if (interrupt) {
				interrupt = false;
				if (failurePoint === "after-write") await append(input);
				throw new Error("synthetic interruption");
			}
			return append(input);
		};
		await expect(new ClaudianReadonlyImporter(legacy, conversations, stateHost).import()).rejects.toThrow("synthetic interruption");
		expect(state).toBeNull();
		const [incomplete] = await store.list();
		expect((await store.load(incomplete.conversationId)).events).toHaveLength(failurePoint === "after-write" ? 1 : 0);
		// Earlier versions could publish full before discovering redacted content.
		files.files.set(`.talos/agent-workbench/v1/conversations/${incomplete.conversationId}/manifest.json`, JSON.stringify({
			...incomplete, importedFrom: { ...incomplete.importedFrom, transcript: "full" },
		}));
		await conversations.rename(incomplete.conversationId, "User title after interruption");
		await conversations.archive(incomplete.conversationId);
		await store.patchManifest(incomplete.conversationId, { selection: { runtimeId: "ohmypi", model: "user-model" } }, "2099-01-01T00:00:00.000Z");
		const reopened = new ConversationService(new PortableConversationStore(files));
		const importer = new ClaudianReadonlyImporter(legacy, reopened, stateHost);
		expect(await importer.import()).toMatchObject({ full: 0, partial: 1, skipped: 0 });
		const projection = await reopened.store.load(incomplete.conversationId);
		expect(projection.manifest).toMatchObject({
			title: "User title after interruption", lifecycle: "archived", updatedAt: "2099-01-01T00:00:00.000Z",
			selection: { runtimeId: "ohmypi", model: "user-model" },
			importedFrom: { ...incomplete.importedFrom, transcript: "partial" },
		});
		expect(projection.events.map((event) => event.payload.text)).toEqual(["Keep this question", "inspect [本机路径已省略]"]);
		expect(projection.events.map((event) => event.runtimeId)).toEqual(["claude", "claude"]);
		expect(new Set(projection.events.map((event) => event.eventId)).size).toBe(2);
		expect(await reopened.store.list()).toHaveLength(1);
		expect(Object.values(stateWrites.at(-1)?.imports ?? {})).toHaveLength(1);
		expect(await importer.import()).toMatchObject({ full: 0, partial: 0, skipped: 1 });
		expect(await reopened.store.load(incomplete.conversationId)).toEqual(projection);
		expect(legacy.digest()).toBe(sourceBefore);
	});

	it("fails closed on conflicting replay content without marking an interrupted import complete", async () => {
		const legacy = new LegacyFiles(new Map([...syntheticLegacy().files].filter(([file]) => file.includes("/full."))));
		const sourceBefore = legacy.digest();
		const files = new MemoryPortableFiles();
		const conversations = new ConversationService(new PortableConversationStore(files));
		let state: LegacyImportState | null = null;
		const stateHost = { read: async () => structuredClone(state), write: async (value: LegacyImportState) => { state = structuredClone(value); } };
		const append = conversations.append.bind(conversations);
		conversations.append = async (input) => { await append(input); throw new Error("synthetic interruption"); };
		await expect(new ClaudianReadonlyImporter(legacy, conversations, stateHost).import()).rejects.toThrow("synthetic interruption");
		const eventPath = [...files.files.keys()].find((file) => file.includes("/events/") && file.endsWith(".json"));
		if (!eventPath) throw new Error("expected persisted event");
		const conflicting = JSON.parse(files.files.get(eventPath)!) as { payload: { text: string } };
		conflicting.payload.text = "Conflicting saved content";
		const conflictingBytes = JSON.stringify(conflicting);
		files.files.set(eventPath, conflictingBytes);
		const reopened = new ConversationService(new PortableConversationStore(files));
		await expect(new ClaudianReadonlyImporter(legacy, reopened, stateHost).import()).rejects.toThrow("eventId 内容冲突");
		expect(state).toBeNull();
		expect(files.files.get(eventPath)).toBe(conflictingBytes);
		expect([...files.files.keys()].filter((file) => file.includes("/events/") && file.endsWith(".json"))).toHaveLength(1);
		expect(legacy.digest()).toBe(sourceBefore);
	});

	it("publishes final transcript metadata once and preserves changes made while appending history", async () => {
		const legacy = new LegacyFiles(new Map([
			[".talos/quyuan/sessions/import.meta.json", JSON.stringify({
				id: "import", title: "Original", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000,
			})],
			[".talos/quyuan/sessions/import.messages.json", JSON.stringify([
				{ id: "u1", role: "user", content: "Keep this history", timestamp: 1_700_000_002_000 },
				{ id: "a1", role: "assistant", content: "inspect /etc/passwd", timestamp: 1_700_000_003_000 },
			])],
		]));
		const before = legacy.digest();
		const conversations = new ConversationService(new PortableConversationStore(new MemoryPortableFiles()), {
			now: () => "2099-01-01T00:00:00.000Z", id: () => "unused",
		});
		let state: LegacyImportState | null = null;
		const append = conversations.append.bind(conversations);
		let first = true;
		conversations.append = async (input) => {
			if (first) {
				first = false;
				expect((await conversations.store.load(input.conversationId)).manifest.importedFrom?.transcript).toBe("partial");
				await conversations.rename(input.conversationId, "User title");
				await conversations.archive(input.conversationId);
			}
			return append(input);
		};
		const importer = new ClaudianReadonlyImporter(legacy, conversations, {
			read: async () => state, write: async (value) => { state = structuredClone(value); },
		});
		expect(await importer.import()).toMatchObject({ full: 0, partial: 1, skipped: 0, corrupt: 0 });
		const [manifest] = await conversations.store.list();
		expect(manifest).toMatchObject({ title: "User title", lifecycle: "archived",
			updatedAt: "2099-01-01T00:00:00.000Z", importedFrom: { transcript: "partial" } });
		const projection = await conversations.store.load(manifest.conversationId);
		expect(projection.events.map((event) => event.payload.text)).toEqual(["Keep this history", "inspect [本机路径已省略]"]);
		expect(await importer.import()).toMatchObject({ partial: 0, skipped: 1 });
		expect((await conversations.store.list())[0]).toEqual(manifest);
		expect(legacy.digest()).toBe(before);
	});

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
