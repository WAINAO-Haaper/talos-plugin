// Lens 界面的数据视图：把控制台已采集的 Collected、lili 状态快照与库元数据
// 整理成 Lens 页面需要的形状。全部只读，不新增任何写库操作。
import { TFile, getAllTags, type App } from "obsidian";
import type { Collected } from "../talos-view-model";
import type { VaultPaths } from "../../data/schema";
import type { TalosPeerStatusState } from "../../peer-status/talos-peer-status";

export interface LensProject {
	id: string;
	name: string;
	/** 项目 README frontmatter 的 status；未登记时为 unknown。 */
	status: string;
	priority: string;
	lastUpdated: number | null;
	line: string;
	notes: number;
	readme: string;
	latestPath?: string;
	progress?: { done: number; total: number; sampled?: boolean; scannedFiles?: number; totalFiles?: number };
}

export interface LensFocus {
	id: string;
	name: string;
	status: string;
	priority: string;
	lastUpdated: string;
	mainline: string;
	next: string;
	blockers: Array<{ title: string; severity: string }>;
	checkpoint: Record<string, string>;
	stale: boolean;
}

export interface LensNote {
	path: string;
	name: string;
	folder: string;
	mtime: number;
	size: number;
	tags: string[];
}

export interface LensData {
	collected: Collected;
	capturedAt: number;
	projects: LensProject[];
	focus: LensFocus | null;
	peerState: TalosPeerStatusState["state"];
}

const KNOWN_STATUS = new Set(["planned", "active", "review", "completed", "paused", "blocked", "archived", "cancelled"]);

function frontmatterStatus(app: App, path: string): string {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return "unknown";
	const raw: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.status;
	const status = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	return KNOWN_STATUS.has(status) ? status : "unknown";
}

function frontmatterPriority(app: App, path: string): string {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return "";
	const raw: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.priority;
	return typeof raw === "string" && /^P[0-4]$/i.test(raw.trim()) ? raw.trim().toUpperCase() : "";
}

function mtimeOf(app: App, path: string | undefined): number | null {
	if (!path) return null;
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file.stat.mtime : null;
}

export function buildLensProjects(app: App, collected: Collected): LensProject[] {
	return collected.projects.map((scene) => ({
		id: scene.readme,
		name: scene.name,
		status: frontmatterStatus(app, scene.readme),
		priority: frontmatterPriority(app, scene.readme),
		lastUpdated: scene.latestMtime ?? mtimeOf(app, scene.latestPath),
		line: scene.latestTitle && scene.latestTitle !== "—" ? `最近：${scene.latestTitle}` : "当前没有记录",
		notes: scene.count,
		readme: scene.readme,
		latestPath: scene.latestPath,
		progress: scene.progress,
	}));
}

export function buildLensFocus(peer: TalosPeerStatusState | null): LensFocus | null {
	if (!peer || (peer.state !== "ready" && peer.state !== "stale")) return null;
	const s = peer.envelope.summary;
	return {
		id: s.current_focus.project_id,
		name: s.current_focus.name,
		status: s.state.status,
		priority: s.state.priority,
		lastUpdated: s.state.last_updated,
		mainline: s.mainline.title,
		next: s.next_action.action,
		blockers: s.blockers.filter((b) => b.status === "open").map((b) => ({ title: b.title, severity: b.severity })),
		checkpoint: { ...s.checkpoint },
		stale: peer.state === "stale",
	};
}

export function buildLensData(app: App, collected: Collected, peer: TalosPeerStatusState | null): LensData {
	return {
		collected,
		capturedAt: Date.now(),
		projects: buildLensProjects(app, collected),
		focus: buildLensFocus(peer),
		peerState: peer?.state ?? "missing",
	};
}

/** 目录下的 Markdown 笔记（按修改时间倒序），供收集 / 知识 / 身份等模块的卡片列表使用。 */
export function listNotes(app: App, folder: string, options: { skipReadme?: boolean } = {}): LensNote[] {
	const prefix = folder.replace(/\/+$/, "") + "/";
	return app.vault.getMarkdownFiles()
		.filter((file) => file.path.startsWith(prefix) && !(options.skipReadme && file.basename === "_README"))
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.map((file) => {
			const cache = app.metadataCache.getFileCache(file);
			const tags = cache ? [...new Set(getAllTags(cache) ?? [])].map((tag) => tag.replace(/^#/, "")) : [];
			return {
				path: file.path,
				name: file.basename,
				folder: file.parent?.path.slice(prefix.length) || "",
				mtime: file.stat.mtime,
				size: file.stat.size,
				tags,
			};
		});
}

export function moduleDir(paths: VaultPaths, key: Parameters<VaultPaths["dir"]>[0]): string {
	return paths.dir(key);
}
