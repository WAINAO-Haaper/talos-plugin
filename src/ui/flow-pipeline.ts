// 内容流：收件、洞察、素材与待处理输出。
// 2026-10-07 导航重构第二期：收件箱、知识库、输出三页共用这条流水线代替各自的页头指标，
// 数字只取既有统计（inbox / knowledge.metrics / output），不重新扫描 Vault。
import type { Collected } from "./talos-view-model";
import type { TalosView } from "../view";
import { CONTENT_KEYS } from "../data/schema";

export type FlowStationKey = "total" | "inbox" | "insights" | "materials" | "queue";

export interface FlowStation {
	key: FlowStationKey;
	label: string;
	value: string;
	sub: string;
	pageKey: "inbox" | "knowledge" | "output";
	stuck: boolean;
}

const STUCK_INBOX_DAYS = 14;

function metricValue(metrics: Collected["knowledge"]["metrics"], label: string): string {
	return metrics.find((metric) => metric.label === label)?.value ?? "0";
}

/** 四个站点及其卡点：收件积压超过两周或有待处理输出。 */
export function flowStations(d: Collected, inboxAvailable = true, source = { content: true, insights: true, materials: true }): FlowStation[] {
	const queue = d.output.queueStatus === "ready" ? d.output.queueTotal : undefined;
	return [
		{
			key: "total",
			label: "知识笔记",
			value: source.content ? d.overview?.totalNotes?.value ?? "—" : `≥${d.overview?.totalNotes?.value ?? 0}`,
			sub: source.content ? d.overview?.totalNotes?.sub ?? "六大内容目录" : "部分内容目录缺失 · 仅计已找到的目录",
			pageKey: "knowledge",
			stuck: false,
		},
		{
			key: "inbox",
			label: "收件",
			value: inboxAvailable ? String(d.inbox.count) : "—",
			sub: !inboxAvailable ? "收件目录未配置" : d.inbox.count > 0 ? `最老 ${d.inbox.oldestDays} 天 · 创建时间` : "已清空",
			pageKey: "inbox",
			stuck: inboxAvailable && d.inbox.count > 0 && d.inbox.oldestDays >= STUCK_INBOX_DAYS,
		},
		{
			key: "insights",
			label: "洞察",
			value: source.insights ? metricValue(d.knowledge.metrics, "原创洞察") : "—",
			sub: source.insights ? "洞察目录" : "目录未找到或无法读取",
			pageKey: "knowledge",
			stuck: false,
		},
		{
			key: "materials",
			label: "素材",
			value: source.materials ? metricValue(d.knowledge.metrics, "外部素材") : "—",
			sub: source.materials ? "素材目录" : "目录未找到或无法读取",
			pageKey: "knowledge",
			stuck: false,
		},
		{
			key: "queue",
			label: "待处理",
			value: queue === undefined ? "—" : String(queue),
			sub: queue === undefined ? "输出来源缺失或格式待检查" : "输出文件 · 待处理条目",
			pageKey: "output",
			stuck: queue !== undefined && queue > 0,
		},
	];
}

export function renderFlowPipeline(view: TalosView, parent: HTMLElement, d: Collected, activePage: string): HTMLElement {
	const pipeline = parent.createDiv({ cls: "talos-flow-pipeline" });
	pipeline.setAttribute("role", "list");
	pipeline.setAttribute("aria-label", "内容流水线");
	const folderExists = (path: string) => { const node = view.app.vault.getAbstractFileByPath(path); return !!node && "children" in node; };
	const inboxFolder = folderExists(view.plugin.talosSettings.inboxFolder);
	const sources = { content: CONTENT_KEYS.every((key) => folderExists(view.paths.dir(key))), insights: folderExists(view.paths.dir("insights")), materials: folderExists(view.paths.dir("assets")) };
	for (const station of flowStations(d, inboxFolder, sources)) {
		const current = station.pageKey === activePage;
		const item = pipeline.createDiv({
			cls: `talos-flow-station${current ? " is-current" : ""}${station.stuck ? " is-stuck" : ""}`,
		});
		item.setAttribute("role", "listitem");
		item.dataset.flowStation = station.key;
		item.createEl("small", { text: station.label });
		item.createEl("b", { text: station.value });
		const detail = item.createEl("span", { text: station.sub });
		if (station.key === "total" && sources.content) {
			detail.setAttribute("title", "六大内容目录；近7天按文件创建时间统计，迁移可能改变日期。");
		}
		if (!current) {
			item.setAttribute("tabindex", "0");
			item.setAttribute("aria-label", `打开${station.label}：${station.value}`);
			const open = () => view.navigateToPage(station.pageKey);
			item.addEventListener("click", open);
			item.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				open();
			});
		}
	}
	return pipeline;
}

/** 把流水线放进页头原指标位置；页头不再重复展示同一组数字。 */
export function mountFlowPipeline(view: TalosView, hero: HTMLElement, d: Collected, activePage: string): void {
	const slot = hero.querySelector<HTMLElement>(".talos-ui-page-header__metrics") ?? hero;
	slot.addClass("has-flow-pipeline");
	renderFlowPipeline(view, slot, d, activePage);
}
