import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchConversationCoordinator } from "../src/agent-workbench/core/workbench-conversation-coordinator";
import { ConversationService } from "../src/agent-workbench/core/conversation-service";
import { ClaudianReadonlyImporter, type LegacyImportState } from "../src/agent-workbench/legacy/claudian-readonly-importer";
import { ObsidianLegacyReadAdapter, ObsidianWorkbenchStorage, type VaultDataAdapter } from "../src/agent-workbench/storage/obsidian-workbench-storage";
import { PortableConversationStore } from "../src/agent-workbench/storage/portable-conversation-store";
import { RuntimeBindingStore } from "../src/agent-workbench/storage/runtime-binding-store";

const created: string[] = [];
afterEach(async () => {
	for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true });
});

class NodeVaultAdapter implements VaultDataAdapter {
	constructor(private readonly root: string) {}
	private resolve(relative: string): string { return path.join(this.root, relative); }
	async exists(relative: string): Promise<boolean> {
		try { await access(this.resolve(relative)); return true; } catch { return false; }
	}
	async read(relative: string): Promise<string> { return readFile(this.resolve(relative), "utf8"); }
	async write(relative: string, value: string): Promise<void> { await writeFile(this.resolve(relative), value); }
	async remove(relative: string): Promise<void> { await rm(this.resolve(relative), { force: true }); }
	async rmdir(relative: string, recursive: boolean): Promise<void> {
		await rm(this.resolve(relative), { recursive, force: recursive });
	}
	async mkdir(relative: string): Promise<void> { await mkdir(this.resolve(relative)); }
	async list(relative: string): Promise<{ files: string[]; folders: string[] }> {
		const entries = await readdir(this.resolve(relative), { withFileTypes: true });
		return {
			files: entries.filter((entry) => entry.isFile()).map((entry) => path.posix.join(relative, entry.name)),
			folders: entries.filter((entry) => entry.isDirectory()).map((entry) => path.posix.join(relative, entry.name)),
		};
	}
}

describe("AgentWorkbench composition persistence", () => {
	it("imports legacy bytes read-only and keeps portable events separate from native bindings", async () => {
		const vault = await mkdtemp(path.join(tmpdir(), "talos-composition-"));
		const syntheticHome = path.join(path.sep, "synthetic-home");
		created.push(vault);
		const legacyDirectory = path.join(vault, ".talos", "quyuan", "sessions");
		await mkdir(legacyDirectory, { recursive: true });
		const metadataPath = path.join(legacyDirectory, "legacy.meta.json");
		const messagesPath = path.join(legacyDirectory, "legacy.messages.json");
		const metadataBytes = JSON.stringify({
			id: "legacy",
			providerId: "codex",
			title: "旧会话",
			createdAt: 1,
			updatedAt: 2,
		});
		const messageBytes = JSON.stringify([
			{ id: "u1", role: "user", content: "合成问题", timestamp: 1 },
			{ id: "a1", role: "assistant", content: "合成答案", timestamp: 2 },
		]);
		await writeFile(metadataPath, metadataBytes);
		await writeFile(messagesPath, messageBytes);

		const adapter = new NodeVaultAdapter(vault);
		const portable = new ObsidianWorkbenchStorage(adapter, vault);
		const conversations = new ConversationService(new PortableConversationStore(portable));
		let bindingState: Record<string, unknown> | null = null;
		const bindings = new RuntimeBindingStore({
			read: async () => structuredClone(bindingState),
			write: async (value) => { bindingState = structuredClone(value); },
		});
		const manifestPath = ".talos/agent-workbench/v1/import-manifest.json";
		const importer = new ClaudianReadonlyImporter(
			new ObsidianLegacyReadAdapter(adapter),
			conversations,
			{
				read: () => portable.readJson<LegacyImportState>(manifestPath),
				write: (state) => portable.writeJsonAtomic(manifestPath, state),
			},
		);
		const coordinator = new WorkbenchConversationCoordinator(conversations, bindings, importer);
		await coordinator.initialize();
		expect(coordinator.getImportReport()).toMatchObject({ full: 1, partial: 0, skipped: 0 });
		await coordinator.initialize();
		expect(coordinator.getImportReport()).toMatchObject({ full: 0, skipped: 1 });
		expect(await readFile(metadataPath, "utf8")).toBe(metadataBytes);
		expect(await readFile(messagesPath, "utf8")).toBe(messageBytes);

		const manifest = await coordinator.ensure({
			conversationId: "portable-1",
			title: "Portable",
			runtimeId: "codex",
		});
		await coordinator.appendUser({
			conversationId: manifest.conversationId,
			turnId: "turn-1",
			runtimeId: "codex",
			text: "read " + vault + "/note.md with sk-synthetic-123456789",
			vaultRoot: vault,
		});
		await coordinator.appendRuntimeEvent(manifest.conversationId, {
			schemaVersion: 1,
			eventId: "runtime-1",
			conversationId: "native-session",
			turnId: "turn-1",
			runtimeId: "codex",
			type: "tool.started",
			timestamp: "2026-08-26T00:00:00.000Z",
			nativeId: path.join(syntheticHome, ".codex/native/request.json"),
			payload: { path: vault + "/note.md", vaultRoot: vault, authorization: "Bearer synthetic" },
		}, vault);
		await coordinator.setBinding(manifest.conversationId, {
			runtimeId: "codex",
			sessionId: "native-session",
			nativeResumeToken: vault + "/native/session.jsonl",
		});
		expect(await coordinator.switchRuntime(manifest.conversationId, "ohmypi")).toBe(true);

		const projection = await conversations.store.load(manifest.conversationId);
		expect(projection.events).toHaveLength(3);
		expect(new Set(projection.events.map((event) => event.type))).toEqual(new Set([
			"user.message",
			"tool.started",
			"handoff.created",
		]));
		const portableBytes = JSON.stringify(projection);
		expect(portableBytes).not.toContain(vault);
		expect(portableBytes).not.toContain(syntheticHome);
		expect(portableBytes).not.toContain("sk-synthetic");
		expect(portableBytes).not.toContain("authorization");
		expect(await coordinator.getBinding(manifest.conversationId, "codex")).toMatchObject({
			sessionId: "native-session",
			nativeResumeToken: vault + "/native/session.jsonl",
		});
		await expect(portable.write("../escape.json", "{}")).rejects.toThrow("越过 Vault");
	});

	it("switches an empty new conversation without creating or inheriting handoff context", async () => {
		const vault = await mkdtemp(path.join(tmpdir(), "talos-empty-conversation-"));
		created.push(vault);
		const adapter = new NodeVaultAdapter(vault);
		const portable = new ObsidianWorkbenchStorage(adapter, vault);
		const conversations = new ConversationService(new PortableConversationStore(portable));
		const coordinator = new WorkbenchConversationCoordinator(
			conversations,
			new RuntimeBindingStore({
				read: async () => null,
				write: async () => undefined,
			}),
		);
		const manifest = await conversations.create("新会话", "codex");
		expect(await coordinator.switchRuntime(manifest.conversationId, "claude")).toBe(false);
		const projection = await conversations.store.load(manifest.conversationId);
		expect(projection.events).toEqual([]);
		expect(projection.manifest.selection).toEqual({ runtimeId: "claude" });
		expect(await coordinator.getBinding(manifest.conversationId, "codex")).toBeNull();
		expect(await coordinator.getBinding(manifest.conversationId, "claude")).toBeNull();

		const discardable = await conversations.create("新会话", "codex");
		expect(await coordinator.switchRuntime(discardable.conversationId, "ohmypi")).toBe(false);
		await expect(adapter.rmdir(
			`.talos/agent-workbench/v1/conversations/${discardable.conversationId}/events`,
			false,
		)).rejects.toThrow();
		await expect(conversations.discardEmpty(discardable.conversationId)).resolves.toBe(true);
		await expect(access(path.join(
			vault,
			".talos/agent-workbench/v1/conversations",
			discardable.conversationId,
		))).rejects.toMatchObject({ code: "ENOENT" });

		await conversations.append({
			conversationId: manifest.conversationId,
			turnId: "legacy-empty-handoff",
			runtimeId: "claude",
			type: "handoff.created",
			payload: {
				goal: "",
				recentMessages: [],
				incompleteTasks: [],
				toolResultSummaries: [],
				vaultRelativeReferences: [],
			},
		});
		expect(await coordinator.switchRuntime(manifest.conversationId, "codex")).toBe(false);
		const legacyProjection = await conversations.store.load(manifest.conversationId);
		expect(legacyProjection.events).toHaveLength(1);
		expect(legacyProjection.manifest.selection).toEqual({ runtimeId: "codex" });
	});
});
