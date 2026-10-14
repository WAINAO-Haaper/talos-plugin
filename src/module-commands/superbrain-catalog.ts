/** Data-only view of the deployment kit's C/M catalog. No executable names come from vault text. */
export const SUPERBRAIN_WORKFLOW_SLUGS = [
	"morning", "intake", "retrieval", "memory", "digest", "mine-rules",
	"maintain", "create", "output", "full-cycle", "weekly-reset", "brand",
	"metrics", "log", "export-okf",
] as const;

export type SuperbrainWorkflowSlug = typeof SUPERBRAIN_WORKFLOW_SLUGS[number];
export type SuperbrainEntryId = `C${string}` | `M${string}`;
export type SuperbrainToolId = "inventory" | "members" | "index" | "search" | "health" | "snapshot" | "export" | "selftest";

export interface SuperbrainEntry {
	id: SuperbrainEntryId;
	title: string;
	summary: string;
	files: string[];
	tools: SuperbrainToolId[];
	icon: string;
	slug?: SuperbrainWorkflowSlug;
	group?: string;
}

export interface SuperbrainCatalog {
	workflows: SuperbrainEntry[];
	mechanisms: SuperbrainEntry[];
}

export const SUPERBRAIN_CATALOG_PATH = "System/interface/talos-superbrain-ui/catalog.json";
const allowedTools = new Set<SuperbrainToolId>(["inventory", "members", "index", "search", "health", "snapshot", "export", "selftest"]);

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作流目录格式无效");
	return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error(`工作流目录 ${label} 无效`);
	return value.trim();
}

export function safeSuperbrainPath(value: unknown): string {
	const path = text(value, "路径");
	if (path.startsWith("/") || path.includes("\\") || path.includes("\u0000") || path.split("/").some(part => !part || part === "." || part === "..") || /^[A-Za-z]:/.test(path)) {
		throw new Error("工作流目录含无效路径");
	}
	return path;
}

function entry(value: unknown, expectedId: string, workflow: boolean): SuperbrainEntry {
	const item = record(value);
	if (item.id !== expectedId) throw new Error(`工作流目录缺少 ${expectedId}`);
	if (!Array.isArray(item.files) || !Array.isArray(item.tools)) throw new Error(`${expectedId} 文件或工具列表无效`);
	const tools = item.tools.map(tool => {
		if (!allowedTools.has(tool as SuperbrainToolId)) throw new Error(`${expectedId} 工具未登记`);
		return tool as SuperbrainToolId;
	});
	const result: SuperbrainEntry = {
		id: expectedId as SuperbrainEntryId,
		title: text(item.title, `${expectedId} 标题`),
		summary: text(item.summary, `${expectedId} 说明`),
		files: item.files.map(safeSuperbrainPath),
		tools,
		icon: text(item.icon, `${expectedId} 图标`),
	};
	if (workflow) {
		const slug = SUPERBRAIN_WORKFLOW_SLUGS[Number(expectedId.slice(1)) - 1];
		if (!slug || item.slug !== slug) throw new Error(`${expectedId} 工作流标识不匹配`);
		result.slug = slug;
		result.group = text(item.group, `${expectedId} 分组`);
	}
	return result;
}

export function parseSuperbrainCatalog(raw: string): SuperbrainCatalog {
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { throw new Error("工作流目录不是有效 JSON"); }
	const source = record(parsed);
	if (source.schema_version !== 1 || !Array.isArray(source.workflows) || !Array.isArray(source.mechanisms)) throw new Error("工作流目录版本或列表无效");
	if (source.workflows.length !== 15 || source.mechanisms.length !== 10) throw new Error("工作流目录必须包含 15 条工作流和 10 组机制");
	return {
		workflows: source.workflows.map((item, index) => entry(item, `C${String(index + 1).padStart(2, "0")}`, true)),
		mechanisms: source.mechanisms.map((item, index) => entry(item, `M${String(index + 1).padStart(2, "0")}`, false)),
	};
}

/** Existing vaults may use user-selected module roots; the catalog's file labels follow them. */
export function mapSuperbrainFile(path: string, roots: Readonly<Record<string, string>>): string {
	const defaults: Record<string, string> = {
		"00-收件箱": "inbox", "01-日志": "logs", "02-洞察": "insights", "03-素材": "assets",
		"04-项目": "projects", "05-归档": "archive", "输出": "output",
		"System/Identity": "identity", "System/灵魂": "soul", "System/模板": "templates",
		"System/自动化": "automation", "System/配置": "config", "System": "system",
	};
	for (const [prefix, key] of Object.entries(defaults).sort((a, b) => b[0].length - a[0].length)) {
		if (path === prefix || path.startsWith(`${prefix}/`)) {
			const mapped = roots[key];
			return mapped ? `${safeSuperbrainPath(mapped)}${path.slice(prefix.length)}` : path;
		}
	}
	return path;
}
