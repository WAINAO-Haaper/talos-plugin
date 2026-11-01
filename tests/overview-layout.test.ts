import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { functionSource, viewSource as readViewSource } from "./helpers/source-text";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const view = readViewSource();
const stats = readFileSync(`${projectRoot}src/data/stats.ts`, "utf8");
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

	it("uses a responsive two-column graph dashboard with keyboard drilldown", () => {
		const today = functionSource(view, "renderTodayPage");
		expect(today).toContain('cls: "talos-home-v3-grid"');
		for (const label of ["资料分布", "资料活跃情况", "收件积压年龄", "系统健康趋势"]) expect(today).toContain(label);
		expect(uiCss).toMatch(/\.talos-home-v3 \.talos-home-v3-grid \{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
		expect(view).toContain('panel.setAttribute("tabindex", "0")');
	});

	it("preserves the quick note and task actions for the workbench", () => {
		expect(view).toContain("export function renderTodayQuickNote");
		expect(view).toContain("export function renderTodayActions");
		expect(view).toContain("new QuickNote({");
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
