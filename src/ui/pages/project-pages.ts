// TALOS 控制台项目、输出与健康页渲染；由 TalosView 委托调用。
import { mountPanelTabs } from "../panel-tabs";
import type { Collected } from "../talos-view-model";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import { setIcon } from "obsidian";
import type { TalosView } from "../../view";
import { fillProjectPortfolioChart, fillSignalList, fillTrend } from "../charts/talos-view-charts";
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

export function renderProjectsPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const projectFolder = view.app.vault.getAbstractFileByPath(view.paths.dir("projects"));
	const projectSourceReady = !!projectFolder && "children" in projectFolder;
	const recentCutoff = Date.now() - 7 * 86400000;
	const recentCount = d.projects.filter((project) => (project.latestMtime ?? 0) >= recentCutoff).length;
	const projectNotes = d.projects.reduce((sum, project) => sum + project.count, 0);
	const rankedProjects = [...d.projects].sort((a, b) => (b.latestMtime ?? 0) - (a.latestMtime ?? 0));

	moduleHero(view, page, {
		ac: "#F59E0B",
		icon: "folder-kanban",
		title: "项目场景",
		desc: "查看项目、近期更新与可追溯的任务统计。",
		stats: [
			{
				label: "项目数",
				value: projectSourceReady ? String(d.projects.length) : "—",
				sub: projectSourceReady ? `${view.paths.dir("projects")} 一级文件夹` : "项目目录未配置或不存在",
				path: view.paths.readme("projects"),
				tone: "default",
			},
			{
				label: "近 7 天有更新",
				value: projectSourceReady ? String(recentCount) : "—",
				sub: projectSourceReady ? "按项目笔记修改时间" : "项目目录不可用",
				path: view.paths.sceneIndexFile,
				tone: "default",
			},
			{
				label: "项目笔记",
				value: projectSourceReady ? String(projectNotes) : "—",
				sub: projectSourceReady ? "项目目录内 Markdown，不含 README" : "项目目录不可用",
				path: view.paths.readme("projects"),
				tone: "good",
			},
		],
		actions: [
			{
				label: "项目总图",
				icon: "map",
				path: view.paths.readme("projects"),
			},
			{
				label: "场景索引",
				icon: "external-link",
				path: view.paths.sceneIndexFile,
			},
			{ label: "检索项目", icon: "copy", command: "/retrieval" },
		],
	});

	const primary = page.createDiv({
		cls: "workflow-v2-primary projects-v2-primary project-scene-layout",
	});
	primary.setAttribute("data-workflow-layout", "split");

	const portfolio = view.panel(
		primary,
		"#4D8DFF",
		"项目组合",
		"更新时间分布 · 扫描到的任务"
	);
	portfolio.addClass("project-portfolio-panel");
	portfolio.setAttribute("data-workflow-section", "core-data");
	fillProjectPortfolioChart(view, 
		portfolio.createDiv({ cls: "project-v2-portfolio-chart" }),
		d.projects
	);

	// 模块整合：「重点项目」与「项目场景地图」是同一批项目的两个视图，合为「重点 / 全部」页签。
	mountPanelTabs({
		parent: primary,
		groupKey: "projects-scenes",
		label: "项目场景",
		selections: view.panelTabSelections,
		tabs: [
			{
				key: "focus",
				label: "最近更新",
				badge: recentCount,
				render: (host) => {
				const attention = view.panel(
					host,
					"#F59E0B",
					"最近更新",
					"按笔记修改时间排序"
				);
				attention.addClass("project-entry-panel");
				attention.setAttribute(
					"data-workflow-section",
					"attention-and-actions"
				);
				const attentionList = attention.createDiv({
					cls: "project-v2-attention-list",
				});
				if (rankedProjects.length === 0) {
					renderTalosEmptyState(
						attentionList,
						"暂无项目场景",
						"建立项目目录后，这里会显示最新进展。",
						{
							label: "打开项目目录",
							icon: "folder-kanban",
							onActivate: () =>
								void openFile(view.app, view.paths.readme("projects")),
						}
					);
				} else {
					for (const project of rankedProjects.slice(0, 4)) {
						const row = attentionList.createEl("button", {
							cls: `project-card project-v2-priority-row priority-${project.priority}`,
							attr: { type: "button" },
						});
						const head = row.createDiv({
							cls: "project-v2-priority-row__head",
						});
						head.createEl("strong", { text: project.name });
						row.createEl("small", { text: project.latestMtime ? `更新 ${new Date(project.latestMtime).toLocaleDateString()}` : "无更新时间" });
						row.createEl("small", {
							cls: "module-latest",
							text: `最新：${project.latestTitle}`,
						});
						if (project.progress) {
							const pct = Math.round(
								(project.progress.done /
									Math.max(project.progress.total, 1)) *
									100
							);
							const progress = row.createDiv({
								cls: "project-v2-priority-progress",
							});
							progress.createSpan().style.width = `${pct}%`;
							progress.createEl("small", {
								text: `${pct}% · ${project.progress.done}/${project.progress.total}${project.progress.sampled ? ` · 最近 ${project.progress.scannedFiles}/${project.progress.totalFiles} 篇` : " · 全部项目笔记"}`,
							});
						}
						row.addEventListener("click", () =>
							void openFile(view.app, project.readme)
						);
					}
				}

				const entryActions = attention.createDiv({
					cls: "project-v2-entry-actions",
				});
				for (const action of [
					{
						label: "场景索引",
						icon: "map",
						path: view.paths.sceneIndexFile,
					},
					{
						label: "项目总 README",
						icon: "folder-open",
						path: view.paths.readme("projects"),
					},
				]) {
					const button = entryActions.createEl("button", {
						cls: "module-hero-action",
						attr: { type: "button" },
					});
					setIcon(
						button.createSpan({ cls: "module-hero-action-icon" }),
						action.icon
					);
					button.createSpan({ text: action.label });
					button.addEventListener("click", () =>
						void openFile(view.app, action.path)
					);
				}
				},
			},
			{
				key: "all",
				label: `全部项目 ${d.projects.length}`,
				render: (host) => {
				const mapPanel = view.panel(
					host,
					"#A78BFA",
					"项目场景地图",
					`${view.paths.dir("projects")} · 全部项目`
				);
				mapPanel.addClass("project-map-panel");
				mapPanel.setAttribute("data-workflow-section", "project-map");
				const cards = mapPanel.createDiv({ cls: "project-grid" });
				if (d.projects.length === 0) {
					renderTalosEmptyState(
						cards,
						"暂无项目",
						"项目目录中出现可识别场景后，将自动生成项目卡片。"
					);
				}
				for (const project of d.projects) {
					const card = cards.createDiv({
						cls: `project-card priority-${project.priority}`,
					});
					card.createEl("b", { text: project.name });
					card.createEl("span", { cls: "big", text: String(project.count) });
					card.createEl("small", { text: project.latestMtime ? `更新 ${new Date(project.latestMtime).toLocaleDateString()}` : "无更新时间" });
					if (project.progress) {
						const pct = Math.round(
							(project.progress.done /
								Math.max(project.progress.total, 1)) *
								100
						);
						const progress = card.createDiv({ cls: "proj-progress" });
						const head = progress.createDiv({
							cls: "proj-progress-head",
						});
						head.createEl("small", { text: "任务进度" });
						head.createEl("small", {
							cls: "proj-progress-num",
							text: `${pct}% · ${project.progress.done}/${project.progress.total}${project.progress.sampled ? ` · 最近 ${project.progress.scannedFiles}/${project.progress.totalFiles} 篇` : " · 全部项目笔记"}`,
						});
						const track = progress.createDiv({
							cls: "proj-progress-track",
						});
						track.createDiv({ cls: "proj-progress-fill" }).style.width =
							`${pct}%`;
					} else {
						card.createEl("small", {
							cls: "proj-progress-none",
							text: "无任务清单 · 进度未跟踪",
						});
					}
					const latest = card.createEl("small", {
						cls: "module-latest",
						text: `最新：${project.latestTitle}`,
					});
					if (project.latestPath) {
						latest.addEventListener("click", (event) => {
							event.stopPropagation();
							void openFile(view.app, project.latestPath || "");
						});
					}
					card.addEventListener("click", () =>
						void openFile(view.app, project.readme)
					);
				}
				},
			},
		],
	});
}
