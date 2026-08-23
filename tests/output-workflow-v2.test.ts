import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const outputPage = view.slice(
	view.indexOf("\tprivate pageOutput("),
	view.indexOf("\tprivate pageTalos(")
);

describe("Output workflow v2", () => {
	it("splits real closure data and today's attention equally", () => {
		expect(outputPage).toContain(
			'cls: "workflow-v2-primary output-v2-primary"'
		);
		expect(outputPage).toContain('"data-workflow-section", "core-data"');
		expect(outputPage).toContain('"attention-and-actions"');
		expect(outputPage).not.toContain("dashboard-grid");
		expect(outputPage).not.toContain("fillMetricGrid");
	});

	it("builds stacked bars only from platform source counts", () => {
		expect(view).toContain("private fillOutputClosureChart(");
		expect(view).toContain(
			"const classified = platform.published + platform.pending"
		);
		expect(view).toContain(
			"const total = Math.max(platform.count, classified)"
		);
		expect(view).toContain("(segment.value / total) * 100");
		for (const tone of ["published", "pending", "unclassified"]) {
			expect(view).toContain(`tone: "${tone}"`);
			expect(css).toContain(`.tone-${tone}`);
		}
	});

	it("keeps queue, candidates, and themed platform cards", () => {
		expect(outputPage).toContain('"今日待发"');
		expect(outputPage).toContain('"运营候选"');
		expect(outputPage).toContain("fillSignalList(");
		expect(outputPage).toContain("fillPlatforms(");
		expect(outputPage).toContain("output-v2-platform-panel");
		expect(css).toContain(".output-v2-platform-panel .platform-grid");
	});

	it("reflows platform details and respects reduced motion", () => {
		expect(css).toContain("@container workflow-v2 (max-width: 760px)");
		expect(css).toContain("@container workflow-v2 (max-width: 480px)");
		expect(css).toMatch(
			/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.output-v2-bar-segment\s*\{[^}]*transition:\s*none/
		);
	});
});
