// TALOS 控制台知识、全库、身份与能力页渲染；由 TalosView 委托调用。
import type { Collected } from "../talos-view-model";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import type { TalosView } from "../../view";
import { fillCapabilityDistribution, fillDist, fillKnowledgeTreemap, fillSignalList, fillTrend } from "../charts/talos-view-charts";
import { moduleHero } from "../view-modules";

export function renderKnowledgePage(view: TalosView, page: HTMLElement, d: Collected): void {
	const mocs =
		d.knowledge.metrics.find((item) => item.label === "MOC 枢纽") ||
		d.knowledge.metrics[0];
	const insightMetric =
		d.knowledge.metrics.find((item) => item.label === "原创洞察") ||
		d.knowledge.metrics[1];
	const materialMetric =
		d.knowledge.metrics.find((item) => item.label === "外部素材") ||
		d.knowledge.metrics[2];

	moduleHero(view, page, {
		ac: "#A78BFA",
		icon: "brain",
		eyebrow: "KNOWLEDGE HUB",
		title: "知识枢纽",
		desc: "原创洞察、外部素材和 MOC 入口分层展示，快速判断该检索、该整理，还是该产出。",
		stats: [
			{
				label: mocs?.label || "MOC 枢纽",
				value: mocs?.value || "0",
				sub: mocs?.sub,
				path: mocs?.path,
				tone: mocs?.tone || "default",
			},
			{
				label: insightMetric?.label || "原创洞察",
				value: insightMetric?.value || "0",
				sub: insightMetric?.sub,
				path: insightMetric?.path,
				tone: insightMetric?.tone || "default",
			},
			{
				label: materialMetric?.label || "外部素材",
				value: materialMetric?.value || "0",
				sub: materialMetric?.sub,
				path: materialMetric?.path,
				tone: materialMetric?.tone || "default",
			},
		],
		actions: [
			{
				label: "MOC",
				icon: "external-link",
				path: view.paths.mocReadme,
			},
			{
				label: "洞察库",
				icon: "lightbulb",
				path: view.paths.readme("insights"),
			},
			{
				label: "素材库",
				icon: "archive",
				path: view.paths.readme("assets"),
			},
		],
	});

	const primary = page.createDiv({
		cls: "knowledge-v2-primary knowledge-hub-v2-primary",
	});
	primary.setAttribute("data-knowledge-layout", "split");

	const structure = view.panel(
		primary,
		"#A78BFA",
		"知识资产结构",
		"按真实总量生成树状占比"
	);
	structure.setAttribute("data-knowledge-section", "core-data");
	fillKnowledgeTreemap(view, 
		structure.createDiv({ cls: "knowledge-v2-treemap" }),
		d.knowledge.metrics
	);

	const recent = view.panel(
		primary,
		"#F472B6",
		"最近新增",
		"原创洞察 · 外部素材"
	);
	recent.addClass("knowledge-v2-recent-panel");
	recent.setAttribute(
		"data-knowledge-section",
		"attention-and-entry"
	);
	for (const group of [
		{
			title: "原创洞察",
			meta: view.paths.dir("insights"),
			items: d.knowledge.recentInsights,
			empty: "暂无洞察",
		},
		{
			title: "外部素材",
			meta: view.paths.dir("assets"),
			items: d.knowledge.recentMaterials,
			empty: "暂无素材",
		},
	]) {
		const section = recent.createDiv({
			cls: "knowledge-v2-recent-group",
		});
		const head = section.createDiv({
			cls: "knowledge-v2-recent-group__head",
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

	const moc = view.panel(
		page,
		"#38E1FF",
		"MOC 概念入口",
		view.paths.mocDir
	);
	moc.addClass("knowledge-v2-moc-panel");
	moc.setAttribute("data-knowledge-section", "moc-entry");
	fillSignalList(view, 
		moc.createDiv({ cls: "detail-list" }),
		d.knowledge.mocs,
		"暂无 MOC"
	);
}

export function renderIdentityPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const pendingTotal = d.approvals.length + d.candidates.length;
	moduleHero(view, page, {
		ac: "#6366F1",
		icon: "fingerprint",
		eyebrow: "IDENTITY CONTEXT",
		title: "身份上下文",
		desc: "用户身份、AI 灵魂和工作记忆并排巡检，确保行动没有脱离长期自我和当前状态。",
		stats: [
			{
				label: "用户身份",
				value: String(view.moduleCount(d, "identity")),
				sub: "使命、状态、偏好、决策",
				path: view.paths.readme("identity"),
				tone: "default",
			},
			{
				label: "AI 灵魂",
				value: String(view.moduleCount(d, "soul")),
				sub: "人格契约与立场账本",
				path: view.paths.readme("soul"),
				tone: "default",
			},
			{
				label: "待确认",
				value: String(pendingTotal),
				sub: `${d.approvals.length} 审批 · ${d.candidates.length} 偏好`,
				path: view.plugin.talosSettings.pendingApprovalsPath,
				tone: pendingTotal > 0 ? "warn" : "good",
			},
		],
		actions: [
			{
				label: "CONTEXT",
				icon: "scan-text",
				path: view.paths.contextFile,
			},
			{
				label: "PERSONA",
				icon: "sparkles",
				path: view.paths.personaFile,
			},
			{ label: "记忆流", icon: "copy", command: "/memory" },
		],
	});

	const primary = page.createDiv({
		cls: "knowledge-v2-primary identity-v2-primary",
	});
	primary.setAttribute("data-knowledge-layout", "split");

	const contextColumn = primary.createDiv({
		cls: "knowledge-v2-column identity-v2-context-column",
	});
	contextColumn.setAttribute(
		"data-knowledge-section",
		"core-context"
	);
	const foundation = view.panel(
		contextColumn,
		"#4D8DFF",
		"身份底座",
		"Haaper · Identity / 屈原 · 灵魂"
	);
	foundation.addClass("identity-v2-foundation");
	for (const group of [
		{
			title: "Haaper · Identity",
			meta: "身份事实与当前状态",
			items: [
				{
					title: "TELOS",
					meta: "使命、目标、信念与长期方向",
					path: view.paths.telosFile,
				},
				{
					title: "CONTEXT",
					meta: "近期焦点、项目与系统状态",
					path: view.paths.contextFile,
				},
				{
					title: "PROFILE",
					meta: "经确认的场景化偏好",
					path: view.paths.profileFile,
				},
				{
					title: "战略决策",
					meta: "方向、方法与品牌级判断",
					path: view.paths.decisionsFile,
				},
			],
			empty: "Identity 文件未找到",
		},
		{
			title: "屈原 · 灵魂",
			meta: "人格契约与独立判断",
			items: [
				{
					title: "PERSONA",
					meta: "名字、价值内核、反驳权与边界",
					path: view.paths.personaFile,
				},
				{
					title: "persona-memory",
					meta: "演化立场、判断与自我修正",
					path: view.paths.personaMemoryFile,
				},
			],
			empty: "灵魂文件未找到",
		},
	]) {
		const section = foundation.createDiv({
			cls: "identity-v2-context-group",
		});
		const head = section.createDiv({
			cls: "identity-v2-context-group__head",
		});
		head.createEl("strong", { text: group.title });
		head.createEl("span", { text: group.meta });
		fillSignalList(view, 
			section.createDiv({ cls: "detail-list" }),
			group.items,
			group.empty
		);
	}

	const attentionColumn = primary.createDiv({
		cls: "knowledge-v2-column identity-v2-attention-column",
	});
	attentionColumn.setAttribute(
		"data-knowledge-section",
		"attention-and-actions"
	);
	const focus = view.panel(
		attentionColumn,
		"#FB7185",
		"当前工作状态",
		"tasks.md · 最多三个焦点"
	);
	fillSignalList(view, 
		focus.createDiv({ cls: "detail-list" }),
		d.focus.slice(0, 3).map((item) => ({
			title: item.title,
			meta: item.doneWhen
				? `done_when · ${item.doneWhen}`
				: item.desc,
			path: item.path || view.plugin.talosSettings.tasksPath,
		})),
		"今日尚未设置焦点"
	);

	const decisions = view.panel(
		attentionColumn,
		"#FBBF24",
		"审批与偏好",
		pendingTotal > 0
			? `${pendingTotal} 项可直接处理`
			: "审批池已清空"
	);
	view.renderDecisionWorkspace(decisions, d, 2);

	const governance = view.panel(
		page,
		"#34D399",
		"记忆与治理入口",
		"任务 · 审批 · 偏好 · 健康"
	);
	governance.addClass("identity-v2-governance-panel");
	governance.setAttribute(
		"data-knowledge-section",
		"governance-entry"
	);
	fillSignalList(view, 
		governance.createDiv({ cls: "detail-list" }),
		[
			{
				title: "任务池",
				meta: `${d.focus.length} 个当前焦点`,
				path: view.plugin.talosSettings.tasksPath,
			},
			{
				title: "审批池",
				meta: `${d.approvals.length} 项待决策`,
				path: view.plugin.talosSettings.pendingApprovalsPath,
			},
			{
				title: "偏好候选",
				meta: `${d.candidates.length} 条待确认`,
				path: view.plugin.talosSettings.candidatesPath,
			},
			{
				title: "健康日志",
				meta: `系统分 ${d.overview.health.value}`,
				path: view.plugin.talosSettings.healthLogPath,
			},
		],
		"工作记忆入口未找到"
	);
}

export function renderVaultPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const activeDays =
		d.heatmap.meta.split(" · ")[0] || d.heatmap.meta;
	const missingModules = d.modules.filter(
		(module) => !module.readmeExists
	);
	const missingReadmes = missingModules.length;

	moduleHero(view, page, {
		ac: "#38E1FF",
		icon: "database",
		eyebrow: "VAULT MAP",
		title: "全库视图",
		desc: "从内容分布、顶层模块到创建热力图，给整个外脑系统做一次横向巡航。",
		stats: [
			{
				label: "知识笔记",
				value: String(d.total),
				sub: "六大内容目录",
				path: view.paths.readme("projects"),
				tone: "default",
			},
			{
				label: "顶层模块",
				value: String(d.modules.length),
				sub: `${missingReadmes} 个 README 异常`,
				path: view.paths.readme("system"),
				tone: missingReadmes > 0 ? "warn" : "good",
			},
			{
				label: "活跃天数",
				value: activeDays,
				sub: d.heatmap.meta.split(" · ")[1] || "近 12 个月",
				path: view.paths.readme("logs"),
				tone: "good",
			},
		],
		actions: [
			{
				label: "系统地图",
				icon: "map",
				path: view.paths.readme("system"),
			},
			{
				label: "项目地图",
				icon: "folder-kanban",
				path: view.paths.readme("projects"),
			},
			{ label: "周重置", icon: "copy", command: "/weekly-reset" },
		],
	});

	const primary = page.createDiv({
		cls: "system-v2-primary vault-v2-primary",
	});
	primary.setAttribute("data-system-layout", "split");

	const distribution = view.panel(
		primary,
		"#34D399",
		"知识库分布",
		`共 ${d.total} 篇`
	);
	distribution.setAttribute("data-system-section", "core-data");
	fillDist(view, 
		distribution.createDiv({ cls: "barchart" }),
		d.dist
	);

	const health = view.panel(
		primary,
		"#F472B6",
		"库健康与异常",
		missingReadmes > 0
			? `${missingReadmes} 个模块缺少 README`
			: "README 完整"
	);
	health.addClass("vault-v2-health-panel");
	health.setAttribute(
		"data-system-section",
		"attention-and-actions"
	);
	fillTrend(view, health, d.healthTrend);
	const anomalyHead = health.createDiv({
		cls: "workflow-v2-subhead vault-v2-anomaly-head",
	});
	anomalyHead.createEl("strong", { text: "README 异常" });
	anomalyHead.createEl("span", {
		text:
			missingReadmes > 0
				? `${missingReadmes} 项待修复`
				: "当前清空",
	});
	fillSignalList(view, 
		health.createDiv({ cls: "detail-list vault-v2-anomaly-list" }),
		missingModules.map((module) => ({
			title: module.name,
			meta: `${module.count} 篇 · 缺少模块 README`,
			path: module.readme,
		})),
		"所有顶层模块均有 README"
	);

	const heat = view.panel(
		page,
		"#A78BFA",
		"笔记创建热力图",
		d.heatmap.meta
	);
	heat.addClass("vault-v2-heat-panel");
	heat.setAttribute("data-system-section", "activity-heatmap");
	const heatWrap = heat.createDiv({ cls: "heatmap" });
	heatWrap.setAttribute("role", "img");
	heatWrap.setAttribute(
		"aria-label",
		`笔记创建热力图：${d.heatmap.meta}`
	);
	for (const month of d.heatmap.months) {
		const monthElement = heatWrap.createDiv({
			cls: "heat-month",
		});
		monthElement.createEl("span", {
			cls: "heat-mlabel",
			text: month.label,
		});
		const weeks = monthElement.createDiv({ cls: "heat-weeks" });
		for (const week of month.weeks) {
			const weekElement = weeks.createDiv({
				cls: "heat-week",
			});
			for (const cell of week) {
				const cellElement = weekElement.createDiv({
					cls: "heat-cell",
				});
				if (cell.date === "") {
					cellElement.addClass("is-empty");
				} else {
					cellElement.setAttribute(
						"data-level",
						String(cell.level)
					);
					cellElement.setAttribute(
						"title",
						`${cell.date} · ${cell.count}`
					);
				}
			}
		}
	}

	const modules = view.panel(
		page,
		"#4D8DFF",
		"系统模块地图",
		"顶层模块 · README / 最新文件"
	);
	modules.addClass("vault-v2-module-panel");
	modules.setAttribute("data-system-section", "module-map");
	const grid = modules.createDiv({ cls: "note-grid" });
	for (const module of d.modules) {
		const note = grid.createDiv({
			cls: module.readmeExists
				? "note module-card"
				: "note module-card missing-readme",
		});
		note.createEl("b", { text: module.name });
		note.createEl("span", {
			cls: "big",
			text: String(module.count),
		});
		note.createEl("span", {
			text: `更新 ${module.lastChange} · ${module.readmeExists ? "README OK" : "缺 README"}`,
		});
		const latest = note.createEl("small", {
			cls: "module-latest",
			text: `最新：${module.latestTitle}`,
		});
		if (module.latestPath) {
			latest.addEventListener("click", (event) => {
				event.stopPropagation();
				void openFile(view.app, module.latestPath || "");
			});
		}
		note.addEventListener("click", () =>
			void openFile(view.app, module.readme)
		);
	}
}

export function renderCapabilityPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const groupCount = (key: string) =>
		d.capGroups.find((group) => group.key === key)?.items.length ?? 0;
	const capabilityTotal = d.capGroups.reduce(
		(sum, group) => sum + group.items.length,
		0
	);
	if (!d.capGroups.some((group) => group.key === view.activeCap)) {
		view.activeCap = d.capGroups[0]?.key ?? "commands";
	}

	moduleHero(view, page, {
		ac: "#14B8A6",
		icon: "blocks",
		eyebrow: "CAPABILITY CENTER",
		title: "能力中心",
		desc: "把命令、Agents 和工作流做成可复制入口，需要调用时不再从规则文件里翻。",
		stats: [
			{
				label: "能力总数",
				value: String(capabilityTotal),
				sub: "可复制调用入口",
				path: ".claude/commands/morning.md",
				tone: "good",
			},
			{
				label: "命令",
				value: String(groupCount("commands")),
				sub: "对话中直接调用",
				path: ".claude/commands/morning.md",
				tone: "default",
			},
			{
				label: "Agents",
				value: String(groupCount("agents")),
				sub: "子代理与技能",
				tone: "default",
			},
		],
		actions: [
			{ label: "晨间", icon: "copy", command: "/morning" },
			{ label: "归档", icon: "copy", command: "/intake" },
			{ label: "维护", icon: "copy", command: "/maintain" },
		],
	});

	const primary = page.createDiv({
		cls: "knowledge-v2-primary capability-v2-primary",
	});
	primary.setAttribute("data-knowledge-layout", "split");

	const distribution = view.panel(
		primary,
		"#38E1FF",
		"能力分布",
		"库内真实命令 / Agents / 工作流"
	);
	distribution.setAttribute("data-knowledge-section", "core-data");
	fillCapabilityDistribution(view, 
		distribution.createDiv({
			cls: "capability-v2-distribution",
		}),
		d.capGroups
	);

	const controls = view.panel(
		primary,
		"#14B8A6",
		"分组控制",
		"选择后更新下方调用入口"
	);
	controls.addClass("capability-v2-controls");
	controls.setAttribute(
		"data-knowledge-section",
		"attention-and-actions"
	);
	const summary = controls.createDiv({
		cls: "capability-v2-current-summary",
	});
	const tabs = controls.createDiv({ cls: "tabs capability-v2-tabs" });

	const browser = view.panel(
		page,
		"#A78BFA",
		"能力调用入口",
		"点击卡片复制调用 · 源文件按钮只负责打开"
	);
	browser.addClass("capability-v2-browser");
	browser.setAttribute("data-knowledge-section", "capability-browser");
	const grid = browser.createDiv({ cls: "commands" });

	const drawGrid = () => {
		grid.empty();
		const group = d.capGroups.find(
			(item) => item.key === view.activeCap
		);
		if (!group || group.items.length === 0) {
			renderTalosEmptyState(
				grid,
				"无可用项",
				"当前分组没有可复制的调用入口。"
			);
			return;
		}
		for (const item of group.items) {
			const card = grid.createDiv({ cls: "command" });
			const top = card.createDiv({ cls: "cap-top" });
			top.createEl("code", { text: item.name });
			const actions = top.createDiv({ cls: "cap-actions" });
			actions.createSpan({ text: "复制调用" });
			if (item.path) {
				const source = actions.createSpan();
				view.addActionButtonContent(
					source,
					"打开源文件",
					"mini"
				);
				source.addEventListener("click", (event) => {
					event.stopPropagation();
					void openFile(view.app, item.path || "");
				});
			}
			card.createEl("small", { text: item.desc || "—" });
			if (item.path) {
				const sourceLine = card.createDiv({ cls: "cap-src" });
				sourceLine.createSpan({ text: item.path });
				sourceLine.createEl("em", { text: group.label });
			}
			card.addEventListener("click", () =>
				void view.copyText(item.invoke)
			);
		}
		view.wireModuleSelection(
			grid,
			`capability:${view.activeCap}`
		);
	};

	const drawTabs = () => {
		tabs.empty();
		summary.empty();
		const active = d.capGroups.find(
			(group) => group.key === view.activeCap
		);
		summary.createEl("small", { text: "当前分组" });
		summary.createEl("strong", {
			text: active?.label || "未选择",
		});
		summary.createEl("span", {
			text: active
				? `${active.items.length} 个调用入口`
				: "暂无可用分组",
		});
		for (const group of d.capGroups) {
			const tab = tabs.createEl("button", {
				cls: `tab${group.key === view.activeCap ? " active" : ""}`,
			});
			tab.type = "button";
			view.addActionButtonContent(
				tab,
				`${group.label} ${group.items.length}`,
				"compact"
			);
			tab.setAttribute(
				"aria-pressed",
				String(group.key === view.activeCap)
			);
			tab.addEventListener("click", () => {
				view.activeCap = group.key;
				drawTabs();
				drawGrid();
			});
		}
	};

	drawTabs();
	drawGrid();
}
