import { describe, expect, it, vi } from "vitest";
import { createConstructorIsolatedProxy } from "../src/ui/constructor-isolated-proxy";

describe("constructor isolated proxy", () => {
	it("delegates reads while containing constructor writes", () => {
		const liveCreateDiv = vi.fn();
		const detachedCreateDiv = vi.fn();
		const host = {
			view: "talos",
			app: { id: "app" },
			containerEl: {
				id: "live-container",
				createDiv: liveCreateDiv,
			},
			getViewState() {
				return { type: this.view };
			},
		};
		const detachedContainer = {
			id: "detached-container",
			createDiv: detachedCreateDiv,
		};
		const isolated = createConstructorIsolatedProxy(host, {
			containerEl: detachedContainer,
		});

		isolated.containerEl.createDiv("workspace-leaf-content");
		isolated.view = "claudian";

		expect(detachedCreateDiv).toHaveBeenCalledWith("workspace-leaf-content");
		expect(liveCreateDiv).not.toHaveBeenCalled();
		expect(host.view).toBe("talos");
		expect(isolated.view).toBe("claudian");
		expect(isolated.app).toBe(host.app);
		expect(isolated.containerEl).toBe(detachedContainer);
		expect(host.containerEl.id).toBe("live-container");
		expect(isolated.getViewState()).toEqual({ type: "talos" });
	});
});
