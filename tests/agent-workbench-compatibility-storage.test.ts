import { describe, expect, it } from "vitest";
import { SessionStorage, type CompatibilitySessionHost } from "../src/quyuan/claudian/core/bootstrap/SessionStorage";
import type { SessionMetadata } from "../src/quyuan/claudian/core/types";
import type { VaultFileAdapter } from "../src/quyuan/claudian/core/storage/VaultFileAdapter";
import { ClaudianSettingsStorage } from "../src/quyuan/claudian/app/settings/ClaudianSettingsStorage";

class Files {
	files = new Map<string, string>(); folders = new Set<string>();
	async write(path: string, content: string) { this.files.set(path, content); }
	async read(path: string) { const value = this.files.get(path); if (value === undefined) throw new Error("missing"); return value; }
	async delete(path: string) { this.files.delete(path); }
	async exists(path: string) { return this.files.has(path) || this.folders.has(path); }
	async ensureFolder(path: string) { this.folders.add(path); }
	async listFiles(path: string) { return [...this.files.keys()].filter((file) => file.startsWith(`${path}/`)); }
}

describe("read-only Claudian compatibility storage", () => {
	it("reads legacy settings as fallback but writes normalization only to the TALOS namespace", async () => {
		const files = new Files();
		const oldPath = ".talos/quyuan/claudian-settings.json";
		const newPath = ".talos/agent-workbench/v1/compatibility-settings.json";
		const oldBytes = '{"model":"openai-codex/default","permissionMode":"plan"}\n';
		files.files.set(oldPath, oldBytes);
		const storage = new ClaudianSettingsStorage(files as unknown as VaultFileAdapter, {
			writePath: newPath,
			readPaths: [newPath, oldPath],
			deleteLegacyOnSave: false,
		});
		const loaded = await storage.load();
		await storage.save(loaded);
		expect(files.files.get(oldPath)).toBe(oldBytes);
		expect(files.files.get(newPath)).toContain('"model"');
	});

	it("keeps old metadata byte-identical while rename/delete persist as TALOS sidecar state", async () => {
		const files = new Files();
		const oldPath = ".talos/quyuan/sessions/legacy.meta.json";
		const oldBytes = JSON.stringify({ id: "legacy", providerId: "codex", title: "旧会话", createdAt: 1, updatedAt: 2, sessionId: "native-old" }, null, 2);
		files.files.set(oldPath, oldBytes);
		let hostValue = { bindings: {} as Record<string, { sessionId?: string | null; providerId?: string }>, deletedIds: [] as string[] };
		const host: CompatibilitySessionHost = { read: async () => structuredClone(hostValue), write: async (value) => { hostValue = structuredClone(value); } };
		const storage = new SessionStorage(files as unknown as VaultFileAdapter, true, host);
		expect((await storage.listMetadata())[0]?.title).toBe("旧会话");
		const renamed: SessionMetadata = { id: "legacy", providerId: "codex", title: "新标题", createdAt: 1, updatedAt: 3, sessionId: "native-new" };
		await storage.saveMetadata(renamed);
		expect(files.files.get(oldPath)).toBe(oldBytes);
		expect((await storage.listMetadata())[0]).toMatchObject({ title: "新标题", sessionId: "native-new" });
		await storage.deleteMetadata("legacy");
		expect(await storage.listMetadata()).toEqual([]);
		expect(files.files.get(".talos/agent-workbench/v1/compatibility-sessions/legacy.meta.json")).toContain("新标题");
		expect(files.files.get(oldPath)).toBe(oldBytes);
		expect(hostValue.deletedIds).toEqual(["legacy"]);
	});
});
