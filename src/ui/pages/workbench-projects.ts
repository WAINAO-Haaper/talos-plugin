// 项目、任务与待决策使用同一工作面；不改写项目或任务文件。
import { openFile } from "../../actions";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { moduleHero } from "../view-modules";
import { fillProjectPortfolioChart } from "../charts/talos-view-charts";
import { renderTodayActions, renderTodayQuickNote } from "./today-page";

/** projects 和 tasks 是历史深链；tasks 保留到待决策的定位。 */
export function renderWorkbenchProjects(view: TalosView, page: HTMLElement, d: Collected, focusKey: string): void {
	const projectRoot = view.paths.dir("projects");
	const projectFolder = view.app.vault.getAbstractFileByPath(projectRoot);
	const projectReady = !!projectFolder && "children" in projectFolder;
	const tasksReady = d.setup?.tasksPath === "ok";
	const approvalsReady = d.setup?.pendingApprovalsPath === "ok";
	const candidatesReady = d.setup?.candidatesPath === "ok";
	const pending = (approvalsReady ? d.approvals.length : 0) + (candidatesReady ? d.candidates.length : 0);
	const allReady = approvalsReady && candidatesReady;
	const recent = d.projects.filter((project) => (project.latestMtime ?? 0) >= Date.now() - 7 * 86400000).length;

	page.dataset.workbenchFocus = focusKey === "tasks" ? "tasks" : "projects";
	moduleHero(view, page, {
		ac: "#4D8DFF", icon: "folder-kanban", title: "项目与任务",
		desc: "在一处查看项目、任务、焦点和待决策。",
		stats: [
			{ label: "项目数", value: projectReady ? String(d.projects.length) : "—", sub: projectReady ? "项目目录一级文件夹" : "项目目录未配置", path: view.paths.readme("projects") },
			{ label: "近7天更新", value: projectReady ? String(recent) : "—", sub: projectReady ? "按项目笔记修改时间" : "项目目录未配置", path: view.paths.sceneIndexFile },
			{ label: "当前焦点", value: tasksReady && d.focusTotal !== undefined ? String(d.focusTotal) : "—", sub: tasksReady ? "任务池 · 最多预览3项" : "任务池来源待检查", path: view.plugin.talosSettings.tasksPath },
			{ label: "任务池完成占比", value: tasksReady ? d.overview.taskFlow.value : "—", sub: tasksReady ? d.overview.taskFlow.sub : "任务池来源待检查", path: view.plugin.talosSettings.tasksPath },
		],
		actions: [
			{ label: "项目总图", icon: "map", path: view.paths.readme("projects") },
			{ label: "场景索引", icon: "external-link", path: view.paths.sceneIndexFile },
			{ label: "任务池", icon: "list-checks", path: view.plugin.talosSettings.tasksPath },
		],
	});
	const commands = page.createDiv({ cls: "module-hero-actions workbench-projects-commands" });
	for (const [label, command] of [["检索项目", "/retrieval"], ["晨间", "/morning"]] as const) {
		const button = commands.createEl("button", { cls: "module-hero-action", text: label, attr: { type: "button" } });
		button.title = `填入 TALOS 对话「${command}」，按回车发送 · 右键复制`;
		button.addEventListener("click", () => { void view.sendCommandToChat(command); });
		button.addEventListener("contextmenu", (event) => { event.preventDefault(); void view.copyText(command); });
	}

	const grid = page.createDiv({ cls: "workflow-v2-primary workbench-projects-grid" });
	grid.setAttribute("data-workflow-layout", "split");
	const portfolio = view.panel(grid, "#4D8DFF", "项目概况", "更新时间分布 · 部分项目最多扫描最近40篇笔记");
	portfolio.setAttribute("data-workbench-section", "project-statistics");
	if (projectReady) fillProjectPortfolioChart(view, portfolio.createDiv({ cls: "project-v2-portfolio-chart" }), d.projects);
	else portfolio.createDiv({ cls: "empty", text: "项目目录未配置或不存在。" });

	const list = view.panel(grid, "#A78BFA", "项目列表", projectReady ? `${d.projects.length} 个项目 · 按笔记修改时间排序` : "项目目录未配置");
	list.setAttribute("data-workbench-section", "projects");
	if (!projectReady) list.createDiv({ cls: "empty", text: "请在设置中检查项目目录。" });
	else if (d.projects.length === 0) list.createDiv({ cls: "empty", text: "项目目录暂无一级文件夹。" });
	else for (const project of d.projects) {
		const row = list.createEl("button", { cls: "project-card project-v2-priority-row", attr: { type: "button" } });
		row.createEl("strong", { text: project.name });
		row.createEl("small", { text: `${project.count} 篇笔记 · ${project.latestMtime ? `更新 ${new Date(project.latestMtime).toLocaleDateString()}` : "无更新时间"}` });
		if (project.progress) row.createEl("small", { text: `扫描任务 ${project.progress.done}/${project.progress.total}${project.progress.sampled ? ` · 最近 ${project.progress.scannedFiles}/${project.progress.totalFiles} 篇` : " · 全部项目笔记"}` });
		row.addEventListener("click", () => void openFile(view.app, project.readme));
	}

	const focus = view.panel(grid, "#4D8DFF", "当前焦点", "任务池预览 · 最多3项");
	focus.setAttribute("data-workbench-section", "focus");
	if (!tasksReady) focus.createDiv({ cls: "empty", text: "任务池未配置或格式待检查，请在设置中检查来源。" });
	else if (!d.focus.length) focus.createDiv({ cls: "empty", text: "任务池暂无活跃焦点" });
	else for (const item of d.focus.slice(0, 3)) {
		const button = focus.createEl("button", { cls: `today-v1-focus talos-focusable tone-${item.level}`, attr: { type: "button" } });
		button.createEl("b", { text: item.title });
		if (item.doneWhen) button.createEl("small", { text: `done_when · ${item.doneWhen}` });
		button.addEventListener("click", () => void openFile(view.app, item.path || view.plugin.talosSettings.tasksPath));
	}

	const decisions = view.panel(grid, "var(--amber)", "待决策", allReady ? `${pending} 项待处理` : "来源缺失或格式待检查");
	decisions.setAttribute("data-workbench-section", "decisions");
	view.renderDecisionWorkspace(decisions, d, 3);
	renderTodayQuickNote(view, grid);
	const more = page.createEl("details", { cls: "today-v1-secondary" });
	more.createEl("summary", { text: "焦点、动作记录与统计检查" });
	const records = more.createDiv({ cls: "workflow-v2-secondary" });
	const actions = view.panel(records, "#F59E0B", "焦点与动作记录", "焦点预览 · 运行中的动作 · 最近结束的动作（含失败）");
	view.fillOverviewKanban(actions, tasksReady ? d : { ...d, focus: [] });
	renderTodayActions(view, records);
}
