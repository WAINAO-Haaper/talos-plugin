// 长期数据画像的只读采集：标签词频、双链结构、月度增长、frontmatter 合规。
// 只读 metadataCache 与文件时间，不修改任何笔记。
import type { App } from "obsidian";

export interface InsightTag {
	tag: string;
	count: number;
}

export interface InsightMonth {
	label: string;
	count: number;
	/** 该月是否包含当前月。 */
	current: boolean;
}

export interface InsightFolder {
	name: string;
	count: number;
}

export interface InsightStats {
	/** 参与统计的 Markdown 笔记数。 */
	total: number;
	/** 去重后的标签数。 */
	tagCount: number;
	topTags: InsightTag[];
	/** 双向链接条目总数。 */
	links: number;
	/** 没有任何入链/出链的笔记数。 */
	orphans: number;
	/** 指向不存在文件的链接数。 */
	broken: number;
	/** 平均每篇笔记的连接数。 */
	density: number;
	/** frontmatter 必填字段齐全的比例（0-100）。 */
	compliance: number;
	months: InsightMonth[];
	folders: InsightFolder[];
	/** 没有任何标签的笔记数。 */
	untagged: number;
	/** 90 天内没有修改的笔记数。 */
	stale: number;
	/** 缺少 _README.md 的顶层目录数。 */
	missingReadme: number;
}

const EXCLUDED_SEGMENTS = ["/node_modules/", "/客户交付物/", "/交付包/", "/talos-system-promo"];
const REQUIRED_FIELDS = ["title", "date", "tags", "status"] as const;

function isExcluded(path: string): boolean {
	const wrapped = "/" + path;
	return EXCLUDED_SEGMENTS.some((segment) => wrapped.includes(segment));
}

function normalizeTag(raw: string): string {
	return raw.replace(/^#/, "").trim();
}

function topLevelFolder(path: string): string {
	const parts = path.split("/");
	return parts.length > 1 ? parts[0] : "根目录";
}

function monthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 汇总长期画像。
 * 数据源全部来自 Obsidian 公开 API：`getMarkdownFiles`、`metadataCache`、`stat.ctime`。
 */
export function collectInsightStats(app: App): InsightStats {
	const files = app.vault.getMarkdownFiles().filter((file) => !isExcluded(file.path));
	const total = files.length;

	const tagCounts = new Map<string, number>();
	const folderCounts = new Map<string, number>();
	const months: InsightMonth[] = [];
	const monthCounts = new Map<string, number>();

	const now = new Date();
	for (let i = 11; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const key = monthKey(d);
		monthCounts.set(key, 0);
		months.push({
			label: String(d.getMonth() + 1).padStart(2, "0"),
			count: 0,
			current: i === 0,
		});
	}

	const resolved = app.metadataCache.resolvedLinks ?? {};
	const unresolved = app.metadataCache.unresolvedLinks ?? {};
	const incoming = new Map<string, number>();
	let links = 0;
	let broken = 0;

	for (const [source, targets] of Object.entries(resolved)) {
		if (isExcluded(source)) continue;
		for (const [target, count] of Object.entries(targets)) {
			links += count;
			incoming.set(target, (incoming.get(target) ?? 0) + count);
		}
	}
	for (const [source, targets] of Object.entries(unresolved)) {
		if (isExcluded(source)) continue;
		for (const count of Object.values(targets)) broken += count;
	}

	let compliant = 0;
	let untagged = 0;
	let stale = 0;
	const staleBefore = Date.now() - 90 * 86400000;

	for (const file of files) {
		folderCounts.set(topLevelFolder(file.path), (folderCounts.get(topLevelFolder(file.path)) ?? 0) + 1);

		const created = new Date(file.stat.ctime);
		const key = monthKey(created);
		if (monthCounts.has(key)) monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);

		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = isFrontmatterRecord(cache?.frontmatter)
			? cache.frontmatter
			: undefined;
		if (
			frontmatter
			&& REQUIRED_FIELDS.every((field) => {
				const value = frontmatter[field];
				if (Array.isArray(value)) return value.length > 0;
				if (typeof value === "string") return value.trim() !== "";
				return value !== undefined && value !== null;
			})
		) compliant += 1;

		const perFile = new Set<string>();
		for (const tag of cache?.tags ?? []) perFile.add(normalizeTag(tag.tag));
		for (const tag of frontmatterTags(frontmatter)) perFile.add(normalizeTag(tag));
		if (perFile.size === 0) untagged += 1;
		for (const name of perFile) {
			if (!name) continue;
			tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1);
		}
		if (file.stat.mtime < staleBefore) stale += 1;
	}

	// 用完整年月回填，避免跨年时串月。
	for (let i = 0; i < months.length; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - (months.length - 1 - i), 1);
		months[i].count = monthCounts.get(monthKey(d)) ?? 0;
	}

	const topTags = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([tag, count]) => ({ tag, count }));

	const folders = [...folderCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6)
		.map(([name, count]) => ({ name, count }));

	const orphans = files.filter((file) => {
		const outgoing = Object.values(resolved[file.path] ?? {}).reduce((sum, count) => sum + count, 0);
		return outgoing === 0 && (incoming.get(file.path) ?? 0) === 0;
	}).length;

	const topFolders = [...folderCounts.keys()];
	const missingReadme = topFolders.filter((folder) => !app.vault.getAbstractFileByPath(`${folder}/_README.md`)).length;

	return {
		total,
		tagCount: tagCounts.size,
		topTags,
		links,
		orphans,
		broken,
		density: total === 0 ? 0 : Math.round((links / total) * 10) / 10,
		compliance: total === 0 ? 0 : Math.round((compliant / total) * 100),
		months,
		folders,
		untagged,
		stale,
		missingReadme,
	};
}

function isFrontmatterRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function frontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
	if (!frontmatter) return [];
	const raw = frontmatter.tags;
	if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string");
	if (typeof raw === "string") return raw.split(/[,，\s]+/).filter(Boolean);
	return [];
}
