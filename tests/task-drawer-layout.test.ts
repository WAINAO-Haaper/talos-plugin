import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");
const drawerSource = readFileSync(
	`${projectRoot}src/ui/task-drawer.ts`,
	"utf8"
);
const layoutCss = readFileSync(
	`${projectRoot}styles.layout-overrides.css`,
	"utf8"
);

describe("task drawer navigation layout", () => {
	it("mounts inside the navigation card instead of overlaying content", () => {
		expect(viewSource).toMatch(
			/this\.taskDrawer = new TaskDrawer\(\{\s*parent: navCard,/
		);
		expect(viewSource).not.toMatch(
			/this\.taskDrawer = new TaskDrawer\(\{\s*parent: main,/
		);
		expect(viewSource).not.toContain('cls: "task-rail"');
	});

	it("uses a stable navigation module instead of an absolute overlay", () => {
		expect(layoutCss).toMatch(
			/\.pagenav-card\s*>\s*\.talos-task-drawer\s*\{[^}]*position:\s*static;/s
		);
		expect(layoutCss).not.toContain(".main > .talos-task-drawer");
		expect(layoutCss).toContain(
			".sidebar:is(:hover, :focus-within)"
		);
	});

	it("reuses the navigation material and labels", () => {
		expect(drawerSource).toContain('root.className = "talos-task-drawer command"');
		expect(drawerSource).toContain('mark.className = "talos-task-drawer__mark mark"');
		expect(drawerSource).toContain('label.className = "nav-label"');
		expect(drawerSource).toContain('label.textContent = "任务"');
	});

	it("keeps expansion motion while respecting reduced-motion preferences", () => {
		expect(layoutCss).toMatch(
			/\.pagenav-card\s*>\s*\.talos-task-drawer\s*\{[^}]*transition:/s
		);
		expect(layoutCss).toMatch(
			/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.pagenav-card > \.talos-task-drawer/
		);
	});
});
