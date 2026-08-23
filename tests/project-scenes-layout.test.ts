import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const projectPage = view.slice(
	view.indexOf("\tprivate pageProjects("),
	view.indexOf("\tprivate pageKnowledge(")
);

describe("Project scenes workflow v2", () => {
	it("replaces the old 2.2/.8 split with an equal data-and-attention stage", () => {
		expect(projectPage).toContain(
			'cls: "workflow-v2-primary projects-v2-primary project-scene-layout"'
		);
		expect(projectPage).toContain('"data-workflow-section", "core-data"');
		expect(projectPage).toContain('"attention-and-actions"');
		expect(css).toMatch(
			/\.project-scene-layout\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("uses real checkbox totals for the completion ring", () => {
		expect(view).toContain("private fillProjectPortfolioChart(");
		expect(view).toContain("project.progress?.total || 0");
		expect(view).toContain("project.progress?.done || 0");
		expect(view).toContain("(doneTasks / totalTasks) * 100");
		expect(view).toContain('role", "img"');
		expect(css).toContain("conic-gradient(");
		expect(css).toContain("--project-progress");
	});

	it("ranks important projects before the complete project map", () => {
		expect(projectPage).toContain("priorityOrder");
		expect(projectPage).toContain("rankedProjects.slice(0, 4)");
		expect(projectPage).toContain("project-v2-priority-row");
		expect(projectPage).toContain("project-v2-entry-actions");
		expect(projectPage).toContain('mapPanel.addClass("project-map-panel")');
		expect(projectPage.indexOf("project-entry-panel")).toBeLessThan(
			projectPage.indexOf('mapPanel.addClass("project-map-panel")')
		);
	});

	it("keeps themed project cards and responsive natural-height grids", () => {
		expect(projectPage).toContain(
			'cls: `project-card priority-${project.priority}`'
		);
		expect(css).toContain("@container workflow-v2 (max-width: 900px)");
		expect(css).toContain("@container workflow-v2 (max-width: 560px)");
		expect(css).not.toMatch(
			/\.projects-v2-primary\s*\{[^}]*min-height/s
		);
		expect(css).toMatch(
			/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.project-v2-priority-bar__track > span\s*\{[^}]*transition:\s*none/
		);
	});
});
