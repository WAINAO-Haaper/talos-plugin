import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { TalosSettings } from "../settings";
import type { VaultPaths } from "./schema";
import type {
	HealthDigest,
	InboxAgeBucket,
	InboxCluster,
	InboxDigest,
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

function extractWikiItems(app: App, text: string, fallbackPath: string, limit = 8): SignalItem[] {
	const seen = new Set<string>();
	const out: SignalItem[] = [];
	for (const line of text.split("\n")) {
		if (!line.includes("[[")) continue;
		const matches = [...line.matchAll(/\[\[([^\]]+)\]\]/g)];
		for (const match of matches) {
			const target = match[1] || "";
			const path = resolveWiki(app, target) || fallbackPath;
			const title = stripMd(line).slice(0, 80);
			const key = `${path}:${title}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ title: title || stripMd(target), meta: "待处理", path });
			if (out.length >= limit) return out;
		}
	}
	return out;
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
	const outlet = await readFile(app, outletPath);
	const queue = extractWikiItems(app, outlet, outletPath, 8);
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
			label: "今日待发",
			value: String(queue.length),
			sub: "统一出口里的待处理条目",
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

	return { metrics, queue, platforms, opsCandidates };
}

export async function collectInboxDigest(app: App, settings: TalosSettings): Promise<InboxDigest> {
	const notes = notesUnder(app, settings.inboxFolder);
	let oldestDays = 0;
	const clusters: InboxCluster[] = [
		{ name: "Loop / 循环工程", count: 0, hint: "适合进洞察或素材聚类" },
		{ name: "微信同步", count: 0, hint: "适合沉淀为自动化模块" },
		{ name: "AI 控制台", count: 0, hint: "适合回流 TALOS 插件" },
		{ name: "Agent 工程", count: 0, hint: "适合进 Claude / Agent 素材" },
		{ name: "其他", count: 0, hint: "需要人工判断" },
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
		const text = `${f.basename} ${titleFor(app, f)}`;
		if (/loop|循环/i.test(text)) addCluster(0);
		else if (/微信|黑曜石|同步/.test(text)) addCluster(1);
		else if (/控制台|仪表盘|talos/i.test(text)) addCluster(2);
		else if (/agent|claude|工程/i.test(text)) addCluster(3);
		else addCluster(4);
	}
	const recent = notes
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, 8)
		.map((f) => ({
			title: titleFor(app, f),
			meta: `${daysOld(f.stat.ctime)}d · ${f.path}`,
			path: f.path,
		}));
	return { count: notes.length, oldestDays, clusters: clusters.filter((c) => c.count > 0), recent, ageBuckets };
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
	const scoreMatches = [...healthLog.matchAll(/\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d+)\s*\|/g)];
	const latest = scoreMatches[scoreMatches.length - 1];
	const latestScore = latest?.[2] || "—";
	const metrics: MetricTile[] = [
		{
			label: "健康分",
			value: latestScore,
			sub: "来自 health-log",
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
	const files = notesUnder(app, folderPath)
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, 40);
	let done = 0;
	let total = 0;
	await Promise.all(
		files.map(async (f) => {
			const raw = await app.vault.cachedRead(f);
			const boxes = raw.match(/^\s*[-*]\s+\[[ x~]\]/gm);
			if (!boxes) return;
			total += boxes.length;
			done += boxes.filter((b) => b.includes("[x]")).length;
		})
	);
	return total > 0 ? { done, total } : undefined;
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
			const priority: ProjectScene["priority"] = /TALOS|医美|AI社群|云心/.test(name) ? "p0" : "p1";
			return {
				name,
				count: notesUnder(app, folder.path).length,
				status: priority === "p0" ? "高频项目" : "观察项目",
				readme: readmeFor(folder.path),
				latestTitle: latest ? titleFor(app, latest) : "—",
				latestPath: latest?.path,
				priority,
				progress: await projectProgress(app, folder.path),
			};
		})
	);
	return scenes.sort((a, b) => {
		const pr = { p0: 0, p1: 1, p2: 2 };
		return pr[a.priority] - pr[b.priority] || b.count - a.count;
	});
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
