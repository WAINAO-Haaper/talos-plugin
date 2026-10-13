import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 单页原则（D-TLP-068）：页头两行、≥600px 保持两列、模块限高内滚、不定死整页高度。
const root = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const layer = css.slice(css.indexOf("单页原则（D-TLP-068"));
const master = readFileSync(`${root}design-system/talos/MASTER.md`, "utf8");

describe("one-screen principle", () => {
	it("keeps the layer at the end of the source stylesheet so it wins the cascade", () => {
		expect(css.indexOf("单页原则（D-TLP-068")).toBeGreaterThan(css.length * 0.9);
	});

	it("compacts the page header into two rows without truncating actions", () => {
		expect(layer).toContain('"main metrics metrics"');
		expect(layer).toContain('"actions actions scene"');
		expect(layer).toMatch(/\.module-hero-actions > \.module-hero-action \{[^}]*flex: 0 0 auto;/);
		expect(layer).toContain("min-height: 0;");
	});

	it("keeps primary and secondary rows in two columns from 600px", () => {
		expect(layer).toContain("@container (min-width: 600px)");
		for (const selector of [".workflow-v2-primary", ".workflow-v2-secondary", ".knowledge-v2-primary", ".system-v2-primary", ".system-v2-secondary", ".today-v1-grid"]) {
			expect(layer).toContain(selector);
		}
		expect(layer).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
	});

	it("caps business modules with inner scroll and a pinned title, exempting chat, voice, harness and settings", () => {
		expect(layer).toContain("--talos-one-screen-module: max(280px, 40vh);");
		expect(layer).toMatch(/\.talos-ui-panel \{[^}]*max-height: var\(--talos-one-screen-module\);[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
		expect(layer).toMatch(/\.talos-ui-panel > \.talos-ui-panel-header \{[^}]*position: sticky;/);
		for (const page of ["settings", "chat", "jarvis", "harness"]) expect(layer).toContain(`:not([data-talos-page="${page}"])`);
	});

	it("never fixes the page height or stretches the last module", () => {
		expect(layer).not.toMatch(/page-content[^{]*\{[^}]*\bheight:/);
		expect(layer).not.toMatch(/:last-child[^{]*\{[^}]*(flex: 1|height: 100%)/);
	});

	it("records the principle in the master specification", () => {
		expect(master).toContain("### 6.4 One-screen principle (owner decision D-TLP-068, 2026-10-14)");
		expect(master).toContain("功能模块尽量在一个页面显示");
	});
});
