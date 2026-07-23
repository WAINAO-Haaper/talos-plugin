import { describe, expect, it } from "vitest";
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
});
