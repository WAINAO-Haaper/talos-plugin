import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const pageSpec = readFileSync(
	`${root}design-system/talos/pages/inbox.md`,
	"utf8"
);

const inboxPage = view.slice(
	view.indexOf("\tprivate pageInbox("),
	view.indexOf("\tprivate pageHealth(")
);

describe("Inbox triage v2", () => {
	it("uses a 6/6 age-and-priority triage screen", () => {
		expect(inboxPage).toContain(
			'cls: "workflow-v2-primary inbox-v2-primary"'
		);
		expect(inboxPage).toContain(
			'"data-workflow-section", "core-data"'
		);
		expect(inboxPage).toContain(
			'"attention-and-actions"'
		);
		const triageStart = inboxPage.indexOf(
			'cls: "workflow-v2-primary inbox-v2-primary"'
		);
		const agePanel = inboxPage.indexOf('"积压年龄"', triageStart);
		const recentPanel = inboxPage.indexOf(
			'recent.addClass("inbox-v2-recent-panel")',
			triageStart
		);
		expect(agePanel).toBeGreaterThan(triageStart);
		expect(agePanel).toBeLessThan(recentPanel);
	});

	it("keeps summary counts only in the hero and charts real source data", () => {
		expect(inboxPage).not.toContain("fillMetricGrid");
		expect(view).toContain("(bucket.count / inbox.count) * 100");
		expect(view).toContain("(cluster.count / max) * 100");
		expect(inboxPage).toContain("rankedClusters");
		expect(pageSpec).toContain("下方模块**禁止重复**同一数字");
	});

	it("keeps recent files as a lower-priority compact entry grid", () => {
		expect(inboxPage).toContain("inbox-v2-recent-panel");
		expect(inboxPage).toContain('"data-workflow-section", "recent-entry"');
		expect(css).toMatch(
			/\.inbox-v2-recent-panel \.detail-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("preserves the stacked-bar and cluster-card component contracts", () => {
		expect(inboxPage).toContain('cls: "age-dist"');
		expect(inboxPage).toContain('cls: "cluster-grid"');
		expect(view).toContain('cls: `age-seg tone-${bucket.tone}`');
		expect(view).toContain('cls: "cluster-bar-fill"');
		expect(css).toContain("@container workflow-v2 (max-width: 560px)");
	});
});
