// TALOS 控制台图表与列表填充器；由 TalosView 委托调用，只依赖传入的视图实例。
import type { CapabilityGroup } from "../../data/capabilities";
import type { DistBar, GateItem, HealthPoint, InboxDigest, MetricTile, OutputCenter, ProjectScene, ReleaseWarRoom, SignalItem, TalosProduct } from "../../types";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import type { TalosView } from "../../view";

// ---------- 填充 ----------
export function fillSignalList(view: TalosView, parent: HTMLElement, items: SignalItem[], emptyText: string): void {
	if (items.length === 0) {
		parent.createDiv({ cls: "empty", text: emptyText });
		return;
	}
	for (const it of items) {
		const row = parent.createDiv({ cls: "detail-row" });
		const text = row.createDiv({ cls: "detail-text" });
		text.createEl("b", { text: it.title });
		// 收件箱视觉优化（2026-07-07）：meta 原为 "3d · 00-收件箱/web/xxx.md" 裸路径，
		// 现拆为结构化 data 属性供 CSS 渲染 chip（[web] 3d），不再裸露完整路径。
		const metaParts = (it.meta || "—").split(" · ");
		const daysPart = metaParts[0] || "";
		const folderPart = it.path?.split("/")[1] || "";
		const span = text.createEl("span");
		span.textContent = daysPart;
		if (folderPart) span.dataset.folder = folderPart;
		if (it.path) row.addEventListener("click", () => void openFile(view.app, it.path || ""));
	}
}

export function fillCapabilityDistribution(view: TalosView, parent: HTMLElement, groups: CapabilityGroup[]): void {
	if (groups.length === 0) {
		renderTalosEmptyState(
			parent,
			"暂无能力分组",
			"扫描到命令、Agent 或工作流后，这里会显示真实数量分布。"
		);
		return;
	}
	const maxCount = Math.max(
		...groups.map((group) => group.items.length),
		1
	);
	for (const group of groups) {
		const row = parent.createDiv({
			cls: "capability-v2-distribution-row",
		});
		const head = row.createDiv({
			cls: "capability-v2-distribution-row__head",
		});
		head.createEl("strong", { text: group.label });
		head.createEl("span", {
			text: String(group.items.length),
		});
		const track = row.createDiv({
			cls: "capability-v2-distribution-row__track",
		});
		track.setAttribute("role", "img");
		track.setAttribute(
			"aria-label",
			`${group.label}：${group.items.length} 个调用入口`
		);
		track.createSpan().style.width =
			`${(group.items.length / maxCount) * 100}%`;
	}
}

export function fillGateStateChart(view: TalosView, parent: HTMLElement, gates: GateItem[]): void {
	if (gates.length === 0) {
		renderTalosEmptyState(
			parent,
			"暂无闸门数据",
			"发布闸门出现后，这里会显示完成、就绪、阻塞和待办分布。"
		);
		return;
	}

	const states: Array<{
		key: GateItem["state"];
		label: string;
	}> = [
		{ key: "done", label: "完成" },
		{ key: "ready", label: "就绪" },
		{ key: "blocked", label: "阻塞" },
		{ key: "todo", label: "待办" },
	];
	const counts = states.map((state) => ({
		...state,
		count: gates.filter((gate) => gate.state === state.key).length,
	}));
	const track = parent.createDiv({
		cls: "talos-v2-gate-chart__track",
	});
	track.setAttribute("role", "img");
	track.setAttribute(
		"aria-label",
		`闸门状态分布：${counts
			.map((item) => `${item.label} ${item.count}`)
			.join("，")}`
	);
	for (const item of counts) {
		if (item.count === 0) continue;
		const segment = track.createSpan({
			cls: `talos-v2-gate-chart__segment state-${item.key}`,
		});
		segment.style.width = `${(item.count / gates.length) * 100}%`;
	}

	const legend = parent.createDiv({
		cls: "talos-v2-gate-chart__legend",
	});
	for (const item of counts) {
		const key = legend.createDiv({
			cls: `talos-v2-gate-chart__key state-${item.key}`,
		});
		key.createSpan({ cls: "talos-v2-gate-chart__dot" });
		key.createEl("strong", { text: String(item.count) });
		key.createEl("span", { text: item.label });
	}
}

export function fillKnowledgeTreemap(view: TalosView, parent: HTMLElement, metrics: MetricTile[]): void {
	const nodes = metrics
		.map((metric) => {
			const value = Number.parseFloat(
				metric.value.replace(/[^\d.]/g, "")
			);
			return {
				metric,
				value: Number.isFinite(value) ? Math.max(0, value) : 0,
			};
		})
		.sort((left, right) => right.value - left.value);
	const total = nodes.reduce((sum, node) => sum + node.value, 0);
	if (total <= 0) {
		renderTalosEmptyState(
			parent,
			"暂无知识资产统计",
			"MOC、洞察或素材出现后，这里会按真实数量形成树状占比。"
		);
		return;
	}

	for (const node of nodes) {
		const share = (node.value / total) * 100;
		const tile = parent.createEl("button", {
			cls: `metric-card knowledge-v2-treemap-node tone-${node.metric.tone || "default"}`,
			attr: {
				type: "button",
				"aria-label": `${node.metric.label}：${node.metric.value}，占 ${Math.round(share)}%`,
			},
		});
		tile.style.setProperty("--knowledge-share", `${share}%`);
		tile.createEl("small", { text: node.metric.label });
		tile.createEl("strong", { text: node.metric.value });
		tile.createEl("span", {
			text: `${Math.round(share)}% · ${node.metric.sub}`,
		});
		if (node.metric.path) {
			tile.addEventListener("click", () =>
				void openFile(view.app, node.metric.path || "")
			);
		} else {
			tile.disabled = true;
		}
	}
}

export function fillOutputClosureChart(view: TalosView, parent: HTMLElement, platforms: OutputCenter["platforms"]): void {
	if (platforms.length === 0) {
		renderTalosEmptyState(
			parent,
			"暂无平台稿件",
			"创建平台内容后，这里会显示发布、待闭环与未分类分布。"
		);
		return;
	}

	const legend = parent.createDiv({ cls: "output-v2-chart-legend" });
	for (const item of [
		{ label: "已发布", tone: "published" },
		{ label: "待闭环", tone: "pending" },
		{ label: "未分类", tone: "unclassified" },
	]) {
		const key = legend.createSpan({
			cls: `output-v2-chart-key tone-${item.tone}`,
		});
		key.createSpan({ cls: "output-v2-chart-key__dot" });
		key.createSpan({ text: item.label });
	}

	for (const platform of platforms) {
		const classified = platform.published + platform.pending;
		const total = Math.max(platform.count, classified);
		const unclassified = Math.max(0, total - classified);
		const row = parent.createDiv({ cls: "output-v2-bar-row" });
		const head = row.createDiv({ cls: "output-v2-bar-row__head" });
		head.createEl("strong", { text: platform.name });
		head.createEl("span", {
			text: `${platform.published}/${total} 已发布 · ${platform.pending} 待闭环`,
		});

		const track = row.createDiv({ cls: "output-v2-bar-track" });
		track.setAttribute("role", "img");
		track.setAttribute(
			"aria-label",
			`${platform.name}：已发布 ${platform.published}，待闭环 ${platform.pending}，未分类 ${unclassified}`
		);
		if (total === 0) track.addClass("is-empty");
		for (const segment of [
			{ tone: "published", value: platform.published },
			{ tone: "pending", value: platform.pending },
			{ tone: "unclassified", value: unclassified },
		]) {
			if (segment.value <= 0 || total === 0) continue;
			const fill = track.createSpan({
				cls: `output-v2-bar-segment tone-${segment.tone}`,
			});
			fill.style.width = `${(segment.value / total) * 100}%`;
		}
	}
}

export function fillProjectPortfolioChart(view: TalosView, parent: HTMLElement, projects: ProjectScene[]): void {
	if (projects.length === 0) {
		renderTalosEmptyState(
			parent,
			"暂无组合数据",
			"项目出现后，这里会显示优先级分布和真实任务完成率。"
		);
		return;
	}

	const tracked = projects.filter((project) => project.progress);
	const totalTasks = tracked.reduce(
		(sum, project) => sum + (project.progress?.total || 0),
		0
	);
	const doneTasks = tracked.reduce(
		(sum, project) => sum + (project.progress?.done || 0),
		0
	);
	const completion =
		totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

	const summary = parent.createDiv({
		cls: "project-v2-portfolio-summary",
	});
	const ring = summary.createDiv({
		cls: `project-v2-progress-ring${totalTasks === 0 ? " is-empty" : ""}`,
	});
	ring.style.setProperty("--project-progress", `${completion}%`);
	ring.setAttribute("role", "img");
	ring.setAttribute(
		"aria-label",
		totalTasks > 0
			? `已跟踪任务完成 ${doneTasks}/${totalTasks}，${completion}%`
			: "暂无可计算的项目任务"
	);
	ring.createSpan({ text: totalTasks > 0 ? `${completion}%` : "—" });
	const copy = summary.createDiv({
		cls: "project-v2-portfolio-summary__copy",
	});
	copy.createEl("strong", { text: "已跟踪任务完成率" });
	copy.createEl("span", {
		text:
			totalTasks > 0
				? `${doneTasks}/${totalTasks} · ${tracked.length} 个项目有任务清单`
				: "当前项目尚未提供可汇总的复选框任务",
	});

	const distribution = [
		{
			key: "p0",
			label: "P0 高频",
			count: projects.filter((project) => project.priority === "p0")
				.length,
		},
		{
			key: "p1",
			label: "P1 活跃",
			count: projects.filter((project) => project.priority === "p1")
				.length,
		},
		{
			key: "p2",
			label: "P2 长尾",
			count: projects.filter((project) => project.priority === "p2")
				.length,
		},
	];
	const maxCount = Math.max(
		...distribution.map((item) => item.count),
		1
	);
	const bars = parent.createDiv({
		cls: "project-v2-priority-bars",
	});
	for (const item of distribution) {
		const row = bars.createDiv({
			cls: `project-v2-priority-bar priority-${item.key}`,
		});
		const head = row.createDiv({
			cls: "project-v2-priority-bar__head",
		});
		head.createEl("strong", { text: item.label });
		head.createEl("span", { text: String(item.count) });
		const track = row.createDiv({
			cls: "project-v2-priority-bar__track",
		});
		track.setAttribute(
			"aria-label",
			`${item.label}：${item.count} 个项目`
		);
		track.setAttribute("role", "img");
		track.createSpan().style.width =
			`${(item.count / maxCount) * 100}%`;
	}
}

export function fillPlatforms(view: TalosView, parent: HTMLElement, platforms: OutputCenter["platforms"]): void {
	for (const platform of platforms) {
		const card = parent.createDiv({ cls: "platform-card" });
		card.createEl("b", { text: platform.name });
		card.createEl("span", { cls: "big", text: String(platform.count) });
		card.createEl("small", { text: `${platform.published} 已发布 · ${platform.pending} 待闭环` });
		const latest = card.createEl("small", { cls: "module-latest", text: `最新：${platform.latestTitle}` });
		if (platform.latestPath) {
			latest.addEventListener("click", (ev) => {
				ev.stopPropagation();
				void openFile(view.app, platform.latestPath || "");
			});
		}
		card.addEventListener("click", () => void openFile(view.app, platform.readme));
	}
}

export function fillInboxClusters(view: TalosView, parent: HTMLElement, clusters: InboxDigest["clusters"]): void {
	if (clusters.length === 0) {
		parent.createDiv({ cls: "empty", text: "暂无待消化主题" });
		return;
	}
	const total = clusters.reduce((sum, c) => sum + c.count, 0);
	const max = Math.max(...clusters.map((c) => c.count), 1);
	for (const cluster of clusters) {
		const card = parent.createDiv({ cls: "cluster-card" });
		card.createEl("b", { text: cluster.name });
		card.createEl("span", { cls: "big", text: String(cluster.count) });
		const hintRow = card.createDiv({ cls: "cluster-hint-row" });
		hintRow.createEl("small", { text: cluster.hint });
		if (total > 0) {
			hintRow.createEl("small", {
				cls: "cluster-pct",
				text: `${Math.round((cluster.count / total) * 100)}%`,
			});
		}
		const bar = card.createDiv({ cls: "cluster-bar" });
		const fill = bar.createDiv({ cls: "cluster-bar-fill" });
		if (cluster.name === "其他") fill.addClass("is-manual");
		fill.style.width = `${Math.max(2, Math.round((cluster.count / max) * 100))}%`;
	}
}

/** 积压年龄分布：design-system/talos/pages/inbox.md §组件规格 */
export function fillInboxAgeDist(view: TalosView, parent: HTMLElement, inbox: InboxDigest): void {
	if (inbox.count === 0) return;
	const buckets = inbox.ageBuckets.filter((b) => b.count > 0);
	parent.createDiv({ cls: "age-dist-title", text: `积压年龄 · 共 ${inbox.count} 篇 · 最老 ${inbox.oldestDays}d` });
	const track = parent.createDiv({ cls: "age-dist-track" });
	for (const bucket of buckets) {
		const seg = track.createDiv({ cls: `age-seg tone-${bucket.tone}` });
		seg.style.width = `${Math.max(1.5, (bucket.count / inbox.count) * 100)}%`;
		seg.setAttr("aria-label", `${bucket.label}：${bucket.count} 篇`);
	}
	track.setAttr("role", "img");
	track.setAttr(
		"aria-label",
		`积压年龄分布：${buckets.map((b) => `${b.label} ${b.count} 篇`).join("，")}`
	);
	const legend = parent.createDiv({ cls: "age-dist-legend" });
	for (const bucket of buckets) {
		const item = legend.createDiv({ cls: "age-legend-item" });
		item.createSpan({ cls: `age-dot tone-${bucket.tone}` });
		item.createSpan({ text: `${bucket.label} · ${bucket.count} 篇` });
	}
}

export function fillTalosModules(view: TalosView, parent: HTMLElement, modules: TalosProduct["modules"]): void {
	for (const module of modules) {
		const card = parent.createDiv({ cls: "talos-module" });
		card.createEl("b", { text: module.name });
		card.createEl("span", { cls: "big", text: String(module.count) });
		const latest = card.createEl("small", { cls: "module-latest", text: `最新：${module.latestTitle}` });
		if (module.latestPath) {
			latest.addEventListener("click", (ev) => {
				ev.stopPropagation();
				void openFile(view.app, module.latestPath || "");
			});
		}
		card.addEventListener("click", () => void openFile(view.app, module.readme));
	}
}

export function fillBanner(view: TalosView, banner: HTMLElement, w: ReleaseWarRoom): void {
	banner.empty();
	banner.toggleClass("is-alert", w.stopTriggered);
	banner.createDiv({ cls: "banner-tag", text: w.stopTriggered ? "⛔ 重估期" : "发布状态" });
	const stats = banner.createDiv({ cls: "banner-stats" });
	const item = (label: string, value: string) => {
		const dd = stats.createDiv({ cls: "banner-item" });
		dd.createSpan({ cls: "banner-num", text: value });
		dd.createSpan({ cls: "banner-lab", text: label });
	};
	item("已发布", `${w.published}/${w.totalPub}`);
	item("冻结天数", String(w.frozenDays));
	item("停止条件", w.stopTriggered ? "已触发" : "正常");
}

export function fillDist(view: TalosView, el: HTMLElement, dist: DistBar[]): void {
	const max = Math.max(1, ...dist.map((d) => d.count));
	for (const d of dist) {
		const row = el.createDiv({ cls: "barrow" });
		row.createSpan({ cls: "bt", text: d.name });
		const wrap = row.createDiv({ cls: "bwrap" });
		const bar = wrap.createEl("i");
		bar.setCssProps({ "--talos-w": `${Math.round((d.count / max) * 100)}%` });
		row.createSpan({ cls: "bn", text: String(d.count) });
		row.addEventListener("click", () => void openFile(view.app, d.readme));
	}
}

export function fillTrend(view: TalosView, panel: HTMLElement, points: HealthPoint[]): void {
	if (points.length === 0) { panel.createDiv({ cls: "empty", text: "无健康分数据" }); return; }
	const last = points[points.length - 1];
	const prev = points.length > 1 ? points[points.length - 2] : undefined;
	const delta = last && prev ? last.score - prev.score : 0;
	const head = panel.createDiv({ cls: "trend-head" });
	head.createSpan({ cls: "score", text: last ? String(last.score) : "—" });
	head.createSpan({ cls: `delta ${delta < 0 ? "down" : "up"}`, text: delta === 0 ? "持平" : delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}` });
	head.createEl("small", { text: "满分 100" });
	const chart = panel.createDiv({ cls: "spark" });
	const max = Math.max(...points.map((p) => p.score), 100);
	for (const p of points) {
		const col = chart.createDiv({ cls: "spark-col" });
		const bar = col.createDiv({ cls: "spark-bar" });
		bar.setCssProps({ "--talos-h": `${Math.round((p.score / max) * 100)}%` });
		bar.setAttribute("title", `${p.label}: ${p.score}`);
		col.createSpan({ cls: "spark-lab", text: p.label });
	}
}

export function fillGates(view: TalosView, el: HTMLElement, gates: GateItem[]): void {
	if (gates.length === 0) { el.createDiv({ cls: "empty", text: "—" }); return; }
	for (const g of gates) {
		const chip = el.createDiv({ cls: `gate state-${g.state}` });
		chip.createSpan({ cls: "gate-id", text: g.id });
		chip.createSpan({ cls: "gate-title", text: g.title });
		if (g.path) chip.addEventListener("click", () => void openFile(view.app, g.path || ""));
	}
}
