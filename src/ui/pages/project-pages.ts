// TALOS 控制台项目、输出与健康页渲染；由 TalosView 委托调用。
import { mountPanelTabs } from "../panel-tabs";
import type { Collected } from "../talos-view-model";
import type { ProjectScene } from "../../types";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import { setIcon } from "obsidian";
import type { TalosView } from "../../view";
import { fillOutputClosureChart, fillProjectPortfolioChart, fillSignalList, fillTrend } from "../charts/talos-view-charts";
import { moduleHero } from "../view-modules";
import { mountFlowPipeline } from "../flow-pipeline";

export function renderOutputPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const hero = moduleHero(view, page, {
		ac: "#FB7185",
		icon: "send",
		title: "输出作战室",
		desc: "统一出口里的待发条目、各平台闭环情况与发布后的运营候选。",
		stats: [],
		actions: [
			{
				label: "统一出口",
				icon: "external-link",
				path: view.paths.outletFile,
			},
			{ label: "输出流", icon: "copy", command: "/output" },
			{
				label: "运营池",
				icon: "activity",
				path: view.paths.opsCandidatesFile,
			},
		],
	});
	mountFlowPipeline(view, hero, d, "output");
	const drafts = page.createDiv({ cls: "talos-publishing-entry" });
	drafts.createEl("strong", { text: "排版与平台草稿" });
	drafts.createSpan({ text: "预览同一篇笔记的公众号与 X 效果，再送到指定账号草稿箱。" });
	const draftButton = drafts.createEl("button", { text: "打开草稿工作区", cls: "mod-cta", attr: { type: "button" } });
	draftButton.addEventListener("click", () => { void view.plugin.openPublishing(); });

	const primary = page.createDiv({
		cls: "workflow-v2-primary output-v2-primary",
	});
	primary.setAttribute("data-workflow-layout", "split");

	const closure = view.panel(
		primary,
		"#34D399",
		"平台闭环分布",
		"已发布 · 待闭环 · 未分类"
	);
	closure.setAttribute("data-workflow-section", "core-data");
	fillOutputClosureChart(view, 
		closure.createDiv({ cls: "output-v2-closure-chart" }),
		d.output.platforms
	);

	const attention = view.panel(
		primary,
		"#FB7185",
		"今日关注",
		"待发队列 · 运营候选"
	);
	attention.addClass("output-v2-attention-panel");
	attention.setAttribute(
		"data-workflow-section",
		"attention-and-actions"
	);
	for (const group of [
		{
			title: "今日待发",
			meta: view.paths.outletFile,
			items: d.output.queue,
			empty: "统一出口暂无待发条目",
		},
		{
			title: "运营候选",
			meta: "发布后观察 · 待确认",
			items: d.output.opsCandidates,
			empty: "暂无待确认运营候选",
		},
	]) {
		const section = attention.createDiv({
			cls: "output-v2-attention-group",
		});
		const head = section.createDiv({
			cls: "output-v2-attention-group__head",
		});
		head.createEl("strong", { text: group.title });
		head.createEl("span", {
			text: `${group.items.length} · ${group.meta}`,
		});
		fillSignalList(view, 
			section.createDiv({ cls: "detail-list" }),
			group.items,
			group.empty
		);
	}
}

export function renderHealthPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const health =
		d.healthDigest.metrics.find((item) => item.label === "健康分") ||
		d.healthDigest.metrics[0];
	const approvals =
		d.healthDigest.metrics.find((item) => item.label === "待审批") ||
		d.healthDigest.metrics[1];
	const candidates =
		d.healthDigest.metrics.find((item) => item.label === "偏好候选") ||
		d.healthDigest.metrics[2];

	if (health && d.healthTrend.length > 1) {
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
	if (approvals && d.approvals.length === 0) approvals.aux = "清空";

	moduleHero(view, page, {
		ac: "#34D399",
		icon: "activity",
		title: "系统健康",
		desc: "把健康分、审批池、偏好候选和错误模式放到同一屏，优先处理会卡住系统的风险。",
		stats: [
			{
				label: health?.label || "健康分",
				value: health?.value || "—",
				sub: health?.sub,
				path: health?.path,
				tone: health?.tone || "default",
			},
			{
				label: approvals?.label || "待审批",
				value: approvals?.value || "0",
				sub: "点击去今日 · 待决策",
				onActivate: () => view.openDecisions(),
				tone: approvals?.tone || "default",
			},
			{
				label: candidates?.label || "偏好候选",
				value: candidates?.value || "0",
				sub: "点击去今日 · 待决策",
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
	fillTrend(view, trend, d.healthTrend);

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
				badge: d.healthDigest.errors.length,
				render: (host) => {
				const errors = view.panel(
					host,
					"#FB7185",
					"错误模式",
					d.healthDigest.errors.length > 0
						? `${d.healthDigest.errors.length} 项需要诊断`
						: "error-patterns · 当前清空"
				);
				fillSignalList(view,
					errors.createDiv({ cls: "detail-list" }),
					d.healthDigest.errors,
					"暂无活跃错误模式"
				);
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
					"loop-health-log"
				);
				fillSignalList(view,
					loops.createDiv({ cls: "detail-list" }),
					d.healthDigest.loopStatus,
					"暂无循环状态记录"
				);
				},
			},
		],
	});
}

export function renderProjectsPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const p0Count = d.projects.filter(
		(project) => project.priority === "p0"
	).length;
	const projectNotes = d.projects.reduce(
		(sum, project) => sum + project.count,
		0
	);
	const priorityOrder: Record<ProjectScene["priority"], number> = {
		p0: 0,
		p1: 1,
		p2: 2,
	};
	const rankedProjects = [...d.projects].sort(
		(left, right) =>
			priorityOrder[left.priority] - priorityOrder[right.priority] ||
			right.count - left.count
	);

	moduleHero(view, page, {
		ac: "#F59E0B",
		icon: "folder-kanban",
		title: "项目场景",
		desc: "按活跃度和优先级扫项目，先让高频项目露头，再进入具体场景推进。",
		stats: [
			{
				label: "项目数",
				value: String(d.projects.length),
				sub: `${view.paths.dir("projects")} 子场景`,
				path: view.paths.readme("projects"),
				tone: "default",
			},
			{
				label: "高频项目",
				value: String(p0Count),
				sub: "P0 场景优先推进",
				path: view.paths.sceneIndexFile,
				tone: p0Count > 0 ? "hot" : "default",
			},
			{
				label: "项目笔记",
				value: String(projectNotes),
				sub: "不含 README",
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
		"优先级分布 · 已跟踪任务完成率"
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
				label: "重点项目",
				badge: p0Count,
				render: (host) => {
				const attention = view.panel(
					host,
					"#F59E0B",
					"重点项目",
					"P0 优先 · 最近活跃度次序"
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
						"建立项目 README 后，这里会显示优先级与最新进展。",
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
						head.createEl("span", {
							cls: `project-v2-priority-badge priority-${project.priority}`,
							text: project.priority.toUpperCase(),
						});
						row.createEl("small", { text: project.status });
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
								text: `${pct}% · ${project.progress.done}/${project.progress.total}`,
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
					card.createEl("small", { text: project.status });
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
							text: `${pct}% · ${project.progress.done}/${project.progress.total}`,
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
