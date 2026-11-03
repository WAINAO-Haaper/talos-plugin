// 项目与任务：一屏给出「当前焦点 + 卡住的项目」；完整图表、动作记录与便签收进底部展开。
import { openFile } from "../../actions";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { fillProjectPortfolioChart } from "../charts/talos-view-charts";
import { renderTodayActions, renderTodayQuickNote } from "./today-page";
import { renderWorkbenchHome, type WorkbenchHomeHandle, type WorkbenchLink, type WorkbenchRow } from "./workbench-home";

export function renderWorkbenchProjects(view: TalosView, page: HTMLElement, d: Collected, focusKey: string): void {
	const projectRoot = view.paths.dir("projects");
	const projectFolder = view.app.vault.getAbstractFileByPath(projectRoot);
	const projectReady = !!projectFolder && "children" in projectFolder;
	const tasksReady = d.setup?.tasksPath === "ok";
	const approvalsReady = d.setup?.pendingApprovalsPath === "ok";
	const candidatesReady = d.setup?.candidatesPath === "ok";
	const pending = (approvalsReady ? d.approvals.length : 0) + (candidatesReady ? d.candidates.length : 0);
	const allReady = approvalsReady && candidatesReady;
	const recent = projectReady ? d.projects.filter((project) => (project.latestMtime ?? 0) >= Date.now() - 7 * 86400000).length : 0;
	const focusItem = tasksReady ? d.focus[0] : undefined;
	const focusTotal = tasksReady ? d.focusTotal ?? d.focus.length : 0;
	const taskDetail = focusKey === "tasks";

	page.dataset.workbenchFocus = taskDetail ? "tasks" : "projects";
	let handle: WorkbenchHomeHandle | null = null;

	const projectRows: WorkbenchRow[] = projectReady
		? d.projects.slice(0, 4).map((project) => ({
			title: project.name,
			meta: `${project.count} 篇笔记 · ${project.latestMtime ? `更新 ${new Date(project.latestMtime).toLocaleDateString()}` : "无更新时间"}`,
			onActivate: () => void openFile(view.app, project.readme),
		}))
		: [];

	const commands: WorkbenchLink[] = [
		{ label: "检索项目", onActivate: () => void view.sendCommandToChat("/retrieval"), onSecondary: () => void view.copyText("/retrieval") },
		{ label: "晨间", onActivate: () => void view.sendCommandToChat("/morning"), onSecondary: () => void view.copyText("/morning") },
	];

	handle = renderWorkbenchHome(view, page, {
		eyebrow: "工作台 · 项目与任务",
		title: "项目与任务",
		lede: projectReady
			? `${d.projects.length} 个项目里 ${recent} 个在近 7 天动过。${focusItem ? `当前焦点是「${focusItem.title}」，先把它推到 done_when。` : "任务池暂无活跃焦点，先处理待决策。"}`
			: "项目目录未配置。先在设置里指定项目目录，再回来查看项目与任务。",
		stats: [
			{
				label: "项目",
				value: projectReady ? String(d.projects.length) : "—",
				unit: "个",
				sub: projectReady ? "项目目录一级文件夹" : "项目目录未配置",
				onActivate: () => void openFile(view.app, view.paths.readme("projects")),
			},
			{
				label: "近 7 天更新",
				value: projectReady ? String(recent) : "—",
				unit: "个",
				sub: projectReady ? "按项目笔记修改时间" : "项目目录未配置",
				onActivate: () => handle?.openDetail("portfolio"),
			},
			{
				label: "待决策",
				value: allReady ? String(pending) : "—",
				unit: "项",
				sub: allReady ? `审批 ${approvalsReady ? d.approvals.length : 0} · 偏好候选 ${candidatesReady ? d.candidates.length : 0}` : "来源缺失或格式待检查",
				alert: allReady && pending > 0,
				onActivate: () => view.openDecisions(),
			},
		],
		focus: {
			accent: "#4D8DFF",
			kicker: focusItem ? "当前焦点 · 最高优先级" : "当前焦点",
			title: focusItem?.title ?? (tasksReady ? "任务池暂无活跃焦点" : "任务池未配置或格式待检查"),
			meta: focusItem?.doneWhen
				? `done_when · ${focusItem.doneWhen}`
				: tasksReady ? "任务池 · 最多预览 3 项" : "在设置里检查任务池来源",
			cta: tasksReady ? "打开任务池 →" : "去设置 →",
			onActivate: () => {
				if (tasksReady) void openFile(view.app, view.plugin.talosSettings.tasksPath);
				else view.navigateToPage("settings");
			},
			rows: [
				{
					title: `当前焦点 · ${tasksReady ? `${focusTotal} 个` : "来源待检查"}`,
					meta: "任务池里的活跃焦点",
					go: "打开任务池 →",
					onActivate: () => {
						if (tasksReady) void openFile(view.app, view.plugin.talosSettings.tasksPath);
						else view.navigateToPage("settings");
					},
				},
				{
					title: `待决策 · ${allReady ? `${pending} 项` : "来源待检查"}`,
					meta: "审批与偏好候选",
					go: "去决策 →",
					onActivate: () => view.openDecisions(),
				},
				{
					title: "项目场景索引",
					meta: "所有项目的场景入口",
					go: "打开索引 →",
					onActivate: () => void openFile(view.app, view.paths.sceneIndexFile),
				},
			],
		},
		blocks: [
			{
				accent: "#4D8DFF",
				title: "项目列表",
				meta: projectReady ? `${d.projects.length} 个项目 · 按修改时间` : "项目目录未配置或不存在",
				section: "projects",
				empty: projectReady ? (d.projects.length === 0 ? "项目目录暂无一级文件夹" : undefined) : "项目目录未配置或不存在",
				rows: projectRows,
				links: [
					{ label: "查看全部项目 →", onActivate: () => void openFile(view.app, view.paths.readme("projects")) },
					{ label: "项目总图", onActivate: () => void openFile(view.app, view.paths.readme("projects")) },
					{ label: "场景索引", onActivate: () => void openFile(view.app, view.paths.sceneIndexFile) },
					...commands,
				],
			},
			{
				accent: "#F59E0B",
				title: "待决策",
				meta: allReady ? `${pending} 项待处理` : "来源缺失或格式待检查",
				section: "decisions",
				mount: (slot) => { view.renderDecisionWorkspace(slot, d, 3); },
				links: [
					{ label: "打开决策区 →", onActivate: () => view.openDecisions() },
				],
			},
		],
		details: [
			{
				key: "portfolio",
				label: "展开项目概况与更新时间分布",
				mount: (host) => {
					const chart = host.createDiv({ cls: "project-v2-portfolio-chart" });
					if (projectReady) fillProjectPortfolioChart(view, chart, d.projects);
					else chart.createDiv({ cls: "empty", text: "项目目录未配置或不存在。" });
				},
			},
			{
				key: "focus-log",
				label: "展开焦点与动作记录",
				mount: (host) => { view.fillOverviewKanban(host, tasksReady ? d : { ...d, focus: [] }); },
			},
			{
				key: "quick-note",
				label: "展开快捷便签",
				mount: (host) => { renderTodayQuickNote(view, host); },
			},
			{
				key: "runtime",
				label: "展开统计检查",
				mount: (host) => { renderTodayActions(view, host); },
			},
		],
	});

	page.querySelectorAll<HTMLElement>(".talos-wb-detail-body > .talos-ui-page-header").forEach((node) => node.remove());
	void handle;
}
