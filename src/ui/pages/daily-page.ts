// TALOS 控制台每日执行页渲染；由 TalosView 委托调用。
import { type Collected, WEEKDAYS } from "../talos-view-model";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import { setIcon } from "obsidian";
import type { TalosView } from "../../view";
import { moduleHero } from "../view-modules";

export function renderDailyPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const now = new Date();
	const minsNow = now.getHours() * 60 + now.getMinutes();
	const rota = view.dailyRota();
	const today = rota.find((item) => item.day === now.getDay()) || rota[0];
	const primary = d.focus[0];
	const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEKDAYS[now.getDay()]}`;
	const victory =
		primary?.doneWhen || "先跑 /morning，把今天的 done_when 写进 tasks.md";

	moduleHero(view, page, {
		ac: "#4D8DFF",
		icon: "calendar-check",
		eyebrow: `DAILY EXECUTION · ${dateLabel}`,
		title: "每日执行",
		desc: "把今天压成一个胜利条件、两个深度块和一次收工回填。",
		stats: [
			{
				label: "唯一胜利",
				value: primary ? "已锁定" : "待设置",
				sub: primary ? victory : "复制 /morning 后写入 done_when",
				path: primary?.path || view.plugin.talosSettings.tasksPath,
				tone: primary ? "good" : "warn",
			},
			{
				label: "周轮值",
				value: today?.project || "周轮值项目",
				sub: today?.label || "今日深度块 02",
				path: today?.path || view.paths.readme("projects"),
				tone: "default",
			},
			{
				label: "当前焦点",
				value: `${d.focus.length} 项`,
				sub: "tasks.md 活跃焦点",
				path: view.plugin.talosSettings.tasksPath,
				tone: d.focus.length > 0 ? "good" : "warn",
			},
		],
		actions: [
			{ label: "开工", icon: "play", command: "开工" },
			{ label: "晨间", icon: "sunrise", command: "/morning" },
			{
				label: "任务池",
				icon: "list-checks",
				path: view.plugin.talosSettings.tasksPath,
			},
		],
	});

	const primaryGrid = page.createDiv({
		cls: "workflow-v2-primary daily-v2-primary",
	});
	primaryGrid.setAttribute("data-workflow-layout", "split");

	const timelinePanel = view.panel(
		primaryGrid,
		"#38E1FF",
		"今日执行节奏",
		"ZERO DECISION TIMELINE"
	);
	timelinePanel.setAttribute("data-workflow-section", "core-data");
	const timeline = timelinePanel.createDiv({ cls: "daily-timeline" });
	for (const slot of view.dailyTimeline()) {
		const slotPath =
			slot.time === "08:30"
				? view.plugin.talosSettings.tasksPath
				: slot.time === "14:00"
					? today?.path || slot.path
					: slot.path;
		const slotDesc =
			slot.time === "14:00"
				? `${today?.label || "今日"}推进「${today?.project || "周轮值项目"}」的一个可见结果。`
				: slot.desc;
		const state =
			minsNow >= slot.mins + slot.dur
				? "done"
				: minsNow >= slot.mins
					? "now"
					: "todo";
		const item = timeline.createDiv({
			cls: `daily-slot daily-item${slot.deep ? " is-deep" : ""} is-${state}`,
		});
		const time = item.createDiv({ cls: "daily-slot-time" });
		time.createEl("b", { text: slot.time });
		time.createEl("small", { text: slot.length });
		const body = item.createDiv({ cls: "daily-slot-body" });
		body.createEl("h3", { text: slot.title });
		body.createEl("p", { text: slotDesc });
		body.createEl("span", { text: slot.starter });
		item.createSpan({
			cls: `daily-slot-badge is-${state}`,
			text:
				state === "done"
					? "已完成"
					: state === "now"
						? "进行中"
						: "待开始",
		});
		item.addEventListener("click", () => void openFile(view.app, slotPath));
	}

	const cockpit = view.panel(
		primaryGrid,
		"#FB7185",
		"当前战役",
		`IMPORTANT ACTIONS · ${dateLabel}`
	);
	cockpit.addClass("daily-cockpit");
	cockpit.setAttribute("data-workflow-section", "attention-and-actions");
	const overview = cockpit.createDiv({ cls: "daily-overview" });
	const win = overview.createDiv({
		cls: `daily-win${primary ? " daily-item" : ""}`,
	});
	win.createEl("small", { text: "今日唯一胜利条件" });
	win.createEl("strong", { text: victory });
	if (primary) {
		win.createEl("span", {
			text: `${primary.title}${primary.desc ? ` · ${primary.desc}` : ""}`,
		});
		win.addEventListener("click", () =>
			void openFile(
				view.app,
				primary.path || view.plugin.talosSettings.tasksPath
			)
		);
	} else {
		win.createEl("span", { text: "尚未锁定焦点，先运行晨间流程。" });
	}

	const route = overview.createDiv({ cls: "daily-route" });
	const routeItem = (label: string, value: string, path: string) => {
		const item = route.createDiv({ cls: "daily-route-item daily-item" });
		item.createEl("small", { text: label });
		item.createEl("b", { text: value });
		item.addEventListener("click", () => void openFile(view.app, path));
	};
	routeItem("深度块 01", "输出闭环", view.paths.outletFile);
	routeItem(
		"深度块 02",
		today?.project || "周轮值项目",
		today?.path || view.plugin.talosSettings.tasksPath
	);
	routeItem(
		"当前焦点",
		`${d.focus.length} 项`,
		view.plugin.talosSettings.tasksPath
	);

	const actions = cockpit.createDiv({ cls: "daily-actions" });
	for (const action of [
		{ label: "开工", command: "开工", desc: "接收今天第一步", icon: "play" },
		{
			label: "晨间",
			command: "/morning",
			desc: "简报与焦点确认",
			icon: "sunrise",
		},
		{
			label: "收工",
			command: "收工",
			desc: "回填并铺好明天",
			icon: "square",
		},
		{
			label: "记忆",
			command: "/memory",
			desc: "保存实质碎片",
			icon: "brain",
		},
	]) {
		const button = actions.createEl("button", {
			cls: "daily-command daily-item",
		});
		button.type = "button";
		const icon = button.createSpan({ cls: "daily-command-icon" });
		setIcon(icon, action.icon);
		const copy = button.createSpan({ cls: "daily-command-copy" });
		copy.createEl("b", { text: action.label });
		copy.createEl("small", { text: action.desc });
		button.addEventListener("click", () => void view.copyText(action.command));
	}

	const supportGrid = page.createDiv({
		cls: "workflow-v2-secondary daily-v2-secondary",
	});
	const rails = view.panel(
		supportGrid,
		"#F472B6",
		"执行铁轨",
		"RULES · ACTIVE FOCUS"
	);
	rails.setAttribute("data-workflow-section", "supporting-rules");
	const railList = rails.createDiv({ cls: "daily-rails" });
	for (const rail of [
		{
			title: "主轨 · 输出闭环",
			desc: "每天优先推动一条内容走到发布、排期或回填。",
		},
		{
			title: "副轨 · 周轮值项目",
			desc: "项目推进不靠心情，轮到谁就推进谁的一个结果。",
		},
		{
			title: "回轨 · 收工记忆",
			desc: "未完成不内耗，只记录阻塞原因与明早第一步。",
		},
		{
			title: "硬刹车",
			desc: "没发之前，不扩建发布系统；输入处理不清仓。",
		},
	]) {
		const item = railList.createDiv({ cls: "daily-rail" });
		item.createEl("b", { text: rail.title });
		item.createEl("span", { text: rail.desc });
	}

	const focusList = rails.createDiv({ cls: "daily-focus-list" });
	if (d.focus.length === 0) {
		renderTalosEmptyState(
			focusList,
			"暂无活跃焦点",
			"打开任务池写下今天唯一的 done_when。",
			{
				label: "打开任务池",
				icon: "list-checks",
				onActivate: () =>
					void openFile(view.app, view.plugin.talosSettings.tasksPath),
			}
		);
	} else {
		for (const focus of d.focus) {
			const item = focusList.createDiv({
				cls: `daily-focus daily-item level-${focus.level}`,
			});
			item.createEl("b", { text: focus.title });
			if (focus.doneWhen) {
				item.createEl("small", {
					text: `done_when · ${focus.doneWhen}`,
				});
			} else if (focus.desc) {
				item.createEl("small", { text: focus.desc });
			}
			item.addEventListener("click", () =>
				void openFile(
					view.app,
					focus.path || view.plugin.talosSettings.tasksPath
				)
			);
		}
	}

	const guide = view.panel(
		supportGrid,
		"#FBBF24",
		"执行协议与入口",
		"FOUR SWITCHES · LIVE FILES"
	);
	guide.addClass("daily-v2-guide");
	guide.setAttribute("data-workflow-section", "protocol-and-entry");
	const protocolGrid = guide.createDiv({ cls: "daily-protocol" });
	for (const item of [
		["唯一胜利条件", "一天只盯第一个 done_when，其他进展都是 bonus。"],
		["先发后修", "公开发布没破零前，新模板与新基建默认延后。"],
		["周几替你选", "第二深度块由周轮值表决定，不现场挑项目。"],
		["明早第一步", "收工时必须写下明早第一个动作。"],
	]) {
		const card = protocolGrid.createDiv({ cls: "daily-proto" });
		card.createEl("b", { text: item[0] });
		card.createEl("span", { text: item[1] });
	}

	const entryHead = guide.createDiv({ cls: "workflow-v2-subhead" });
	entryHead.createEl("strong", { text: "快速入口" });
	entryHead.createEl("span", { text: "点击进入原始文件" });
	const map = guide.createDiv({ cls: "daily-map" });
	for (const node of [
		{
			label: "每日操作系统",
			desc: "原始说明与规则",
			path: "每日操作系统.md",
			icon: "calendar-check",
		},
		{
			label: "tasks.md",
			desc: "焦点与 done_when",
			path: view.plugin.talosSettings.tasksPath,
			icon: "list-checks",
		},
		{
			label: "输出统一出口",
			desc: "发布前唯一队列",
			path: view.paths.outletFile,
			icon: "send",
		},
		{
			label: "运营候选池",
			desc: "发布后反馈池",
			path: view.paths.opsCandidatesFile,
			icon: "activity",
		},
		{
			label: "CONTEXT",
			desc: "近期状态与项目台账",
			path: view.paths.contextFile,
			icon: "scan-text",
		},
	]) {
		const card = map.createDiv({ cls: "daily-node daily-item" });
		const icon = card.createSpan({ cls: "daily-node-icon" });
		setIcon(icon, node.icon);
		const copy = card.createDiv();
		copy.createEl("b", { text: node.label });
		copy.createEl("span", { text: node.desc });
		card.addEventListener("click", () => void openFile(view.app, node.path));
	}

	const weekPanel = view.panel(
		page,
		"#A78BFA",
		"周轮值表 · 深度块②",
		"WEEK ROUTER"
	);
	weekPanel.addClass("daily-v2-week-panel");
	const week = weekPanel.createDiv({ cls: "daily-week" });
	for (const item of rota) {
		const day = week.createDiv({
			cls: `daily-day daily-item${item.day === now.getDay() ? " is-today" : ""}`,
		});
		day.createEl("small", { text: `${item.code} · ${item.label}` });
		day.createEl("b", { text: item.project });
		day.createEl("span", { text: item.desc });
		day.addEventListener("click", () => void openFile(view.app, item.path));
	}
}
