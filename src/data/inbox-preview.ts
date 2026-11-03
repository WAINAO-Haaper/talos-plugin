// 收件条目的预处理：读取正文首段与小节，生成摘要型内容。
// 只读 `vault.cachedRead`，不调用模型、不写回任何文件。
import type { App, TFile } from "obsidian";

export interface InboxPreview {
	/** 摘要段落（已剥离 markdown 噪声），保留段落分隔。 */
	summary: string;
	/** 摘要包含的段落数。 */
	paragraphs: number;
	/** 文中小节标题，最多 8 条。 */
	headings: string[];
	/** 正文字符数（不含空白）。 */
	chars: number;
	/** 预计阅读分钟数。 */
	readingMinutes: number;
	/** 正文中的链接数。 */
	links: number;
	/** 粗略类型：剪藏 / 语音 / 文件 / 笔记。 */
	kind: string;
}

function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function plain(text: string): string {
	return text
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^>\s?/gm, "")
		.replace(/[*_`~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function inferKind(path: string, raw: string): string {
	const lower = path.toLowerCase();
	if (/语音|转写|transcript|voice/.test(lower) || /语音转写/.test(raw.slice(0, 400))) return "语音";
	if (/剪藏|clipp?ing|readwise/.test(lower)) return "剪藏";
	if (/\.(pdf|docx?|xlsx?|png|jpe?g)$/i.test(lower)) return "文件";
	return "笔记";
}

export async function readInboxBody(app: App, path: string): Promise<string | null> {
	const file = app.vault.getAbstractFileByPath(path) as TFile | null;
	if (!file || typeof file.path !== "string") return null;
	try {
		return stripFrontmatter(await app.vault.cachedRead(file));
	} catch {
		return null;
	}
}

export async function readInboxPreview(app: App, path: string): Promise<InboxPreview | null> {
	const file = app.vault.getAbstractFileByPath(path) as TFile | null;
	if (!file || typeof file.path !== "string") return null;
	let raw = "";
	try {
		raw = await app.vault.cachedRead(file);
	} catch {
		return null;
	}
	if (!raw.trim()) return null;

	const body = stripFrontmatter(raw);
	const lines = body.split(/\r?\n/);
	const headings = lines
		.filter((line) => /^#{1,3}\s+\S/.test(line))
		.map((line) => line.replace(/^#{1,3}\s+/, "").trim())
		.slice(0, 8);

	const paragraphs = body
		.split(/\r?\n\s*\r?\n/)
		.filter((block) => !/^\s*#{1,6}\s/.test(block))
		.map((block) => plain(block))
		.filter((block) => block.length > 0 && !block.startsWith("|"));
	// 取前 3 段、合计不超过 520 字，保留段落分隔。
	const picked: string[] = [];
	let budget = 520;
	for (const paragraph of paragraphs.slice(0, 3)) {
		if (budget <= 0) break;
		const slice = paragraph.length > 260 ? `${paragraph.slice(0, 260)}…` : paragraph;
		picked.push(slice);
		budget -= slice.length;
	}
	const summary = picked.join("\n\n");
	const chars = body.replace(/\s/g, "").length;
	const links = (body.match(/\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)/g) ?? []).length;

	return {
		summary,
		paragraphs: picked.length,
		headings,
		chars,
		readingMinutes: Math.max(1, Math.round(chars / 400)),
		links,
		kind: inferKind(path, raw),
	};
}
