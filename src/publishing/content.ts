import { marked, type Tokens } from "marked";
import { sanitizeHTMLToDom } from "obsidian";
import { MarkedFormatter } from "../../vendor/serena-post/src/utils/formatter";
import { markMedia } from "../../vendor/serena-post/src/utils/media";
import { checkMarkdownStyle } from "../../vendor/serena-post/vendor/kaitox/x-article/styleCheck";
import type { ArticleInput, PreparedArticle, PublishingAsset } from "./types";
import { assetDataUrl, assertSupportedMedia, freezeAsset, sha256, wechatImage, type LocalPublishingResolver } from "./media";
import { assertPublishingContentSafe, PublishingCheckError } from "./security";
import { PUBLISHING_THEME_CSS } from "./theme";

export interface PrepareArticleOptions {
	resolveLocalAsset: LocalPublishingResolver;
	now?: () => Date;
}

function stripFrontmatter(markdown: string): string {
	return markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/, "");
}

/** Mask code before interpreting Obsidian syntax or scanning HTML/media. */
function protectCode(markdown: string): { text: string; restore: (value: string) => string } {
	if (/[\uE000\uE001]/.test(markdown)) throw new PublishingCheckError("正文包含不支持的控制标记，请先移除。");
	const snippets: string[] = [];
	const save = (value: string) => `\uE000${snippets.push(value) - 1}\uE001`;
	let text = markdown.replace(/^[ \t>]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t>]*\1[`~]*[ \t]*(?:\n|$)/gm, save);
	// Marked identifies indented code and an unclosed final fence as block code.
	for (const token of marked.lexer(text)) if (token.type === "code") text = text.replace(token.raw, save(token.raw));
	text = text.replace(/(`+)[^`]*?(?:`(?!\1)[^`]*?)*?\1(?!`)/g, save);
	return { text, restore: value => value.replace(/\uE000(\d+)\uE001/g, (_all, index: string) => snippets[Number(index)]) };
}

function localReference(reference: string): string {
	let ref = reference.trim();
	const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(ref);
	if (wiki) ref = wiki[1].split("|")[0].split("#")[0].trim();
	try { ref = decodeURIComponent(ref); } catch { throw new PublishingCheckError("本地媒体路径编码无效，请重新插入图片。"); }
	if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) throw new PublishingCheckError("远程图片或媒体不会在预览中下载。请先保存到当前库，再重新插入。");
	if (!ref || ref.startsWith("/") || ref.startsWith("\\") || ref.includes("\u0000")) throw new PublishingCheckError("媒体必须来自当前库内的本地文件。");
	return ref;
}

function safeName(name: string, taken: Set<string>): string {
	const original = name.split(/[\\/]/).pop()?.normalize("NFKC") || "image";
	const extension = original.match(/\.([a-zA-Z0-9]+)$/)?.[1].toLowerCase();
	const base = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(original)
		? original
		: `asset-${sha256(original).slice(0, 16)}${extension ? `.${extension}` : ""}`;
	let result = base;
	for (let n = 2; taken.has(result.toLowerCase()); n++) result = base.replace(/(\.[^.]+)?$/, `_${n}$1`);
	taken.add(result.toLowerCase());
	return result;
}

/** Keep top-level diagrams as code before Kaitox's Mermaid extraction can run. */
function plainMermaidForX(markdown: string): string {
	let cursor = 0;
	let result = "";
	for (const token of marked.lexer(markdown)) {
		const start = markdown.indexOf(token.raw, cursor);
		if (start < cursor) continue;
		result += markdown.slice(cursor, start);
		const code = token as Tokens.Code;
		result += token.type === "code" && code.lang?.trim().split(/\s+/)[0].toLowerCase() === "mermaid"
			? token.raw.replace(/^([ \t]*(?:`{3,}|~{3,}))[^\r\n]*/, "$1text")
			: token.raw;
		cursor = start + token.raw.length;
	}
	return result + markdown.slice(cursor);
}

function assetFingerprint(asset: PublishingAsset): object {
	return { source: asset.source, fileName: asset.fileName, mime: asset.mime, sha256: asset.sha256, bytes: Buffer.from(asset.bytes).toString("base64") };
}

function articleFingerprint(article: Omit<PreparedArticle, "fingerprint" | "createdAt">): string {
	return sha256(JSON.stringify({ sourcePath: article.sourcePath, title: article.title, markdown: article.markdown, wechatHtml: article.wechatHtml, xMarkdown: article.xMarkdown, digest: article.digest, author: article.author, assets: article.assets.map(assetFingerprint), wechatAssets: article.wechatAssets.map(assetFingerprint), cover: article.cover ? assetFingerprint(article.cover) : null, warnings: article.warnings }));
}

export function verifyPreparedArticle(article: PreparedArticle): void {
	for (const asset of [...article.assets, ...article.wechatAssets, ...(article.cover ? [article.cover] : [])]) {
		if (sha256(asset.bytes) !== asset.sha256) throw new PublishingCheckError("预览媒体已变化，请重新预览后再发送。");
	}
	if (articleFingerprint(article) !== article.fingerprint) throw new PublishingCheckError("预览内容已变化，请重新预览后再发送。");
	assertPublishingContentSafe(article);
}

/** Offline only. The injected host resolver owns vault and realpath/symlink checks. */
export async function prepareArticle(input: ArticleInput, options: PrepareArticleOptions): Promise<PreparedArticle> {
	if (!input.title.trim()) throw new PublishingCheckError("请填写文章标题。");
	const markdown = stripFrontmatter(input.markdown);
	assertPublishingContentSafe({ ...input, markdown });
	const protectedCode = protectCode(markdown);
	let work = protectedCode.text;
	if (/<\/?[a-z][a-z0-9-]*(?:\s[^>]*|\/?)>/i.test(work)) throw new PublishingCheckError("正文含原始 HTML。请改用 Markdown 后重新预览，避免隐藏的远程资源。");
	const warnings: string[] = [];
	work = work.replace(/!\[\[([^\]\n]+)\]\]/g, (_all, inner: string) => {
		const [reference, alias] = inner.split("|");
		const ref = localReference(reference.split("#")[0]);
		if (!/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|mp4|mov)$/i.test(ref)) throw new PublishingCheckError("暂不支持笔记或其他文件嵌入。请把需要的文字放入当前文章，媒体使用本地图片或 MP4/MOV。");
		return `![${(alias && !/^\d+(?:x\d+)?$/.test(alias) ? alias : "").replace(/[[\]]/g, "")}](${encodeURI(ref).replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
	});
	work = work.replace(/(?<!!)\[\[([^\]\n]+)\]\]/g, (_all, inner: string) => {
		if (!warnings.includes("库内双链已转为文字；草稿不会附带其他笔记。")) warnings.push("库内双链已转为文字；草稿不会附带其他笔记。");
		return (inner.split("|")[1] || inner.split("#")[0]).replace(/[<>]/g, "");
	});
	const assets: PublishingAsset[] = [];
	const wechatAssets: PublishingAsset[] = [];
	const byIdentity = new Map<string, PublishingAsset>();
	const byReference = new Map<string, PublishingAsset>();
	const taken = new Set<string>();
	const load = async (reference: string): Promise<PublishingAsset> => {
		const local = localReference(reference);
		if (!/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|mp4|mov)$/i.test(local)) throw new PublishingCheckError("不支持此媒体嵌入。请使用本地图片或 MP4/MOV 视频，不会读取其他笔记。");
		const cached = byReference.get(local);
		if (cached) return cached;
		let resource;
		try { resource = await options.resolveLocalAsset(local, input.sourcePath); }
		catch { throw new PublishingCheckError("本地媒体无法读取或超出当前库范围，请检查图片和封面后重新预览。"); }
		assertSupportedMedia(resource);
		const existing = byIdentity.get(resource.source);
		if (existing) { byReference.set(local, existing); return existing; }
		const fileName = safeName(resource.fileName, taken);
		const asset = freezeAsset(fileName, fileName, resource.mime.toLowerCase().replace("image/jpg", "image/jpeg"), resource.bytes);
		byIdentity.set(resource.source, asset);
		byReference.set(local, asset);
		return asset;
	};
	const images: { raw: string; href: string; text: string }[] = [];
	void marked.walkTokens(marked.lexer(work), token => {
		if (token.type === "image") {
			const image = token as Tokens.Image;
			images.push({ raw: image.raw, href: image.href, text: image.text });
		}
	});
	for (const image of images) {
		const asset = await load(image.href);
		if (!assets.includes(asset)) assets.push(asset);
		work = work.replace(image.raw, `![${image.text.replace(/[[\]\n]/g, "")}](${asset.fileName})`);
	}
	const checkedMarkdown = protectedCode.restore(work);
	const xMarkdown = plainMermaidForX(checkedMarkdown);
	const report = checkMarkdownStyle(checkedMarkdown, { assetMap: Object.fromEntries(assets.map(asset => [asset.fileName, { bytesLen: asset.bytes.byteLength, mime: asset.mime, resolved: true }])) });
	for (const issue of report.issues) {
		const location = issue.line ? `（第 ${issue.line} 行）` : "";
		if (issue.rule === "mermaid-block") {
			warnings.push(`排版检查${location}：Mermaid 按代码保留，不会自动生成图片。需要图形时请先导出为本地图片。`);
		} else if (issue.severity !== "info" || ["heading-depth", "extra-h1", "task-list", "code-block"].includes(issue.rule)) {
			warnings.push(`X 排版检查${location}：${issue.message}${issue.suggestion ? ` ${issue.suggestion}` : ""}`);
		}
	}
	const media = markMedia(work);
	if (media.gifs.length) warnings.push("公众号中的 GIF 将使用静态首帧，并保留手动替换动图的提示；X 保留原始 GIF。");
	if (media.videos.length) warnings.push("公众号中的视频将显示手动插入占位提示；X 保留原始 MP4/MOV。");
	let wechatMarkdown = media.text;
	for (const asset of assets) {
		if (!asset.mime.startsWith("image/")) continue;
		const derived = await wechatImage(asset);
		wechatAssets.push(derived);
		wechatMarkdown = wechatMarkdown.split(`](${asset.fileName})`).join(`](${assetDataUrl(derived)})`);
	}
	let cover: PublishingAsset | undefined;
	if (input.coverPath?.trim()) cover = await wechatImage(await load(input.coverPath));
	const wechatHtml = await MarkedFormatter.markdownToHtml(protectedCode.restore(wechatMarkdown), PUBLISHING_THEME_CSS);
	// Renderer output is checked as well: no hidden network-bearing element survives.
	const container = sanitizeHTMLToDom(wechatHtml);
	for (const element of Array.from(container.querySelectorAll("[src], [srcset], [poster], iframe, object, embed, link, style, script"))) {
		if (element.tagName.toLowerCase() !== "img" || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(element.getAttribute("src") || "") || element.hasAttribute("srcset")) throw new PublishingCheckError("预览中含未冻结的远程或嵌入资源，请先保存为本地媒体。");
	}
	const article = { sourcePath: input.sourcePath, title: input.title.trim(), markdown, wechatHtml, xMarkdown, digest: input.digest, author: input.author, assets: Object.freeze(assets) as unknown as PublishingAsset[], wechatAssets: Object.freeze(wechatAssets) as unknown as PublishingAsset[], cover, warnings: Object.freeze(warnings) as unknown as string[] };
	return Object.freeze({ ...article, fingerprint: articleFingerprint(article), createdAt: (options.now?.() ?? new Date()).toISOString() });
}
