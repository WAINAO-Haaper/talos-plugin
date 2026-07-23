import { describe, expect, it } from "vitest";
import { MemoryRecoveryStore } from "../src/task-core/recovery-store";

describe("MemoryRecoveryStore", () => {
	it("stores recovery metadata without prompt or file body", async () => {
		const store = new MemoryRecoveryStore();

		const id = await store.capture({
			taskId: "task-1",
			actionId: "organize-inbox",
			targetPaths: ["00 收件箱/想法.md"],
			createdAt: "2026-07-24T00:00:00.000Z",
		});

		const record = store.get(id);
		expect(record).toEqual({
			id,
			taskId: "task-1",
			actionId: "organize-inbox",
			targetPaths: ["00 收件箱/想法.md"],
			createdAt: "2026-07-24T00:00:00.000Z",
		});
		expect(JSON.stringify(record)).not.toContain("prompt");
		expect(JSON.stringify(record)).not.toContain("content");
	});
});
