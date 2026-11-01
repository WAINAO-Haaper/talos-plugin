// 系统、能力和身份在同一个工作台中各有清晰的操作区；首页负责统计图。
import { openFile } from "../../actions";
import type { SignalItem } from "../../types";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";

type SystemFocus = "health" | "capability" | "identity";

/** 所有旧系统入口均保留为锚点，由工作台负责导航与滚动。 */
export function renderWorkbenchSystem(view: TalosView, page: HTMLElement, d: Collected, focusKey: string): void {
	const grid = page.createDiv({ cls: "workflow-v2-primary workbench-system-grid" });
	grid.setAttribute("data-workflow-layout", "split");
	const panel = (key: SystemFocus, accent: string, title: string, description: string): HTMLElement => {
		const host = view.panel(grid, accent, title, description);
		host.dataset.workbenchSection = key;
		host.dataset.focusRequested = String(focusKey === key);
		host.tabIndex = -1;
		return host;
	};
	const button = (host: HTMLElement, label: string, action: () => void): HTMLButtonElement => {
		const result = host.createEl("button", { cls: "module-hero-action", text: label, attr: { type: "button" } });
		result.addEventListener("click", action);
		return result;
	};
	const pathButton = (host: HTMLElement, label: string, path: string, ready?: boolean): void => {
		button(host, label, () => { if (ready === false) view.navigateToPage("settings"); else void openFile(view.app, path); });
	};
	const signals = (host: HTMLElement, items: SignalItem[], empty: string): void => {
		if (!items.length) { host.createDiv({ cls: "empty", text: empty }); return; }
		const list = host.createDiv({ cls: "detail-list" });
		for (const item of items) {
			const row = list.createEl("button", { cls: "detail-row talos-focusable", attr: { type: "button" } });
			row.createEl("b", { text: item.title });
			row.createEl("small", { text: item.meta || "—" });
			row.disabled = !item.path;
			row.addEventListener("click", () => { if (item.path) void openFile(view.app, item.path); });
		}
	};

	const health = panel("health", "#34D399", "系统健康与诊断", "健康记录、错误与循环状态；图表见系统总览");
	const healthReady = d.setup?.healthLogPath === "ok";
	const healthMetric = d.healthDigest.metrics.find((item) => item.label === "健康分");
	health.createDiv({ cls: "workbench-system-summary", text: healthReady ? `最近健康记录：${healthMetric?.value ?? "—"} · ${healthMetric?.sub ?? "暂无记录"}` : "健康日志未配置或格式待检查" });
	const healthActions = health.createDiv({ cls: "module-hero-actions" });
	pathButton(healthActions, "健康日志", view.plugin.talosSettings.healthLogPath, d.setup?.healthLogPath !== "missing");
	pathButton(healthActions, "审批池", view.plugin.talosSettings.pendingApprovalsPath, d.setup?.pendingApprovalsPath !== "missing");
	button(healthActions, "处理待决策", () => view.openDecisions());
	button(healthActions, "快检", () => { void view.sendCommandToChat("/maintain quick"); });
	for (const entry of [
		{ key: "errorPatterns" as const, label: "错误模式", path: view.paths.errorPatternsFile, items: d.healthDigest.errors, limit: "最多 6 条" },
		{ key: "loopHealth" as const, label: "循环状态", path: view.paths.loopHealthFile, items: d.healthDigest.loopStatus, limit: "最近 4 条" },
	]) {
		const detail = health.createEl("details", { cls: "workbench-system-detail" });
		detail.createEl("summary", { text: `${entry.label} · ${d.setup?.[entry.key] === "ok" ? entry.limit : "来源待检查"}` });
		pathButton(detail, `打开${entry.label}来源`, entry.path, d.setup?.[entry.key] !== "missing");
		if (d.setup?.[entry.key] === "ok") signals(detail, entry.items, "未识别到可展示记录");
		else detail.createDiv({ cls: "empty", text: "来源文件未配置或格式待检查。" });
	}

	const capability = panel("capability", "#14B8A6", "能力调用", "按命令、Agent 和工作流查看；调用只预填对话");
	const capActions = capability.createDiv({ cls: "module-hero-actions" });
	for (const [label, command] of [["晨间", "/morning"], ["归档", "/intake"], ["维护", "/maintain"]] as const) {
		button(capActions, label, () => { void view.sendCommandToChat(command); });
	}
	const tabs = capability.createDiv({ cls: "tabs capability-v2-tabs" });
	const listing = capability.createDiv({ cls: "commands capability-v2-browser" });
	if (!d.capGroups.some((group) => group.key === view.activeCap)) view.activeCap = d.capGroups[0]?.key ?? "commands";
	const draw = (): void => {
		tabs.empty(); listing.empty();
		for (const group of d.capGroups) {
			const found = group.items.filter((item) => item.origin === "discovered").length;
			const count = group.sourceStatus === "ready" ? String(found) : group.sourceStatus === "partial" ? `≥${found}` : "—";
			const tab = button(tabs, `${group.label} ${count}`, () => { view.activeCap = group.key; draw(); });
			tab.setAttribute("aria-pressed", String(view.activeCap === group.key));
		}
		const group = d.capGroups.find((item) => item.key === view.activeCap);
		if (!group) { listing.createDiv({ cls: "empty", text: "暂无能力来源。" }); return; }
		if (group.sourceStatus !== "ready") listing.createDiv({ cls: "empty", text: "部分能力来源不可用；推荐入口不计入已发现数量。" });
		if (!group.items.length) listing.createDiv({ cls: "empty", text: "当前分组没有调用入口。" });
		for (const item of group.items) {
			const card = listing.createDiv({ cls: "command" });
			card.createEl("strong", { text: item.name });
			card.createEl("small", { text: `${item.desc || "—"}${item.origin === "fallback" ? " · 推荐入口，未发现对应文件" : ""}` });
			const actions = card.createDiv({ cls: "cap-actions" });
			button(actions, "填入对话", () => { void view.sendCommandToChat(item.invoke); });
			button(actions, "复制调用", () => { void view.copyText(item.invoke); });
			if (item.path) button(actions, "打开源文件", () => { void openFile(view.app, item.path || ""); });
		}
	};
	draw();

	const identity = panel("identity", "#6366F1", "身份与记忆", "身份资料、助手人格与记忆入口");
	const identityActions = identity.createDiv({ cls: "module-hero-actions" });
	pathButton(identityActions, "身份目录", view.paths.readme("identity"));
	pathButton(identityActions, "人格目录", view.paths.readme("soul"));
	pathButton(identityActions, "CONTEXT", view.paths.contextFile, d.setup?.context !== "missing");
	pathButton(identityActions, "PERSONA", view.paths.personaFile, d.setup?.persona !== "missing");
	button(identityActions, "记忆流", () => { void view.sendCommandToChat("/memory"); });
	for (const group of [
		{ title: "用户身份", items: [
			{ title: "TELOS", meta: "使命与目标", path: view.paths.telosFile },
			{ title: "CONTEXT", meta: "当前状态", path: view.paths.contextFile },
			{ title: "PROFILE", meta: "已确认偏好", path: view.paths.profileFile },
			{ title: "战略决策", meta: "方向与判断", path: view.paths.decisionsFile },
		] },
		{ title: "助手人格", items: [
			{ title: "PERSONA", meta: "人格与边界", path: view.paths.personaFile },
			{ title: "persona-memory", meta: "人格记忆", path: view.paths.personaMemoryFile },
		] },
		{ title: "记忆与治理", items: [
			{ title: "任务池", meta: d.setup?.tasksPath === "ok" && d.focusTotal !== undefined ? `${d.focusTotal} 个当前焦点` : "来源待检查", path: view.plugin.talosSettings.tasksPath },
			{ title: "审批池", meta: d.setup?.pendingApprovalsPath === "ok" ? `${d.approvals.length} 项待决策` : "来源待检查", path: view.plugin.talosSettings.pendingApprovalsPath },
			{ title: "偏好候选", meta: d.setup?.candidatesPath === "ok" ? `${d.candidates.length} 条待确认` : "来源待检查", path: view.plugin.talosSettings.candidatesPath },
			{ title: "健康日志", meta: healthReady ? (healthMetric?.sub ?? "查看记录") : "来源待检查", path: view.plugin.talosSettings.healthLogPath },
		] },
	]) {
		const detail = identity.createEl("details", { cls: "workbench-system-detail" });
		detail.open = focusKey === "identity";
		detail.createEl("summary", { text: group.title });
		signals(detail, group.items, "暂无入口");
	}
}
