import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { functionSource, viewSource as readViewSource } from "./helpers/source-text";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readViewSource();
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = functionSource(view, "renderHealthPage");

describe("System health v2", () => {
	// 模块整合（D-TLP-069）：健康页第一行为「健康分趋势 | 诊断」；审批与偏好只在今日 · 待决策处理。
	it("uses a health-trend and diagnostics first screen without a second approval workspace", () => {
		expect(page).toContain(
			'cls: "system-v2-primary health-v2-primary"'
		);
		expect(page).toContain('"data-system-section", "core-data"');
		expect(page).toContain("fillTrend(view, trend, d.healthTrend)");
		expect(page).not.toContain("renderDecisionWorkspace");
		expect(page.match(/onActivate: \(\) => view\.openDecisions\(\)/g)?.length).toBe(2);
		expect(page).not.toContain("fillMetricGrid");
		expect(page).not.toContain('cls: "panel-grid"');
	});

	it("keeps loop and error diagnostics together in one diagnostics tab group", () => {
		expect(page).toContain('groupKey: "health-diagnostics"');
		expect(page).toContain("parent: primary,");
		expect(page).toContain("badge: d.healthDigest.errors.length");
		expect(page).toContain("d.healthDigest.loopStatus");
		expect(page).toContain("d.healthDigest.errors");
		expect(css).toMatch(
			/\.system-v2-secondary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("reuses the existing reversible approval actions", () => {
		expect(view).toContain("renderApprovalItem(view, pendingList, item)");
		expect(view).toContain("renderCandidateItem(view, preferenceList, item)");
		expect(view.match(/view\.renderDecisionWorkspace\(/g)?.length).toBe(1);
	});

	it("uses a container breakpoint and natural page height", () => {
		expect(css).toContain("container: system-v2 / inline-size");
		expect(css).toContain("@container system-v2 (max-width: 820px)");
		expect(css).not.toMatch(
			/\.system-v2-primary\s*\{[^}]*min-height/s
		);
	});
});
