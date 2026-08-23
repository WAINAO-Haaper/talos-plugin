import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = view.slice(
	view.indexOf("\tprivate pageCapability("),
	view.indexOf("\n\n\n\t// ---------- 填充 ----------")
);

describe("Capability center v2", () => {
	it("uses an equal real-distribution and group-control first screen", () => {
		expect(page).toContain(
			'cls: "knowledge-v2-primary capability-v2-primary"'
		);
		expect(page).toContain('"data-knowledge-section", "core-data"');
		expect(page).toContain('"attention-and-actions"');
		expect(page).toContain("fillCapabilityDistribution(");
		expect(css).toMatch(
			/\.knowledge-v2-primary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("keeps dynamic themed tabs and updates the lower browser", () => {
		expect(page).toContain("const drawTabs = () =>");
		expect(page).toContain("const drawGrid = () =>");
		expect(page).toContain("this.activeCap = group.key");
		expect(page).toContain("drawTabs();");
		expect(page).toContain("drawGrid();");
		expect(page).toContain("this.addActionButtonContent(");
		expect(page).toContain('"aria-pressed"');
	});

	it("preserves copy invocation, source opening, and module selection", () => {
		expect(page).toContain("void this.copyText(item.invoke)");
		expect(page).toContain("void openFile(this.app, item.path ||");
		expect(page).toContain("this.wireModuleSelection(");
		expect(page).toContain('cls: "cap-src"');
	});

	it("charts only real group lengths and reflows naturally", () => {
		expect(view).toContain("private fillCapabilityDistribution(");
		expect(view).toContain("group.items.length / maxCount");
		expect(css).toContain("@container knowledge-v2 (max-width: 520px)");
		expect(css).toMatch(
			/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.capability-v2-distribution-row__track > span\s*\{[^}]*transition:\s*none/
		);
	});
});
