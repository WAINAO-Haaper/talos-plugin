import { describe, expect, it } from "vitest";
import {
	DEFAULT_SUPERBRAIN_CANVAS_LAYOUT,
	addSuperbrainCanvasCard,
	addSuperbrainCanvasTab,
	moveSuperbrainCanvasCard,
	reorderSuperbrainCanvasCard,
	normalizeSuperbrainCanvasLayout,
	removeSuperbrainCanvasCard,
	removeSuperbrainCanvasTab,
	renameSuperbrainCanvasTab,
} from "../src/ui/superbrain-canvas-layout";

describe("superbrain canvas layout", () => {
	it("recovers malformed saved layouts without changing the default", () => {
		const before = JSON.stringify(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT);
		expect(normalizeSuperbrainCanvasLayout({ version: 1, tabs: [{ id: "../bad", label: "x", cards: ["focus"] }] }))
			.toEqual(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT);
		expect(JSON.stringify(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT)).toBe(before);
	});

	it("keeps unique known cards and a valid selected tab", () => {
		const result = normalizeSuperbrainCanvasLayout({
			version: 1, activeTabId: "missing", tabs: [
				{ id: "home", label: "主页", cards: ["focus", "focus", "unknown", "inbox"] },
				{ id: "home", label: "重复", cards: ["pending"] },
			],
		});
		expect(result.tabs).toEqual([{ id: "home", label: "主页", cards: ["focus", "inbox"] }]);
		expect(result.activeTabId).toBe("home");
	});

	it("adds, reorders, renames, and removes without changing other tabs", () => {
		const initial = normalizeSuperbrainCanvasLayout(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT);
		const added = addSuperbrainCanvasTab(initial);
		expect(added.activeTabId).toBe("custom-1");
		const named = renameSuperbrainCanvasTab(added, "custom-1", "阅读");
		const withCard = addSuperbrainCanvasCard(named, "custom-1", "recent");
		expect(addSuperbrainCanvasCard(withCard, "custom-1", "recent").tabs.at(-1)?.cards).toEqual(["recent"]);
		const moved = addSuperbrainCanvasCard(withCard, "custom-1", "focus");
		expect(moveSuperbrainCanvasCard(moved, "custom-1", "focus", -1).tabs.at(-1)?.cards).toEqual(["focus", "recent"]);
		const removedCard = removeSuperbrainCanvasCard(moved, "custom-1", "recent");
		expect(removedCard.tabs.at(-1)?.cards).toEqual(["focus"]);
		const removedTab = removeSuperbrainCanvasTab(removedCard, "custom-1");
		expect(removedTab.activeTabId).toBe("home");
		expect(initial.tabs).toEqual(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT.tabs);
	});
 it("persists drag positions while preserving the source and unrelated pages", () => {
  const original = normalizeSuperbrainCanvasLayout(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT);
  const before = JSON.stringify(original);
  const moved = reorderSuperbrainCanvasCard(original, "home", "focus", 3);
  expect(moved.tabs[0].cards[3]).toBe("focus");
  expect(moved.tabs.slice(1)).toEqual(original.tabs.slice(1));
  expect(JSON.stringify(original)).toBe(before);
  expect(normalizeSuperbrainCanvasLayout(moved)).toEqual(moved);
  for (const index of [-1, 100, Number.NaN, 1.5]) {
   expect(reorderSuperbrainCanvasCard(original, "home", "focus", index)).toEqual(original);
  }
  expect(reorderSuperbrainCanvasCard(original, "missing", "focus", 1)).toEqual(original);
  expect(reorderSuperbrainCanvasCard(original, "knowledge", "focus", 1)).toEqual(original);
 });

});
