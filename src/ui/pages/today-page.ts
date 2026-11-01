// TALOS「今日」页：现在做什么、需要处理什么、待决策与任务进度，一屏取齐。
// 2026-10-07 导航重构：合并原工作台与每日执行的首屏信息；健康趋势、知识分布等
// 只在各自主场页（系统 / 内容流）出现，这里只保留带跳转的提醒。
import type { Collected } from "../talos-view-model";
import { WEEKDAYS } from "../talos-view-model";
import { ConsoleActionPanel } from "../console-action-panel";
import { QuickNote } from "../quick-note";
import { openFile } from "../../actions";
import type { TalosView } from "../../view";
import { moduleHero } from "../view-modules";
import { CONTENT_KEYS } from "../../data/schema";

export interface TodayTimelineSlot {
	time: string;
	mins: number;
	dur: number;
	title: string;
	starter: string;
	path: string;
}

/** 当前所处时段与下一个时段；不在任何时段内时 current 为 null。 */
export function pickTodaySlots<T extends TodayTimelineSlot>(
	slots: readonly T[],
	minsNow: number
): { current: T | null; next: T | null } {
	const current = slots.find((slot) => minsNow >= slot.mins && minsNow < slot.mins + slot.dur) ?? null;
	const next = slots.find((slot) => slot.mins > minsNow) ?? null;
	return { current, next };
}

export function renderTodayPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const root = page.createDiv({ cls: "talos-home-v3" });
	const folderExists = (path: string): boolean => {
		const item = view.app.vault.getAbstractFileByPath(path);
		return !!item && "children" in item;
	};
	const availableContent = CONTENT_KEYS.filter((key) => folderExists(view.paths.dir(key))).length;
	const contentComplete = availableContent === CONTENT_KEYS.length;
	const inboxReady = folderExists(view.plugin.talosSettings.inboxFolder);
	const projectsReady = folderExists(view.paths.dir("projects"));
	const tasksReady = d.setup?.tasksPath === "ok";
	const healthReady = d.setup?.healthLogPath === "ok";
	const approvalsReady = d.setup?.pendingApprovalsPath === "ok";
	const candidatesReady = d.setup?.candidatesPath === "ok";
	const pending = (approvalsReady ? d.approvals.length : 0) + (candidatesReady ? d.candidates.length : 0);
	const pendingText = approvalsReady && candidatesReady ? String(pending) : approvalsReady || candidatesReady ? `≥${pending}` : "—";
	const now = new Date();
	const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;
	const latestHealth = healthReady ? d.healthTrend.at(-1) : undefined;
	moduleHero(view, root, {
		ac: "#F59E0B", icon: "layout-dashboard", eyebrow: `TALOS · ${dateLabel}`,
		title: "系统总览", desc: "用图表查看资料、工作和系统健康。", metricLimit: 5,
		stats: [
			{ label: "知识笔记", value: availableContent === 0 ? "—" : `${contentComplete ? "" : "≥"}${d.total}`, sub: contentComplete ? "六大内容目录 · Markdown" : "部分内容目录未配置", onActivate: () => view.navigateToPage("knowledge") },
			{ label: "收件积压", value: inboxReady ? String(d.inbox.count) : "—", sub: inboxReady ? "收件目录 · 文件创建时间" : "收件目录未配置", onActivate: () => view.navigateToPage("inbox") },
			{ label: "项目", value: projectsReady ? String(d.projects.length) : "—", sub: projectsReady ? "项目目录的一级文件夹" : "项目目录未配置", onActivate: () => view.navigateToPage("projects") },
			{ label: "任务池完成", value: tasksReady ? d.overview.taskFlow.value : "—", sub: tasksReady ? d.overview.taskFlow.sub : "任务池未配置或格式待检查", onActivate: () => view.navigateToPage("tasks") },
			{ label: "最近健康记录", value: latestHealth ? String(latestHealth.score) : "—", sub: latestHealth ? `健康日志 · ${latestHealth.label}` : "健康日志未就绪或无记录", onActivate: () => view.navigateToPage("health") },
		],
	});

	const grid = root.createDiv({ cls: "talos-home-v3-grid" });
	grid.setAttribute("aria-label", "系统统计图表");
	const distribution = homePanel(view, grid, "#34D399", "资料分布", contentComplete ? "六大内容目录 · Markdown 文件" : "部分内容目录未配置 · 仅显示已找到的目录", null);
	const bars = distribution.createDiv({ cls: "talos-home-v3-bars" });
	const maxCount = Math.max(1, ...d.dist.map((item) => item.count));
	for (const [index, item] of d.dist.entries()) {
		const key = CONTENT_KEYS[index];
		const ready = key !== undefined && folderExists(view.paths.dir(key));
		const row = bars.createEl("button", { cls: "talos-home-v3-bar", attr: { type: "button" } });
		row.disabled = !ready;
		row.setAttribute("aria-label", `${item.name}：${ready ? `${item.count} 篇，打开详情` : "目录未配置"}`);
		row.addEventListener("click", () => {
			if (key === "inbox") view.navigateToPage("inbox");
			else if (key === "projects") view.navigateToPage("projects");
			else if (key === "insights" || key === "assets") view.navigateToPage("knowledge");
			else if (key === "logs" || key === "archive") void openFile(view.app, item.readme);
		});
		row.createSpan({ text: item.name });
		const track = row.createDiv({ cls: "talos-home-v3-bar-track" });
		track.createSpan().style.width = `${ready ? Math.round(item.count / maxCount * 100) : 0}%`;
		row.createEl("b", { text: ready ? String(item.count) : "—" });
	}
	if (availableContent === 0) bars.createDiv({ cls: "empty", text: "内容目录未配置" });

	const heat = homePanel(view, grid, "#A78BFA", "资料活跃情况", "近12个月 · 文件创建时间，迁移可能改变日期", "knowledge");
	const heatWrap = heat.createDiv({ cls: "talos-home-v3-heat" });
	heatWrap.setAttribute("role", "img");
	heatWrap.setAttribute("aria-label", `笔记创建热力图：${d.heatmap.meta}`);
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	for (const month of d.heatmap.months) {
		const monthEl = heatWrap.createDiv({ cls: "talos-home-v3-month" });
		monthEl.createEl("small", { text: month.label });
		const weeks = monthEl.createDiv({ cls: "talos-home-v3-weeks" });
		for (const week of month.weeks) {
			const weekEl = weeks.createDiv({ cls: "talos-home-v3-week" });
			for (const cell of week) {
				const cellEl = weekEl.createDiv({ cls: "talos-home-v3-cell" });
				if (!cell.date || cell.date > today) cellEl.addClass("is-empty");
				else { cellEl.setAttribute("data-level", String(cell.level)); cellEl.setAttribute("title", `${cell.date} · ${cell.count} 篇`); }
			}
		}
	}
	heat.createEl("small", { cls: "talos-home-v3-note", text: d.heatmap.meta });

	const age = homePanel(view, grid, "#F59E0B", "收件积压年龄", "收件目录 · 按文件创建时间", "inbox");
	if (!inboxReady) age.createDiv({ cls: "empty", text: "收件目录未配置" });
	else if (d.inbox.count === 0) age.createDiv({ cls: "empty", text: "收件箱没有积压" });
	else {
		const track = age.createDiv({ cls: "talos-home-v3-age-track" });
		track.setAttribute("role", "img");
		track.setAttribute("aria-label", `收件年龄分布：${d.inbox.ageBuckets.map((item) => `${item.label} ${item.count}篇`).join("，")}`);
		for (const bucket of d.inbox.ageBuckets) {
			if (!bucket.count) continue;
			const segment = track.createSpan({ cls: `tone-${bucket.tone}` });
			segment.style.width = `${bucket.count / d.inbox.count * 100}%`;
		}
		const legend = age.createDiv({ cls: "talos-home-v3-age-legend" });
		for (const bucket of d.inbox.ageBuckets) {
			const label = legend.createSpan({ cls: `tone-${bucket.tone}` });
			label.createEl("i"); label.createSpan({ text: `${bucket.label} · ${bucket.count}` });
		}
		age.createEl("small", { cls: "talos-home-v3-note", text: `共 ${d.inbox.count} 篇 · 最老 ${d.inbox.oldestDays} 天 · 迁移可能改变日期` });
	}

	const health = homePanel(view, grid, "#4D8DFF", "系统健康趋势", "健康日志 · 最近最多9次记录", "health");
	if (!healthReady) health.createDiv({ cls: "empty", text: "健康日志未配置或格式待检查" });
	else if (d.healthTrend.length === 0) health.createDiv({ cls: "empty", text: "健康日志暂无有效记录" });
	else renderHomeHealth(health, d.healthTrend);

	const summary = root.createDiv({ cls: "talos-home-v3-summary" });
	const cutoff = Date.now() - 7 * 86400000;
	const recentProjects = projectsReady ? d.projects.filter((item) => (item.latestMtime ?? 0) >= cutoff).length : null;
	homeSummary(summary, "近期项目", recentProjects === null ? "项目目录未配置" : `近7天更新 ${recentProjects} 个 · 按笔记修改时间`, () => view.navigateToPage("projects"));
	homeSummary(summary, "当前焦点", !tasksReady ? "任务池来源待检查" : d.focus[0]?.title || "暂无活跃焦点", () => view.navigateToPage("tasks"));
	homeSummary(summary, "待决策", approvalsReady && candidatesReady ? `${pendingText} 项待处理` : `已识别 ${pendingText} · 来源待检查`, () => view.openDecisions());
}

function homePanel(view: TalosView, parent: HTMLElement, color: string, title: string, detail: string, target: string | null): HTMLElement {
	const panel = view.panel(parent, color, title, detail);
	panel.addClass("talos-home-v3-chart");
	if (!target) {
		panel.setAttribute("role", "group");
		panel.setAttribute("aria-label", `${title}，${detail}。选择分类打开详情`);
		return panel;
	}
	panel.setAttribute("role", "button");
	panel.setAttribute("tabindex", "0");
	panel.setAttribute("aria-label", `${title}，${detail}。打开详情`);
	panel.addEventListener("click", () => view.navigateToPage(target));
	panel.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault(); view.navigateToPage(target);
	});
	return panel;
}

function homeSummary(parent: HTMLElement, label: string, text: string, activate: () => void): void {
	const button = parent.createEl("button", { cls: "talos-home-v3-summary-item", attr: { type: "button" } });
	button.createEl("strong", { text: label }); button.createSpan({ text });
	button.addEventListener("click", activate);
}

function renderHomeHealth(parent: HTMLElement, points: Collected["healthTrend"]): void {
	const ns = "http://www.w3.org/2000/svg";
	const svg = parent.ownerDocument.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 400 108");
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", `健康日志记录：${points.map((p) => `${p.label} ${p.score}分`).join("，")}`);
	svg.classList.add("talos-home-v3-line");
	const xs = points.map((_, index) => points.length === 1 ? 200 : 18 + index * 364 / (points.length - 1));
	const ceiling = Math.max(100, ...points.map((point) => point.score));
	const y = (score: number) => 88 - Math.max(0, score) / ceiling * 72;
	const polyline = parent.ownerDocument.createElementNS(ns, "polyline");
	polyline.setAttribute("points", points.map((p, i) => `${xs[i]},${y(p.score)}`).join(" "));
	svg.appendChild(polyline);
	points.forEach((p, i) => {
		const circle = parent.ownerDocument.createElementNS(ns, "circle"); circle.setAttribute("cx", String(xs[i])); circle.setAttribute("cy", String(y(p.score))); circle.setAttribute("r", "4");
		const title = parent.ownerDocument.createElementNS(ns, "title"); title.textContent = `${p.label} · ${p.score}分`; circle.appendChild(title); svg.appendChild(circle);
	});
	parent.appendChild(svg);
	const last = points.at(-1);
	parent.createEl("small", { cls: "talos-home-v3-note", text: last ? `最近记录：${last.label} · ${last.score}分 · 纵轴 0–${ceiling}` : "暂无记录" });
}

export function renderTodayActions(view: TalosView, host: HTMLElement): void {
	const actionRuntimePanel = view.panel(
		host,
		"#38E1FF",
		"统计检查",
		"本地只读 · 不修改资料"
	);
	actionRuntimePanel.setAttribute("data-workbench-section", "runtime-actions");
	const actionStamp = Date.now();
	view.actionPanel = new ConsoleActionPanel({
		parent: actionRuntimePanel,
		runtime: view.plugin.getConsoleActionRuntime(),
		actions: [
			{
				actionId: "refresh-stats",
				idempotencyKey: `overview-refresh-${actionStamp}`,
				input: undefined,
				request: {
					readPaths: ["**"],
					writePaths: [],
					effects: ["read"],
				},
				proposal: {
					title: "刷新统计",
					provider: "TALOS 本地运行时",
					steps: ["重新读取 Vault 统计", "刷新当前控制台"],
					fileCount: 0,
					keyDiffs: ["只读动作，不修改文件"],
					reversible: false,
				},
			},
			{
				actionId: "vault-lint",
				idempotencyKey: `overview-lint-${actionStamp}`,
				input: undefined,
				request: {
					readPaths: ["**"],
					writePaths: [],
					effects: ["read"],
				},
				proposal: {
					title: "只读 Vault Lint",
					provider: "TALOS 本地运行时",
					steps: ["扫描 Markdown 元数据", "报告结构化检查结果"],
					fileCount: 0,
					keyDiffs: ["只读动作，不生成报告文件"],
					reversible: false,
				},
			},
		],
	});
	view.actionPanel.mount();
}

export function renderTodayQuickNote(view: TalosView, host: HTMLElement): void {
	const quickNotePanel = view.panel(
		host,
		"#A78BFA",
		"快捷便签",
		"B 类可恢复写入 · ⌘/Ctrl + Enter 保存"
	);
	quickNotePanel.setAttribute("data-workbench-section", "quick-note");
	view.quickNote ??= new QuickNote({
		parent: quickNotePanel,
		runtime: view.plugin.getConsoleActionRuntime(),
		targetFolder: () => view.paths.dir("inbox"),
	});
	view.quickNote.mount(quickNotePanel);
}
