import { describe, expect, it, vi } from "vitest";
import { mountPanelTabs } from "../src/ui/panel-tabs";
import { createMiniHost } from "./helpers/mini-dom";

function setup(selections = new Map<string, string>(), badge = 0) {
	const { host, element } = createMiniHost();
	const rendered: string[] = [];
	mountPanelTabs({
		parent: host,
		groupKey: "demo",
		label: "演示",
		selections,
		tabs: ["a", "b", "c"].map((key) => ({
			key,
			label: key.toUpperCase(),
			badge: key === "a" ? badge : undefined,
			render: (panel: HTMLElement) => {
				rendered.push(key);
				panel.appendChild(panel.ownerDocument.createElement("p")).textContent = `content-${key}`;
			},
		})),
	});
	const tabs = element.querySelectorAll('[role="tab"]');
	const panels = element.querySelectorAll('[role="tabpanel"]');
	for (const tab of tabs) (tab as unknown as { focus: () => void }).focus = vi.fn();
	const visible = () => panels.filter((panel) => !panel.hidden).map((panel) => panel.textContent);
	return { element, rendered, tabs, panels, visible, selections };
}

describe("mountPanelTabs", () => {
	it("renders every original panel once and shows only the first", () => {
		const { rendered, visible, tabs } = setup();
		expect(rendered).toEqual(["a", "b", "c"]);
		expect(visible()).toEqual(["content-a"]);
		expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
		expect(tabs[0]?.getAttribute("aria-controls")).toBe("talos-tab-demo-a-panel");
	});

	it("names the tab list without aria-label so Obsidian shows no hover tooltip", () => {
		const { element } = setup();
		const list = element.querySelector('[role="tablist"]');
		expect(list?.getAttribute("aria-label")).toBeNull();
		expect(list?.getAttribute("aria-labelledby")).toBe("talos-tabs-demo-label");
		expect(element.querySelector(".talos-sr-only")?.textContent).toBe("演示");
	});

	it("switches on click and remembers the choice for the next render", () => {
		const first = setup();
		first.tabs[2]?.click();
		expect(first.visible()).toEqual(["content-c"]);
		expect(first.selections.get("demo")).toBe("c");
		const again = setup(first.selections);
		expect(again.visible()).toEqual(["content-c"]);
	});

	it("supports arrow, Home and End keys with wrap-around", () => {
		const { tabs, visible } = setup();
		tabs[0]?.dispatch("keydown", "ArrowLeft");
		expect(visible()).toEqual(["content-c"]);
		tabs[2]?.dispatch("keydown", "ArrowRight");
		expect(visible()).toEqual(["content-a"]);
		tabs[0]?.dispatch("keydown", "End");
		expect(visible()).toEqual(["content-c"]);
		tabs[2]?.dispatch("keydown", "Home");
		expect(visible()).toEqual(["content-a"]);
	});

	it("shows a badge only when there is something pending", () => {
		expect(setup(new Map(), 3).element.querySelector(".talos-panel-tabs__badge")?.textContent).toBe("3");
		expect(setup(new Map(), 0).element.querySelector(".talos-panel-tabs__badge")).toBeNull();
	});

	it("falls back to the first tab when the remembered key no longer exists", () => {
		const { visible } = setup(new Map([["demo", "gone"]]));
		expect(visible()).toEqual(["content-a"]);
	});
});

