import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${projectRoot}src/view.ts`, "utf8");
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
		expect(view).toContain("this.embeddedSettingsTab.renderInto(body)");
	});

	it("keeps the fixed settings destination and shadowless sidebar", () => {
		expect(view).toContain("talos-settings-nav-command");
		expect(view).toContain('case "settings": this.pageSettings(page); break;');
		expect(shellCss).toMatch(
			/\.sidebar:is\(:hover,\s*:focus-within\)\s*\{[^}]*box-shadow:\s*none\s*!important/s
		);
		expect(shellCss).toContain(
			".talos-console.section-settings .page-content"
		);
	});
});
