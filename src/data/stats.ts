import { App, TFile, normalizePath } from "obsidian";
import { isPendingApprovalStatusLine } from "../approval-actions";
import type { TalosSettings } from "../settings";
import { CONTENT_KEYS, MODULE_KEYS, SCHEMA_LABELS, type VaultPaths } from "./schema";
import { isCandidateContentLine, statisticalMarkdownLines } from "./vault-files";
import type {
	DistBar,
	FocusItem,
	HealthPoint,
	HeatCell,
	HeatMonth,
	ModuleTile,
	SignalItem,
	StatCard,
} from "../types";

const DAY = 86400000;


// 计数排除：嵌套交付副本 / 依赖目录，不算知识笔记
const EXCLUDE = ["/node_modules/", "/客户交付物/", "/交付包/", "/talos-system-promo"];

function isExcluded(path: string): boolean {
	const sp = "/" + path;
	return EXCLUDE.some((x) => sp.includes(x));
}

function notesUnder(app: App, rel: string): TFile[] {
	const prefix = rel + "/";
	return app.vault
		.getMarkdownFiles()
		.filter(
			(f) =>
				(f.path === rel || f.path.startsWith(prefix)) &&
				f.basename !== "_README" &&
				!isExcluded(f.path)
		);
}

function countMd(app: App, rel: string): number {
	return notesUnder(app, rel).length;
}

function relTime(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < DAY) return "today";
	const d = Math.floor(diff / DAY);
	if (d < 30) return `${d}d`;
	if (d < 365) return `${Math.floor(d / 30)}mo`;
	return `${Math.floor(d / 365)}y`;
}

function fmtDate(d: Date): string {
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

function stripMd(s: string): string {
	return (s || "")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_m, p: string) => p.split("/").pop() || p)
		.replace(/\*\*/g, "")
		.replace(/`/g, "")
		.trim();
}

// ---------- 分布 + 模块地图 + 总览 ----------
export function collectDist(app: App, paths: VaultPaths): { dist: DistBar[]; total: number } {
	const dist: DistBar[] = CONTENT_KEYS.map((key) => ({
		name: SCHEMA_LABELS[key],
		count: countMd(app, paths.dir(key)),
		readme: paths.readme(key),
	}));
	return { dist, total: dist.reduce((a, b) => a + b.count, 0) };
}

export function collectModules(app: App, paths: VaultPaths): ModuleTile[] {
	return MODULE_KEYS.map((key) => {
		const rel = paths.dir(key);
		const notes = notesUnder(app, rel);
		let lastMtime = 0;
		let latest: TFile | undefined;
		for (const f of notes) {
			if (f.stat.mtime > lastMtime) {
				lastMtime = f.stat.mtime;
				latest = f;
			}
		}
		const readme = paths.readme(key);
		return {
			name: rel,
			count: notes.length,
			lastChange: lastMtime ? relTime(lastMtime) : "—",
			readme,
			readmeExists: app.vault.getAbstractFileByPath(readme) instanceof TFile,
			latestTitle: latest ? latest.basename : "—",
			latestPath: latest?.path,
		};
	});
}

export function collectOverview(
	app: App,
	paths: VaultPaths,
	total: number,
	inboxCount: number,
	taskFlow: StatCard,
	healthTrend: HealthPoint[]
): {
	totalNotes: StatCard;
	inbox: StatCard;
	taskFlow: StatCard;
	health: StatCard;
} {
	// 收件箱细节
	const inboxNotes = notesUnder(app, paths.dir("inbox"));
	let oldest = 0;
	const now = Date.now();
	for (const f of inboxNotes) {
		const age = Math.floor((now - f.stat.ctime) / DAY);
		if (age > oldest) oldest = age;
	}
	// 本周新增（全库知识笔记）
	const weekAgo = now - 7 * DAY;
	let weekNew = 0;
	for (const key of CONTENT_KEYS) {
		for (const f of notesUnder(app, paths.dir(key))) if (f.stat.ctime >= weekAgo) weekNew++;
	}

	const last = healthTrend.length ? healthTrend[healthTrend.length - 1] : undefined;
	const prev =
		healthTrend.length > 1 ? healthTrend[healthTrend.length - 2] : undefined;
	const hv = last?.score;
	const delta = last && prev ? last.score - prev.score : 0;

	return {
		totalNotes: {
			label: "知识笔记总数",
			value: String(total),
			sub: `近7天 +${weekNew}`,
			tone: "default",
		},
		inbox: {
			label: "收件箱积压",
			value: String(inboxCount),
			sub: inboxCount === 0 ? "已清空 🎉" : `${oldest}d oldest`,
			tone: inboxCount > 30 ? "warn" : "default",
		},
		taskFlow,
		health: {
			label: "健康分",
			value: hv === undefined ? "—" : String(hv),
			sub:
				delta === 0
					? "持平"
					: delta > 0
						? `+${delta} vs 上次`
						: `${delta} vs 上次`,
			tone: delta < 0 ? "warn" : "good",
		},
	};
}

// ---------- 焦点 + 任务流 ----------
export async function collectFocusAndFlow(
	app: App,
	settings: TalosSettings
): Promise<{ focus: FocusItem[]; focusTotal: number; taskFlow: StatCard }> {
	const file = app.vault.getAbstractFileByPath(normalizePath(settings.tasksPath));
	if (!(file instanceof TFile)) {
		return {
			focus: [],
			focusTotal: 0,
			taskFlow: { label: "任务池完成占比", value: "—", sub: "任务池未配置或未找到" },
		};
	}
	const raw = await app.vault.cachedRead(file);
	const lines = statisticalMarkdownLines(raw);

	const focus: FocusItem[] = [];
	let section = "other";
	let done = 0;
	let open = 0;
	let inProgress = 0;
	let focusTotal = 0;

	for (const ln of lines) {
		const h = ln.match(/^##\s*(.+?)\s*$/);
		if (h) {
			const t = h[1] || "";
			section = /焦点/.test(t)
				? "focus"
				: /待办/.test(t)
					? "todo"
					: /已完成/.test(t)
						? "done"
						: "other";
			continue;
		}
		const m = ln.match(/^\s*[-*]\s*(?:\[([ xX~])\]\s*)?(🔴|🟡|🟢|⚫|🔌|🔮|📖|🎯)?\s*(.*)$/);
		if (!m) continue;
		const checked = (m[1] || "").toLowerCase() === "x";
		const prio = m[2] || "";
		const body = m[3] || "";
		if (!body.trim()) continue;
		// 只统计复选框，分子分母均来自同一个文件和同一类条目。
		if (m[1] !== undefined) {
			if (checked) done++;
			else if (m[1] === "~") inProgress++;
			else open++;
		}
		if (section === "focus" && !checked) focusTotal++;

		if (section === "focus" && focus.length < 3 && !checked) {
			const bm = body.match(/\*\*(.+?)\*\*/);
			const title = stripMd(bm ? bm[1] || "" : body.split("|")[0] || body);
			const doneWhenMatch = body.match(
				/\|\s*done_when[:：]\s*(.+?)(?=\s*\|\s*(?:来源|source)[:：]|$)/i
			);
			const doneWhen = stripMd(doneWhenMatch?.[1] || "");
			let desc = body;
			if (bm) desc = body.slice(body.indexOf(bm[0]) + bm[0].length);
			desc = desc.replace(/^\s*[—-]+\s*/, "");
			desc = desc.split(/\s*\|\s*done_when[:：]/)[0] || "";
			desc = stripMd(desc);
			if (desc.length > 80) desc = desc.slice(0, 78) + "…";
			focus.push({
				level: prio === "🔴" ? "hot" : prio === "🟡" ? "warn" : "normal",
				title,
				desc,
				doneWhen,
				path: file.path,
			});
		}
	}

	const totalT = done + open + inProgress;
	const rate = totalT === 0 ? null : Math.round((done / totalT) * 100);
	return {
		focus,
		focusTotal,
		taskFlow: {
			label: "任务池完成占比",
			value: rate === null ? "—" : `${rate}%`,
			sub: totalT === 0 ? "任务池没有可统计的复选框" : `任务池复选框 · 已完成 ${done}/${totalT} · 待办 ${open} · 进行中 ${inProgress}`,
			counts: { done, open, inProgress, total: totalT },
			tone: rate === null ? "default" : rate >= 50 ? "good" : "warn",
		},
	};
}

// ---------- 待审批 ----------
export async function collectApprovals(
	app: App,
	settings: TalosSettings
): Promise<SignalItem[]> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.pendingApprovalsPath)
	);
	if (!(file instanceof TFile)) return [];
	const text = statisticalMarkdownLines(await app.vault.read(file)).join("\n");
	const m = text.match(
		/## 当前待审批([\s\S]*?)(?:\n### 后续候选|\n## 保留观察项|\n## 已解决|$)/
	);
	const section = m ? m[1] || "" : "";
	const out: SignalItem[] = [];
	let curTitle = "待审批提案";
	for (const ln of section.split("\n")) {
		const h = ln.match(/^###\s+(.*)$/);
		if (h) curTitle = stripMd(h[1] || "");
		if (isPendingApprovalStatusLine(ln)) {
			out.push({ title: curTitle, meta: "待审批", path: file.path });
		}
	}
	return out;
}

// ---------- 偏好候选 ----------
export async function collectCandidates(
	app: App,
	settings: TalosSettings
): Promise<SignalItem[]> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.candidatesPath)
	);
	if (!(file instanceof TFile)) return [];
	const lines = statisticalMarkdownLines(await app.vault.cachedRead(file));
	const out: SignalItem[] = [];
	let inside = false;
	for (const ln of lines) {
		if (ln.startsWith("## ")) {
			inside = ln.includes("待确认");
			continue;
		}
		if (!inside) continue;
		const s = ln.trim();
		if (ln === ln.trimStart() && isCandidateContentLine(s)) {
			out.push({ title: stripMd(s.slice(2)), meta: "待确认", path: file.path });
		}
	}
	return out;
}

// ---------- 健康分趋势 ----------
export interface HealthHistoryEntry {
	date: string;
	score: number;
}

/**
 * 健康历史的唯一解析口径。有效日期按完整日期升序，同日按文件原顺序保留；
 * 因此同日最后一条作为最新记录。无标记的旧日志继续识别日期/分数表。
 */
export function parseHealthHistory(text: string): HealthHistoryEntry[] {
	const block = text.match(/<!-- EVAL_HISTORY -->([\s\S]*?)<!-- EVAL_HISTORY_END -->/);
	if (!block && /<!-- EVAL_HISTORY(?:_END)? -->/.test(text)) return [];
	const source = block ? block[1] ?? "" : text;
	const records: Array<HealthHistoryEntry & { sourceIndex: number }> = [];
	for (const [sourceIndex, row] of source.split("\n").entries()) {
		const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
		if (cells.length < 2) continue;
		const dateMatch = cells[0].match(/(?:^|\D)(\d{4}-\d{2}-\d{2})(?:\D|$)/);
		const scoreMatch = cells[1].match(/^(\d+(?:\.\d+)?)(?:\s*(?:\/\s*100|分|%))?$/);
		if (!dateMatch || !scoreMatch) continue;
		const date = dateMatch[1];
		const parsedDate = new Date(`${date}T00:00:00Z`);
		if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) continue;
		const score = Number(scoreMatch[1]);
		if (!Number.isFinite(score)) continue;
		records.push({ date, score, sourceIndex });
	}
	return records.sort((a, b) => a.date.localeCompare(b.date) || a.sourceIndex - b.sourceIndex)
		.map(({ date, score }) => ({ date, score }));
}

export async function collectHealthTrend(
	app: App,
	settings: TalosSettings,
	n = 9
): Promise<HealthPoint[]> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.healthLogPath)
	);
	if (!(file instanceof TFile)) return [];
	const history = parseHealthHistory(await app.vault.cachedRead(file));
	if (n <= 0) return [];
	return history.slice(-n).map(({ date, score }) => ({ label: date, score }));
}

// ---------- 热力图（全库） ----------
export function collectHeatmap(app: App): { meta: string; months: HeatMonth[] } {
	const counts = new Map<string, number>();
	for (const f of app.vault.getMarkdownFiles()) {
		if (isExcluded(f.path)) continue;
		const key = fmtDate(new Date(f.stat.ctime));
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	const level = (c: number): HeatCell["level"] =>
		c <= 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 9 ? 3 : 4;

	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
	const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
	const months: HeatMonth[] = [];
	let activeDays = 0;

	for (let i = 0; i < 12; i++) {
		const cur = new Date(start.getFullYear(), start.getMonth() + i, 1);
		const year = cur.getFullYear();
		const month = cur.getMonth();
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const weeks: HeatCell[][] = [];
		let week: HeatCell[] = [];
		const firstWeekday = new Date(year, month, 1).getDay();
		for (let p = 0; p < firstWeekday; p++) week.push({ date: "", count: -1, level: 0 });
		for (let d = 1; d <= daysInMonth; d++) {
			const date = new Date(year, month, d);
			const c = counts.get(fmtDate(date)) || 0;
			if (c > 0) activeDays++;
			week.push({ date: fmtDate(date), count: c, level: level(c) });
			if (date.getDay() === 6) {
				weeks.push(week);
				week = [];
			}
		}
		if (week.length) weeks.push(week);
		months.push({ label: monthNames[month] || "", weeks });
	}
	const first = `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
	const last = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
	return { meta: `${activeDays} active days · ${first} – ${last}`, months };
}
