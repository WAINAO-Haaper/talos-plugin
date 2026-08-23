import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const settings = readFileSync(`${root}src/settings.ts`, "utf8");
const uiCss = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const layoutCss = readFileSync(
	`${root}styles.layout-overrides.css`,
	"utf8"
);

describe("settings configuration workspace v2", () => {
	it("turns the six categories into described, accessible tabs", () => {
		expect(settings).toContain("const TALOS_SETTING_TABS");
		for (const label of [
			"界面",
			"目录映射",
			"数据源",
			"AI Provider",
			"屈原 · 语音",
			"屈原 · 高级",
		]) {
			expect(settings).toContain(`label: "${label}"`);
		}
		expect(settings).toContain('createEl("button"');
		expect(settings).toContain('role: "tab"');
		expect(settings).toContain('"aria-selected"');
		expect(settings).toContain('event.key === "ArrowDown"');
		expect(settings).toContain('event.key === "Home"');
	});

	it("adds current-category context without creating a second settings renderer", () => {
		expect(settings).toContain("talos-settings-section-intro");
		expect(settings).toContain("CONFIGURATION WORKSPACE");
		expect(settings).toContain("content.dataset.settingsTab = active.id");
		expect(settings).toContain("renderInto(containerEl: HTMLElement)");
		expect(settings).toContain("this.renderInto(target)");
		expect(settings).toContain("new Setting(c)");
	});

	it("reflows non-advanced settings into compact cards only when wide enough", () => {
		const workspaceCss = uiCss.slice(
			uiCss.indexOf("/* Settings configuration workspace · D-TLP-019")
		);
		expect(workspaceCss).toContain(
			"@container talos-app (min-width: 1240px)"
		);
		expect(workspaceCss).toContain(
			'.talos-setcontent:not([data-settings-tab="workbench"])'
		);
		expect(workspaceCss).toContain(
			"grid-template-columns: repeat(2, minmax(0, 1fr))"
		);
		expect(workspaceCss).toContain(
			"@container talos-app (max-width: 720px)"
		);
	});

	it("preserves themes, motion, secret storage, and automatic saves", () => {
		for (const theme of [
			"aurora",
			"cosmos-dark",
			"animal-island",
			"system-classic",
			"data-stream",
			"soft-relief",
			"geometric-modern",
			"executive-brief",
			"paper-ink",
			"swiss-modern",
		]) {
			expect(settings).toContain(`.addOption("${theme}"`);
		}
		expect(settings).toContain("providerSecretStoreFromApp");
		expect(settings).toContain("saveProviderSecret");
		expect(settings).toContain("await this.plugin.saveTalosSettings()");
		expect(settings).toContain("renderWorkbench");
		expect(layoutCss).toContain("animation: talos-app-content-in");
		expect(layoutCss).toContain("@media (prefers-reduced-motion: reduce)");
	});
});
