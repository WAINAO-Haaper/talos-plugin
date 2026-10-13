// TALOS「今日」页：现在做什么、需要处理什么、待决策与任务进度，一屏取齐。
// 2026-10-07 导航重构：合并原工作台与每日执行的首屏信息；健康趋势、知识分布等
// 只在各自主场页（系统 / 内容流）出现，这里只保留带跳转的提醒。
import { mountPanelTabs } from "../panel-tabs";
import type { Collected, OverviewAttention } from "../talos-view-model";
import { WEEKDAYS } from "../talos-view-model";
import { ConsoleActionPanel } from "../console-action-panel";
import { QuickNote } from "../quick-note";
import { openFile } from "../../actions";
import { setIcon } from "obsidian";
import type { TalosView } from "../../view";
import { moduleHero, overviewToneColor } from "../view-modules";
import { collectOverviewAttention, renderOverviewAttentionRows } from "./overview-page";

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

function renderSlot(view: TalosView, parent: HTMLElement, tag: string, slot: TodayTimelineSlot): void {
	const item = parent.createDiv({ cls: "today-v1-slot daily-item" });
	item.createSpan({ cls: "today-v1-slot__tag", text: tag });
	const body = item.createDiv({ cls: "today-v1-slot__body" });
	body.createEl("b", { text: `${slot.time} · ${slot.title}` });
	body.createEl("small", { text: slot.starter });
	item.setAttribute("role", "button");
	item.setAttribute("tabindex", "0");
	item.addEventListener("click", () => void openFile(view.app, slot.path));
}

export function renderTodayPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const now = new Date();
	const attention = collectOverviewAttention(view, d);
	const focusItem = d.focus[0];
	const primary: OverviewAttention = attention[0] || {
		title: focusItem?.title || "今日焦点尚未设置",
		meta: focusItem?.doneWhen
			? `done_when · ${focusItem.doneWhen}`
			: "从 tasks.md 读取",
		detail:
			focusItem?.desc ||
			"先运行 /morning，写下今天唯一胜利条件，再进入执行。",
		action: focusItem ? "打开今日焦点" : "打开任务池",
		path: focusItem?.path || view.plugin.talosSettings.tasksPath,
		icon: focusItem ? "target" : "calendar-plus",
		tone: focusItem ? "default" : "warn",
	};
	const pendingTotal = d.approvals.length + d.candidates.length;
	const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;

	moduleHero(view, page, {
		ac: "#F59E0B",
		icon: "sun",
		eyebrow: `${view.plugin.talosSettings.mainTitle} · ${dateLabel}`,
		title: "今日",
		desc: focusItem?.doneWhen
			? `唯一胜利：${focusItem.doneWhen}`
			: "先跑 /morning，写下今天唯一的胜利条件。",
		stats: [
			{
				label: "今日执行",
				value: d.overview.taskFlow.value,
				sub: d.overview.taskFlow.sub,
				path: view.plugin.talosSettings.tasksPath,
				tone: d.overview.taskFlow.tone,
			},
			{
				label: "待决策",
				value: String(pendingTotal),
				sub: "审批与偏好确认",
				path: view.plugin.talosSettings.pendingApprovalsPath,
				tone: pendingTotal > 0 ? "warn" : "good",
			},
			{
				label: "收件积压",
				value: String(d.inbox.count),
				sub: d.inbox.count > 0 ? `最老 ${d.inbox.oldestDays} 天` : "已清空",
				path: view.paths.readme("inbox"),
				tone: d.inbox.oldestDays >= 14 ? "hot" : d.inbox.count > 0 ? "warn" : "good",
			},
		],
		actions: [
			{ label: "开工", icon: "play", command: "开工" },
			{ label: "晨间", icon: "sunrise", command: "/morning" },
			{ label: "收工", icon: "moon", command: "收工" },
		],
	});

	const grid = page.createDiv({ cls: "today-v1-grid" });
	grid.setAttribute("data-today-section", "primary");

	const minsNow = now.getHours() * 60 + now.getMinutes();
	const { current, next } = pickTodaySlots(view.dailyTimeline(), minsNow);
	const nowPanel = view.panel(
		grid,
		"#4D8DFF",
		"现在做什么",
		current ? `${current.time} 起 · ${current.dur} 分钟` : "当前不在执行时段"
	);
	nowPanel.setAttribute("data-today-section", "now");
	if (current) renderSlot(view, nowPanel, "现在", current);
	if (next) renderSlot(view, nowPanel, "下一段", next);
	if (!current && !next) {
		nowPanel.createDiv({ cls: "empty", text: "今日节奏已结束 · 收工回填" });
	}
	const focusList = nowPanel.createDiv({ cls: "today-v1-focus-list" });
	focusList.createEl("small", { cls: "today-v1-label", text: "当前焦点" });
	if (d.focus.length === 0) {
		focusList.createDiv({ cls: "empty", text: "tasks.md 暂无活跃焦点" });
	}
	for (const focus of d.focus.slice(0, 3)) {
		const row = focusList.createDiv({ cls: `today-v1-focus focus tone-${focus.level}` });
		row.createEl("b", { text: focus.title });
		if (focus.doneWhen) row.createEl("small", { text: `done_when · ${focus.doneWhen}` });
		const target = focus.path || view.plugin.talosSettings.tasksPath;
		row.addEventListener("click", () => void openFile(view.app, target));
	}

	const attentionPanel = view.panel(
		grid,
		overviewToneColor(view, primary.tone),
		"需要你处理",
		attention.length > 0
			? `${attention.length} 项需要处理`
			: "当前没有阻塞性异常"
	);
	attentionPanel.addClass("overview-v2-attention-panel");
	attentionPanel.setAttribute("data-today-section", "attention");
	const priority = attentionPanel.createDiv({
		cls: `overview-v2-priority tone-${primary.tone}`,
	});
	const priorityHead = priority.createDiv({ cls: "overview-v2-priority__head" });
	const priorityIcon = priorityHead.createSpan({
		cls: "overview-v2-priority__icon",
	});
	setIcon(priorityIcon, primary.icon);
	const priorityCopy = priorityHead.createDiv({
		cls: "overview-v2-priority__copy",
	});
	priorityCopy.createEl("small", {
		text: attention.length > 0 ? "第一优先级" : "下一步",
	});
	priorityCopy.createEl("h3", { text: primary.title });
	priority.createEl("p", { text: primary.detail });
	priority.createEl("span", { text: primary.meta });
	const priorityAction = priority.createEl("button", {
		cls: "module-hero-action overview-v2-priority__action",
		attr: { type: "button" },
	});
	setIcon(
		priorityAction.createSpan({ cls: "module-hero-action-icon" }),
		"arrow-up-right"
	);
	priorityAction.createSpan({ text: primary.action });
	priorityAction.addEventListener("click", () => {
		if (primary.target === "decisions") view.openDecisions();
		else void openFile(view.app, primary.path);
	});
	renderOverviewAttentionRows(view, attentionPanel, attention.slice(1, 4));

	// 单页原则：第二行把决策、进度、状态与工具合进两个页签组，内容与渲染不变。
	mountPanelTabs({
		parent: grid,
		groupKey: "today-status",
		label: "决策与进度",
		selections: view.panelTabSelections,
		tabs: [
			{
				key: "decisions",
				label: "待决策",
				badge: pendingTotal,
				render: (host) => {
					const decisionPanel = view.panel(
						host,
						"var(--amber)",
						"待决策",
						pendingTotal > 0 ? `${pendingTotal} 项待决策` : "审批池已清空"
					);
					decisionPanel.setAttribute("data-today-section", "decisions");
					view.renderDecisionWorkspace(decisionPanel, d, 3);
				},
			},
			{
				key: "kanban",
				label: "任务进度",
				render: (host) => {
					const kanbanPanel = view.panel(
						host,
						"#F59E0B",
						"任务进度",
						"待办 · 进行中 · 最近完成"
					);
					kanbanPanel.addClass("overview-v2-kanban-panel");
					kanbanPanel.setAttribute("data-today-section", "task-kanban");
					view.fillOverviewKanban(kanbanPanel, d);
				},
			},
			{ key: "peer", label: "TALOS 状态", render: (host) => view.renderPeerStatusPanel(host) },
		],
	});

	mountPanelTabs({
		parent: grid,
		groupKey: "today-tools",
		label: "工具",
		selections: view.panelTabSelections,
		tabs: [
			{ key: "actions", label: "可执行动作", render: (host) => renderTodayActions(view, host) },
			{ key: "note", label: "快捷便签", render: (host) => renderTodayQuickNote(view, host) },
		],
	});
}

function renderTodayActions(view: TalosView, host: HTMLElement): void {
	const actionRuntimePanel = view.panel(
		host,
		"#38E1FF",
		"可执行动作",
		"A 直接执行 · C 提案后审批"
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
			{
				actionId: "deep-research",
				idempotencyKey: `overview-research-${actionStamp}`,
				input: undefined,
				request: {
					readPaths: ["**"],
					writePaths: ["<external>"],
					effects: ["external-publish"],
				},
				proposal: {
					title: "启动 Deep Research",
					provider: "当前 Agent 命令",
					steps: [
						"展示本次外部执行范围",
						"等待独立批准",
						"进入 10 秒可取消安全窗口",
						"批准后调用同一 TALOS runner",
					],
					fileCount: 1,
					keyDiffs: [
						`研究结果将写入 ${view.plugin.talosSettings.reportsFolder}`,
					],
					reversible: false,
				},
			},
		],
	});
	view.actionPanel.mount();
}

function renderTodayQuickNote(view: TalosView, host: HTMLElement): void {
	const quickNotePanel = view.panel(
		host,
		"#A78BFA",
		"快捷便签",
		"B 类可恢复写入 · ⌘/Ctrl + Enter 保存"
	);
	quickNotePanel.setAttribute("data-workbench-section", "quick-note");
	new QuickNote({
		parent: quickNotePanel,
		runtime: view.plugin.getConsoleActionRuntime(),
		targetFolder: view.paths.dir("inbox"),
	}).mount();
}
