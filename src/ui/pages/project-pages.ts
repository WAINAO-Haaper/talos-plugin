// TALOS 控制台项目、输出与健康页渲染；由 TalosView 委托调用。
import type { Collected } from "../talos-view-model";
import type { ProjectScene } from "../../types";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import { setIcon } from "obsidian";
import type { TalosView } from "../../view";
import { fillOutputClosureChart, fillPlatforms, fillProjectPortfolioChart, fillSignalList, fillTrend } from "../charts/talos-view-charts";
import { moduleHero } from "../view-modules";

export function renderOutputPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const pending =
		d.output.metrics.find((item) => item.label === "今日待发") ||
		d.output.metrics[0];
	const platformMetric =
		d.output.metrics.find((item) => item.label === "平台稿件") ||
		d.output.metrics[1];
	const opsMetric =
		d.output.metrics.find((item) => item.label === "运营候选") ||
		d.output.metrics[2];

	moduleHero(view, page, {
		ac: "#FB7185",
		icon: "send",
		eyebrow: "OUTPUT WAR ROOM",
		title: "输出作战室",
		desc: "从统一出口到五平台分发，把待发、发布、回填放在同一条线上看。",
		stats: [
			{
				label: pending?.label || "今日待发",
				value: pending?.value || "0",
				sub: pending?.sub,
				path: pending?.path,
				tone: pending?.tone || "default",
			},
			{
				label: platformMetric?.label || "平台稿件",
				value: platformMetric?.value || "0",
				sub: platformMetric?.sub,
				path: platformMetric?.path,
				tone: platformMetric?.tone || "default",
			},
			{
				label: opsMetric?.label || "运营候选",
				value: opsMetric?.value || "0",
				sub: opsMetric?.sub,
				path: opsMetric?.path,
				tone: opsMetric?.tone || "default",
			},
		],
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

	const platforms = view.panel(
		page,
		"#38E1FF",
		"平台分发明细",
		"抖音 / 小红书 / X / 公众号 / 知识星球"
	);
	platforms.addClass("output-v2-platform-panel");
	platforms.setAttribute("data-workflow-section", "platform-details");
	fillPlatforms(view, 
		platforms.createDiv({ cls: "platform-grid" }),
		d.output.platforms
	);
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
	const pendingTotal = d.approvals.length + d.candidates.length;

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
		eyebrow: "SYSTEM HEALTH",
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
				sub: approvals?.sub,
				path: approvals?.path,
				tone: approvals?.tone || "default",
			},
			{
				label: candidates?.label || "偏好候选",
				value: candidates?.value || "0",
				sub: candidates?.sub,
				path: candidates?.path,
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

	const decisions = view.panel(
		primary,
		"#FBBF24",
		"审批与偏好",
		pendingTotal > 0
			? `${pendingTotal} 项可直接处理`
			: "审批池已清空"
	);
	decisions.setAttribute(
		"data-system-section",
		"attention-and-actions"
	);
	view.renderDecisionWorkspace(decisions, d, 3);

	const diagnostics = page.createDiv({
		cls: "system-v2-secondary health-v2-diagnostics",
	});
	const loops = view.panel(
		diagnostics,
		"#38E1FF",
		"循环状态",
		"loop-health-log"
	);
	fillSignalList(view, 
		loops.createDiv({ cls: "detail-list" }),
		d.healthDigest.loopStatus,
		"暂无循环状态记录"
	);
	const errors = view.panel(
		diagnostics,
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
		eyebrow: "PROJECT SCENES",
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

	const attention = view.panel(
		primary,
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

	const mapPanel = view.panel(
		page,
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
}
