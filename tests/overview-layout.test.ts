import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${projectRoot}src/view.ts`, "utf8");
const stats = readFileSync(`${projectRoot}src/data/stats.ts`, "utf8");
const baseCss = readFileSync(`${projectRoot}styles.talos.css`, "utf8");
const uiCss = readFileSync(`${projectRoot}styles.ui-v2.css`, "utf8");

describe("workbench dashboard and approval layout", () => {
	it("renders pending and preference decisions in one approval workspace", () => {
		expect(view).toContain("decidePreferenceCandidate");
		expect(view).toContain("overview-v2-approval-panel");
		expect(view).toContain("overview-pending-panel");
		expect(view).toContain("overview-preference-panel");
		expect(view).toContain('cls: "item approval-item candidate-approval-item"');
	});

	it("keeps the full candidate title for exact write-back", () => {
		expect(stats).toContain(
			'out.push({ title: stripMd(s.slice(2)), meta: "待确认", path: file.path });'
		);
		expect(stats).not.toContain("stripMd(s.slice(2)).slice(0, 70)");
	});

	it("uses a real 6/6 data-and-attention first screen", () => {
		expect(view).toContain('cls: "overview-v2-primary"');
		expect(view).toContain('"data-workbench-section", "core-data"');
		expect(view).toContain('"attention-and-approvals"');
		expect(uiCss).toMatch(
			/\.overview-v2-primary[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("reuses real trend and distribution data instead of decorative percentages", () => {
		expect(view).toContain("this.fillTrend(trendPanel, d.healthTrend)");
		expect(view).toContain("this.fillDist(");
		expect(view).not.toContain("fillOverviewStatBar");
		expect(view).not.toContain("overview-stat-bar");
		expect(view).not.toContain("d.total / 2000");
		expect(view).not.toContain("capCount / 36");
	});

	it("keeps the task kanban and adds a recoverable quick note", () => {
		expect(view).toContain('cls: "overview-kanban"');
		expect(view).toContain('"data-workbench-section", "task-kanban"');
		expect(view).toContain("任务进度看板");
		expect(view).toContain("fillOverviewKanban");
		expect(view).toContain("new QuickNote({");
		expect(view).toContain('"data-workbench-section", "quick-note"');
		expect(baseCss).toContain(".overview-kanban-col");
		expect(uiCss).toContain(".talos-quick-note");
	});

	it("removes the duplicate customer-module launcher grid", () => {
		expect(view).not.toContain("for (const module of WORKBENCH_MODULES)");
		expect(view).not.toContain("九个模块入口");
		expect(view).not.toContain("workbench-module-grid");
	});

	it("keeps decorative data-rain work within the low-end hardware budget", () => {
		expect(view).toContain("for (let i = 0; i < 8; i++)");
		expect(view).not.toContain("for (let i = 0; i < 20; i++)");
		expect(view).not.toContain('"01\\n10\\nCTX\\n01\\nSYS\\n10\\nMEM');
	});

	it("reflows by container while preserving natural page height", () => {
		expect(uiCss).toContain("container: overview-v2 / inline-size");
		expect(uiCss).toContain("@container overview-v2 (max-width: 760px)");
		expect(uiCss).not.toMatch(
			/\.talos-console\[data-talos-page="overview"\] \.talos-ui-page\s*\{[^}]*min-height/s
		);
	});
});
