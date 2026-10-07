// TALOS 控制台总览页渲染；由 TalosView 委托调用。
import type { Collected, OverviewAttention } from "../talos-view-model";
import { ConsoleActionPanel } from "../console-action-panel";
import { QuickNote } from "../quick-note";
import { openFile } from "../../actions";
import { renderTalosKpiStrip } from "../page-primitives";
import { setIcon } from "obsidian";
import type { TalosView } from "../../view";
import { fillDist, fillTrend } from "../charts/talos-view-charts";
import { overviewToneColor } from "../view-modules";

export function renderOverviewPage(view: TalosView, page: HTMLElement, d: Collected): void {
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
	const latestHealth = d.healthTrend[d.healthTrend.length - 1];
	const previousHealth = d.healthTrend[d.healthTrend.length - 2];
	const healthDelta = latestHealth && previousHealth
		? latestHealth.score - previousHealth.score
		: 0;
	const pendingTotal = d.approvals.length + d.candidates.length;

	const primaryGrid = page.createDiv({
		cls: "overview-v2-primary",
	});
	primaryGrid.setAttribute("data-workbench-section", "primary-split");

	const dataColumn = primaryGrid.createDiv({
		cls: "overview-v2-column overview-v2-data-column",
	});
	dataColumn.setAttribute("data-workbench-section", "core-data");
	renderTalosKpiStrip(dataColumn, [
		{
			label: "知识笔记",
			value: d.overview.totalNotes.value,
			detail: d.overview.totalNotes.sub,
			tone: d.overview.totalNotes.tone,
			onActivate: () => void openFile(view.app, view.paths.readme("insights")),
		},
		{
			label: "今日执行",
			value: d.overview.taskFlow.value,
			detail: d.overview.taskFlow.sub,
			tone: d.overview.taskFlow.tone,
			onActivate: () =>
				void openFile(view.app, view.plugin.talosSettings.tasksPath),
		},
		{
			label: "系统健康",
			value: d.overview.health.value,
			detail:
				healthDelta === 0
					? d.overview.health.sub
					: `${healthDelta > 0 ? "较上次 +" : "较上次 "}${healthDelta}`,
			tone: d.overview.health.tone,
			onActivate: () =>
				void openFile(view.app, view.plugin.talosSettings.healthLogPath),
		},
		{
			label: "发布闭环",
			value: `${d.warRoom.published}/${d.warRoom.totalPub}`,
			detail: `冻结 ${d.warRoom.frozenDays} 天`,
			tone: d.warRoom.stopTriggered ? "hot" : "good",
			onActivate: () =>
				void openFile(view.app, view.plugin.talosSettings.talosTasksPath),
		},
	]);

	view.renderPeerStatusPanel(dataColumn);

	const trendPanel = view.panel(
		dataColumn,
		"#F472B6",
		"健康分趋势",
		"health-log · 近 9 次真实记录"
	);
	trendPanel.addClass("overview-v2-chart-panel");
	fillTrend(view, trendPanel, d.healthTrend);

	const distributionPanel = view.panel(
		dataColumn,
		"#34D399",
		"知识分布",
		`六大内容目录 · 共 ${d.total} 篇`
	);
	distributionPanel.addClass("overview-v2-chart-panel");
	fillDist(view, 
		distributionPanel.createDiv({ cls: "barchart overview-v2-distribution" }),
		d.dist
	);

	const attentionColumn = primaryGrid.createDiv({
		cls: "overview-v2-column overview-v2-attention-column",
	});
	attentionColumn.setAttribute(
		"data-workbench-section",
		"attention-and-approvals"
	);

	const attentionPanel = view.panel(
		attentionColumn,
		overviewToneColor(view, primary.tone),
		"重要事项",
		attention.length > 0
			? `${attention.length} 项需要处理`
			: "当前没有阻塞性异常"
	);
	attentionPanel.addClass("overview-v2-attention-panel");
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
	priorityAction.addEventListener("click", () =>
		void openFile(view.app, primary.path)
	);
	renderOverviewAttentionRows(view, attentionPanel, attention.slice(1, 4));

	const approvalPanel = view.panel(
		attentionColumn,
		"var(--amber)",
		"审批工作区",
		pendingTotal > 0 ? `${pendingTotal} 项待决策` : "审批池已清空"
	);
	view.renderDecisionWorkspace(approvalPanel, d, 2);

	const kanbanPanel = view.panel(
		page,
		"#F59E0B",
		"任务进度看板",
		"待办 · 进行中 · 最近完成"
	);
	kanbanPanel.addClass("overview-v2-kanban-panel");
	kanbanPanel.setAttribute("data-workbench-section", "task-kanban");
	view.fillOverviewKanban(kanbanPanel, d);

	const utilityGrid = page.createDiv({ cls: "overview-v2-utility-grid" });
	const actionRuntimePanel = view.panel(
		utilityGrid,
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

	const quickNotePanel = view.panel(
		utilityGrid,
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

export function collectOverviewAttention(view: TalosView, d: Collected): OverviewAttention[] {
	const items: OverviewAttention[] = [];
	if (d.warRoom.stopTriggered) {
		items.push({
			title: "发布停止条件已触发",
			meta: `${d.warRoom.frozenDays} 天未形成发布闭环 · 高优先级`,
			detail:
				"当前发布节奏已经触发重估条件。继续建设前，先决定恢复发布、调整目标或正式暂停。",
			action: "打开发布任务",
			path: view.plugin.talosSettings.talosTasksPath,
			icon: "octagon-alert",
			tone: "hot",
		});
	}
	if (d.approvals.length > 0) {
		items.push({
			title: `待审批变更 ${d.approvals.length} 项`,
			meta: `${d.approvals[0]?.title || "B/C 类变更"} · 需要决策`,
			detail:
				"这些变更不会自动执行。先处理会阻塞当前工作流或影响身份、规则与系统结构的提案。",
			action: "进入审批池",
			path: view.plugin.talosSettings.pendingApprovalsPath,
			icon: "clipboard-check",
			tone: "warn",
		});
	}
	if (d.inbox.count > 0) {
		items.push({
			title: `收件箱积压 ${d.inbox.count} 篇`,
			meta: `最老 ${d.inbox.oldestDays} 天 · 建议运行 /intake`,
			detail:
				"优先处理长期滞留条目，避免收件箱变成第二个无人维护的知识库。",
			action: "打开收件箱",
			path: view.paths.readme("inbox"),
			icon: "inbox",
			tone: d.inbox.oldestDays >= 7 ? "hot" : "warn",
		});
	}
	if (d.candidates.length > 0) {
		items.push({
			title: `偏好候选 ${d.candidates.length} 条`,
			meta: "待确认 · 运行 /digest 晋升或退回",
			detail:
				"候选偏好尚未成为稳定规则。集中确认，避免未经验证的信号长期悬空。",
			action: "打开候选池",
			path: view.plugin.talosSettings.candidatesPath,
			icon: "list-checks",
			tone: "default",
		});
	}
	return items;
}

export function renderOverviewAttentionRows(view: TalosView, parent: HTMLElement, items: OverviewAttention[]): void {
	const list = parent.createDiv({ cls: "overview-v2-attention-list" });
	if (items.length === 0) {
		list.createDiv({
			cls: "ok",
			text: "其余巡检项正常，暂无需要展开的异常。",
		});
		return;
	}
	for (const item of items) {
		const row = list.createDiv({
			cls: `overview-v2-attention-row tone-${item.tone}`,
		});
		row.setAttribute("role", "button");
		row.setAttribute("tabindex", "0");
		row.setAttribute("aria-label", `${item.title}：${item.action}`);
		const icon = row.createSpan({ cls: "overview-v2-attention-row__icon" });
		setIcon(icon, item.icon);
		const copy = row.createDiv({ cls: "overview-v2-attention-row__copy" });
		copy.createEl("strong", { text: item.title });
		copy.createEl("span", { text: item.meta });
		const arrow = row.createSpan({ cls: "overview-v2-attention-row__arrow" });
		setIcon(arrow, "chevron-right");
		const activate = () => void openFile(view.app, item.path);
		row.addEventListener("click", activate);
		row.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			activate();
		});
	}
}
