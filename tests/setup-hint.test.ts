import { describe, expect, it, vi } from "vitest";
import { renderSetupHint, setupProblems } from "../src/ui/setup-hint";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

describe("setup hint", () => {
	it("lists only this page's missing or incomplete sources", () => {
		const problems = setupProblems("health", { healthLogPath: "format", loopHealth: "missing", errorPatterns: "ok", tasksPath: "missing" });
		expect(problems.map((p) => [p.label, p.status])).toEqual([["健康日志", "format"], ["循环健康日志", "missing"]]);
		expect(setupProblems("health", { healthLogPath: "ok" })).toEqual([]);
		expect(setupProblems("health", undefined)).toEqual([]);
	});

	it("renders nothing when everything is in place", () => {
		const { host, element } = createMiniHost();
		expect(renderSetupHint(host, [], { onScaffold: vi.fn(), onSettings: vi.fn() })).toBeNull();
		expect(element.children).toHaveLength(0);
	});

	it("offers scaffold and settings for missing sources", () => {
		const { host, element } = createMiniHost();
		const onScaffold = vi.fn();
		const onSettings = vi.fn();
		renderSetupHint(host, setupProblems("health", { healthLogPath: "format", loopHealth: "missing" }), { onScaffold, onSettings });
		expect(element.textContent).toContain("健康日志（缺少分区）");
		expect(element.textContent).toContain("循环健康日志（缺失）");
		(element.querySelector('[data-action="scaffold"]') as MiniElement).click();
		(element.querySelector('[data-action="settings"]') as MiniElement).click();
		expect(onScaffold).toHaveBeenCalledTimes(1);
		expect(onSettings).toHaveBeenCalledTimes(1);
	});

	it("marks personal-only gaps as optional without a scaffold button", () => {
		const { host, element } = createMiniHost();
		renderSetupHint(host, setupProblems("talos", { talosTasksPath: "missing", talosProjectDir: "missing" }), { onScaffold: vi.fn(), onSettings: vi.fn() });
		expect(element.textContent).toContain("可以忽略");
		expect(element.querySelector('[data-action="scaffold"]')).toBeNull();
		expect((element.children[0]).className).toContain("is-optional");
	});
});
