import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = view.slice(
	view.indexOf("\tprivate pageVault("),
	view.indexOf("\tprivate pageCapability(")
);

describe("Vault analytics v2", () => {
	it("uses equal distribution and health-attention panels", () => {
		expect(page).toContain(
			'cls: "system-v2-primary vault-v2-primary"'
		);
		expect(page).toContain('"data-system-section", "core-data"');
		expect(page).toContain('"attention-and-actions"');
		expect(page).not.toContain("chart-row");
		expect(page).toContain("this.fillDist(");
		expect(page).toContain("this.fillTrend(health, d.healthTrend)");
	});

	it("promotes real README anomalies without inventing status", () => {
		expect(page).toContain(
			"d.modules.filter(\n\t\t\t(module) => !module.readmeExists"
		);
		expect(page).toContain("missingModules.map((module) =>");
		expect(page).toContain('"README 异常"');
		expect(page).toContain('"所有顶层模块均有 README"');
	});

	it("preserves and labels the real heatmap", () => {
		expect(page).toContain("for (const month of d.heatmap.months)");
		expect(page).toContain("for (const week of month.weeks)");
		expect(page).toContain("for (const cell of week)");
		expect(page).toContain('"data-level"');
		expect(page).toContain('"role", "img"');
		expect(page).toContain("笔记创建热力图：");
	});

	it("keeps themed module cards in a responsive compact map", () => {
		expect(page).toContain('"note module-card"');
		expect(page).toContain('"note module-card missing-readme"');
		expect(css).toMatch(
			/\.vault-v2-module-panel \.note-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/
		);
		expect(css).toContain("@container system-v2 (max-width: 760px)");
		expect(css).toContain("@container system-v2 (max-width: 520px)");
	});
});
