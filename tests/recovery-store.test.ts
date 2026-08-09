import { describe, expect, it } from "vitest";
import { VaultRecoveryStore } from "../src/task-core/recovery-store";

class MemoryFiles {
	readonly files = new Map<string, string>();

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path));
	}

	read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`missing: ${path}`);
		return Promise.resolve(value);
	}

	write(path: string, value: string): Promise<void> {
		this.files.set(path, value);
		return Promise.resolve();
	}

	remove(path: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}
}

describe("VaultRecoveryStore", () => {
	it("restores original files and removes files created after capture", async () => {
		const files = new MemoryFiles();
		files.files.set("00 收件箱/existing.md", "before");
		const store = new VaultRecoveryStore(files);
		const id = await store.capture({
			taskId: "task-1",
			actionId: "create-note",
			targetPaths: [
				"00 收件箱/existing.md",
				"00 收件箱/new.md",
				"<external>",
			],
			createdAt: "2026-07-25T00:00:00.000Z",
		});

		await files.write("00 收件箱/existing.md", "after");
		await files.write("00 收件箱/new.md", "created");
		await store.restore(id);

		expect(files.files.get("00 收件箱/existing.md")).toBe("before");
		expect(files.files.has("00 收件箱/new.md")).toBe(false);
		expect(store.has(id)).toBe(true);
	});

	it("refuses to snapshot private TALOS paths", async () => {
		const store = new VaultRecoveryStore(new MemoryFiles());

		await expect(
			store.capture({
				taskId: "task-private",
				actionId: "create-note",
				targetPaths: [".talos/private/secret.md"],
				createdAt: "2026-07-25T00:00:00.000Z",
			})
		).rejects.toThrow("private");
	});

	it.each([
		"safe/../.talos/private/secret.md",
		["", "00 收件箱", "absolute.md"].join("/"),
		["C:", "Vault", "00 收件箱", "absolute.md"].join("\\"),
		"00 收件箱//empty-segment.md",
	])("refuses unsafe recovery path %s before adapter access", async (path) => {
		const files = new MemoryFiles();
		const exists = files.exists.bind(files);
		let adapterAccessed = false;
		files.exists = async (candidate) => {
			adapterAccessed = true;
			return exists(candidate);
		};
		const store = new VaultRecoveryStore(files);

		await expect(
			store.capture({
				taskId: "task-unsafe",
				actionId: "create-note",
				targetPaths: [path],
				createdAt: "2026-07-25T00:00:00.000Z",
			})
		).rejects.toThrow("不安全路径");
		expect(adapterAccessed).toBe(false);
	});

	it("treats private recovery paths case-insensitively", async () => {
		const store = new VaultRecoveryStore(new MemoryFiles());

		await expect(
			store.capture({
				taskId: "task-private-case",
				actionId: "create-note",
				targetPaths: [".TALOS/PRIVATE/secret.md"],
				createdAt: "2026-07-25T00:00:00.000Z",
			})
		).rejects.toThrow("private");
	});
});
