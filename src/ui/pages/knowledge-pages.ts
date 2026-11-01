// TALOS 控制台知识、全库、身份与能力页渲染；由 TalosView 委托调用。
import { mountPanelTabs } from "../panel-tabs";
import type { Collected } from "../talos-view-model";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import type { TalosView } from "../../view";
import { fillCapabilityDistribution, fillDist, fillSignalList } from "../charts/talos-view-charts";
import { commandActionHint, moduleHero } from "../view-modules";
import { mountFlowPipeline } from "../flow-pipeline";
import { CONTENT_KEYS } from "../../data/schema";

export function renderKnowledgePage(view: TalosView, page: HTMLElement, d: Collected): void {
	const mocFolder = view.app.vault.getAbstractFileByPath(view.paths.mocDir);
	const mocReady = !!mocFolder && "children" in mocFolder;
	const hero = moduleHero(view, page, {
		ac: "#A78BFA",
		icon: "brain",
		title: "知识资料",
		desc: "汇总内容分布、近期资料与目录结构；创建时间可能因迁移变化。",
		stats: [
			{ label: "MOC", value: mocReady ? d.knowledge.metrics.find((metric) => metric.label === "MOC 枢纽")?.value ?? "—" : "—", sub: mocReady ? "概念入口 · MOC 目录" : "MOC 目录未找到", path: view.paths.mocReadme, tone: "default" },
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
	mountFlowPipeline(view, hero, d, "knowledge");

	const primary = page.createDiv({
		cls: "knowledge-v2-primary knowledge-hub-v2-primary",
	});
	primary.setAttribute("data-knowledge-layout", "split");

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
		primary,
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
	renderVaultStatistics(view, page, d);
}

export function renderIdentityPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const pendingTotal = d.approvals.length + d.candidates.length;
	const decisionsReady = d.setup?.pendingApprovalsPath === "ok" && d.setup?.candidatesPath === "ok";
	moduleHero(view, page, {
		ac: "#6366F1",
		icon: "fingerprint",
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
				sub: "角色设定与记忆",
				path: view.paths.readme("soul"),
				tone: "default",
			},
			{
				label: "待确认",
				value: decisionsReady ? String(pendingTotal) : "—",
				sub: decisionsReady ? `${d.approvals.length} 审批 · ${d.candidates.length} 偏好 · 去今日处理` : "待决策来源缺失或格式待检查",
				onActivate: () => view.openDecisions(),
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
		"用户身份 / 助手人格"
	);
	foundation.addClass("identity-v2-foundation");
	for (const group of [
		{
			title: "用户身份",
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
			title: "助手人格",
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
	// 这里只提供来源入口，审批与偏好的处理集中在今日 · 待决策。
	const governance = view.panel(
		attentionColumn,
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
				meta: d.setup?.tasksPath === "ok" && d.focusTotal !== undefined ? `${d.focusTotal} 个当前焦点` : "任务池缺失或格式待检查",
				path: view.plugin.talosSettings.tasksPath,
			},
			{
				title: "审批池",
				meta: d.setup?.pendingApprovalsPath === "ok" ? `${d.approvals.length} 项待决策 · 今日处理` : "审批来源缺失或格式待检查",
				path: view.plugin.talosSettings.pendingApprovalsPath,
			},
			{
				title: "偏好候选",
				meta: d.setup?.candidatesPath === "ok" ? `${d.candidates.length} 条待确认 · 今日处理` : "候选来源缺失或格式待检查",
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
	renderKnowledgePage(view, page, d);
}

function renderVaultStatistics(view: TalosView, page: HTMLElement, d: Collected): void {
	const missingModules = d.modules.filter((module) => !module.readmeExists);
	const missingReadmes = missingModules.length;
	const completeContent = CONTENT_KEYS.every((key) => { const node = view.app.vault.getAbstractFileByPath(view.paths.dir(key)); return !!node && "children" in node; });
	const primary = page.createDiv({
		cls: "system-v2-primary vault-v2-primary",
	});
	primary.setAttribute("data-system-layout", "split");

	const distribution = view.panel(
		primary,
		"#34D399",
		"知识库分布",
		completeContent ? `六大内容目录 · ${d.total} 篇` : `部分目录缺失 · 已找到 ${d.total} 篇`
	);
	distribution.setAttribute("data-system-section", "core-data");
	fillDist(view, 
		distribution.createDiv({ cls: "barchart" }),
		d.dist
	);

	// 模块整合：健康趋势的主场是系统健康页；这里只把 README 异常并入知识库分布，作为库结构的完整性检查。
	const anomalyHead = distribution.createDiv({
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
		distribution.createDiv({ cls: "detail-list vault-v2-anomaly-list" }),
		missingModules.map((module) => ({
			title: module.name,
			meta: `${module.count} 篇 · 缺少模块 README`,
			path: module.readme,
		})),
		"所有顶层模块均有 README"
	);

	// 单页原则：模块地图与热力图合进一个页签组，放在第一行右栏，内容与渲染不变。
	mountPanelTabs({
		parent: primary,
		groupKey: "vault-structure",
		label: "库结构",
		selections: view.panelTabSelections,
		tabs: [
			{
				key: "modules",
				label: "系统模块地图",
				render: (host) => {
				const modules = view.panel(
					host,
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
				},
			},
			{
				key: "heatmap",
				label: "笔记创建热力图",
				render: (host) => {
				const heat = view.panel(
					host,
					"#A78BFA",
					"笔记创建热力图",
					`${d.heatmap.meta} · 文件创建时间，迁移可能改变`
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
				},
			},
		],
	});
}

export function renderCapabilityPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const groupCount = (key: string) => {
		const group = d.capGroups.find((item) => item.key === key);
		if (!group || group.sourceStatus === "unavailable" || !group.sourceStatus) return "—";
		const count = group.items.filter((item) => item.origin === "discovered").length;
		return group.sourceStatus === "partial" ? `≥${count}` : String(count);
	};
	const knownGroups = d.capGroups.map((group) => ({ ...group, items: group.items.filter((item) => item.origin === "discovered") }));
	const capabilityTotal = d.capGroups.reduce(
		(sum, group) => sum + group.items.filter((item) => item.origin === "discovered").length,
		0
	);
	const capabilityComplete = d.capGroups.every((group) => group.sourceStatus === "ready");
	if (!d.capGroups.some((group) => group.key === view.activeCap)) {
		view.activeCap = d.capGroups[0]?.key ?? "commands";
	}

	moduleHero(view, page, {
		ac: "#14B8A6",
		icon: "blocks",
		title: "能力中心",
		desc: "把命令、Agents 和工作流做成可复制入口，需要调用时不再从规则文件里翻。",
		stats: [
			{
				label: "已发现能力",
				value: capabilityComplete ? String(capabilityTotal) : `≥${capabilityTotal}`,
				sub: capabilityComplete ? "已发现的命令、Agent 与工作流" : "部分目录不可用 · 仅显示已发现项",
				path: ".claude/commands/morning.md",
				tone: "good",
			},
			{
				label: "命令",
				value: groupCount("commands"),
				sub: "实际发现的命令文件",
				path: ".claude/commands/morning.md",
				tone: "default",
			},
			{
				label: "Agents",
				value: groupCount("agents"),
				sub: "实际发现的 Agent 文件",
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
		capabilityComplete ? "已发现命令 / Agents / 工作流" : "部分来源不可用，图表仅含已发现项"
	);
	distribution.setAttribute("data-knowledge-section", "core-data");
	fillCapabilityDistribution(view, 
		distribution.createDiv({
			cls: "capability-v2-distribution",
		}),
		knownGroups
	);

	// 模块整合：分组控制是调用入口的筛选，并入调用入口顶部；调用入口上移到第一行右栏。
	const browser = view.panel(
		primary,
		"#A78BFA",
		"能力调用入口",
		"点击卡片填入 TALOS 对话 · 右键复制 · 源文件按钮只负责打开"
	);
	browser.addClass("capability-v2-browser");
	browser.setAttribute("data-knowledge-section", "capability-browser");
	const controls = browser.createDiv({ cls: "capability-v2-controls capability-v2-controls--inline" });
	controls.setAttribute(
		"data-knowledge-section",
		"attention-and-actions"
	);
	const summary = controls.createDiv({
		cls: "capability-v2-current-summary",
	});
	const tabs = controls.createDiv({ cls: "tabs capability-v2-tabs" });

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
			if (item.origin === "fallback") top.createEl("small", { text: "推荐入口 · 未发现对应文件" });
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
			card.title = commandActionHint(item.invoke);
			card.addEventListener("click", () =>
				void view.sendCommandToChat(item.invoke)
			);
			card.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				void view.copyText(item.invoke);
			});
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
				? `${active.items.filter((item) => item.origin === "discovered").length} 已发现 · ${active.items.filter((item) => item.origin === "fallback").length} 推荐${active.sourceStatus !== "ready" ? " · 来源不完整" : ""}`
				: "暂无可用分组",
		});
		for (const group of d.capGroups) {
			const tab = tabs.createEl("button", {
				cls: `tab${group.key === view.activeCap ? " active" : ""}`,
			});
			tab.type = "button";
			view.addActionButtonContent(
				tab,
				`${group.label} ${groupCount(group.key)}`,
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
