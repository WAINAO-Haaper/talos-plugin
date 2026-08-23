import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = view.slice(
	view.indexOf("\tprivate pageIdentity("),
	view.indexOf("\tprivate pageVault(")
);

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
		expect(view).toContain("private renderDecisionWorkspace(");
		expect(view.match(/this\.renderDecisionWorkspace\(/g)?.length).toBe(3);
		expect(view).toContain(
			"talos-decision-group overview-v2-approval-group overview-pending-panel"
		);
		expect(view).toContain("this.renderApprovalItem(pendingList, item)");
		expect(view).toContain("this.renderCandidateItem(preferenceList, item)");
		expect(css).toContain(".talos-decision-workspace");
	});

	it("keeps actual identity, soul, focus, and governance paths", () => {
		for (const contract of [
			"this.paths.telosFile",
			"this.paths.contextFile",
			"this.paths.profileFile",
			"this.paths.personaFile",
			"this.paths.personaMemoryFile",
			"this.plugin.talosSettings.pendingApprovalsPath",
			"this.plugin.talosSettings.candidatesPath",
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
