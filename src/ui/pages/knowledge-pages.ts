// TALOS 控制台知识、全库、身份与能力页渲染；由 TalosView 委托调用。
import { mountPanelTabs } from "../panel-tabs";
import type { Collected } from "../talos-view-model";
import { openFile } from "../../actions";
import type { TalosView } from "../../view";
import { fillDist, fillSignalList } from "../charts/talos-view-charts";
import { moduleHero } from "../view-modules";
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
