// Lens 的资料浏览样式：搜索框 → 分类芯片 → 分页卡片（lens-card-deck，每页 6 张）→ 点击右侧摘要栏。
// 收集 / 知识 / 身份 / 输出 / 执行节奏的笔记列表都走这一套。
import { TFile } from "obsidian";
import type { HeatMonth, MetricTile, SignalItem } from "../../types";
import { button, chip, el, heading, icon, panel, type LensChild } from "./lens-dom";
import { bytes, num, time } from "./lens-format";
import { listNotes, type LensNote } from "./lens-data";
import type { LensContext } from "./lens-pages";

const CARD_PAGE_SIZE = 6;

/** Last 14 calendar days in local time; heatmap grids may include future cells. */
export function recentHeatCells(months: HeatMonth[], now = new Date()) {
	const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	return months.flatMap((m) => m.weeks.flat()).filter((c) => c.date && c.date <= date)
		.sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
}

function searchBox(ctx: LensContext, key: string, placeholder: string): HTMLElement {
	const { doc } = ctx;
	const input = el(doc, "input", { id: `lens-q-${key}`, type: "search", "aria-label": placeholder, placeholder });
	input.value = ctx.state.queries[key] ?? "";
	input.addEventListener("input", () => {
		ctx.state.queries[key] = input.value;
		ctx.state.deckPages[key] = 0;
		ctx.rerender();
	});
	return el(doc, "label", { class: "ta-search" }, icon(doc, "search"), input);
}

function readingCard(ctx: LensContext, note: LensNote, kind: string): HTMLElement {
	const { doc } = ctx;
	const card = el(doc, "button", {
		type: "button",
		class: `lens-reading-card${ctx.drawerPath() === note.path ? " is-selected" : ""}`,
		"data-doc": note.path,
		title: note.name,
	},
	el(doc, "span", { class: "lens-card-symbol" }, icon(doc, "file-text")),
	el(doc, "h3", {}, note.name),
	el(doc, "span", { class: "lens-card-meta" }, chip(doc, kind, "dim"), el(doc, "span", {}, note.folder || note.tags[0] || "根目录")),
	el(doc, "span", { class: "lens-card-meta" }, el(doc, "span", {}, `修改 ${time(note.mtime, true)}`), el(doc, "span", {}, bytes(note.size)), icon(doc, "chevron-right")));
	card.addEventListener("click", () => ctx.openDrawer(note.path));
	return card;
}

function cardDeck(ctx: LensContext, key: string, label: string, cards: HTMLElement[]): HTMLElement {
	const { doc } = ctx;
	const total = cards.length;
	const pages = Math.max(1, Math.ceil(total / CARD_PAGE_SIZE));
	const page = Math.max(0, Math.min(pages - 1, ctx.state.deckPages[key] ?? 0));
	const start = page * CARD_PAGE_SIZE;
	const end = Math.min(total, start + CARD_PAGE_SIZE);
	const turn = (delta: number) => {
		ctx.state.deckPages[key] = page + delta;
		ctx.rerender();
	};
	const prev = button(doc, "← 上一页", { "aria-label": `上一页 · ${label}`, disabled: page === 0 });
	prev.addEventListener("click", () => turn(-1));
	const next = button(doc, "下一页 →", { "aria-label": `下一页 · ${label}`, disabled: page === pages - 1 });
	next.addEventListener("click", () => turn(1));
	return el(doc, "section", {
		class: "lens-card-deck", "data-card-deck": key, "data-card-page": page, "data-card-pages": pages, "data-card-busy": "false",
		"aria-label": label, "aria-roledescription": "分页卡片", tabindex: "0",
	},
	el(doc, "div", { class: "lens-deck-header" }, el(doc, "span", {}, label, el(doc, "small", {}, `${total} 项 · ${total ? start + 1 : 0}–${end}`))),
	el(doc, "div", { class: "lens-deck-window" },
		el(doc, "div", { class: "lens-card-page", "data-direction": "0", "aria-busy": "false" },
			...(total ? cards.slice(start, end) : [el(doc, "p", { class: "lens-card-empty" }, "当前范围没有内容。")]))),
	el(doc, "nav", { class: "lens-deck-controls", "aria-label": `${label}翻页` },
		prev, el(doc, "span", { class: "lens-page-indicator", role: "status", "aria-live": "polite" }, "第 ", el(doc, "b", {}, String(page + 1)), ` / ${pages} 页`), next));
}

/** 目录笔记卡片：搜索 + 子目录芯片 + 分页卡片。 */
export function noteDeck(ctx: LensContext, key: string, label: string, folder: string, kind = label): HTMLElement {
	const { doc } = ctx;
	const all = listNotes(ctx.app, folder, { skipReadme: true });
	const query = (ctx.state.queries[key] ?? "").trim().toLowerCase();
	const filterKey = `${key}:kind`;
	const activeKind = ctx.state.queries[filterKey] ?? "all";
	const groups = new Map<string, number>();
	for (const note of all) {
		const group = note.folder.split("/")[0] || "根目录";
		groups.set(group, (groups.get(group) ?? 0) + 1);
	}
	const matches = all.filter((note) =>
		(activeKind === "all" || (note.folder.split("/")[0] || "根目录") === activeKind)
		&& (!query || `${note.name} ${note.folder} ${note.tags.join(" ")}`.toLowerCase().includes(query)));
	const chips = groups.size > 1 ? el(doc, "div", { class: "lens-kind-chips", role: "group", "aria-label": "按目录筛选" },
		...[["all", "全部", all.length] as const, ...[...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => [name, name, count] as const)]
			.map(([id, name, count]) => {
				const node = el(doc, "button", { type: "button", class: "lens-kind-chip", "aria-pressed": String(activeKind === id) }, name, el(doc, "b", {}, num(count)));
				node.addEventListener("click", () => {
					ctx.state.queries[filterKey] = id;
					ctx.state.deckPages[key] = 0;
					ctx.rerender();
				});
				return node;
			})) : null;
	return el(doc, "div", { class: "lens-note-browser" },
		searchBox(ctx, key, `搜索${label}的标题、目录或标签`),
		chips,
		cardDeck(ctx, key, `${label}卡片`, matches.map((note) => readingCard(ctx, note, kind))));
}

/** 已采集的条目列表（待发、候选等）也用卡片展示，能定位到文件的打开摘要栏。 */
export function signalDeck(ctx: LensContext, key: string, label: string, items: SignalItem[], kind: string): HTMLElement {
	const notes: LensNote[] = items.map((item) => {
		const file = item.path ? ctx.app.vault.getAbstractFileByPath(item.path) : null;
		return file instanceof TFile
			? { path: file.path, name: item.title, folder: item.meta, mtime: file.stat.mtime, size: file.stat.size, tags: [] }
			: { path: item.path ?? "", name: item.title, folder: item.meta, mtime: 0, size: 0, tags: [] };
	});
	return cardDeck(ctx, key, label, notes.map((note) => readingCard(ctx, note, kind)));
}

/** MetricTile 指标用 Lens 的 ov-kpis 指标条呈现。 */
export function metricStrip(ctx: LensContext, metrics: MetricTile[]): HTMLElement {
	const { doc } = ctx;
	const tone = { warn: "warn", hot: "fail", good: "pass", default: "idle" } as const;
	return el(doc, "section", { class: "ov-kpiwrap" }, el(doc, "div", { class: "ov-kpis" }, ...metrics.slice(0, 6).map((m, i) => {
		const node = el(doc, "button", { type: "button", class: "ov-kpi vk-rise", style: `--vk-i:${i}`, "data-missing": String(m.value === "—") },
			el(doc, "span", {}, m.label), el(doc, "strong", {}, m.value), m.sub ? el(doc, "em", { "data-tone": tone[m.tone ?? "default"] }, m.aux || m.sub) : null);
		if (m.path) node.addEventListener("click", () => ctx.openDrawer(m.path!));
		return node;
	})));
}

/** Lens 类型分布行（lens-distribution）。 */
export function distribution(ctx: LensContext, rows: Array<{ name: string; count: number; onClick?: () => void }>, caption: string): LensChild[] {
	const { doc } = ctx;
	const total = rows.reduce((n, r) => n + r.count, 0);
	if (!rows.length || !total) return [el(doc, "p", { class: "lens-query-error" }, "当前范围没有记录。")];
	return [
		el(doc, "div", { class: "lens-distribution" }, ...rows.map((row) => {
			const percent = (row.count / total) * 100;
			const node = el(doc, "button", { type: "button", class: "lens-distribution-row", "aria-label": `${row.name}，${num(row.count)}，占 ${percent.toFixed(1)}%` },
				el(doc, "span", {}, row.name), el(doc, "span", { class: "lens-bar-track" }, el(doc, "i", { style: `width:${percent}%` })),
				el(doc, "b", {}, num(row.count)), el(doc, "small", {}, `${percent.toFixed(1)}%`));
			if (row.onClick) node.addEventListener("click", row.onClick);
			return node;
		})),
		el(doc, "div", { class: "v-caption" }, caption.replace("{total}", num(total))),
	];
}

function libraryMetrics(ctx: LensContext): HTMLElement {
	const d = ctx.data.collected;
	const metric = (label: string, folder: string) => {
		const value = d.knowledge.metrics.find((m) => m.label.includes(label));
		const path = ctx.app.vault.getAbstractFileByPath(folder);
		return value && path && "children" in path ? value : value ? { ...value, value: "—", sub: "目录未找到或不是文件夹" } : undefined;
	};
	const output = d.output.queueStatus === "ready" ? String(d.output.queueTotal ?? 0) : "—";
	const inboxDir = ctx.app.vault.getAbstractFileByPath(ctx.paths.dir("inbox"));
	const inboxReady = !!inboxDir && "children" in inboxDir;
	const missing = (["projects", "assets", "insights", "archive", "logs", "inbox"] as const).filter((key) => {
		const path = ctx.app.vault.getAbstractFileByPath(ctx.paths.dir(key));
		return !path || !("children" in path);
	}).length;
	return metricStrip(ctx, [
		{ label: "知识笔记", value: missing === 6 ? "—" : String(d.total), sub: missing ? `部分统计 · ${missing} 个目录未配置` : d.overview.totalNotes.sub, path: ctx.paths.readme("insights") },
		{ label: "收件积压", value: inboxReady ? String(d.inbox.count) : "—", sub: inboxReady ? `最久 ${d.inbox.oldestDays} 天 · 文件创建时间` : "收件目录未配置", path: ctx.paths.readme("inbox") },
		...(metric("洞察", ctx.paths.dir("insights")) ? [metric("洞察", ctx.paths.dir("insights"))!] : []), ...(metric("素材", ctx.paths.dir("assets")) ? [metric("素材", ctx.paths.dir("assets"))!] : []),
		...(metric("MOC", ctx.paths.mocDir) ? [metric("MOC", ctx.paths.mocDir)!] : []),
		{ label: "待处理输出", value: output, sub: d.output.queueStatus === "missing" ? "来源未配置" : d.output.queueStatus === "format" ? "格式不识别" : d.output.queueStatus === "ready" ? "未完成任务数" : "来源状态未知", path: ctx.paths.outletFile },
	]);
}

export function renderCollect(ctx: LensContext): LensChild[] {
	const host = el(ctx.doc, "div", { class: "talos-lens-native", "aria-label": "收件分诊与积压统计" });
	const inboxDir = ctx.app.vault.getAbstractFileByPath(ctx.paths.dir("inbox"));
	if (inboxDir && "children" in inboxDir) ctx.renderInbox(host);
	else host.appendChild(el(ctx.doc, "p", {}, "收件目录未配置或不是文件夹，请在设置中检查。"));
	return [libraryMetrics(ctx), host];
}

export function renderKnowledge(ctx: LensContext): LensChild[] {
	const { doc } = ctx;
	const d = ctx.data.collected;
	const cells = recentHeatCells(d.heatmap.months);
	const max = Math.max(1, ...cells.map((c) => c.count));
	const missing = (["projects", "assets", "insights", "archive", "logs", "inbox"] as const).filter((key) => {
		const path = ctx.app.vault.getAbstractFileByPath(ctx.paths.dir(key));
		return !path || !("children" in path);
	}).length;
	const strip = libraryMetrics(ctx);
	return [heading(doc, "知识", "资料分布、近期新增和知识入口", "资料"), strip,
		panel(doc, "知识目录分布", [missing ? el(doc, "p", {}, `${missing} 个内容目录未找到；仅统计已找到的目录。`) : null, ...distribution(ctx, d.dist.map((x) => ({ name: x.name, count: x.count, onClick: () => ctx.openDrawer(x.readme) })), missing ? "已找到目录 · 共 {total} 篇" : "配置的六类目录 · 共 {total} 篇")]),
		panel(doc, "资料库模块", distribution(ctx, d.modules.map((m) => ({ name: m.name, count: m.count, onClick: () => ctx.openDrawer(m.readme) })), "含系统与配置 · 共 {total} 篇")),
		panel(doc, "近 14 天创建", [el(doc, "p", {}, "按文件创建时间统计；迁移或复制可能改变日期。"), el(doc, "div", { class: "v-columns" }, ...cells.map((c) => el(doc, "div", { title: `${c.date} · ${c.count} 篇` }, el(doc, "b", {}, String(c.count)), el(doc, "div", { class: "v-column-track" }, el(doc, "span", { style: `height:${(c.count / max) * 100}%` })), el(doc, "span", {}, c.date.slice(5)))))]),
		noteDeck(ctx, "insights", "洞察", ctx.paths.dir("insights")), noteDeck(ctx, "materials", "素材", ctx.paths.dir("assets")), noteDeck(ctx, "moc", "MOC", ctx.paths.mocDir)];
}

export function renderIdentity(ctx: LensContext): LensChild[] {
	const { doc } = ctx;
	const state = ctx.data.collected.setup?.candidatesPath;
	return [heading(doc, "身份与记忆", "身份资料、助手人格与待确认偏好", "系统"),
		panel(doc, "偏好候选", [el(doc, "p", {}, state === "ok" ? `${ctx.data.collected.candidates.length} 条待确认 · 在工作台处理` : state === "format" ? "来源格式不识别" : state === "missing" ? "来源未配置" : "来源状态未知")]),
		noteDeck(ctx, "identity", "身份", ctx.paths.dir("identity")), noteDeck(ctx, "soul", "人格", ctx.paths.dir("soul"))];
}

export function renderOutput(ctx: LensContext): LensChild[] {
	const { doc } = ctx;
	const queue = ctx.data.collected.output.queue;
	const status = ctx.data.collected.output.queueStatus;
	return [heading(doc, "输出", "查看和整理待处理的输出内容", "资料"), libraryMetrics(ctx),
		el(doc, "p", {}, status === "ready" ? `待处理 ${ctx.data.collected.output.queueTotal ?? 0} 项；下方最多展示 8 项。` : status === "missing" ? "输出来源未配置。" : status === "format" ? "输出来源格式不识别。" : "输出来源状态未知。"),
		signalDeck(ctx, "queue", status === "ready" ? "待处理输出" : "来源预览 · 不计入统计", queue, status === "ready" ? "待处理" : "预览")];
}
