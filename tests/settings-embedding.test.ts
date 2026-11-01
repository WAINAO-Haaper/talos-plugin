import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { functionSource, viewSource as readViewSource } from "./helpers/source-text";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const view = readViewSource();
const settings = readFileSync(`${projectRoot}src/settings.ts`, "utf8");
const shellCss = [
	readFileSync(`${projectRoot}styles.quyuan-shell.css`, "utf8"),
	readFileSync(`${projectRoot}styles.layout-overrides.css`, "utf8"),
].join("\n");

describe("embedded TALOS settings", () => {
	it("shares one renderer and rerenders the active surface", () => {
		expect(settings).toContain("renderInto(containerEl: HTMLElement)");
		expect(settings).toContain("this.renderTarget = containerEl");
		expect(settings).toContain("this.renderInto(target)");
		expect(settings).not.toContain("new Notice(`${name} 已写入 Obsidian SecretStorage`);\n\t\t\t\t\tthis.display()");
		expect(view).toContain("view.embeddedSettingsTab.renderInto(body)");
	});

	it("keeps the fixed settings destination and shadowless sidebar", () => {
		expect(view).toContain("talos-settings-nav-command");
		expect(view).toContain('case "settings": this.pageSettings(page); break;');
		expect(shellCss).toMatch(
			/\.talos-console\[data-talos-page\] \.sidebar \{[^}]*box-shadow: var\(--talos-shadow-0, none\);/s
		);
		expect(shellCss).toContain(
			".talos-console.section-settings .page-content"
		);
	});

	it("renders the shared settings surface as an application workspace", () => {
		const settingsPage = functionSource(view, "renderSettingsPage");
		expect(settingsPage).not.toContain("talos-inline-settings__header");
		expect(settingsPage).not.toContain("talos-inline-settings__status");
		expect(settingsPage).toContain("view.embeddedSettingsTab.renderInto(body)");
		expect(settingsPage).toContain('shell.setAttribute("aria-label", "TALOS 设置")');
		expect(shellCss).toMatch(
			/\.talos-settings--console\s*\{[^}]*grid-template-columns:\s*minmax\(154px, 184px\)\s+minmax\(0, 1fr\)/s
		);
		expect(shellCss).toContain(
			".talos-settings--console .talos-setcontent > .setting-item"
		);
		expect(shellCss).toContain("animation: talos-app-content-in");
	});
});
