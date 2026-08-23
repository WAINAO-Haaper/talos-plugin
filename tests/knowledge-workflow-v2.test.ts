import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = view.slice(
	view.indexOf("\tprivate pageKnowledge("),
	view.indexOf("\tprivate pageIdentity(")
);

describe("Knowledge hub v2", () => {
	it("uses an equal asset-structure and recent-entry first screen", () => {
		expect(page).toContain(
			'cls: "knowledge-v2-primary knowledge-hub-v2-primary"'
		);
		expect(page).toContain('"data-knowledge-section", "core-data"');
		expect(page).toContain('"attention-and-entry"');
		expect(page).not.toContain("panel-grid cols-3");
		expect(page).not.toContain("fillMetricGrid");
		expect(css).toMatch(
			/\.knowledge-v2-primary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("builds the treemap from parsed metric values and real shares", () => {
		expect(view).toContain("private fillKnowledgeTreemap(");
		expect(view).toContain('metric.value.replace(/[^\\d.]/g, "")');
		expect(view).toContain("const share = (node.value / total) * 100");
		expect(view).toContain('"--knowledge-share"');
		expect(css).toContain("flex: 1 1 var(--knowledge-share)");
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
