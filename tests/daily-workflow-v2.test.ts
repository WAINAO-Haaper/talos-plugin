import { describe, expect, it } from "vitest";
import { dailyRota, dailyTimeline } from "../src/ui/talos-view-model";
import type { VaultPaths } from "../src/data/schema";
import { TalosPageRouter } from "../src/ui/page-router";

describe("retired personal routine", () => {
	it("routes saved daily links to the task workbench and does not supply a hard-coded routine", () => {
		const router = new TalosPageRouter("daily");
		expect(router.current()).toEqual({ primary: "workbench", secondary: "tasks" });
		expect(router.renderKey()).toBe("tasks");
		expect(dailyRota({} as VaultPaths, "tasks.md")).toEqual([]);
		expect(dailyTimeline({} as VaultPaths, "tasks.md")).toEqual([]);
	});
});
