import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// 单页原则（D-TLP-068）：页头两行、≥600px 保持两列、模块限高内滚、不定死整页高度。
const root = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const layer = css.slice(css.indexOf("单页原则（D-TLP-068"));
const master = readFileSync(`${root}design-system/talos/MASTER.md`, "utf8");

describe("one-screen principle", () => {
	it("places the one-screen layer before the scoped dashboard overrides", () => {
		const oneScreen = css.indexOf("单页原则（D-TLP-068");
		expect(oneScreen).toBeGreaterThan(0);
		expect(css.indexOf("系统总览：四张可钻取图表")).toBeGreaterThan(oneScreen);
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

	it("keeps the statistics dashboard in two columns and limits chart height", () => {
		expect(css).toMatch(/\.talos-home-v3 \.talos-home-v3-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
		expect(css).toMatch(/\.talos-home-v3 \.talos-home-v3-chart \{[^}]*max-height:[^}]*overflow: auto/);
		expect(css).toContain("@container (max-width: 599px)");
	});

	it("keeps the old daily route and vault support modules", () => {
		const read = (path: string) => readFileSync(`${root}src/ui/pages/${path}`, "utf8");
		const daily = read("daily-page.ts");
		expect(daily).toContain("renderTodayPage(view, page, d)");
		const vault = read("knowledge-pages.ts");
		expect(vault).toContain('groupKey: "vault-structure"');
		for (const label of ["系统模块地图", "笔记创建热力图"]) expect(vault).toContain(`label: "${label}"`);
	});

	it("keeps the pixel patrol bot fully inside the compact scene band", () => {
		// 小人布局高 43px、以底边为基准缩放并带倾斜动画；带高 48px、顶部 -2px 时整只可见（0.4.12 实机被裁）。
		expect(layer).toMatch(/--talos-pixel-safe-stage-height: 48px;[^}]*--talos-pixel-safe-bot-top: -2px;[^}]*--pixel-scale: 0\.75;/);
		expect(layer).toMatch(/\.talos-ui-page-header__scene \{[^}]*height: 48px;/);
		expect(layer).not.toContain("--talos-pixel-safe-stage-height: 34px");
	});
});
