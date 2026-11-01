import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { TalosSettings } from "../settings";
import type { VaultPaths } from "./schema";
import { statisticalMarkdownLines } from "./vault-files";
import { parseHealthHistory } from "./stats";
import { INBOX_FALLBACK_TOPIC, INBOX_TOPIC_RULES, classifyInboxTopic } from "../inbox-triage";
import type {
	HealthDigest,
	InboxAgeBucket,
	InboxCluster,
	InboxDigest,
	InboxQueueItem,
	KnowledgeHub,
	MetricTile,
	OutputCenter,
	OutputPlatform,
	ProjectScene,
	SignalItem,
	TalosModule,
	TalosProduct,
} from "../types";

const DAY = 86400000;
const EXCLUDE = ["/node_modules/", "/客户交付物/", "/交付包/", "/talos-system-promo"];
const OUTPUT_PLATFORMS = ["抖音", "小红书", "X", "公众号", "知识星球"];

function isExcluded(path: string): boolean {
	const sp = "/" + path;
	return EXCLUDE.some((x) => sp.includes(x));
}

function stripMd(s: string): string {
	return (s || "")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_m, p: string) => p.split("/").pop() || p)
		.replace(/\*\*/g, "")
		.replace(/`/g, "")
		.replace(/^[-*]\s*/, "")
		.trim();
}

function notesUnder(app: App, rel: string): TFile[] {
	const prefix = normalizePath(rel) + "/";
	return app.vault
		.getMarkdownFiles()
		.filter(
			(f) =>
				(f.path.startsWith(prefix) || f.path === rel) &&
				f.basename !== "_README" &&
				!isExcluded(f.path)
		);
}

function readmeFor(rel: string): string {
	return `${normalizePath(rel)}/_README.md`;
}

function titleFor(app: App, file: TFile): string {
	const fm: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
	const title =
		typeof fm === "object" && fm !== null && "title" in fm
			? (fm as Record<string, unknown>).title
			: undefined;
	return typeof title === "string" && title.trim() ? title.trim() : file.basename;
}

function latestOf(app: App, rel: string): TFile | undefined {
	const notes = notesUnder(app, rel);
	return notes.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
}

function daysOld(ms: number): number {
	return Math.max(0, Math.floor((Date.now() - ms) / DAY));
}

async function readFile(app: App, path: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	if (!(file instanceof TFile)) return "";
	return await app.vault.cachedRead(file);
}

function resolveWiki(app: App, raw: string): string | undefined {
	const clean = raw.split("|")[0]?.split("#")[0]?.trim();
	if (!clean) return undefined;
	const direct = clean.endsWith(".md") ? clean : `${clean}.md`;
	if (app.vault.getAbstractFileByPath(direct) instanceof TFile) return direct;
	const base = direct.split("/").pop()?.replace(/\.md$/, "");
	if (!base) return direct;
	return app.vault.getMarkdownFiles().find((f) => f.basename === base)?.path || direct;
}

/** 旧版出口未使用复选框时保留原有链接预览；它不是待处理统计。 */
function previewOutputLinks(app: App, text: string, fallbackPath: string): SignalItem[] {
	const seen = new Set<string>();
	const items: SignalItem[] = [];
	for (const line of statisticalMarkdownLines(text)) {
		if (/^\s*[-*]\s+\[[ xX~]\]/.test(line)) continue;
		for (const match of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
			const path = resolveWiki(app, match[1] || "") || fallbackPath;
			const title = stripMd(line).slice(0, 80);
			const key = `${path}:${title}`;
			if (!title || seen.has(key)) continue;
			seen.add(key);
			items.push({ title, meta: "来源预览 · 未计入统计", path });
			if (items.length >= 8) return items;
		}
	}
	return items;
}

/** 按表格列拆分，保留双链别名和转义竖线，避免把一条内容拆成多列。 */
function outputTableCells(line: string): string[] | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
	const cells: string[] = [];
	let current = "";
	let wiki = false;
	let code = false;
	for (let i = 1; i < trimmed.length - 1; i++) {
		const char = trimmed[i];
		if (char === "\\" && i + 1 < trimmed.length - 1) {
			current += char + trimmed[++i];
			continue;
		}
		if (!code && trimmed.slice(i, i + 2) === "[[") { wiki = true; current += "[["; i++; continue; }
		if (wiki && trimmed.slice(i, i + 2) === "]]" ) { wiki = false; current += "]]"; i++; continue; }
		if (!wiki && char === "`") code = !code;
		if (char === "|" && !wiki && !code) { cells.push(current.trim()); current = ""; continue; }
		current += char;
	}
	if (wiki || code) return null;
	cells.push(current.trim());
	return cells;
}

/** 仅统计标准模板的明确待发队列；今日指针与说明不计入队列。 */
function outputQueueTable(app: App, text: string, fallbackPath: string): { recognized: boolean; ambiguous: boolean; items: SignalItem[] } | null {
	const lines = statisticalMarkdownLines(text);
	const heading = (line: string) => line.match(/^##\s+(.+?)\s*$/)?.[1] || "";
	const queueName = (title: string) => /^(?:[^\p{L}\p{N}]*\s*)?待发队列(?:\s*[（(].*[）)])?\s*$/u.test(title);
	const starts = lines.map((line, i) => queueName(heading(line)) ? i : -1).filter((i) => i >= 0);
	if (!starts.length) return null;
	if (starts.length !== 1) return { recognized: false, ambiguous: true, items: [] };
	const start = starts[0];
	let end = lines.findIndex((line, i) => i > start && Boolean(heading(line)));
	if (end < 0) end = lines.length;
	const tableLines = lines.slice(start + 1, end).filter((line) => /^\s*\|/.test(line));
	const expected = ["内容", "平台", "成熟度", "备注"];
	const header = tableLines.length ? outputTableCells(tableLines[0]) : null;
	const separator = tableLines.length > 1 ? outputTableCells(tableLines[1]) : null;
	if (!header || header.length !== expected.length || header.some((cell, i) => cell !== expected[i]) ||
		!separator || separator.length !== expected.length || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
		return { recognized: false, ambiguous: true, items: [] };
	}
	let ambiguous = false;
	const items: SignalItem[] = [];
	const empty = (cell: string) => /^(?:|[-—–]|暂无|无|空|（无）|\(无\))$/.test(cell.trim());
	for (const line of lines.slice(start + 1, end)) {
		if (/^\s*[-*]\s+\S/.test(line)) ambiguous = true;
	}
	for (const line of tableLines.slice(2)) {
		const cells = outputTableCells(line);
		if (!cells || cells.length !== expected.length) { ambiguous = true; continue; }
		if (cells.every(empty)) continue;
		if (empty(cells[0]) || empty(cells[1]) || /已发布|published|已完成/i.test(cells.slice(1).join(" "))) { ambiguous = true; continue; }
		const body = cells[0];
		const target = body.match(/\[\[([^\]]+)\]\]/)?.[1];
		const title = stripMd(body).slice(0, 80);
		if (!title) { ambiguous = true; continue; }
		items.push({ title, meta: "待处理", path: target ? resolveWiki(app, target) || fallbackPath : fallbackPath });
	}
	let section = "";
	for (let i = 0; i < lines.length; i++) {
		const title = heading(lines[i]);
		if (title) { section = title; continue; }
		if (i > start && i < end) continue;
		if (/^(?:[^\p{L}\p{N}]*\s*)?(?:今日待发|发布后回填|队列纪律)(?:\s*[（(].*[）)])?\s*$/u.test(section)) continue;
		if (/^\s*[-*]\s+\S/.test(lines[i]) || /^\s*\|.*\|\s*$/.test(lines[i])) ambiguous = true;
	}
	return { recognized: true, ambiguous, items };
}

/** 仅将明确的 Markdown 复选框计为任务；每一行只计一次。 */
function outputTasks(app: App, text: string, fallbackPath: string): { recognized: boolean; ambiguous: boolean; items: SignalItem[] } {
	const table = outputQueueTable(app, text, fallbackPath);
	if (table) return table;
	const items: SignalItem[] = [];
	let recognized = false;
	let ambiguous = false;
	for (const line of statisticalMarkdownLines(text)) {
		const match = line.match(/^\s*[-*]\s+\[([ xX~])\]\s+(.+?)\s*$/);
		if (!match) {
			// 非复选框列表和数据表可能仍是待办，不能据此宣称总数完整。
			if (/^\s*[-*]\s+\S/.test(line) || /^\s*\|.*\|\s*$/.test(line)) ambiguous = true;
			continue;
		}
		recognized = true;
		if ((match[1] || "").toLowerCase() === "x") continue;
		const body = match[2] || "";
		const target = body.match(/\[\[([^\]]+)\]\]/)?.[1];
		items.push({ title: stripMd(body).slice(0, 80), meta: "待处理", path: target ? resolveWiki(app, target) || fallbackPath : fallbackPath });
	}
	return { recognized, ambiguous, items };
}

function bulletItems(text: string, path: string, limit = 6): SignalItem[] {
	const out: SignalItem[] = [];
	for (const line of text.split("\n")) {
		const m = line.match(/^\s*-\s+(.*)$/);
		if (!m) continue;
		const title = stripMd(m[1] || "");
		if (!title || title.includes("无）") || title.includes("空）")) continue;
		out.push({ title: title.slice(0, 90), meta: "待处理", path });
		if (out.length >= limit) break;
	}
	return out;
}

function isPublished(app: App, file: TFile): boolean {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!fm) return false;
	const status = String(fm.status || "").toLowerCase();
	return (
		/published|已发布/.test(status) ||
		Boolean(fm.publish_url || fm.publishUrl || fm.publish_date || fm.url)
	);
}

export async function collectOutputCenter(app: App, paths: VaultPaths): Promise<OutputCenter> {
	const outletPath = paths.outletFile;
	const opsPath = paths.opsCandidatesFile;
	const outletFile = app.vault.getAbstractFileByPath(normalizePath(outletPath));
	const outlet = outletFile instanceof TFile ? await app.vault.cachedRead(outletFile) : "";
	const parsed = outputTasks(app, outlet, outletPath);
	const queueStatus = !(outletFile instanceof TFile) ? "missing" : parsed.recognized && !parsed.ambiguous ? "ready" : "format";
	const queueTotal = queueStatus === "ready" ? parsed.items.length : undefined;
	const queue = queueStatus === "format"
		? [...parsed.items.map((item) => ({ ...item, meta: "来源预览 · 未计入统计" })), ...previewOutputLinks(app, outlet, outletPath)].slice(0, 8)
		: parsed.items.slice(0, 8);
	const opsCandidates = bulletItems(await readFile(app, opsPath), opsPath, 6);

	const platforms: OutputPlatform[] = OUTPUT_PLATFORMS.map((name) => {
		const rel = paths.outputPlatform(name);
		const notes = notesUnder(app, rel);
		const latest = latestOf(app, rel);
		const published = notes.filter((f) => isPublished(app, f)).length;
		return {
			name,
			count: notes.length,
			published,
			pending: Math.max(0, notes.length - published),
			readme: readmeFor(rel),
			latestTitle: latest ? titleFor(app, latest) : "—",
			latestPath: latest?.path,
		};
	});

	const total = platforms.reduce((sum, p) => sum + p.count, 0);
	const published = platforms.reduce((sum, p) => sum + p.published, 0);
	const metrics: MetricTile[] = [
		{
			label: "待处理输出",
			value: queueTotal === undefined ? "—" : String(queueTotal),
			sub: queueStatus === "missing" ? "输出文件未配置或未找到" : queueStatus === "format" ? "格式不识别，仅统计复选框任务" : "输出文件中未完成的复选框任务",
			path: outletPath,
			tone: queue.length > 0 ? "hot" : "good",
		},
		{
			label: "平台稿件",
			value: String(total),
			sub: `${published} 已发布 · ${Math.max(0, total - published)} 待闭环`,
			path: paths.readme("output"),
			tone: total > published ? "warn" : "good",
		},
		{
			label: "运营候选",
			value: String(opsCandidates.length),
			sub: "发布后沉淀的待确认信号",
			path: opsPath,
			tone: opsCandidates.length > 0 ? "warn" : "default",
		},
	];

	return { metrics, queue, queueTotal, queueStatus, platforms, opsCandidates };
}

export async function collectInboxDigest(app: App, settings: TalosSettings): Promise<InboxDigest> {
	const notes = notesUnder(app, settings.inboxFolder);
	let oldestDays = 0;
	const clusters: InboxCluster[] = [
		...INBOX_TOPIC_RULES.map((rule) => ({ name: rule.name, count: 0, hint: rule.hint })),
		{ name: INBOX_FALLBACK_TOPIC.name, count: 0, hint: INBOX_FALLBACK_TOPIC.hint },
	];
	const addCluster = (index: number) => {
		const cluster = clusters[index];
		if (cluster) cluster.count++;
	};
	const ageBuckets: InboxAgeBucket[] = [
		{ label: "0–3d", count: 0, tone: "info" },
		{ label: "4–7d", count: 0, tone: "good" },
		{ label: "8–14d", count: 0, tone: "warn" },
		{ label: ">14d", count: 0, tone: "hot" },
	];
	for (const f of notes) {
		const age = daysOld(f.stat.ctime);
		oldestDays = Math.max(oldestDays, age);
		const bucket = age <= 3 ? ageBuckets[0] : age <= 7 ? ageBuckets[1] : age <= 14 ? ageBuckets[2] : ageBuckets[3];
		if (bucket) bucket.count++;
		addCluster(classifyInboxTopic(`${f.basename} ${titleFor(app, f)}`));
	}
	const recent = notes
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, 8)
		.map((f) => ({
			title: titleFor(app, f),
			meta: `${daysOld(f.stat.ctime)}d · ${f.path}`,
			path: f.path,
		}));
	const queue = collectInboxQueue(app, notes, settings.inboxFolder);
	return { count: notes.length, oldestDays, clusters: clusters.filter((c) => c.count > 0), recent, ageBuckets, queue };
}

export const INBOX_QUEUE_LIMIT = 30;

function tagsFor(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	const raw: unknown = cache?.frontmatter?.tags;
	const fromFrontmatter = Array.isArray(raw)
		? raw.filter((tag): tag is string => typeof tag === "string")
		: typeof raw === "string" ? raw.split(/[,\s]+/) : [];
	const inline = (cache?.tags ?? []).map((tag) => tag.tag);
	return [...new Set([...fromFrontmatter, ...inline].map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))].slice(0, 6);
}

/** 待分诊队列：最早进入的在前；相关笔记只读 Obsidian 已解析的链接图，不扫正文。 */
function collectInboxQueue(app: App, notes: TFile[], inboxFolder: string): InboxQueueItem[] {
	const inboxPrefix = `${normalizePath(inboxFolder)}/`;
	const picked = [...notes].sort((a, b) => a.stat.ctime - b.stat.ctime).slice(0, INBOX_QUEUE_LIMIT);
	const wanted = new Set(picked.map((file) => file.path));
	const linked = new Map<string, string[]>();
	const remember = (note: string, other: string) => {
		if (other === note || other.startsWith(inboxPrefix) || isExcluded(other)) return;
		const list = linked.get(note) ?? [];
		if (list.length < 3 && !list.includes(other)) linked.set(note, [...list, other]);
	};
	const resolved = app.metadataCache.resolvedLinks ?? {};
	for (const [source, targets] of Object.entries(resolved)) {
		if (wanted.has(source)) for (const target of Object.keys(targets)) remember(source, target);
		for (const target of Object.keys(targets)) if (wanted.has(target)) remember(target, source);
	}
	return picked.map((file) => ({
		path: file.path,
		title: titleFor(app, file),
		ageDays: daysOld(file.stat.ctime),
		tags: tagsFor(app, file),
		linked: linked.get(file.path) ?? [],
	}));
}

export async function collectHealthDigest(
	app: App,
	paths: VaultPaths,
	settings: TalosSettings,
	approvals: SignalItem[],
	candidates: SignalItem[]
): Promise<HealthDigest> {
	const healthLog = await readFile(app, settings.healthLogPath);
	const errPath = paths.errorPatternsFile;
	const loopPath = paths.loopHealthFile;
	const errors = bulletItems(await readFile(app, errPath), errPath, 6);
	const loopRows = (await readFile(app, loopPath))
		.split("\n")
		.filter((line) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(line))
		.slice(-4)
		.map((line) => {
			const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
			return {
				title: cells.slice(0, 4).join(" · "),
				meta: "循环健康",
				path: loopPath,
		};
	});
	const broken = healthLog.match(/断链[^\d]*(\d+)/)?.[1] || "—";
	const latest = parseHealthHistory(healthLog).at(-1);
	const latestScore = latest ? String(latest.score) : "—";
	const metrics: MetricTile[] = [
		{
			label: "健康分",
			value: latestScore,
			sub: latest ? `健康日志最近记录 · ${latest.date}` : "健康日志无有效记录",
			path: settings.healthLogPath,
			tone: latestScore === "—" || Number(latestScore) < 90 ? "warn" : "good",
		},
		{
			label: "待审批",
			value: String(approvals.length),
			sub: "B/C 类变更需要你确认",
			path: settings.pendingApprovalsPath,
			tone: approvals.length > 0 ? "warn" : "good",
		},
		{
			label: "偏好候选",
			value: String(candidates.length),
			sub: "候选池待晋升",
			path: settings.candidatesPath,
			tone: candidates.length > 0 ? "warn" : "good",
		},
		{
			label: "断链",
			value: broken,
			sub: "最近健康报告摘取",
			path: settings.healthLogPath,
			tone: broken !== "—" && Number(broken) > 0 ? "warn" : "good",
		},
	];
	return { metrics, errors, loopStatus: loopRows };
}

/** 单项目任务进度：读最近改动的 md（上限 40 个，防爆量），统计复选框完成率 */
async function projectProgress(
	app: App,
	folderPath: string
): Promise<ProjectScene["progress"]> {
	const allFiles = notesUnder(app, folderPath).sort((a, b) => b.stat.mtime - a.stat.mtime);
	const files = allFiles.slice(0, 40);
	let done = 0;
	let total = 0;
	await Promise.all(
		files.map(async (f) => {
			const raw = await app.vault.cachedRead(f);
			const boxes = statisticalMarkdownLines(raw).join("\n").match(/^\s*[-*]\s+\[[ xX~]\]/gm);
			if (!boxes) return;
			total += boxes.length;
			done += boxes.filter((b) => /\[x\]/i.test(b)).length;
		})
	);
	return total > 0 ? { done, total, sampled: allFiles.length > files.length, scannedFiles: files.length, totalFiles: allFiles.length } : undefined;
}

export async function collectProjectScenes(app: App, paths: VaultPaths): Promise<ProjectScene[]> {
	const root = app.vault.getAbstractFileByPath(paths.dir("projects"));
	if (!(root instanceof TFolder)) return [];
	const folders: TFolder[] = [];
	for (const item of root.children) {
		if (item instanceof TFolder) folders.push(item);
	}
	const scenes = await Promise.all(
		folders.map(async (folder) => {
			const latest = latestOf(app, folder.path);
			const name = folder.name;
			// 旧字段仅为兼容；目录名称不能推断项目优先级。
			const priority: ProjectScene["priority"] = "p1";
			return {
				name,
				count: notesUnder(app, folder.path).length,
				status: latest ? "有更新记录" : "暂无更新记录",
				readme: readmeFor(folder.path),
				latestTitle: latest ? titleFor(app, latest) : "—",
				latestPath: latest?.path,
				latestMtime: latest?.stat.mtime,
				priority,
				progress: await projectProgress(app, folder.path),
			};
		})
	);
	return scenes.sort((a, b) => (b.latestMtime || 0) - (a.latestMtime || 0) || a.name.localeCompare(b.name));
}

export function collectKnowledgeHub(app: App, paths: VaultPaths): KnowledgeHub {
	const mocs = notesUnder(app, paths.mocDir)
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.map((f) => ({ title: titleFor(app, f), meta: "MOC", path: f.path }));
	const recentInsights = notesUnder(app, paths.dir("insights"))
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, 8)
		.map((f) => ({ title: titleFor(app, f), meta: "原创洞察", path: f.path }));
	const recentMaterials = notesUnder(app, paths.dir("assets"))
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, 8)
		.map((f) => ({ title: titleFor(app, f), meta: "外部素材", path: f.path }));
	const metrics: MetricTile[] = [
		{
			label: "MOC 枢纽",
			value: String(mocs.length),
			sub: "概念入口",
			path: paths.mocReadme,
			tone: "good",
		},
		{
			label: "原创洞察",
			value: String(notesUnder(app, paths.dir("insights")).length),
			sub: paths.dir("insights"),
			path: paths.readme("insights"),
			tone: "default",
		},
		{
			label: "外部素材",
			value: String(notesUnder(app, paths.dir("assets")).length),
			sub: paths.dir("assets"),
			path: paths.readme("assets"),
			tone: "default",
		},
	];
	return { metrics, mocs, recentInsights, recentMaterials };
}

export function collectTalosProduct(app: App, paths: VaultPaths): TalosProduct {
	const root = app.vault.getAbstractFileByPath(paths.talosProjectDir);
	const modules: TalosModule[] = [];
	if (root instanceof TFolder) {
		for (const child of root.children) {
			if (!(child instanceof TFolder)) continue;
			const latest = latestOf(app, child.path);
			modules.push({
				name: child.name.replace(/^\d+-/, ""),
				count: notesUnder(app, child.path).length,
				readme: readmeFor(child.path),
				latestTitle: latest ? titleFor(app, latest) : "—",
				latestPath: latest?.path,
			});
		}
	}
	modules.sort((a, b) => a.readme.localeCompare(b.readme));
	const total = modules.reduce((sum, m) => sum + m.count, 0);
	const delivery = modules.find((m) => /交付|SOP/.test(m.name));
	const consoleMod = modules.find((m) => /控制台/.test(m.name));
	const metrics: MetricTile[] = [
		{
			label: "TALOS 资产",
			value: String(total),
			sub: `${modules.length} 个产品分区`,
			path: `${paths.talosProjectDir}/_README.md`,
			tone: "default",
		},
		{
			label: "交付 SOP",
			value: String(delivery?.count ?? 0),
			sub: "B 端交付资产",
			path: delivery?.readme || `${paths.talosProjectDir}/_README.md`,
			tone: "good",
		},
		{
			label: "控制台",
			value: String(consoleMod?.count ?? 0),
			sub: "插件与仪表盘",
			path: consoleMod?.readme || `${paths.talosProjectDir}/_README.md`,
			tone: "warn",
		},
	];
	return { metrics, modules };
}
