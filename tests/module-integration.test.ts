import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { viewSource as readViewSource } from "./helpers/source-text";

// 模块整合（D-TLP-069）：每类信息只有一个主场，其他页只留数字 + 跳转。
const root = fileURLToPath(new URL("../", import.meta.url));
const all = readViewSource();
const read = (path: string) => readFileSync(`${root}src/${path}`, "utf8");
const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

describe("module integration", () => {
	it("keeps decision actions in the workbench and routes the dashboard summary there", () => {
		expect(count(all, /view\.renderDecisionWorkspace\(/g)).toBe(1);
		expect(read("ui/pages/workbench-projects.ts")).toContain("view.renderDecisionWorkspace(slot, d, 3)");
		expect(read("ui/pages/today-page.ts")).not.toContain("renderDecisionWorkspace");
		expect(read("ui/pages/today-page.ts")).toContain("view.openDecisions()");
	});

	it("provides a dashboard health chart with a link to the health details", () => {
		const today = read("ui/pages/today-page.ts");
		expect(today).toContain('"系统健康趋势"');
		expect(today).toContain('"health"');
		expect(read("ui/pages/project-pages.ts")).toContain("fillTrend(view, trend, d.healthTrend)");
	});

	it("routes decision links to the workbench task page", () => {
		const source = read("view.ts");
		expect(source).toContain("openDecisions(): void {");
		expect(source).toContain('this.navigateToPage("tasks")');
		expect(source).toContain('data-workbench-section="decisions"');
		expect(read("ui/view-modules.ts")).toContain("stat.onActivate");
	});

	it("groups related modules into three shared workbench surfaces", () => {
		const workbench = read("ui/pages/workbench-page.ts");
		for (const renderer of ["renderWorkbenchData", "renderWorkbenchProjects", "renderWorkbenchSystem"]) expect(workbench).toContain(renderer);
		expect(workbench).not.toContain("workbench-subnav");
		const projects = read("ui/pages/workbench-projects.ts");
		expect(projects).toContain('"项目列表"');
		expect(projects).toContain('section: "decisions"');
	});


});
