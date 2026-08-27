import { describe, expect, it } from "vitest";
import { createAgentEvent } from "../src/agent-workbench/contracts/agent-events";
import type { ConversationManifest } from "../src/agent-workbench/contracts/conversation";
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
	async remove(path: string) { this.files.delete(path); }
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
