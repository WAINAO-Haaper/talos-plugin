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
	it("keeps user-facing categories as described, accessible tabs", () => {
		expect(settings).toContain("const TALOS_SETTING_TABS");
		for (const label of [
			"界面",
			"库与数据",
			"对话与模型",
			"语音",
			"系统维护",
		]) {
			expect(settings).toContain(`label: "${label}"`);
		}
		expect(settings).toContain('createEl("button"');
		expect(settings).toContain('role: "tab"');
		expect(settings).toContain('"aria-selected"');
		expect(settings).toContain('event.key === "ArrowDown"');
		expect(settings).toContain('event.key === "Home"');
		expect(settings).toContain('this.plugin.openTalosPage(this.plugin.talosSettings.consoleMode === "superbrain" ? "sb-system" : "health")');
		expect(settings).toContain('this.plugin.openTalosPage(this.plugin.talosSettings.consoleMode === "superbrain" ? "sb-system" : "tasks")');
	});

	it("adds current-category context without creating a second settings renderer", () => {
		// 2026-10-08：分类大标题与标签栏重复，已移除；版权说明统一在底部。
		expect(settings).not.toContain("CONFIGURATION WORKSPACE");
		expect(settings).toContain('cls: "talos-settings-footer"');
		expect(settings).toContain("content.dataset.settingsTab = active.id");
		expect(settings).toContain("renderInto(containerEl: HTMLElement)");
		expect(settings).toContain("this.renderInto(target)");
		expect(settings).toContain("new Setting(c)");
		expect(settings).not.toContain("renderWorkbench");
		expect(settings).not.toContain("ClaudianSettingTab");
		// API 配置与对话侧栏共用「自定义 API」窗口，设置页只显示摘要与编辑入口。
		expect(settings).toContain("customApiSummary(port, kind)");
		expect(settings).toContain("await createCustomApiHost(port).open(kind);");
		expect(settings).not.toContain("Anthropic API Key");
		for (const obsoleteLabel of [
			"旧串行语音设置（存档）",
			"旧语音识别引擎",
			"旧本地断句（存档）",
			"旧·语音助手（存档）",
		]) expect(settings).not.toContain(obsoleteLabel);
	});

	it("reflows every remaining settings category into compact cards only when wide enough", () => {
		const workspaceCss = uiCss.slice(
			uiCss.indexOf("/* Settings configuration workspace · D-TLP-019")
		);
		expect(workspaceCss).toContain(
			"@container talos-app (min-width: 1240px)"
		);
		expect(workspaceCss).toContain(
			".talos-setcontent {"
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
			"data-stream",
			"soft-relief",
			"geometric-modern",
			"executive-brief",
			"paper-ink",
		]) {
			expect(settings).toContain(`.addOption("${theme}"`);
		}
		expect(settings).toContain("providerSecretStoreFromApp");
		expect(settings).toContain("saveProviderSecret");
		expect(settings).toContain("await this.plugin.saveTalosSettings()");
		expect(layoutCss).not.toContain("talos-embedded-workbench-settings");
		expect(layoutCss).toContain("animation: talos-app-content-in");
		expect(layoutCss).toContain("@media (prefers-reduced-motion: reduce)");
	});
});
