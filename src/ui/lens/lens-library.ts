// Lens 的资料浏览样式：搜索框 → 分类芯片 → 分页卡片（lens-card-deck，每页 6 张）→ 点击右侧摘要栏。
// 收集 / 知识 / 身份 / 输出 / 执行节奏的笔记列表都走这一套。
import { TFile } from "obsidian";
import type { HeatMonth, MetricTile, SignalItem } from "../../types";
import { button, chip, el, icon, type LensChild } from "./lens-dom";
import { bytes, num, time } from "./lens-format";
import type { LensNote } from "./lens-data";
import type { LensContext } from "./lens-pages";

const CARD_PAGE_SIZE = 6;

/** Last 14 calendar days in local time; heatmap grids may include future cells. */
export function recentHeatCells(months: HeatMonth[], now = new Date()) {
	const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	return months.flatMap((m) => m.weeks.flat()).filter((c) => c.date && c.date <= date)
		.sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
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
