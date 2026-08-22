import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const layoutCss = readFileSync(
	`${projectRoot}styles.layout-overrides.css`,
	"utf8"
);

const fullFrameStart = layoutCss.indexOf("TALOS 2.0 · 四页全幅内容框架");
const fullFrameEnd = layoutCss.indexOf(
	".talos-console {\n  container-name:",
	fullFrameStart
);
const fullFrameCss = layoutCss.slice(fullFrameStart, fullFrameEnd);

describe("daily knowledge health and settings overview canvas", () => {
	it("targets the four requested pages as one shared layout contract", () => {
		expect(fullFrameCss).not.toBe("");
		for (const page of ["daily", "knowledge", "health", "settings"]) {
			expect(fullFrameCss).toContain(`[data-talos-page="${page}"]`);
		}
	});

	it("copies the overview outer canvas and desktop column boundary", () => {
		expect(fullFrameCss).toMatch(
			/\) \.app \{[^}]*gap:\s*0;[^}]*padding:\s*0;/s
		);
		expect(fullFrameCss).toMatch(
			/\) :is\(\.sidebar, \.main\) \{[^}]*gap:\s*0;/s
		);
		expect(fullFrameCss).toMatch(
			/\) :is\(\.talos-page-tabs, \.page-content\) \{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin-inline:\s*0;/s
		);
		expect(fullFrameCss).toMatch(
			/@media \(min-width:\s*1101px\)[\s\S]*?\) \.app \{[^}]*grid-template-columns:\s*286px minmax\(0, 1fr\);/s
		);
	});

	it("does not resize, shrink, or grow page modules", () => {
		expect(fullFrameCss).toMatch(/\) \.page-content \{[^}]*gap:\s*0;/s);
		expect(fullFrameCss).not.toMatch(/flex:\s*1 1 auto/);
		expect(fullFrameCss).not.toMatch(/flex-grow|min-height|max-height/);
		expect(fullFrameCss).not.toMatch(/\.page-content\s*>/);
	});
});
