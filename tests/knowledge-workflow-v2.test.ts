import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { functionSource, viewSource as readViewSource } from "./helpers/source-text";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readViewSource();
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = functionSource(view, "renderKnowledgePage");

describe("Knowledge hub v2", () => {
	it("puts recent entries and MOCs side by side under the shared flow pipeline", () => {
		expect(page).toContain(
			'cls: "knowledge-v2-primary knowledge-hub-v2-primary"'
		);
		expect(page).toContain('mountFlowPipeline(view, hero, d, "knowledge")');
		expect(page).toContain('label: "MOC"');
		expect(page).toContain("renderVaultStatistics(view, page, d)");
		expect(page).toContain('"attention-and-entry"');
		expect(page).toMatch(/const moc = view\.panel\(\s*primary,/);
		expect(page).not.toContain("panel-grid cols-3");
		expect(page).not.toContain("fillMetricGrid");
		expect(css).toMatch(
			/\.knowledge-v2-primary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("no longer repeats the insight / material counts as a treemap", () => {
		expect(view).not.toContain("fillKnowledgeTreemap(");
		expect(page).not.toContain('"data-knowledge-section", "core-data"');
	});

	it("keeps recent insight/material groups and moves MOCs to a compact lower entry", () => {
		expect(page).toContain("knowledge-v2-recent-group");
		expect(page).toContain("d.knowledge.recentInsights");
		expect(page).toContain("d.knowledge.recentMaterials");
		expect(page).toContain("knowledge-v2-moc-panel");
		expect(page).toContain("d.knowledge.mocs");
		expect(css).toMatch(
			/\.knowledge-v2-moc-panel \.detail-list\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("uses the knowledge container and natural-height reflow", () => {
		expect(css).toContain("container: knowledge-v2 / inline-size");
		expect(css).toContain("@container knowledge-v2 (max-width: 820px)");
		expect(css).not.toMatch(
			/\.knowledge-v2-primary\s*\{[^}]*min-height/s
		);
	});
});
