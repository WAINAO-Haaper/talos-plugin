import { describe, expect, it } from "vitest";
import { detectConsoleMode, normalizeConsoleMode } from "../src/ui/console-mode";
import { SUPERBRAIN_CATALOG_PATH } from "../src/module-commands/superbrain-catalog";
import {
	PRIMARY_NAVIGATION,
	SUPERBRAIN_NAVIGATION,
	homePageFor,
	isSuperbrainPage,
	navigationFor,
	pageBelongsTo,
} from "../src/ui/navigation-model";
import { pageCommands } from "../src/plugin/page-commands";

describe("console mode (dual mode, per vault)", () => {
	it("defaults to the personal system and only accepts the two modes", () => {
		expect(normalizeConsoleMode(undefined)).toBe("personal");
		expect(normalizeConsoleMode("other")).toBe("personal");
		expect(normalizeConsoleMode("superbrain")).toBe("superbrain");
	});

	it("detects a framework vault by its workflow catalog", async () => {
		expect(await detectConsoleMode(async (path) => path === SUPERBRAIN_CATALOG_PATH)).toBe("superbrain");
		expect(await detectConsoleMode(() => false)).toBe("personal");
	});

	it("keeps the personal navigation unchanged and gives the framework its own five pages", () => {
		expect(navigationFor("personal")).toBe(PRIMARY_NAVIGATION);
		expect(navigationFor("superbrain")).toBe(SUPERBRAIN_NAVIGATION);
		expect(PRIMARY_NAVIGATION.some((group) => isSuperbrainPage(group.key))).toBe(false);
		const sbPages = SUPERBRAIN_NAVIGATION.flatMap((group) => group.children.map((child) => child.key)).filter(isSuperbrainPage);
		expect(sbPages).toEqual(["sb-loop", "sb-knowledge", "sb-memory", "sb-output", "sb-system"]);
	});

	it("sends pages that do not belong to the mode back to that mode's home", () => {
		expect(homePageFor("personal")).toBe("today");
		expect(homePageFor("superbrain")).toBe("sb-loop");
		expect(pageBelongsTo("personal", "sb-loop")).toBe(false);
		expect(pageBelongsTo("superbrain", "today")).toBe(false);
		expect(pageBelongsTo("superbrain", "settings")).toBe(true);
		expect(pageBelongsTo("personal", "settings")).toBe(true);
	});

	it("registers page commands per mode without changing the personal list", () => {
		const personal = pageCommands().map((command) => command.pageKey);
		expect(pageCommands("personal").map((command) => command.pageKey)).toEqual(personal);
		expect(personal.some(isSuperbrainPage)).toBe(false);
		expect(pageCommands("superbrain").map((command) => command.pageKey)).toEqual(expect.arrayContaining(["sb-loop", "sb-system", "settings"]));
	});
});
