import { App, TFile, normalizePath } from "obsidian";
import { isPendingApprovalStatusLine } from "../approval-actions";
import type { TalosSettings } from "../settings";
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

// 六大内容目录（知识笔记口径，与 refresh-dashboard.py 一致）：显示名 -> 相对路径
const CONTENT_DIRS: [string, string][] = [
	["项目", "04-项目"],
	["素材", "03-素材"],
	["洞察", "02-洞察"],
	["归档", "05-归档"],
	["日志", "01-日志"],
	["收件箱", "00-收件箱"],
];

// 全部系统模块（顶层组织/器官）
const SYSTEM_MODULES: string[] = [
	"00-收件箱", "01-日志", "02-洞察", "03-素材", "04-项目", "05-归档",
	"Identity", "灵魂", "输出", "System", "模板", "自动化", "配置",
];

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
export function collectDist(app: App): { dist: DistBar[]; total: number } {
	const dist: DistBar[] = CONTENT_DIRS.map(([name, rel]) => ({
		name,
		count: countMd(app, rel),
		readme: `${rel}/_README.md`,
	}));
	return { dist, total: dist.reduce((a, b) => a + b.count, 0) };
}

export function collectModules(app: App): ModuleTile[] {
	return SYSTEM_MODULES.map((rel) => {
		const notes = notesUnder(app, rel);
		let lastMtime = 0;
		let latest: TFile | undefined;
		for (const f of notes) {
			if (f.stat.mtime > lastMtime) {
				lastMtime = f.stat.mtime;
				latest = f;
			}
		}
		const readme = `${rel}/_README.md`;
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
	const inboxNotes = notesUnder(app, "00-收件箱");
	let oldest = 0;
	const now = Date.now();
	for (const f of inboxNotes) {
		const age = Math.floor((now - f.stat.ctime) / DAY);
		if (age > oldest) oldest = age;
	}
	// 本周新增（全库知识笔记）
	const weekAgo = now - 7 * DAY;
	let weekNew = 0;
	for (const [, rel] of CONTENT_DIRS) {
		for (const f of notesUnder(app, rel)) if (f.stat.ctime >= weekAgo) weekNew++;
	}

	const last = healthTrend.length ? healthTrend[healthTrend.length - 1] : undefined;
	const prev =
		healthTrend.length > 1 ? healthTrend[healthTrend.length - 2] : undefined;
	const hv = last ? last.score : 0;
	const delta = last && prev ? last.score - prev.score : 0;

	return {
		totalNotes: {
			label: "知识笔记总数",
			value: String(total),
			sub: `六大内容目录 · 本周 +${weekNew}`,
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
			value: hv ? String(hv) : "—",
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
): Promise<{ focus: FocusItem[]; taskFlow: StatCard }> {
	const file = app.vault.getAbstractFileByPath(normalizePath(settings.tasksPath));
	if (!(file instanceof TFile)) {
		return {
			focus: [],
			taskFlow: { label: "任务流", value: "—", sub: "tasks.md 未找到" },
		};
	}
	const raw = await app.vault.cachedRead(file);
	const lines = raw.split("\n");

	const focus: FocusItem[] = [];
	let section = "other";
	let done = 0;
	let open = 0;

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
		const m = ln.match(/^-\s*(?:\[([ xX])\]\s*)?(🔴|🟡|🟢|⚫|🔌|🔮|📖|🎯)?\s*(.*)$/);
		if (!m) continue;
		const checked = (m[1] || "").toLowerCase() === "x";
		const prio = m[2] || "";
		const body = m[3] || "";
		if (!body.trim()) continue;
		if (checked) done++;
		else if (section === "focus" || section === "todo") open++;

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

	const totalT = done + open;
	const rate = totalT === 0 ? 0 : Math.round((done / totalT) * 100);
	return {
		focus,
		taskFlow: {
			label: "任务流",
			value: `${rate}%`,
			sub: `${focus.length} 焦点 · ${open} open · ${done} done`,
			tone: rate >= 50 ? "good" : "warn",
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
	const text = await app.vault.read(file);
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
	const lines = (await app.vault.cachedRead(file)).split("\n");
	const out: SignalItem[] = [];
	let inside = false;
	for (const ln of lines) {
		if (ln.startsWith("## ")) {
			inside = ln.includes("待确认");
			continue;
		}
		if (!inside) continue;
		const s = ln.trim();
		if (s.startsWith("- ") && !s.includes("（无）") && !s.includes("（空）")) {
			out.push({ title: stripMd(s.slice(2)).slice(0, 70), meta: "待确认", path: file.path });
		}
	}
	return out;
}

// ---------- 健康分趋势 ----------
export async function collectHealthTrend(
	app: App,
	settings: TalosSettings,
	n = 9
): Promise<HealthPoint[]> {
	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.healthLogPath)
	);
	if (!(file instanceof TFile)) return [];
	const text = await app.vault.cachedRead(file);
	const m = text.match(/<!-- EVAL_HISTORY -->([\s\S]*?)<!-- EVAL_HISTORY_END -->/);
	if (!m) return [];
	const out: HealthPoint[] = [];
	for (const row of (m[1] || "").split("\n")) {
		const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
		if (cells.length < 2) continue;
		const dm = (cells[0] || "").match(/(\d{4})-(\d{2})-(\d{2})/);
		if (!dm) continue;
		const score = parseInt(cells[1] || "", 10);
		if (isNaN(score)) continue;
		out.push({ label: `${Number(dm[2])}/${Number(dm[3])}`, score });
	}
	return out.slice(-n);
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
