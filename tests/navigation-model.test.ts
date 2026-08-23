import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	LEGACY_PAGE_KEYS,
	PRIMARY_NAVIGATION,
	WORKBENCH_MODULES,
	resolvePageRoute,
} from "../src/ui/navigation-model";
import { TalosPageRouter } from "../src/ui/page-router";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");

describe("TALOS navigation model", () => {
	it("has seven primary destinations with settings permanently last", () => {
		expect(PRIMARY_NAVIGATION.map((item) => item.key)).toEqual([
			"workbench",
			"chat",
			"voice",
			"workflow",
			"knowledge",
			"system",
			"settings",
		]);
		expect(resolvePageRoute("settings")).toEqual({ primary: "settings" });
	});

	it("keeps every legacy page key and Claudian view addressable", () => {
		for (const key of LEGACY_PAGE_KEYS) {
			expect(resolvePageRoute(key)).not.toBeNull();
		}
		expect(resolvePageRoute("talos-quyuan-view")).toEqual({
			primary: "chat",
		});
		expect(resolvePageRoute("overview")).toEqual({
			primary: "workbench",
		});
		expect(resolvePageRoute("jarvis")).toEqual({
			primary: "voice",
		});
	});

	it("keeps all nine legacy customer-module routes addressable", () => {
		expect(WORKBENCH_MODULES).toHaveLength(9);
		expect(new Set(WORKBENCH_MODULES.map((module) => module.key)).size).toBe(9);
		for (const module of WORKBENCH_MODULES) {
			expect(resolvePageRoute(module.pageKey)).not.toBeNull();
		}
	});

	it("uses the primary navigation instead of duplicating nine launch cards", () => {
		expect(viewSource).toContain('"data-workbench-section", "core-data"');
		expect(viewSource).toContain(
			'"data-workbench-section",\n\t\t\t"attention-and-approvals"'
		);
		expect(viewSource).toContain('"data-workbench-section", "task-kanban"');
		expect(viewSource).not.toContain("for (const module of WORKBENCH_MODULES)");
		expect(viewSource).not.toContain('"data-workbench-section", "customer-modules"');
		expect(viewSource).not.toContain("const PAGES:");
	});
});

describe("TalosPageRouter", () => {
	it("switches primary regions and secondary tabs without creating leaves", () => {
		const router = new TalosPageRouter("overview");
		expect(router.current()).toEqual({ primary: "workbench" });

		router.navigate("projects");
		expect(router.current()).toEqual({
			primary: "workflow",
			secondary: "projects",
		});
		expect(router.renderKey()).toBe("projects");

		router.selectPrimary("system");
		expect(router.current()).toEqual({
			primary: "system",
			secondary: "health",
		});
		router.selectSecondary("vault");
		expect(router.renderKey()).toBe("vault");

		router.selectPrimary("settings");
		expect(router.current()).toEqual({ primary: "settings" });
		expect(router.renderKey()).toBe("settings");
	});
});
