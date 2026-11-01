// Lens「项目」：对照 TALOS Lens projectList()——搜索 + 看板/列表切换 + 状态筛选页签，
// 看板列固定为 计划中/进行中/待评审/已完成/已暂停，其余状态（已归档、未登记）追加在后。
// 状态取各项目 _README.md 的 frontmatter status，未登记不推测。
import { button, chip, el, heading, icon, type LensChild } from "./lens-dom";
import { metricStrip } from "./lens-library";
import { freshness, label, num, time } from "./lens-format";
import type { LensContext } from "./lens-pages";
import type { LensProject } from "./lens-data";

const BOARD_STATUSES = ["planned", "active", "review", "completed", "paused"];
const PAGE_SIZE = 8;

function freshnessDot(ctx: LensContext, value: number | null): HTMLElement {
	const f = freshness(value);
	return el(ctx.doc, "span", { class: "vk-fresh", "data-tone": f.tone }, el(ctx.doc, "i"), f.label);
}

function statusTone(status: string): string {
	return ["blocked", "review", "partial", "stale"].includes(status) ? "warn" : ["unknown", "planned", "archived"].includes(status) ? "dim" : "";
}

function filtered(ctx: LensContext): LensProject[] {
	const query = (ctx.state.queries.projects ?? "").trim().toLowerCase();
	const filter = ctx.state.projectFilter;
	return ctx.data.projects.filter((p) => (filter === "all" || p.status === filter)
		&& (!query || `${p.name} ${p.line}`.toLowerCase().includes(query)));
}

function board(ctx: LensContext, list: LensProject[]): HTMLElement[] {
	const { doc } = ctx;
	const grouped = new Map<string, LensProject[]>(BOARD_STATUSES.map((s) => [s, []]));
	for (const p of list) {
		if (!grouped.has(p.status)) grouped.set(p.status, []);
		grouped.get(p.status)!.push(p);
	}
	return [
		el(doc, "div", { class: "lens-project-board", role: "region", "aria-label": "按登记状态排列的项目" },
			...[...grouped].map(([status, items]) => el(doc, "section", { class: "lens-board-column" },
				el(doc, "div", { class: "lens-board-head" }, el(doc, "span", { class: "lens-board-dot", "data-status": status }), el(doc, "h2", {}, label(status)), el(doc, "span", {}, String(items.length))),
				el(doc, "div", { class: "lens-board-items" }, ...(items.length ? items.map((p) => {
					const card = el(doc, "button", { type: "button", class: "lens-board-card", "data-project": p.id },
						el(doc, "strong", {}, p.name),
						el(doc, "span", { class: "lens-board-line" }, p.line),
						el(doc, "span", { class: "lens-board-meta" }, freshnessDot(ctx, p.lastUpdated),
							/^P[0-4]$/i.test(p.priority) ? el(doc, "em", { "data-tone": "ink" }, p.priority) : null));
					card.addEventListener("click", () => ctx.openDrawer(p.readme));
					return card;
				}) : [el(doc, "p", { class: "lens-board-empty" }, "暂无项目")]))))),
		el(doc, "p", { class: "lens-board-caption" }, `${list.length} 个项目`),
	];
}

function list(ctx: LensContext, projects: LensProject[]): HTMLElement[] {
	const { doc } = ctx;
	const pages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
	const page = Math.max(0, Math.min(pages - 1, ctx.state.deckPages.projects ?? 0));
	const start = page * PAGE_SIZE;
	const turn = (delta: number) => {
		ctx.state.deckPages.projects = page + delta;
		ctx.rerender();
	};
	const prev = button(doc, "上一页", { disabled: page === 0 });
	prev.addEventListener("click", () => turn(-1));
	const next = button(doc, "下一页", { disabled: start + PAGE_SIZE >= projects.length });
	next.addEventListener("click", () => turn(1));
	return [
		el(doc, "div", { class: "ta-project-grid" }, ...(projects.length ? projects.slice(start, start + PAGE_SIZE).map((p) => {
			const card = el(doc, "button", { type: "button", class: "ta-project-card", "data-project": p.id },
				el(doc, "div", { class: "ta-card-title" }, el(doc, "h3", {}, p.name), chip(doc, label(p.status), statusTone(p.status))),
				el(doc, "p", {}, p.line),
				el(doc, "footer", {},
					el(doc, "span", {}, p.progress ? `任务 ${p.progress.done}/${p.progress.total}${p.progress.sampled ? ` · 抽样 ${p.progress.scannedFiles}/${p.progress.totalFiles} 篇` : ""}` : `笔记 ${num(p.notes)} 篇`),
					el(doc, "span", {}, p.lastUpdated ? time(p.lastUpdated) : "更新时间未知")));
			card.addEventListener("click", () => ctx.openDrawer(p.readme));
			return card;
		}) : [el(doc, "p", { class: "ta-muted" }, "没有匹配的项目")])),
		el(doc, "div", { class: "ta-pagination" },
			el(doc, "span", {}, `${projects.length} 个匹配项目 · 第 ${page + 1}/${pages} 页`),
			el(doc, "div", { class: "ta-head-actions" }, prev, next)),
	];
}

export function renderProjects(ctx: LensContext): LensChild[] {
	const { doc } = ctx;
	const input = el(doc, "input", { id: "lens-q-projects", type: "search", "aria-label": "搜索项目", placeholder: "搜索项目或最近记录" });
	input.value = ctx.state.queries.projects ?? "";
	input.addEventListener("input", () => {
		ctx.state.queries.projects = input.value;
		ctx.state.deckPages.projects = 0;
		ctx.rerender();
	});
	const viewSwitch = el(doc, "div", { class: "lens-view-switch", role: "group", "aria-label": "项目视图" },
		...([["board", "看板"], ["list", "列表"]] as const).map(([view, name]) => {
			const node = el(doc, "button", { type: "button", "aria-pressed": String(ctx.state.projectView === view) }, name);
			node.addEventListener("click", () => {
				ctx.state.projectView = view;
				ctx.rerender();
			});
			return node;
		}));
	const counts = new Map<string, number>();
	for (const p of ctx.data.projects) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
	const tabs = el(doc, "div", { class: "ta-tabs", "aria-label": "项目状态筛选" },
		...[["all", ctx.data.projects.length] as const, ...counts.entries()].map(([status, count]) => {
			const node = el(doc, "button", { type: "button", class: "ta-tab", "aria-pressed": String(ctx.state.projectFilter === status) },
				status === "all" ? "全部" : label(status), el(doc, "small", {}, String(count)));
			node.addEventListener("click", () => {
				ctx.state.projectFilter = status;
				ctx.state.deckPages.projects = 0;
				ctx.rerender();
			});
			return node;
		}));
	const projects = filtered(ctx);
	const all = ctx.data.projects;
	const root = ctx.app.vault.getAbstractFileByPath(ctx.paths.dir("projects"));
	const available = !!root && "children" in root;
	const recentlyUpdated = all.filter((p) => p.lastUpdated !== null && p.lastUpdated >= Date.now() - 7 * 86400000).length;
	const noteCount = all.reduce((sum, p) => sum + p.notes, 0);
	const metrics = metricStrip(ctx, [
		{ label: "项目总数", value: available ? String(all.length) : "—", sub: "项目目录下一级文件夹", path: ctx.paths.readme("projects") },
		{ label: "近 7 天更新", value: available ? String(recentlyUpdated) : "—", sub: "按项目内笔记修改时间", path: ctx.paths.readme("projects") },
		{ label: "项目笔记", value: available ? String(noteCount) : "—", sub: "项目目录内 Markdown 笔记", path: ctx.paths.readme("projects") },
	]);
	return [
		heading(doc, "项目管理", "项目状态取各项目 README 的 status；点开查看摘要"),
		metrics,
		el(doc, "div", { class: "lens-project-toolbar" }, el(doc, "label", { class: "ta-search" }, icon(doc, "search"), input), viewSwitch),
		tabs,
		el(doc, "div", { class: "ta-project-results" }, ...(ctx.state.projectView === "list" ? list(ctx, projects) : board(ctx, projects))),
	];
}
