import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = view.slice(
	view.indexOf("\tprivate pageHealth("),
	view.indexOf("\tprivate pageProjects(")
);

describe("System health v2", () => {
	it("uses an equal health-trend and direct-decision first screen", () => {
		expect(page).toContain(
			'cls: "system-v2-primary health-v2-primary"'
		);
		expect(page).toContain('"data-system-section", "core-data"');
		expect(page).toContain('"attention-and-actions"');
		expect(page).toContain("this.fillTrend(trend, d.healthTrend)");
		expect(page).toContain("this.renderDecisionWorkspace(decisions, d, 3)");
		expect(page).not.toContain("fillMetricGrid");
		expect(page).not.toContain('cls: "panel-grid"');
	});

	it("keeps loop and error diagnostics in a lower two-column layer", () => {
		expect(page).toContain(
			'cls: "system-v2-secondary health-v2-diagnostics"'
		);
		expect(page).toContain("d.healthDigest.loopStatus");
		expect(page).toContain("d.healthDigest.errors");
		expect(css).toMatch(
			/\.system-v2-secondary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("reuses the existing reversible approval actions", () => {
		expect(view).toContain("this.renderApprovalItem(pendingList, item)");
		expect(view).toContain("this.renderCandidateItem(preferenceList, item)");
		expect(view.match(/this\.renderDecisionWorkspace\(/g)?.length).toBe(3);
	});

	it("uses a container breakpoint and natural page height", () => {
		expect(css).toContain("container: system-v2 / inline-size");
		expect(css).toContain("@container system-v2 (max-width: 820px)");
		expect(css).not.toMatch(
			/\.system-v2-primary\s*\{[^}]*min-height/s
		);
	});
});
