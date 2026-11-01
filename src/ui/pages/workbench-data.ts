// 资料工作区：同屏查看收件、知识和输出；完整操作沿用原有页面。
import { openFile } from "../../actions";
import type { SignalItem } from "../../types";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { moduleHero } from "../view-modules";
import { renderInboxPage } from "./workspace-pages";
import { renderKnowledgePage } from "./knowledge-pages";
import { renderOutputPage } from "./project-pages";

type DataPageKey = "inbox" | "knowledge" | "output";

function sourceFolder(view: TalosView, path: string): boolean {
	const folder = view.app.vault.getAbstractFileByPath(path);
	return !!folder && "children" in folder;
}

function fileButton(view: TalosView, host: HTMLElement, label: string, path: string): void {
	const button = host.createEl("button", { cls: "module-hero-action", text: label, attr: { type: "button" } });
	button.addEventListener("click", () => void openFile(view.app, path));
}

function commandButton(view: TalosView, host: HTMLElement, label: string, command: string): void {
	const button = host.createEl("button", { cls: "module-hero-action", text: label, attr: { type: "button" } });
	button.title = `填入 TALOS 对话「${command}」，按回车发送 · 右键复制`;
	button.addEventListener("click", () => void view.sendCommandToChat(command));
	button.addEventListener("contextmenu", (event) => { event.preventDefault(); void view.copyText(command); });
}

function previewList(view: TalosView, host: HTMLElement, title: string, items: SignalItem[], empty: string): void {
	const section = host.createDiv({ cls: "knowledge-v2-recent-group" });
	section.createEl("strong", { text: title });
	if (!items.length) { section.createDiv({ cls: "empty", text: empty }); return; }
	for (const item of items.slice(0, 3)) {
		const button = section.createEl("button", { cls: "module-hero-action", text: item.title, attr: { type: "button" } });
		if (item.path) button.addEventListener("click", () => void openFile(view.app, item.path || ""));
		else button.disabled = true;
	}
}

/**
 * 原有详细页面仅在对应模块展开时挂载；隐藏其重复头部，详细内容与操作仍沿原实现。
 * 旧页面键会展开并定位到相应模块，不修改用户资料。
 */
export function renderWorkbenchData(view: TalosView, page: HTMLElement, d: Collected, focusKey: string): void {
	const focus: DataPageKey = focusKey === "knowledge" || focusKey === "output" ? focusKey : "inbox";
	const inboxReady = sourceFolder(view, view.plugin.talosSettings.inboxFolder);
	const insightsReady = sourceFolder(view, view.paths.dir("insights"));
	const materialsReady = sourceFolder(view, view.paths.dir("assets"));
	const mocReady = sourceFolder(view, view.paths.mocDir);
	const detailsByKey: Partial<Record<DataPageKey, HTMLDetailsElement>> = {};
	const openDetail = (key: DataPageKey) => {
		const detail = detailsByKey[key];
		if (!detail) return;
		detail.open = true;
		detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
	};
	moduleHero(view, page, {
		ac: "#FBBF24", icon: "library", title: "资料工作台", desc: "收件、知识与输出集中查看和处理。",
		stats: [
			{ label: "收件积压", value: inboxReady ? String(d.inbox.count) : "—", sub: inboxReady ? `最老 ${d.inbox.oldestDays} 天 · 文件创建时间` : "收件目录未配置或不存在", onActivate: () => openDetail("inbox") },
			{ label: "洞察", value: insightsReady ? d.knowledge.metrics.find((item) => item.label === "原创洞察")?.value ?? "—" : "—", sub: insightsReady ? "洞察目录" : "目录未配置或不存在", onActivate: () => openDetail("knowledge") },
			{ label: "素材", value: materialsReady ? d.knowledge.metrics.find((item) => item.label === "外部素材")?.value ?? "—" : "—", sub: materialsReady ? "素材目录" : "目录未配置或不存在", onActivate: () => openDetail("knowledge") },
			{ label: "待处理输出", value: d.output.queueStatus === "ready" && d.output.queueTotal !== undefined ? String(d.output.queueTotal) : "—", sub: d.output.queueStatus === "ready" && d.output.queueTotal !== undefined ? "输出文件中未完成的任务" : "输出来源缺失或格式待检查", onActivate: () => openDetail("output") },
		],
	});

	const grid = page.createDiv({ cls: "workflow-v2-primary workbench-data-grid" });
	grid.setAttribute("data-workflow-layout", "split");
	const left = grid.createDiv({ cls: "workbench-data-column" });
	const right = grid.createDiv({ cls: "workbench-data-column" });
	const renderDetail = (host: HTMLElement, key: DataPageKey, label: string, render: (content: HTMLElement) => void): HTMLDetailsElement => {
		const details = host.createEl("details", { cls: "workbench-data-detail" });
		details.dataset.workbenchData = key;
		detailsByKey[key] = details;
		const summary = details.createEl("summary", { text: label });
		summary.setAttribute("aria-label", label);
		let mounted = false;
		const mount = () => {
			if (!details.open || mounted) return;
			mounted = true;
			const content = details.createDiv({ cls: "workbench-data-detail-content" });
			render(content);
			// 操作按钮在综合模块中保留，避免原页面头部重复占位。
			content.querySelector<HTMLElement>(".talos-ui-page-header")?.remove();
		};
		details.addEventListener("toggle", mount);
		details.open = key === focus;
		mount();
		return details;
	};

	const inbox = view.panel(left, "#F97316", "收件与分诊", inboxReady ? `共 ${d.inbox.count} 篇 · 按创建时间统计，迁移可能改变日期` : "收件目录未配置或不存在");
	const inboxActions = inbox.createDiv({ cls: "module-hero-actions" });
	commandButton(view, inboxActions, "开始归档", "/intake");
	commandButton(view, inboxActions, "消化偏好", "/digest");
	fileButton(view, inboxActions, "收件地图", view.paths.readme("inbox"));
	if (!inboxReady) inbox.createDiv({ cls: "empty", text: "请在设置中检查收件目录。" });
	renderDetail(inbox, "inbox", "收件分诊与积压详情", (content) => renderInboxPage(view, content, d));

	const knowledge = view.panel(right, "#A78BFA", "知识与 MOC", "最近资料预览 · 完整内容可展开");
	const knowledgeActions = knowledge.createDiv({ cls: "module-hero-actions" });
	fileButton(view, knowledgeActions, "MOC", view.paths.mocReadme);
	fileButton(view, knowledgeActions, "洞察库", view.paths.readme("insights"));
	fileButton(view, knowledgeActions, "素材库", view.paths.readme("assets"));
	const knowledgePreview = knowledge.createDiv({ cls: "workbench-data-preview" });
	previewList(view, knowledgePreview, "最近洞察", insightsReady ? d.knowledge.recentInsights : [], insightsReady ? "暂无洞察" : "洞察目录未配置或不存在");
	previewList(view, knowledgePreview, "最近素材", materialsReady ? d.knowledge.recentMaterials : [], materialsReady ? "暂无素材" : "素材目录未配置或不存在");
	previewList(view, knowledgePreview, "MOC 概念入口", mocReady ? d.knowledge.mocs : [], mocReady ? "暂无 MOC" : "MOC 目录未配置或不存在");
	const knowledgeDetails = renderDetail(knowledge, "knowledge", "展开完整知识详情", (content) => renderKnowledgePage(view, content, d));
	knowledgePreview.hidden = knowledgeDetails.open;
	knowledgeDetails.addEventListener("toggle", () => { knowledgePreview.hidden = knowledgeDetails.open; });

	const output = view.panel(right, "#FB7185", "输出", d.output.queueStatus === "ready" && d.output.queueTotal !== undefined ? `待处理 ${d.output.queueTotal} 条 · 预览最多 3 条` : d.output.queueStatus === "format" ? "格式待检查 · 保留来源预览" : "输出来源未配置或无法统计");
	fileButton(view, output, "打开输出", view.paths.outletFile);
	const outputPreview = output.createDiv({ cls: "workbench-data-preview" });
	previewList(view, outputPreview, d.output.queueStatus === "format" ? "来源预览" : "待处理输出", d.output.queue, d.output.queueStatus === "ready" ? "暂无待处理输出" : "请检查输出文件及条目格式");
	const outputDetails = renderDetail(output, "output", "展开完整输出详情", (content) => renderOutputPage(view, content, d));
	outputPreview.hidden = outputDetails.open;
	outputDetails.addEventListener("toggle", () => { outputPreview.hidden = outputDetails.open; });
}
