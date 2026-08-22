import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");
const talosStyles = readFileSync(`${projectRoot}styles.talos.css`, "utf8");
const quyuanStyles = readFileSync(
	`${projectRoot}styles.quyuan-shell.css`,
	"utf8"
);

describe("assistant layout regression", () => {
	it("reuses the current navigable leaf instead of adding a second workspace leaf", () => {
		expect(mainSource).toMatch(
			/async activateTalosView\(\): Promise<void> \{\s*const leaf = await this\.openOrReviveTalosLeaf\(false\);/
		);
		expect(mainSource).not.toMatch(
			/async activateTalosView\(\): Promise<void> \{\s*const leaf = await this\.openOrReviveTalosLeaf\(true\);/
		);
	});

	it("constructs the embedded Claudian view without mutating the TALOS leaf", () => {
		expect(viewSource).toContain(
			"createConstructorIsolatedProxy(this.leaf, {"
		);
		expect(viewSource).toContain(
			'containerEl: page.ownerDocument.createElement("div")'
		);
		expect(viewSource).toContain("workbench.leaf = this.leaf");
		expect(viewSource).toContain(
			'.workspace-leaf-content[data-type="talos-quyuan-view"]'
		);
		expect(viewSource).toContain("orphan.remove()");
		expect(viewSource).not.toContain(
			"new EmbeddedClaudianView(this.leaf, this.plugin)"
		);
	});

	it("sizes embedded chat and voice surfaces from the current leaf", () => {
		// contentEl 即 .view-content 本体（控制台滚动容器）：弹性布局保留，
		// 但不得再设 overflow: hidden——其特异性 0,3,0 曾压住 .talos-console 的
		// overflow-y:auto（0,1,0），导致整页无法滚动（2026-08-22 复验修复）。
		expect(talosStyles).toMatch(
			/\.workspace-leaf-content\[data-type="talos-console-view"\] \.view-content \{[^}]*display: flex;[^}]*min-height: 0;/s
		);
		expect(talosStyles).not.toMatch(
			/\.workspace-leaf-content\[data-type="talos-console-view"\] \.view-content \{[^}]*overflow: hidden;/s
		);
		expect(talosStyles).toMatch(/\.talos-console \{[^}]*overflow-y: auto;/s);
		expect(quyuanStyles).toMatch(
			/\.talos-console:is\(\.section-chat, \[data-talos-page="jarvis"\]\) \.app \{[^}]*flex: 1 1 auto;[^}]*height: 100%;[^}]*min-height: 0;/s
		);
		expect(quyuanStyles).toContain("--tq-view-height: 100%;");
		expect(quyuanStyles).not.toContain(
			"--tq-view-height: calc(100svh - 76px)"
		);
	});

	it("keeps the primary navigation visible on the voice page", () => {
		expect(quyuanStyles).toMatch(
			/\.talos-console\[data-talos-page="jarvis"\] \.sidebar \{[^}]*height: 100%;[^}]*visibility: visible;[^}]*opacity: 1;/s
		);
		expect(quyuanStyles).toMatch(
			/\.talos-console\[data-talos-page="jarvis"\] \.pagenav-card \{[^}]*display: block !important;[^}]*visibility: visible;[^}]*opacity: 1;/s
		);
	});
});
