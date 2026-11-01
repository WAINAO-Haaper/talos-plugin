import { access, mkdir, mkdtemp, readFile, readdir, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ObsidianWorkbenchStorage } from "../src/agent-workbench/storage/obsidian-workbench-storage";
import { describe, expect, it } from "vitest";
import { createAgentEvent } from "../src/agent-workbench/contracts/agent-events";
import type { ConversationManifest } from "../src/agent-workbench/contracts/conversation";
import { hasMeaningfulHandoffContext } from "../src/agent-workbench/storage/conversation-projection";
import { ConversationService } from "../src/agent-workbench/core/conversation-service";
import { WorkbenchConversationCoordinator } from "../src/agent-workbench/core/workbench-conversation-coordinator";
import {
	assertPortableValue,
	PortableConversationStore,
	sanitizePortableString,
	type PortableFileAdapter,
} from "../src/agent-workbench/storage/portable-conversation-store";
import { RuntimeBindingStore } from "../src/agent-workbench/storage/runtime-binding-store";

class MemoryFiles implements PortableFileAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	async exists(path: string) { return this.files.has(path) || this.folders.has(path); }
	async read(path: string) {
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`missing: ${path}`);
		return value;
	}
	async write(path: string, value: string) { this.files.set(path, value); }
	async rename(from: string, to: string) {
		const value = await this.read(from);
		this.files.set(to, value);
		this.files.delete(from);
	}
	async replace(from: string, to: string) { await this.rename(from, to); }
	async remove(path: string) {
		if (this.folders.has(path)) throw new Error(`remove cannot delete directory: ${path}`);
		this.files.delete(path);
	}
	async rmdir(path: string, recursive: boolean) {
		const prefix = `${path}/`;
		const children = [...this.files.keys(), ...this.folders].filter((candidate) => candidate.startsWith(prefix));
		if (!recursive && children.length > 0) throw new Error(`directory not empty: ${path}`);
		for (const candidate of children) {
			this.files.delete(candidate);
			this.folders.delete(candidate);
		}
		this.folders.delete(path);
	}
	async mkdir(path: string) { this.folders.add(path); }
	async list(path: string) {
		const prefix = `${path}/`;
		const files = new Set<string>();
		const folders = new Set<string>();
		for (const candidate of this.files.keys()) {
			if (!candidate.startsWith(prefix)) continue;
			const suffix = candidate.slice(prefix.length);
			const slash = suffix.indexOf("/");
			if (slash < 0) files.add(suffix);
			else folders.add(suffix.slice(0, slash));
		}
		for (const candidate of this.folders) {
			if (!candidate.startsWith(prefix)) continue;
			const suffix = candidate.slice(prefix.length);
			if (suffix && !suffix.includes("/")) folders.add(suffix);
		}
		return { files: [...files], folders: [...folders] };
	}
}

const manifest: ConversationManifest = {
	schemaVersion: 1,
	conversationId: "conv-1",
	title: "Portable",
	createdAt: "2026-08-26T00:00:00.000Z",
	updatedAt: "2026-08-26T00:00:00.000Z",
	lifecycle: "active",
	selection: { runtimeId: "codex" },
};

function event(id = "event-1") {
	return createAgentEvent({
		eventId: id,
		conversationId: "conv-1",
		turnId: "turn-1",
		runtimeId: "codex",
		type: "assistant.final",
		timestamp: "2026-08-26T00:00:01.000Z",
		payload: { text: "done", vaultPath: "00 收件箱/test.md" },
	});
}

describe("PortableConversationStore", () => {
	it("repairs import completeness only for the expected source identity", async () => {
		const store = new PortableConversationStore(new MemoryFiles());
		const importedFrom = { kind: "claudian" as const, sourceDigest: "expected-source", transcript: "full" as const };
		await store.create({ ...manifest, importedFrom });
		await Promise.all([
			store.patchManifest("conv-1", { title: "User title", lifecycle: "archived" }, "2099-01-01T00:00:00.000Z"),
			store.setImportTranscript("conv-1", "expected-source", "partial"),
		]);
		const updated = (await store.load("conv-1")).manifest;
		expect(updated).toMatchObject({ title: "User title", lifecycle: "archived", updatedAt: "2099-01-01T00:00:00.000Z",
			importedFrom: { kind: "claudian", sourceDigest: "expected-source", transcript: "partial" } });
		await expect(store.setImportTranscript("conv-1", "other-source", "full")).rejects.toThrow("来源身份不匹配");
		expect((await store.load("conv-1")).manifest).toEqual(updated);
		expect((await store.list())[0]).toEqual(updated);
	});

	it("merges concurrent manifest fields and never rolls activity time backward", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		const peer = new PortableConversationStore(files);
		const importedFrom = { kind: "claudian" as const, sourceDigest: "source-digest", transcript: "full" as const };
		await store.create({ ...manifest, importedFrom });
		await Promise.all([
			store.patchManifest("conv-1", { title: "Renamed" }, "2026-08-26T00:00:03.000Z"),
			peer.patchManifest("conv-1", { selection: { runtimeId: "claude", model: "model-1" } }, "2026-08-26T00:00:02.000Z"),
			store.setLifecycle("conv-1", "deleted"),
			peer.touch("conv-1", "2099-01-01T00:00:00.000Z"),
		]);
		const stored = (await store.load("conv-1")).manifest;
		expect(stored).toEqual({
			...manifest, title: "Renamed", selection: { runtimeId: "claude", model: "model-1" },
			lifecycle: "deleted", updatedAt: "2099-01-01T00:00:00.000Z", importedFrom,
		});
		expect((await peer.list())[0]).toEqual(stored);
	});

	it("keeps an archive requested while rename reads its manifest", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		const conversations = new ConversationService(store, {
			now: () => "2026-08-26T00:00:01.000Z", id: () => "unused",
		});
		const read = files.read.bind(files);
		let first = true;
		let archived: Promise<void> | undefined;
		files.read = async (file) => {
			const snapshot = await read(file);
			if (first && file.endsWith("/conv-1/manifest.json")) {
				first = false;
				archived = conversations.archive("conv-1");
			}
			return snapshot;
		};
		await conversations.rename("conv-1", "  Renamed  ");
		await archived;
		expect((await store.load("conv-1")).manifest).toMatchObject({ title: "Renamed", lifecycle: "archived" });
		expect((await store.list())[0]).toMatchObject({ title: "Renamed", lifecycle: "archived" });
	});

	it("updates metadata without reading history and continues after a rejected write", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		files.files.set(".talos/agent-workbench/v1/conversations/conv-1/events/recovery.json", "corrupt history kept for recovery");
		const replace = files.replace.bind(files);
		let fail = true;
		files.replace = async (from, to) => {
			if (fail && to.endsWith("/conv-1/manifest.json")) { fail = false; throw new Error("synthetic disk failure"); }
			await replace(from, to);
		};
		await expect(store.patchManifest("conv-1", { title: "Failed" })).rejects.toThrow("synthetic disk failure");
		const conversations = new ConversationService(store);
		await conversations.rename("conv-1", "Recovered");
		await conversations.archive("conv-1");
		expect((await store.list())[0]).toMatchObject({ title: "Recovered", lifecycle: "archived" });
		expect(files.files.get(".talos/agent-workbench/v1/conversations/conv-1/events/recovery.json")).toBe("corrupt history kept for recovery");
	});

	it("physically discards only untouched blank conversations", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		const conversations = new ConversationService(store);
		const blank = await conversations.create();
		const named = await conversations.create("keep me");
		const used = await conversations.create();
		const guarded = await conversations.create();
		files.files.set(`.talos/agent-workbench/v1/conversations/${guarded.conversationId}/recovery.bin`, "preserve");
		await conversations.append({
			conversationId: used.conversationId,
			turnId: "turn-used",
			runtimeId: "codex",
			type: "user.message",
			payload: { text: "real content" },
		});

		await expect(conversations.discardEmpty(blank.conversationId)).resolves.toBe(true);
		await expect(conversations.discardEmpty(named.conversationId)).resolves.toBe(false);
		await expect(conversations.discardEmpty(used.conversationId)).resolves.toBe(false);
		await expect(conversations.discardEmpty(guarded.conversationId)).resolves.toBe(false);
		expect((await store.list()).map((item) => item.conversationId)).toEqual(expect.arrayContaining([named.conversationId, used.conversationId]));
		expect((await store.list()).map((item) => item.conversationId)).not.toContain(blank.conversationId);
		await expect(store.load(blank.conversationId)).rejects.toThrow();
		expect([...files.folders]).not.toContain(`.talos/agent-workbench/v1/conversations/${blank.conversationId}`);
		expect(files.files.get(`.talos/agent-workbench/v1/conversations/${guarded.conversationId}/recovery.bin`)).toBe("preserve");
	});

	it("flushes and publishes concurrent portable and host state writes on the real filesystem", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "talos-storage-concurrency-"));
		const absolute = (file: string) => path.join(root, file);
		const storage = new ObsidianWorkbenchStorage({
			exists: async (file) => { try { await access(absolute(file)); return true; } catch { return false; } },
			read: (file) => readFile(absolute(file), "utf8"),
			write: (file, value) => writeFile(absolute(file), value),
			remove: (file) => unlink(absolute(file)),
			rmdir: (file) => rmdir(absolute(file)),
			mkdir: async (file) => { await mkdir(absolute(file), { recursive: true }); },
			list: async (directory) => {
				const entries = await readdir(absolute(directory), { withFileTypes: true });
				return {
					files: entries.filter((entry) => entry.isFile()).map((entry) => `${directory}/${entry.name}`),
					folders: entries.filter((entry) => entry.isDirectory()).map((entry) => `${directory}/${entry.name}`),
				};
			},
		}, root);
		try {
			const store = new PortableConversationStore(storage);
			await store.create(manifest);
			await Promise.all([
				store.touch("conv-1", "2026-08-26T00:00:02.000Z"),
				...Array.from({ length: 6 }, (_, sequence) => storage.writeJsonAtomic(".talos/host-state.json", { sequence })),
			]);
			expect(await storage.readJson(".talos/host-state.json")).toEqual({ sequence: 5 });
			expect((await store.list())[0]?.updatedAt).toBe("2026-08-26T00:00:02.000Z");
			expect((await storage.list(".talos")).files.some((file) => file.endsWith(".tmp"))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("serializes concurrent manifest/index updates and preserves the latest activity", async () => {
		const files = new MemoryFiles();
		const replace = files.replace.bind(files);
		files.replace = async (from, to) => {
			await new Promise((resolve) => setTimeout(resolve, 0));
			await replace(from, to);
		};
		const store = new PortableConversationStore(files);
		const secondStore = new PortableConversationStore(files);
		await Promise.all([store.create(manifest), secondStore.create({ ...manifest, conversationId: "conv-2" })]);
		await Promise.all([
			store.touch("conv-1", "2026-08-26T00:00:03.000Z"),
			secondStore.touch("conv-2", "2026-08-26T00:00:02.000Z"),
			store.touch("conv-1", "2026-08-26T00:00:01.000Z"),
		]);
		expect(await store.list()).toMatchObject([
			{ conversationId: "conv-1", updatedAt: "2026-08-26T00:00:03.000Z" },
			{ conversationId: "conv-2", updatedAt: "2026-08-26T00:00:02.000Z" },
		]);
		expect([...files.files.keys()].some((path) => path.endsWith(".tmp"))).toBe(false);
	});

	it("lets independent conversations persist while another conversation write is blocked", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		await store.create({ ...manifest, conversationId: "conv-2" });
		let release!: () => void;
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => { markStarted = resolve; });
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		const write = files.write.bind(files);
		files.write = async (file, value) => {
			if (file.includes("/conv-1/events/")) { markStarted(); await blocked; }
			await write(file, value);
		};
		const pending = store.append(event());
		await started;
		try {
			await store.append({ ...event("parallel-event"), conversationId: "conv-2" });
			expect((await store.load("conv-2")).events).toHaveLength(1);
		} finally {
			release();
			await pending;
		}
	});

	it("serializes immutable-event collisions and keeps the queue usable after rejection", async () => {
		const store = new PortableConversationStore(new MemoryFiles());
		await store.create(manifest);
		const results = await Promise.allSettled([
			store.append(event()),
			store.append({ ...event(), payload: { text: "conflict" } }),
			store.append(event("event-2")),
		]);
		expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
		expect((await store.load("conv-1")).events).toHaveLength(2);
	});

	it("writes immutable events idempotently and rejects collisions", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		expect(await store.append(event())).toBe("written");
		expect(await store.append(event())).toBe("duplicate");
		await expect(store.append({ ...event(), payload: { text: "changed" } })).rejects.toThrow("冲突");
	});

	it("rebuilds chronological order independently of hashed event filenames", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		await store.append({ ...event("z-late"), timestamp: "2026-08-26T00:00:03.000Z" });
		await store.append({ ...event("a-early"), timestamp: "2026-08-26T00:00:02.000Z" });
		expect((await store.load("conv-1")).events.map((item) => item.eventId)).toEqual(["a-early", "z-late"]);
		expect([...files.files.keys()].join("\n")).not.toMatch(/a-early|z-late/);
		await expect(store.create({ ...manifest, conversationId: "../escape" })).rejects.toThrow("安全路径段");
	});

	it("keeps the user prompt before provider events when reloading a turn", async () => {
		const store = new PortableConversationStore(new MemoryFiles());
		await store.create(manifest);
		await store.append(createAgentEvent({
			eventId: "provider-first",
			conversationId: "conv-1",
			turnId: "turn-1",
			runtimeId: "codex",
			type: "assistant.delta",
			timestamp: "2026-08-26T00:00:01.000Z",
			payload: { text: "answer" },
		}));
		await store.append(createAgentEvent({
			eventId: "user-after-acceptance",
			conversationId: "conv-1",
			turnId: "turn-1",
			runtimeId: "codex",
			type: "user.message",
			timestamp: "2026-08-26T00:00:02.000Z",
			payload: { text: "question" },
		}));
		await store.append(createAgentEvent({
			eventId: "assistant-start",
			conversationId: "conv-1",
			turnId: "turn-1",
			runtimeId: "codex",
			type: "assistant.start",
			timestamp: "2026-08-26T00:00:03.000Z",
			payload: {},
		}));
		expect((await store.load("conv-1")).events.map((item) => item.type)).toEqual([
			"user.message",
			"assistant.start",
			"assistant.delta",
		]);
	});

	it("does not render legacy handoff markers that contain no context", () => {
		expect(hasMeaningfulHandoffContext(createAgentEvent({
			eventId: "empty-handoff",
			conversationId: "conv-1",
			turnId: "handoff-1",
			runtimeId: "codex",
			type: "handoff.created",
			timestamp: "2026-08-26T00:00:01.000Z",
			payload: {
				goal: "",
				recentMessages: [],
				incompleteTasks: [],
				toolResultSummaries: [],
				vaultRelativeReferences: [],
			},
		}))).toBe(false);
	});

	it("rebuilds a corrupt index from immutable manifests", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		files.files.set(".talos/agent-workbench/v1/index.json", "{broken");
		expect(await store.list()).toMatchObject([{ conversationId: "conv-1" }]);
	});

	it("supports archive, restore and recoverable soft delete", async () => {
		const store = new PortableConversationStore(new MemoryFiles());
		await store.create(manifest);
		await store.setLifecycle("conv-1", "archived");
		expect((await store.load("conv-1")).manifest.lifecycle).toBe("archived");
		await store.setLifecycle("conv-1", "deleted");
		expect((await store.load("conv-1")).manifest.lifecycle).toBe("deleted");
		await store.setLifecycle("conv-1", "active");
		expect((await store.load("conv-1")).manifest.lifecycle).toBe("active");
	});

	it("publishes updates through the adapter atomic-replace boundary", async () => {
		const files = new MemoryFiles();
		let replacements = 0;
		files.replace = async (from, to) => { replacements += 1; await files.rename(from, to); };
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		await store.setLifecycle("conv-1", "archived");
		expect(replacements).toBeGreaterThanOrEqual(4);
		expect([...files.files.keys()].some((path) => path.endsWith(".tmp"))).toBe(false);
	});

	it("redacts secrets and local absolute paths at the storage boundary", async () => {
		const files = new MemoryFiles();
		const store = new PortableConversationStore(files);
		await store.create(manifest);
		await expect(store.append({ ...event(), payload: { authorization: "Bearer fake-secret-value" } })).resolves.toBe("written");
		await expect(store.append({ ...event("event-2"), payload: { text: "/synthetic/private.md" } })).resolves.toBe("written");
		const nestedRuntimeEvent = { ...event("event-3"), payload: { threadSettings: { collaborationMode: { settings: { developer_instructions: "read /etc/passwd now" } } } } };
		await expect(store.append(nestedRuntimeEvent)).resolves.toBe("written");
		await expect(store.append(nestedRuntimeEvent)).resolves.toBe("duplicate");
		const projection = await store.load("conv-1");
		expect(projection.events[0]?.payload).not.toHaveProperty("authorization");
		expect(JSON.stringify(projection.events)).not.toContain("/synthetic/private.md");
		expect(JSON.stringify(projection.events)).not.toContain("/etc/passwd");
		expect([...files.files.values()].join("\n")).not.toContain("fake-secret-value");
	});

	const syntheticMacPath = ["", "Users", "synthetic", "超级大脑", "state.json"].join("/");
	const markdownWrappedMacPath = ["`", syntheticMacPath, "`"].join("");

	it.each([
		["Windows drive root with backslash", "C:\\"],
		["Windows drive root with slash", "C:/"],
		["UNC share root", "\\\\server\\share"],
		["Markdown-wrapped Unicode POSIX path", markdownWrappedMacPath],
	])("keeps portable detection and redaction symmetric for %s", (_label, value) => {
		expect(() => assertPortableValue(value)).toThrow("portable 数据不得包含本机绝对路径");
		const portable = sanitizePortableString(value);
		expect(portable).not.toBe(value);
		expect(() => assertPortableValue(portable)).not.toThrow();
	});

	it.each([
		["HTTPS URL", "https://api.openai.com/v1"],
		["embedded drive-like text", "abcC:\\runtime\\state.json"],
		["bare escaped slashes", "\\\\"],
		["model id", "openai-codex/gpt-5.6-sol"],
	])("does not mistake %s for a local absolute path", (_label, value) => {
		expect(sanitizePortableString(value)).toBe(value);
		expect(() => assertPortableValue(value)).not.toThrow();
	});

	it.each(["claude", "codex", "ohmypi"] as const)(
		"keeps %s native path metadata from aborting the shared portable append",
		async (runtimeId) => {
			const files = new MemoryFiles();
			const store = new PortableConversationStore(files);
			await store.create(manifest);
			await expect(store.append({
				...event("event-" + runtimeId),
				runtimeId,
				payload: {
					driveRoot: "C:\\",
					uncRoot: "\\\\server\\share",
					instruction: markdownWrappedMacPath,
				},
			})).resolves.toBe("written");
			const projection = await store.load("conv-1");
			expect(() => assertPortableValue(projection.events)).not.toThrow();
		},
	);

	it("keeps a portable policy rejection from interrupting the runtime", async () => {
		const appended: unknown[] = [];
		let rejectPolicy = true;
		const store = {
			append: async (value: unknown) => {
				appended.push(value);
				if (rejectPolicy) {
					rejectPolicy = false;
					throw new Error("portable 数据不得包含本机绝对路径");
				}
				return "written" as const;
			},
		} as unknown as PortableConversationStore;
		const coordinator = new WorkbenchConversationCoordinator(
			new ConversationService(store),
			new RuntimeBindingStore({
				read: async () => null,
				write: async () => undefined,
			}),
		);
		const result = await coordinator.appendRuntimeEvent("conv-1", event("native-policy-event"), "");
		expect(result).toMatchObject({
			type: "notice",
			payload: { omittedEventType: "assistant.final" },
		});
		expect(appended).toHaveLength(2);
		expect(appended[1]).toEqual(result);
	});

	it("orders conversations by durable user activity instead of creation time", async () => {
		const store = new PortableConversationStore(new MemoryFiles());
		await store.create(manifest);
		await store.create({ ...manifest, conversationId: "conv-2", updatedAt: "2026-08-26T00:00:02.000Z" });
		const conversations = new ConversationService(store, {
			now: () => "2026-08-26T00:00:03.000Z",
			id: () => "generated-event",
		});
		await conversations.append({
			conversationId: "conv-1",
			turnId: "turn-activity",
			runtimeId: "codex",
			type: "user.message",
			payload: { text: "new activity" },
		});
		expect((await store.list()).map((item) => item.conversationId)).toEqual(["conv-1", "conv-2"]);
		expect((await store.load("conv-1")).manifest.updatedAt).toBe("2026-08-26T00:00:03.000Z");
	});
});
