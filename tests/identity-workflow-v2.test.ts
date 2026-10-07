import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { functionSource, viewSource as readViewSource } from "./helpers/source-text";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readViewSource();
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = functionSource(view, "renderIdentityPage");

describe("Identity context v2", () => {
	it("uses equal context and attention columns without duplicate metric panels", () => {
		expect(page).toContain(
			'cls: "knowledge-v2-primary identity-v2-primary"'
		);
		expect(page).toMatch(
			/"data-knowledge-section"\s*,\s*"core-context"/
		);
		expect(page).toContain('"attention-and-actions"');
		expect(page).not.toContain("fillMetricGrid");
		expect(page).not.toContain("dashboard-grid identity-grid");
	});

	it("reuses one shared decision workspace on Workbench and Identity", () => {
		expect(view).toContain("export function renderDecisionWorkspace(");
		expect(view.match(/view\.renderDecisionWorkspace\(/g)?.length).toBe(3);
		expect(view).toContain(
			"talos-decision-group overview-v2-approval-group overview-pending-panel"
		);
		expect(view).toContain("renderApprovalItem(view, pendingList, item)");
		expect(view).toContain("renderCandidateItem(view, preferenceList, item)");
		expect(css).toContain(".talos-decision-workspace");
	});

	it("keeps actual identity, soul, focus, and governance paths", () => {
		for (const contract of [
			"view.paths.telosFile",
			"view.paths.contextFile",
			"view.paths.profileFile",
			"view.paths.personaFile",
			"view.paths.personaMemoryFile",
			"view.plugin.talosSettings.pendingApprovalsPath",
			"view.plugin.talosSettings.candidatesPath",
		]) {
			expect(page).toContain(contract);
		}
		expect(page).toContain("d.focus.slice(0, 3)");
	});

	it("keeps lower governance entries compact and responsive", () => {
		expect(page).toContain("identity-v2-governance-panel");
		expect(css).toMatch(
			/\.identity-v2-governance-panel \.detail-list\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/
		);
		expect(css).toContain("@container knowledge-v2 (max-width: 520px)");
	});
});
