import { describe, expect, it } from "vitest";
import {
	LEGACY_PAGE_KEYS,
	PRIMARY_NAVIGATION,
	SUPERBRAIN_NAVIGATION,
	navigationFor,
	pageBelongsTo,
	isSuperbrainPage,
	WORKBENCH_MODULES,
	resolvePageRoute,
	routeContextLabel,
} from "../src/ui/navigation-model";
import {
	decodeTalosViewState,
	encodeTalosViewState,
	TalosPageRouter,
} from "../src/ui/page-router";
import { viewSource as readViewSource } from "./helpers/source-text";

const viewSource = readViewSource();

describe("TALOS navigation model", () => {
	it("adds the same C/M groups to the personal navigation only when its catalog exists", () => {
		expect(navigationFor("personal")).toBe(PRIMARY_NAVIGATION);
		expect(navigationFor("personal", false)).toBe(PRIMARY_NAVIGATION);
		const navigation = navigationFor("personal", true);
		expect(navigation.filter((page) => !isSuperbrainPage(page.key))).toEqual(PRIMARY_NAVIGATION);
		expect(navigation.filter((page) => isSuperbrainPage(page.key))).toEqual(
			SUPERBRAIN_NAVIGATION.filter((page) => isSuperbrainPage(page.key))
		);
		expect(navigation.at(-1)?.key).toBe("settings");
		expect(new Set(navigation.map((page) => page.key)).size).toBe(navigation.length);
		for (const group of SUPERBRAIN_NAVIGATION.filter((page) => isSuperbrainPage(page.key))) {
			expect(pageBelongsTo("personal", group.key)).toBe(false);
			expect(pageBelongsTo("personal", group.key, true)).toBe(true);
			expect(new TalosPageRouter(group.key).renderKey()).toBe(group.key);
		}
	});

	it("keeps the framework navigation compatible regardless of the capability argument", () => {
		expect(navigationFor("superbrain")).toBe(SUPERBRAIN_NAVIGATION);
		expect(navigationFor("superbrain", true)).toBe(SUPERBRAIN_NAVIGATION);
		expect(pageBelongsTo("superbrain", "sb-loop")).toBe(true);
		expect(pageBelongsTo("personal", "today", true)).toBe(true);
		expect(pageBelongsTo("personal", "unknown", true)).toBe(false);
	});

	it("groups the console into five task-ordered destinations plus settings at the bottom", () => {
		expect(PRIMARY_NAVIGATION.map((item) => item.key)).toEqual([
			"today",
			"flow",
			"projects",
			"assistant",
			"system",
			"settings",
		]);
		expect(PRIMARY_NAVIGATION.map((item) => item.children.map((child) => child.key))).toEqual([
			["today", "daily"],
			["inbox", "knowledge", "output"],
			["projects", "talos"],
			["chat", "jarvis", "harness"],
			["health", "vault", "capability", "identity"],
			["settings"],
		]);
		expect(resolvePageRoute("settings")).toEqual({ primary: "settings", secondary: "settings" });
	});

	it("renders every secondary page that the navigation can open", () => {
		for (const page of PRIMARY_NAVIGATION) {
			for (const child of page.children) {
				// AI 对话在右侧边栏打开，主区不渲染 chat 页
				if (child.key === "chat") continue;
				expect(viewSource, `missing renderer for ${child.key}`).toContain(`case "${child.key}": `);
			}
		}
		expect(viewSource).toContain('if (this.activePage === "chat") {');
		expect(viewSource).not.toContain('case "overview": ');
	});

	it("keeps the full-screen section classes for chat and settings after regrouping", () => {
		expect(viewSource).toContain('const LEGACY_SECTION_PAGES = ["chat", "settings"] as const;');
		expect(viewSource).toContain("this.contentEl.classList.add(`section-${this.activePage}`);");
	});

	it("keeps every legacy page key and Claudian view addressable inside its group", () => {
		const legacy = [...LEGACY_PAGE_KEYS, "workbench", "workflow", "voice", "chat", "talos-quyuan-view", "settings"];
		for (const key of legacy) {
			const route = resolvePageRoute(key);
			expect(route, key).not.toBeNull();
			const group = PRIMARY_NAVIGATION.find((page) => page.key === route?.primary);
			expect(group?.children.some((child) => child.key === route?.secondary), key).toBe(true);
		}
		expect(resolvePageRoute("talos-quyuan-view")).toEqual({ primary: "assistant", secondary: "chat" });
		expect(resolvePageRoute("overview")).toEqual({ primary: "today", secondary: "today" });
		expect(resolvePageRoute("jarvis")).toEqual({ primary: "assistant", secondary: "jarvis" });
	});

	it("labels page headers with their group, like Lens' context line", () => {
		expect(routeContextLabel({ primary: "flow", secondary: "inbox" })).toBe("内容流 · 收件箱");
		expect(routeContextLabel({ primary: "settings", secondary: "settings" })).toBe("设置");
		expect(viewSource).not.toContain('eyebrow: "INTAKE DIGEST"');
	});

	it("keeps all nine legacy customer-module routes addressable", () => {
		expect(WORKBENCH_MODULES).toHaveLength(9);
		expect(new Set(WORKBENCH_MODULES.map((module) => module.key)).size).toBe(9);
		for (const module of WORKBENCH_MODULES) {
			expect(resolvePageRoute(module.pageKey)).not.toBeNull();
		}
	});

	it("uses the primary navigation instead of duplicating nine launch cards", () => {
		expect(viewSource).toContain('"data-today-section", "now"');
		expect(viewSource).toContain('"data-today-section", "attention"');
		expect(viewSource).toContain('"data-today-section", "decisions"');
		expect(viewSource).toContain('"data-today-section", "task-kanban"');
		expect(viewSource).not.toContain("for (const module of WORKBENCH_MODULES)");
		expect(viewSource).not.toContain('"data-workbench-section", "customer-modules"');
		expect(viewSource).not.toContain("const PAGES:");
	});
});

describe("TalosPageRouter", () => {
	it("switches primary regions and secondary tabs without creating leaves", () => {
		const router = new TalosPageRouter();
		expect(router.current()).toEqual({ primary: "today", secondary: "today" });
		expect(router.renderKey()).toBe("today");

		router.navigate("projects");
		expect(router.current()).toEqual({ primary: "projects", secondary: "projects" });
		expect(router.renderKey()).toBe("projects");

		router.selectPrimary("system");
		expect(router.current()).toEqual({ primary: "system", secondary: "health" });
		router.selectSecondary("identity");
		expect(router.renderKey()).toBe("identity");
		router.selectPrimary("settings");
		expect(router.renderKey()).toBe("settings");

		router.selectPrimary("assistant");
		expect(router.renderKey()).toBe("chat");
		router.selectSecondary("jarvis");
		expect(router.renderKey()).toBe("jarvis");
		expect(() => router.selectSecondary("health")).toThrow();
	});
});

describe("TALOS view state", () => {
	it("round-trips the active inner page across a cold workspace restore", () => {
		expect(encodeTalosViewState("chat")).toEqual({
			schemaVersion: 1,
			page: "chat",
		});
		expect(decodeTalosViewState(encodeTalosViewState("chat"))).toBe("chat");
		expect(decodeTalosViewState(encodeTalosViewState("projects"))).toBe("projects");
		expect(decodeTalosViewState(encodeTalosViewState("today"))).toBe("today");
	});

	it("normalizes aliases and rejects stale or malformed persisted state", () => {
		expect(decodeTalosViewState({ schemaVersion: 1, page: "talos-quyuan-view" })).toBe("chat");
		expect(decodeTalosViewState({ schemaVersion: 1, page: "overview" })).toBe("today");
		expect(decodeTalosViewState({ schemaVersion: 1, page: "voice" })).toBe("jarvis");
		expect(decodeTalosViewState({ schemaVersion: 2, page: "chat" })).toBe("today");
		expect(decodeTalosViewState({ schemaVersion: 1, page: "missing" })).toBe("today");
		expect(decodeTalosViewState(null)).toBe("today");
	});
});
