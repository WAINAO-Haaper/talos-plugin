import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createObsidianHost } from "./helpers/obsidian-dom";
import type { TalosView } from "../src/view";
import type { Collected } from "../src/ui/talos-view-model";

vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../src/actions", () => ({ openFile: vi.fn() }));
vi.mock("../src/ui/view-modules", () => ({ moduleHero: vi.fn() }));
vi.mock("../src/ui/panel-tabs", () => ({ mountPanelTabs: (options: { parent: HTMLElement; tabs: { render: (host: HTMLElement) => void }[] }) => options.tabs.forEach((tab) => tab.render(options.parent)) }));
vi.mock("../src/ui/charts/talos-view-charts", () => ({ fillTrend: vi.fn(), fillProjectPortfolioChart: vi.fn(), fillSignalList: vi.fn() }));
import { renderHealthPage } from "../src/ui/pages/project-pages";
import { functionSource, viewSource as readViewSource } from "./helpers/source-text";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readViewSource();
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const page = functionSource(view, "renderHealthPage");

describe("System health v2", () => {
	// 模块整合（D-TLP-069）：健康页第一行为「健康分趋势 | 诊断」；审批与偏好只在今日 · 待决策处理。
	it("uses a health-trend and diagnostics first screen without a second approval workspace", () => {
		expect(page).toContain(
			'cls: "system-v2-primary health-v2-primary"'
		);
		expect(page).toContain('"data-system-section", "core-data"');
		expect(page).toContain("fillTrend(view, trend, d.healthTrend)");
		expect(page).not.toContain("renderDecisionWorkspace");
		expect(page.match(/onActivate: \(\) => view\.openDecisions\(\)/g)?.length).toBe(2);
		expect(page).not.toContain("fillMetricGrid");
		expect(page).not.toContain('cls: "panel-grid"');
	});

	it("keeps loop and error diagnostics together in one diagnostics tab group", () => {
		expect(page).toContain('groupKey: "health-diagnostics"');
		expect(page).toContain("parent: primary,");
		expect(page).not.toContain('badge: d.healthDigest.errors.length');
		expect(page).toContain("d.healthDigest.loopStatus");
		expect(page).toContain("d.healthDigest.errors");
		expect(css).toMatch(
			/\.system-v2-secondary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
		);
	});

	it("reuses the existing reversible approval actions", () => {
		expect(view).toContain("renderApprovalItem(view, pendingList, item)");
		expect(view).toContain("renderCandidateItem(view, preferenceList, item)");
		expect(view.match(/view\.renderDecisionWorkspace\(/g)?.length).toBe(1);
		expect(view).toContain('decisions.setAttribute("data-workbench-section", "decisions")');
	});

	it("uses a container breakpoint and natural page height", () => {
		expect(css).toContain("container: system-v2 / inline-size");
		expect(css).toContain("@container system-v2 (max-width: 820px)");
		expect(css).not.toMatch(
			/\.system-v2-primary\s*\{[^}]*min-height/s
		);
	});
});


describe("health diagnostic sources", () => {
	function render(errorStatus: "ok" | "missing", loopStatus: "ok" | "missing") {
		const { host, element } = createObsidianHost();
		const view = {
			plugin: { talosSettings: { healthLogPath: "health.md", pendingApprovalsPath: "approval.md" } },
			panelTabSelections: new Map(), openDecisions: vi.fn(),
			panel: (parent: HTMLElement, _accent: string, title: string, subtitle: string) => {
				const panel = parent.createDiv(); panel.createEl("strong", { text: title }); panel.createEl("small", { text: subtitle }); return panel;
			},
		} as unknown as TalosView;
		const data = { setup: { healthLogPath: "ok", errorPatterns: errorStatus, loopHealth: loopStatus }, healthTrend: [], healthDigest: { metrics: [], errors: Array.from({ length: 6 }, (_, i) => ({ title: `错误${i}` })), loopStatus: Array.from({ length: 4 }, (_, i) => ({ title: `循环${i}` })) }, approvals: [], candidates: [] } as unknown as Collected;
		renderHealthPage(view, host, data);
		return element;
	}
	it("does not report an unavailable diagnostic source as clear", () => {
		const element = render("missing", "missing");
		expect(element.textContent).toContain("错误模式文件缺失或未就绪");
		expect(element.textContent).toContain("循环健康日志缺失或未就绪");
		expect(element.textContent).not.toContain("当前清空");
		expect(element.textContent).not.toContain("暂无循环状态记录");
	});
	it("labels the bounded diagnostic previews without claiming totals", () => {
		const element = render("ok", "ok");
		expect(element.textContent).toContain("最多显示 6 条");
		expect(element.textContent).toContain("最多显示最近 4 条");
		expect(element.textContent).not.toContain("6 项需要诊断");
	});
});
