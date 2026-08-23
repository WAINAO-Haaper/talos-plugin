import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const switcher = readFileSync(
	`${root}src/harness/harness-switcher.ts`,
	"utf8"
);
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");

describe("AI chat workspace v2", () => {
	it("removes the duplicate title and keeps only the channel switch", () => {
		expect(switcher).not.toContain("talos-harness-switcher__header");
		expect(switcher).not.toContain("talos-chat-workspace-header");
		expect(switcher).not.toContain("TALOS WORKSPACE");
		expect(switcher).toContain(
			'bar.dataset.talosComponent = "chat-channel-switch"'
		);
		expect(switcher).toContain('"AI 工作区切换"');
	});

	it("mounts the switch at the bottom of navigation and only on chat", () => {
		const drawerMount = view.indexOf("this.taskDrawer.mount()");
		const hostMount = view.indexOf(
			'cls: "talos-chat-nav-switch-host"'
		);
		expect(drawerMount).toBeGreaterThan(-1);
		expect(hostMount).toBeGreaterThan(drawerMount);
		expect(view).toContain(
			"getSwitchHost: () => this.chatSwitchHostEl"
		);
		expect(switcher).toContain("this.attachSwitchControl()");
		expect(css).toMatch(
			/\.talos-console\s+\.talos-chat-nav-switch-host\s*\{[^}]*display:\s*none;/s
		);
		expect(css).toMatch(
			/\.talos-console\[data-talos-page="chat"\][\s\S]*\.talos-chat-nav-switch-host:not\(:empty\)\s*\{\s*display:\s*block;/
		);
	});

	it("keeps the original switch, slots, and non-destructive lifecycle", () => {
		for (const contract of [
			"talos-harness-switch__track",
			"talos-harness-switch__thumb",
			"talos-harness-switcher__body",
			"talos-harness-switcher__slot",
			"ensureChannelMounted",
			"this.root?.remove()",
			"this.switchBar?.remove()",
		]) {
			expect(switcher).toContain(contract);
		}
		const suspendStart = switcher.indexOf("async suspend()");
		const suspendEnd = switcher.indexOf("focusComposer()", suspendStart);
		const suspend = switcher.slice(suspendStart, suspendEnd);
		expect(suspend).toContain("this.root?.remove()");
		expect(suspend).toContain("this.switchBar?.remove()");
		expect(suspend).not.toContain(".destroy()");
		expect(switcher).toContain("await channel.workbench.destroy()");
	});

	it("exposes active channel state accessibly", () => {
		expect(switcher).toContain('setAttribute("role", "switch")');
		expect(switcher).toContain('"aria-checked"');
		expect(switcher).toContain('"aria-pressed"');
		expect(switcher).toContain("root.dataset.activeChannel");
		expect(switcher).toContain("switchBar.dataset.activeChannel");
	});

	it("uses compact navigation reflow and preserves switch motion", () => {
		expect(css).toContain("container: chat-nav-switch / inline-size");
		expect(css).toContain(
			"@container chat-nav-switch (max-width: 210px)"
		);
		expect(css).toMatch(
			/\.talos-chat-nav-switch-host\s+\.talos-harness-switch\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.25fr\) 46px minmax\(0, 0\.75fr\)/s
		);
		expect(css).toMatch(
			/\.talos-chat-nav-switch-host[\s\S]*?\.talos-harness-switch__track\s*\{[^}]*width:\s*46px;[^}]*height:\s*28px;/
		);
		expect(css).toMatch(
			/\.talos-chat-nav-switch-host[\s\S]*?\.talos-harness-switch__option\s*\{[^}]*background:\s*transparent !important;[^}]*font-size:\s*var\(--talos-type-meta\)/
		);
		expect(css).toMatch(
			/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.talos-harness-switch__thumb\s*\{[^}]*transition:\s*none/
		);
	});
});
