import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${projectRoot}src/view.ts`, "utf8");
const primitives = readFileSync(
	`${projectRoot}src/ui/page-primitives.ts`,
	"utf8"
);
const styles = readFileSync(`${projectRoot}styles.ui-v2.css`, "utf8");
const build = readFileSync(`${projectRoot}build-styles.mjs`, "utf8");
const legacyStyles = readFileSync(`${projectRoot}styles.talos.css`, "utf8");
const voiceStyles = readFileSync(
	`${projectRoot}styles.quyuan-shell.css`,
	"utf8"
);

describe("TALOS unified interface language v2 foundation", () => {
	it("assigns every route to one of the five page archetypes", () => {
		for (const archetype of [
			"dashboard",
			"execution",
			"knowledge",
			"workspace",
			"settings",
		]) {
			expect(view).toContain(`"${archetype}"`);
		}
		expect(view).toContain('"data-talos-archetype"');
	});

	it("renders all business page headers through one shared primitive", () => {
		expect(view).toContain('from "./ui/page-primitives"');
		expect(view).toContain("renderTalosPageHeader(parent");
		expect(primitives).toContain('data.talosComponent = "page-header"'.replace("data.", "dataset."));
		expect(primitives).toContain("metrics.slice(0, 4)");
		expect(primitives).toContain("actions.slice(0, 3)");
	});

	it("keeps interactive metrics keyboard reachable", () => {
		expect(primitives).toContain('setAttribute("role", "button")');
		expect(primitives).toContain('setAttribute("tabindex", "0")');
		expect(primitives).toContain('event.key !== "Enter"');
	});

	it("defines semantic tokens and reference-theme mappings", () => {
		for (const token of [
			"--talos-ui-canvas",
			"--talos-ui-surface",
			"--talos-ui-ink",
			"--talos-ui-line",
			"--talos-ui-accent",
			"--talos-ui-success",
			"--talos-ui-warning",
			"--talos-ui-danger",
			"--talos-ui-focus",
		]) {
			expect(styles).toContain(token);
		}
		expect(styles).toContain(".talos-console.theme-geometric-modern");
	});

	it("builds the cohesive v2 layer after validated legacy overrides", () => {
		const layout = build.indexOf("readFileSync(layoutOverridesSource");
		const uiV2 = build.indexOf("readFileSync(uiV2Source");
		expect(layout).toBeGreaterThan(-1);
		expect(uiV2).toBeGreaterThan(layout);
	});

	it("uses container reflow without forcing the page-content height", () => {
		expect(styles).toContain("container: talos-ui-page / inline-size");
		expect(styles).toContain("@container talos-ui-page (max-width: 900px)");
		expect(styles).toContain("@container talos-ui-page (max-width: 560px)");
		expect(styles).not.toMatch(/\.talos-ui-page\s*\{[^}]*min-height/s);
		expect(styles).not.toMatch(/\.talos-ui-page\s*\{[^}]*max-height/s);
		expect(styles).not.toMatch(/\.talos-ui-page\s*\{[^}]*flex:/s);
	});

	it("keeps every non-overview pixel bot inside the compact header safe area", () => {
		const stageSelector =
			'.talos-console[data-talos-archetype]:not([data-talos-page="overview"])\n\t.module-hero .talos-pixel-patrol.talos-ui-page-header__scene.in-module-hero';
		const botSelector =
			'.talos-console[data-talos-archetype]:not([data-talos-page="overview"])\n\t.module-hero .talos-pixel-patrol.in-module-hero .talos-pixel-bot';
		const trackSelector =
			'.talos-console[data-talos-archetype]:not([data-talos-page="overview"])\n\t.module-hero .talos-pixel-patrol.in-module-hero .talos-pixel-track';

		expect(styles).toContain(stageSelector);
		expect(styles).toContain(botSelector);
		expect(styles).toContain(trackSelector);
		expect(styles).toContain("--talos-pixel-safe-stage-height: 86px");
		expect(styles).toContain("--talos-pixel-safe-bot-top: 28px");
		expect(styles).toContain("--talos-pixel-safe-track-bottom: 4px");
		expect(styles).toMatch(
			/\.talos-pixel-patrol\.talos-ui-page-header__scene\.in-module-hero\s*\{[^}]*height:\s*var\(--talos-pixel-safe-stage-height\)[^}]*overflow:\s*hidden[^}]*--pixel-scale:\s*1\.25/s
		);
		expect(styles).toMatch(
			/\.talos-pixel-patrol\.in-module-hero \.talos-pixel-track\s*\{[^}]*top:\s*auto[^}]*bottom:\s*var\(--talos-pixel-safe-track-bottom\)/s
		);
	});

	it("preserves every theme identity and the established motion surfaces", () => {
		for (const theme of [
			"theme-aurora",
			"theme-cosmos-dark",
			"theme-animal-island",
			"theme-system-classic",
			"theme-data-stream",
			"theme-soft-relief",
			"theme-geometric-modern",
			"theme-executive-brief",
			"theme-paper-ink",
			"theme-swiss-modern",
		]) {
			expect(view).toContain(`"${theme}"`);
		}

		expect(view).toContain("this.buildThemeAtmosphere(bg)");
		expect(view).toContain("this.buildPixelPatrol(hero)");
		for (const surface of [
			".cosmos-scene",
			".data-rain",
			".geometry-field",
			".talos-pixel-patrol",
		]) {
			expect(legacyStyles).toContain(surface);
		}
		expect(voiceStyles).toContain(".tq-voice");
		expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
		expect(styles).not.toMatch(
			/(?:cosmos-scene|data-rain|geometry-field|talos-pixel-patrol|tq-voice)[^{]*\{[^}]*display:\s*none/s
		);
	});

});
