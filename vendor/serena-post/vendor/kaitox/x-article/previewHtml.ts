/**
 * 预览渲染：PreviewModel → HTML 字符串。
 *
 * 输出 <article class="xp-article">…</article>，配套样式见包根的 preview.css
 * （xp- 前缀类 + --xp-* CSS 变量主题，宿主设置变量即可换肤/暗色）。
 *
 * 与框架无关：返回纯字符串，文本与属性值全部经内部转义，可直接 innerHTML /
 * dangerouslySetInnerHTML / 服务端输出。
 */

import { marked } from 'marked18';
import { buildPreviewModel } from './previewModel.js';
import type { PreviewModel } from './previewModel.js';
import { groupBlocks, segmentText } from './previewModel.js';
import type { Segment } from './previewModel.js';
import type { ContentBlock, EntityValue } from './types.js';
import { assertNever } from './types.js';

export interface RenderPreviewOptions {
  /** 显示标题；缺省用 model.derivedTitle（发布时上层通常传 bundle.title——发布真值）。 */
  title?: string;
  /** 封面图 URL；缺省不渲染封面。 */
  coverUrl?: string;
  /**
   * 图片 src → 可显示 URL。返回：
   *   string    → 直接渲染 <img>；
   *   undefined → 「加载中」占位（宿主稍后重渲染即可换成图）；
   *   null      → 「未打包，上传时将被跳过」占位（与发布行为一致）。
   * 不提供时默认原样使用 src（适合 markdown 里就是可访问 URL 的 Web 场景）。
   */
  resolveImage?: (src: string) => string | null | undefined;
  /** Whether a media src is a video (rendered as <video> instead of <img>). Hosts answer from the asset MIME. */
  isVideo?: (src: string) => boolean;
}

/** 便捷入口：markdown 一步到 HTML。 */
export function renderPreviewHtml(markdown: string, opts: RenderPreviewOptions = {}): string {
  return renderModelHtml(buildPreviewModel(markdown), opts);
}

export function renderModelHtml(model: PreviewModel, opts: RenderPreviewOptions = {}): string {
  const parts: string[] = [];

  if (opts.coverUrl) {
    parts.push(`<img class="xp-cover" src="${escapeHtml(opts.coverUrl)}" alt="">`);
  }

  const title = (opts.title ?? model.derivedTitle ?? '').trim();
  parts.push(
    title
      ? `<h1 class="xp-title">${escapeHtml(title)}</h1>`
      : `<h1 class="xp-title xp-title-empty">（无标题）</h1>`,
  );

  if (isEmptyBody(model.blocks)) {
    parts.push(`<div class="xp-empty">（正文为空）</div>`);
  } else {
    for (const group of groupBlocks(model.blocks)) {
      if (group.kind === 'list') {
        const tag = group.ordered ? 'ol' : 'ul';
        const cls = group.ordered ? 'xp-ol' : 'xp-ul';
        const items = group.items.map((b) => `<li>${renderInline(b, model.entities)}</li>`).join('');
        parts.push(`<${tag} class="${cls}">${items}</${tag}>`);
      } else {
        const html = renderSingleBlock(group.block, model.entities, opts);
        if (html) parts.push(html);
      }
    }
  }

  return `<article class="xp-article">${parts.join('')}</article>`;
}

/** 转换器兜底产物（只有空 unstyled 块）视作空正文。 */
function isEmptyBody(blocks: ContentBlock[]): boolean {
  return blocks.every((b) => b.type === 'unstyled' && b.text.trim() === '' && b.entity_ranges.length === 0);
}

function renderSingleBlock(
  block: ContentBlock,
  entities: Map<number, EntityValue>,
  opts: RenderPreviewOptions,
): string {
  switch (block.type) {
    case 'unstyled':
      return `<p class="xp-p">${renderInline(block, entities)}</p>`;
    case 'header-one': // X 编辑器的 Heading（markdown ##）
      return `<h2 class="xp-h1">${renderInline(block, entities)}</h2>`;
    case 'header-two': // X 编辑器的 SubHeading（markdown ### 及更深）
      return `<h3 class="xp-h2">${renderInline(block, entities)}</h3>`;
    case 'blockquote':
      return `<blockquote class="xp-quote">${renderInline(block, entities)}</blockquote>`;
    // 列表项正常路径已被 groupBlocks 归入 list 组，这里是防御渲染（单项也不丢内容）。
    case 'unordered-list-item':
      return `<ul class="xp-ul"><li>${renderInline(block, entities)}</li></ul>`;
    case 'ordered-list-item':
      return `<ol class="xp-ol"><li>${renderInline(block, entities)}</li></ol>`;
    case 'atomic':
      return renderAtomic(block, entities, opts);
    default:
      return assertNever(block.type, 'preview block type');
  }
}

function renderAtomic(
  block: ContentBlock,
  entities: Map<number, EntityValue>,
  opts: RenderPreviewOptions,
): string {
  const key = block.entity_ranges[0]?.key;
  const entity = key === undefined ? undefined : entities.get(key);
  if (!entity) return '';
  switch (entity.type) {
    case 'DIVIDER':
      return `<hr class="xp-divider">`;
    case 'MARKDOWN': {
      // X 端按 markdown 渲染 MARKDOWN 实体：表格显示为原生表格，
      // 代码块显示为纯文本代码框（``` 围栏本身不显示）。
      const table = tryRenderTable(entity.data.markdown);
      if (table) return table;
      return `<pre class="xp-md">${escapeHtml(stripCodeFence(entity.data.markdown))}</pre>`;
    }
    case 'MEDIA': {
      // 预览模型里 media_id 就是图片 src（buildPreviewModel 的占位约定）。
      const src = entity.data.media_items[0]?.media_id ?? '';
      const resolved = opts.resolveImage ? opts.resolveImage(src) : src;
      if (resolved === null) {
        return `<div class="xp-img-missing">图片未打包，上传时将被跳过：${escapeHtml(src)}</div>`;
      }
      if (resolved === undefined) {
        return `<figure class="xp-fig"><div class="xp-img-loading">图片加载中…</div></figure>`;
      }
      if (opts.isVideo?.(src)) {
        return `<figure class="xp-fig"><video class="xp-img" src="${escapeHtml(resolved)}" controls muted playsinline preload="metadata"></video></figure>`;
      }
      return `<figure class="xp-fig"><img class="xp-img" src="${escapeHtml(resolved)}" alt=""></figure>`;
    }
    case 'TWEET': {
      // 预览拿不到帖子正文，渲染一张占位卡片 + 指向该帖的安全链接。
      // 用规范形式 https://x.com/i/status/<id>（X 会重定向到原帖）。
      const id = entity.data.tweet_id;
      const url = `https://x.com/i/status/${encodeURIComponent(id)}`;
      return (
        `<figure class="xp-tweet"><a class="xp-tweet-link" href="${escapeHtml(url)}" ` +
        `target="_blank" rel="noopener noreferrer">View post on X · ${escapeHtml(id)}</a></figure>`
      );
    }
    // LINK 是行内实体，不会出现在 atomic 块里（行内渲染见 renderSegment）。
    case 'LINK':
      return '';
    default:
      return assertNever(entity, 'preview atomic entity');
  }
}

function renderInline(block: ContentBlock, entities: Map<number, EntityValue>): string {
  const segments = segmentText(block.text, block.inline_style_ranges, block.entity_ranges);
  return segments.map((s) => renderSegment(s, entities)).join('');
}

function renderSegment(seg: Segment, entities: Map<number, EntityValue>): string {
  let html = escapeHtml(seg.text).replace(/\n/g, '<br>');
  if (seg.strikethrough) html = `<s>${html}</s>`;
  if (seg.italic) html = `<em>${html}</em>`;
  if (seg.bold) html = `<strong>${html}</strong>`;
  if (seg.entityKey !== undefined) {
    const entity = entities.get(seg.entityKey);
    if (entity?.type === 'LINK' && isSafeUrl(entity.data.url)) {
      html = `<a class="xp-link" href="${escapeHtml(entity.data.url)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
    }
  }
  return html;
}

/** '```lang\ncode\n```' → 'code'；不是完整围栏（表格等）则原样返回。 */
function stripCodeFence(md: string): string {
  const m = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(md.trim());
  return m ? m[1] : md;
}

/** marked 行内 token 的宽松结构。 */
interface InlineMdToken {
  type: string;
  raw?: string;
  text?: string;
  href?: string;
  tokens?: InlineMdToken[];
}

/**
 * MARKDOWN 实体内容若是一张表格，渲染成 HTML 表格（与 X 的原生渲染一致）。
 * X 会把 MARKDOWN 实体整体按 markdown 渲染，所以单元格里的行内标记
 *（`code` / **bold** / 链接）也要渲染出来——这与正文段落不同（正文里
 * 行内代码会被 X 降级为纯文本，表格实体内部则保留样式）。
 */
function tryRenderTable(md: string): string | null {
  interface CellToken {
    text: string;
    tokens?: InlineMdToken[];
  }
  const tokens = marked.lexer(md) as unknown as Array<{
    type: string;
    header?: CellToken[];
    rows?: CellToken[][];
  }>;
  const meaningful = tokens.filter((t) => t.type !== 'space');
  const t = meaningful.length === 1 && meaningful[0].type === 'table' ? meaningful[0] : null;
  if (!t?.header) return null;
  const cell = (c: CellToken) => (c.tokens?.length ? renderInlineMd(c.tokens) : escapeHtml(decodeMdEntities(c.text)));
  const th = t.header.map((c) => `<th>${cell(c)}</th>`).join('');
  const rows = (t.rows ?? [])
    .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="xp-table-wrap"><table class="xp-table"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** 表格单元格内的行内 markdown → HTML（code/strong/em/del/link/br）。 */
function renderInlineMd(tokens: InlineMdToken[]): string {
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'codespan':
        out += `<code class="xp-code">${escapeHtml(decodeMdEntities(t.text ?? ''))}</code>`;
        break;
      case 'strong':
        out += `<strong>${renderInlineMd(t.tokens ?? [])}</strong>`;
        break;
      case 'em':
        out += `<em>${renderInlineMd(t.tokens ?? [])}</em>`;
        break;
      case 'del':
        out += `<s>${renderInlineMd(t.tokens ?? [])}</s>`;
        break;
      case 'link': {
        const inner = t.tokens?.length ? renderInlineMd(t.tokens) : escapeHtml(decodeMdEntities(t.text ?? ''));
        out +=
          t.href && isSafeUrl(t.href)
            ? `<a class="xp-link" href="${escapeHtml(t.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
            : inner;
        break;
      }
      case 'br':
        out += '<br>';
        break;
      default:
        out += escapeHtml(decodeMdEntities(t.text ?? t.raw ?? ''));
    }
  }
  return out;
}

/** marked 会把 & < > 等转成 HTML 实体，输出前先还原（随后统一走 escapeHtml）。 */
function decodeMdEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/** 只放行常规跳转协议，挡掉 javascript: 之类可执行 URL。 */
function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
