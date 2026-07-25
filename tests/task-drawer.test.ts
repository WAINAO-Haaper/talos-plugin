import { describe, expect, it, vi } from "vitest";
import { MemoryTaskStore } from "../src/task-core/task-store";
import { TaskDrawer } from "../src/ui/task-drawer";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

describe("TaskDrawer", () => {
	it("keeps observing the same store while the page content is replaced", () => {
		const store = new MemoryTaskStore();
		const { host, element } = createMiniHost();
		const page = element.ownerDocument.createElement("main");
		element.appendChild(page);
		new TaskDrawer({ parent: host, store }).mount();

		page.replaceChildren(element.ownerDocument.createElement("section"));
		const task = store.create({
			id: "task-1",
			idempotencyKey: "drawer-1",
			actionId: "organize-inbox",
			state: "ready",
			approvalRequired: false,
			riskDecision: "snapshot-and-run",
			createdAt: "2026-07-24T00:00:00.000Z",
			readPaths: [],
			changes: [],
		});
		store.transition(task.id, "queued");
		store.transition(task.id, "running");

		const drawer = element.querySelector<MiniElement>(".talos-task-drawer");
		const live = drawer?.querySelector<MiniElement>("[aria-live='polite']");
		expect(drawer?.textContent).toContain("organize-inbox");
		expect(drawer?.textContent).toContain("执行中");
		expect(live?.textContent).toContain("执行中");
	});

	it("collapses on Escape without destroying its store subscription", () => {
		const store = new MemoryTaskStore();
		const { host, element } = createMiniHost();
		new TaskDrawer({ parent: host, store }).mount();
		const drawer = element.querySelector<MiniElement>(".talos-task-drawer");

		drawer?.dispatch("keydown", "Escape");
		store.create({
			id: "task-2",
			idempotencyKey: "drawer-2",
			actionId: "vault-lint",
			state: "ready",
			approvalRequired: false,
			riskDecision: "allow",
			createdAt: "2026-07-24T00:00:00.000Z",
			readPaths: [],
			changes: [],
		});

		expect(drawer?.classList.contains("is-collapsed")).toBe(true);
		expect(drawer?.textContent).toContain("vault-lint");
	});

	it("shows cancel and undo only when the shared runner allows them", async () => {
		const store = new MemoryTaskStore();
		const running = store.create({
			id: "task-running",
			idempotencyKey: "drawer-running",
			actionId: "vault-lint",
			state: "ready",
			approvalRequired: false,
			riskDecision: "allow",
			createdAt: "2026-07-24T00:00:00.000Z",
			readPaths: [],
			changes: [],
		});
		store.transition(running.id, "queued");
		store.transition(running.id, "running");
		const completed = store.create({
			id: "task-completed",
			idempotencyKey: "drawer-completed",
			actionId: "create-note",
			state: "ready",
			approvalRequired: false,
			riskDecision: "snapshot-and-run",
			createdAt: "2026-07-24T00:00:00.000Z",
			readPaths: [],
			changes: [],
		});
		store.transition(completed.id, "queued");
		store.transition(completed.id, "running");
		store.transition(completed.id, "completed", {
			recoveryId: "recovery-1",
		});
		store.create({
			id: "task-static",
			idempotencyKey: "drawer-static",
			actionId: "refresh-stats",
			state: "ready",
			approvalRequired: false,
			riskDecision: "allow",
			createdAt: "2026-07-24T00:00:00.000Z",
			readPaths: [],
			changes: [],
		});
		const cancel = vi.fn().mockReturnValue(true);
		const revert = vi.fn().mockResolvedValue(true);
		const { host, element } = createMiniHost();
		new TaskDrawer({
			parent: host,
			store,
			controller: {
				canCancel: (taskId) => taskId === running.id,
				cancel,
				canRevert: (taskId) => taskId === completed.id,
				revert,
			},
		}).mount();

		const cancelButton = element.querySelector<MiniElement>(
			"button[data-task-control='cancel']"
		);
		const revertButton = element.querySelector<MiniElement>(
			"button[data-task-control='revert']"
		);
		expect(
			element.querySelectorAll<MiniElement>(
				"button[data-task-control='cancel']"
			)
		).toHaveLength(1);
		expect(
			element.querySelectorAll<MiniElement>(
				"button[data-task-control='revert']"
			)
		).toHaveLength(1);

		cancelButton?.click();
		revertButton?.click();
		await vi.waitFor(() => expect(revert).toHaveBeenCalledWith(completed.id));
		expect(cancel).toHaveBeenCalledWith(running.id);
	});
});
