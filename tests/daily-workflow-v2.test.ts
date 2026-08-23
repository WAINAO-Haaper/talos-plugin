import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");

describe("Daily workflow v2", () => {
	it("uses a true 6/6 execution-and-attention first screen", () => {
		expect(view).toContain(
			'cls: "workflow-v2-primary daily-v2-primary"'
		);
		expect(view).toContain('"data-workflow-section", "core-data"');
		expect(view).toContain(
			'"data-workflow-section", "attention-and-actions"'
		);
		expect(css).toMatch(
			/\.workflow-v2-primary,[\s\S]*?\.workflow-v2-secondary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("keeps the existing timeline, command, focus, entry, and week components", () => {
		for (const contract of [
			"daily-timeline",
			"daily-slot-badge",
			"daily-command daily-item",
			"daily-focus daily-item",
			"daily-map",
			"daily-week",
		]) {
			expect(view).toContain(contract);
		}
		expect(view).toContain("renderTalosEmptyState(");
	});

	it("removes the old uneven daily work grid and false interactive rules", () => {
		expect(view).not.toContain('cls: "daily-work-grid"');
		expect(view).toContain('cls: "daily-rail"');
		expect(view).toContain('cls: "daily-proto"');
		expect(view).not.toContain('cls: "daily-rail daily-item"');
		expect(view).not.toContain('cls: "daily-proto daily-item"');
	});

	it("reflows the workflow container without changing page height", () => {
		expect(css).toContain("container: workflow-v2 / inline-size");
		expect(css).toContain("@container workflow-v2 (max-width: 820px)");
		expect(css).toContain("@container workflow-v2 (max-width: 560px)");
		expect(css).not.toMatch(
			/\.workflow-v2-primary\s*\{[^}]*min-height/s
		);
	});
});
