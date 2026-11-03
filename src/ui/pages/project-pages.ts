// TALOS 控制台项目、输出与健康页渲染；由 TalosView 委托调用。
import { mountPanelTabs } from "../panel-tabs";
import type { Collected } from "../talos-view-model";
import type { TalosView } from "../../view";
import { fillSignalList, fillTrend } from "../charts/talos-view-charts";
import { moduleHero } from "../view-modules";
import { mountFlowPipeline } from "../flow-pipeline";

export function renderOutputPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const hero = moduleHero(view, page, {
		ac: "#FB7185",
		icon: "send",
		title: "输出",
		desc: "查看和整理待处理的输出内容。",
		stats: [],
		actions: [{ label: "打开输出", icon: "external-link", path: view.paths.outletFile }],
	});
	mountFlowPipeline(view, hero, d, "output");
	const panel = view.panel(page, "#FB7185", d.output.queueStatus === "format" ? "来源预览" : "待处理输出", d.output.queueStatus === "ready" ? `共 ${d.output.queueTotal} 条 · 列表最多显示 8 条` : d.output.queueStatus === "format" ? "格式无法统计 · 仅显示链接预览" : "来源文件未配置或不存在");
	fillSignalList(view, panel.createDiv({ cls: "detail-list" }), d.output.queue, d.output.queueStatus === "ready" ? "暂无待处理输出" : "请检查输出文件及条目格式");
}

export function renderHealthPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const healthReady = d.setup?.healthLogPath === "ok";
	const errorsReady = d.setup?.errorPatterns === "ok";
	const loopsReady = d.setup?.loopHealth === "ok";
	const health =
		d.healthDigest.metrics.find((item) => item.label === "健康分") ||
		d.healthDigest.metrics[0];
	const approvals =
		d.healthDigest.metrics.find((item) => item.label === "待审批") ||
		d.healthDigest.metrics[1];
	const candidates =
		d.healthDigest.metrics.find((item) => item.label === "偏好候选") ||
		d.healthDigest.metrics[2];

	if (healthReady && health && d.healthTrend.length > 1) {
		const last = d.healthTrend[d.healthTrend.length - 1];
		const previous = d.healthTrend[d.healthTrend.length - 2];
		const delta = (last?.score ?? 0) - (previous?.score ?? 0);
		health.aux =
			delta > 0
				? `↑ ${delta} vs 上次`
				: delta < 0
					? `↓ ${Math.abs(delta)} vs 上次`
					: "→ 持平";
	}
	if (approvals && d.setup?.pendingApprovalsPath === "ok" && d.approvals.length === 0) approvals.aux = "清空";

	moduleHero(view, page, {
		ac: "#34D399",
		icon: "activity",
		title: "系统健康",
		desc: "把健康分、审批池、偏好候选和错误模式放到同一屏，优先处理会卡住系统的风险。",
		stats: [
			{
				label: health?.label || "健康分",
				value: healthReady ? health?.value || "—" : "—",
				sub: healthReady ? health?.sub : "健康日志缺失或格式待检查",
				path: health?.path,
				tone: health?.tone || "default",
			},
			{
				label: approvals?.label || "待审批",
				value: d.setup?.pendingApprovalsPath === "ok" ? (approvals?.value || "0") : "—",
				sub: d.setup?.pendingApprovalsPath === "ok" ? "点击去今日 · 待决策" : "审批文件缺失或格式待检查",
				onActivate: () => view.openDecisions(),
				tone: approvals?.tone || "default",
			},
			{
				label: candidates?.label || "偏好候选",
				value: d.setup?.candidatesPath === "ok" ? (candidates?.value || "0") : "—",
				sub: d.setup?.candidatesPath === "ok" ? "点击去今日 · 待决策" : "候选文件缺失或格式待检查",
				onActivate: () => view.openDecisions(),
				tone: candidates?.tone || "default",
			},
		],
		actions: [
			{
				label: "健康日志",
				icon: "external-link",
				path: view.plugin.talosSettings.healthLogPath,
			},
			{
				label: "审批池",
				icon: "clipboard-list",
				path: view.plugin.talosSettings.pendingApprovalsPath,
			},
			{ label: "快检", icon: "copy", command: "/maintain quick" },
		],
	});

	const primary = page.createDiv({
		cls: "system-v2-primary health-v2-primary",
	});
	primary.setAttribute("data-system-layout", "split");

	const trend = view.panel(
		primary,
		"#F472B6",
		"健康分趋势",
		"health-log · 近 9 次"
	);
	trend.addClass("health-v2-trend-panel");
	trend.setAttribute("data-system-section", "core-data");
	if (healthReady) fillTrend(view, trend, d.healthTrend);
	else trend.createDiv({ cls: "empty", text: "健康日志缺失或格式待检查。" });

	// 模块整合：审批与偏好只在今日页「待决策」处理（页头数字可直达）；循环状态与错误模式合为「诊断」。
	mountPanelTabs({
		parent: primary,
		groupKey: "health-diagnostics",
		label: "诊断",
		selections: view.panelTabSelections,
		tabs: [
			{
				key: "errors",
				label: "错误模式",
				render: (host) => {
				const errors = view.panel(
					host,
					"#FB7185",
					"错误模式",
					errorsReady ? "错误模式文件 · 最多显示 6 条" : "错误模式文件缺失或未就绪"
				);
				if (errorsReady) fillSignalList(view,
					errors.createDiv({ cls: "detail-list" }),
					d.healthDigest.errors,
					"未识别到可展示条目"
				);
				else errors.createDiv({ cls: "empty", text: "请检查错误模式文件及其路径。" });
				},
			},
			{
				key: "loops",
				label: "循环状态",
				render: (host) => {
				const loops = view.panel(
					host,
					"#38E1FF",
					"循环状态",
					loopsReady ? "循环健康日志 · 最多显示最近 4 条" : "循环健康日志缺失或未就绪"
				);
				if (loopsReady) fillSignalList(view,
					loops.createDiv({ cls: "detail-list" }),
					d.healthDigest.loopStatus,
					"未识别到可展示记录"
				);
				else loops.createDiv({ cls: "empty", text: "请检查循环健康日志及其路径。" });
				},
			},
		],
	});
}
