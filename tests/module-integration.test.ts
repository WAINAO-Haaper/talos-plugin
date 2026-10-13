import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { viewSource as readViewSource } from "./helpers/source-text";

// 模块整合（D-TLP-069）：每类信息只有一个主场，其他页只留数字 + 跳转。
const root = fileURLToPath(new URL("../", import.meta.url));
const all = readViewSource();
const read = (path: string) => readFileSync(`${root}src/${path}`, "utf8");
const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

describe("module integration", () => {
	it("renders the approval and preference workspace in exactly one place: Today", () => {
		expect(count(all, /view\.renderDecisionWorkspace\(/g)).toBe(1);
		expect(read("ui/pages/today-page.ts")).toContain("view.renderDecisionWorkspace(decisionPanel, d, 3)");
	});

	it("draws the health trend only on the System health page", () => {
		expect(count(all, /fillTrend\(view, /g)).toBe(1);
		expect(read("ui/pages/project-pages.ts")).toContain("fillTrend(view, trend, d.healthTrend)");
	});

	it("routes every other decision entry to Today · decisions instead of opening a second workspace", () => {
		const view = read("view.ts");
		expect(view).toContain("openDecisions(): void {");
		expect(view).toContain('this.panelTabSelections.set("today-status", "decisions");');
		const attention = read("ui/pages/overview-page.ts");
		expect(count(attention, /target: "decisions"/g)).toBe(2);
		expect(attention).toContain('if (item.target === "decisions") view.openDecisions();');
		expect(read("ui/pages/today-page.ts")).toContain('if (primary.target === "decisions") view.openDecisions();');
		expect(read("ui/view-modules.ts")).toContain("stat.onActivate");
	});

	it("groups same-purpose secondary modules into tab groups on the integrated pages", () => {
		const groups: Array<[string, string]> = [
			["ui/pages/workspace-pages.ts", "inbox-overview"],
			["ui/pages/project-pages.ts", "projects-scenes"],
			["ui/pages/project-pages.ts", "health-diagnostics"],
			["ui/pages/knowledge-pages.ts", "vault-structure"],
		];
		for (const [file, key] of groups) expect(read(file)).toContain(`groupKey: "${key}"`);
		const projects = read("ui/pages/project-pages.ts");
		expect(projects).toContain('label: "重点项目"');
		expect(projects).toContain("label: `全部项目 ${d.projects.length}`");
	});

	it("folds the capability group controls into the capability browser", () => {
		const knowledge = read("ui/pages/knowledge-pages.ts");
		expect(knowledge).not.toContain('"分组控制"');
		expect(knowledge).toContain('const controls = browser.createDiv({ cls: "capability-v2-controls capability-v2-controls--inline" });');
		expect(knowledge).toContain("点击卡片填入 TALOS 对话");
	});

	it("keeps the identity page to identity and governance entries", () => {
		const knowledge = read("ui/pages/knowledge-pages.ts");
		expect(knowledge).not.toContain('"当前工作状态"');
		expect(knowledge).toContain("const governance = view.panel(\n\t\tattentionColumn,");
	});
});
