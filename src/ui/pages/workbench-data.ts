// 资料工作台：一屏给出「今天最该分诊哪一条」，收件、洞察、输出各自只留可行动的入口。
// 完整分诊 / 知识 / 输出页收进底部按需展开，首页不再嵌套滚动。
import { openFile } from "../../actions";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { renderWorkbenchHome, type WorkbenchHomeHandle, type WorkbenchRow } from "./workbench-home";
import { renderInboxPage } from "./workspace-pages";
import { renderKnowledgePage } from "./knowledge-pages";
import { renderOutputPage } from "./project-pages";

type DataPageKey = "inbox" | "knowledge" | "output";

function sourceFolder(view: TalosView, path: string): boolean {
	const folder = view.app.vault.getAbstractFileByPath(path);
	return !!folder && "children" in folder;
}

function metricValue(d: Collected, label: string): string {
	return d.knowledge.metrics.find((item) => item.label === label)?.value ?? "—";
}

export function renderWorkbenchData(view: TalosView, page: HTMLElement, d: Collected, focusKey: string): void {
	const focus: DataPageKey = focusKey === "knowledge" || focusKey === "output" ? focusKey : "inbox";
	const inboxReady = sourceFolder(view, view.plugin.talosSettings.inboxFolder);
	const insightsReady = sourceFolder(view, view.paths.dir("insights"));
	const materialsReady = sourceFolder(view, view.paths.dir("assets"));
	const mocReady = sourceFolder(view, view.paths.mocDir);
	const outputReady = d.output.queueStatus === "ready" && d.output.queueTotal !== undefined;
	const decisionsReady = d.setup?.pendingApprovalsPath === "ok" || d.setup?.candidatesPath === "ok";

	let handle: WorkbenchHomeHandle | null = null;

	const inboxRows: WorkbenchRow[] = d.inbox.queue.slice(0, 3).map((item) => ({
		title: item.title,
		meta: `${item.ageDays} 天未分诊`,
		tag: item.tags[0] ? `#${item.tags[0].replace(/^#/, "")}` : undefined,
		onActivate: () => void openFile(view.app, item.path),
	}));
	const insightRows: WorkbenchRow[] = d.knowledge.recentInsights.slice(0, 3).map((item) => {
		const path = item.path;
		return {
			title: item.title,
			meta: item.meta || "最近洞察",
			onActivate: path ? () => void openFile(view.app, path) : undefined,
		};
	});
	const first = inboxReady ? d.inbox.queue[0] : undefined;

	handle = renderWorkbenchHome(view, page, {
		eyebrow: "工作台 · 资料",
		title: "资料工作台",
		lede: inboxReady
			? `收件还有 ${d.inbox.count} 篇待分诊，最老 ${d.inbox.oldestDays} 天。先处理最老的一条，再动洞察与输出。`
			: "收件目录未配置。先在设置里指定收件目录，再回来分诊。",
		stats: [
			{
				label: "待分诊",
				value: inboxReady ? String(d.inbox.count) : "—",
				unit: "条",
				sub: inboxReady ? `最老 ${d.inbox.oldestDays} 天 · 按创建时间` : "收件目录未配置或不存在",
				alert: inboxReady && d.inbox.count > 0,
				onActivate: () => handle?.openDetail("inbox"),
			},
			{
				label: "洞察",
				value: insightsReady ? metricValue(d, "原创洞察") : "—",
				unit: "篇",
				sub: insightsReady ? "洞察目录" : "洞察目录未配置或不存在",
				onActivate: () => handle?.openDetail("knowledge"),
			},
			{
				label: "素材",
				value: materialsReady ? metricValue(d, "外部素材") : "—",
				unit: "篇",
				sub: materialsReady ? "素材目录" : "素材目录未配置或不存在",
				onActivate: () => handle?.openDetail("knowledge"),
			},
		],
		focus: {
			accent: "#F97316",
			kicker: first ? "待分诊 · 最高优先级" : "待分诊 · 队列状态",
			title: first
				? first.title
				: inboxReady
					? "收件箱已清空，没有待分诊条目"
					: "收件目录未配置，暂时无法分诊",
			meta: first
				? `${first.ageDays} 天未分诊 · 规则未命中${first.tags[0] ? ` · #${first.tags[0].replace(/^#/, "")}` : ""}`
				: inboxReady ? "完整分诊在页面底部展开" : "去设置里指定收件目录",
			cta: inboxReady ? "打开分诊 →" : "去设置 →",
			onActivate: () => {
				if (inboxReady) handle?.openDetail("inbox");
				else view.navigateToPage("settings");
			},
			rows: [
				{
					title: `待确认偏好 · ${decisionsReady ? `${d.candidates.length} 条` : "来源待检查"}`,
					meta: "确认后才会进入规则",
					go: "去确认 →",
					onActivate: () => view.openDecisions(),
				},
				{
					title: `待处理输出 · ${outputReady ? `${d.output.queueTotal} 条` : "来源待检查"}`,
					meta: d.output.queueStatus === "format" ? "输出格式待检查，保留来源预览" : "输出队列",
					go: "打开输出 →",
					onActivate: () => handle?.openDetail("output"),
				},
				{
					title: `最近洞察 · ${insightsReady ? `${d.knowledge.recentInsights.length} 条` : "目录未配置"}`,
					meta: "完整知识详情可展开",
					go: "查看知识库 →",
					onActivate: () => handle?.openDetail("knowledge"),
				},
			],
		},
		blocks: [
			{
				accent: "#F97316",
				title: "收件与分诊",
				meta: inboxReady ? `共 ${d.inbox.count} 篇 · 逐条决定去向` : "收件目录未配置或不存在",
				section: "inbox",
				empty: inboxReady ? (d.inbox.count === 0 ? "收件箱没有积压" : undefined) : "收件目录未配置或不存在",
				rows: inboxRows,
				links: [
					{ label: "查看全部分诊 →", onActivate: () => handle?.openDetail("inbox") },
					{ label: "开始归档 /intake", onActivate: () => void view.sendCommandToChat("/intake") },
					{ label: "消化偏好 /digest", onActivate: () => void view.sendCommandToChat("/digest") },
					{ label: "收件地图", onActivate: () => void openFile(view.app, view.paths.readme("inbox")) },
				],
			},
			{
				accent: "#A78BFA",
				title: "最近洞察",
				meta: insightsReady ? `近 7 天 · ${d.knowledge.recentInsights.length} 条` : "洞察目录未配置或不存在",
				section: "knowledge",
				empty: insightsReady ? undefined : "洞察目录未配置或不存在",
				rows: insightRows,
				links: [
					{ label: "打开知识库 →", onActivate: () => handle?.openDetail("knowledge") },
					{ label: "素材库", onActivate: () => void openFile(view.app, view.paths.readme("assets")) },
					{ label: "MOC", onActivate: () => void openFile(view.app, view.paths.mocReadme) },
					{ label: "输出队列 →", onActivate: () => handle?.openDetail("output") },
				],
			},
		],
		details: [
			{ key: "inbox", label: "展开完整收件分诊", open: false, mount: (host) => renderInboxPage(view, host, d) },
			{ key: "knowledge", label: "展开完整知识详情", open: focus === "knowledge", mount: (host) => renderKnowledgePage(view, host, d) },
			{ key: "output", label: "展开完整输出详情", open: focus === "output", mount: (host) => renderOutputPage(view, host, d) },
		],
	});

	// 原详情页自带头部，在综合模块里去掉，避免与首页页头重复。
	page.querySelectorAll<HTMLElement>(".talos-wb-detail-body > .talos-ui-page-header").forEach((node) => node.remove());

	void mocReady;
}
