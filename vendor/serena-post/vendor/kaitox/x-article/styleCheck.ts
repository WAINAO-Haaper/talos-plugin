/**
 * 推特友好度检查 + 纯文本兜底预处理。CLI / Obsidian / 插件共用。
 *
 * 规则严格对齐 contentState.ts 转换器的「真实降级行为」——只有转换器会把某构造渲染坏
 * 或丢内容时，这里才报问题。避免报「其实没事」的假警。
 *
 *   构造            转换器实际行为（contentState.ts）        →  规则/级别
 *   ------------------------------------------------------------------------
 *   表格            MARKDOWN atomic，X 原生渲染为表格           →  table / info
 *   嵌套列表        collectListItemInline 丢弃子列表            →  nested-list / warning
 *   HTML 块         case 'html' 直接 break，内容丢失            →  html-block / warning
 *   代码块          MARKDOWN plaintext atomic（可接受）         →  code-block / info
 *   标题层级        h1=主标题(不进正文) h2=Heading h3+=SubHeading →  heading-depth / extra-h1 / info
 *   脚注 [^1]       marked 不解析 → 当字面量文本                →  footnote / warning
 *   任务列表 - [ ]  当普通列表项，勾选框丢失                     →  task-list / info
 *   远程图片        插件只上传本地字节，远程图需上传端预下载      →  image-remote / warning
 *   本地图缺失      无字节 → pushImage 跳过                     →  image-missing / error
 *   图片过大        PNG/JPEG/WebP 由 relay 入库自动压缩（无感）  →  不报
 *                   GIF/SVG 等不可压缩格式仍可能被 X 拒          →  image-too-large / warning
 *                   (GIFs are checked against X's 15MB GIF limit; video limits are per-account, not checked)
 *   <video> 标签    not a media embed; pasted as literal text   →  video-html / warning
 *   非 MP4/MOV 视频  relay converts it to MP4 at ingest (ffmpeg)  →  video-convert / info
 *   空文档          X 要求非空正文（转换器塞空段落兜底）          →  empty-doc / error
 */

import { marked } from 'marked18';
import { collectImageSources } from './contentState.js';
import { mediaKindFromMime, MAX_X_GIF_BYTES } from './media.js';
import type { StyleIssue, StyleReport } from '../relay-protocol/index.js';

/** 单张图片的元信息（上传端解析本地/相对路径后填）。key = markdown 里的原样 src。 */
export interface AssetMeta {
  bytesLen?: number;
  mime?: string;
  /** 是否已解析出本地字节（false = 路径没找到）。 */
  resolved?: boolean;
}

export interface StyleCheckOptions {
  /** src → 资源元信息。用于判定 image-missing / image-too-large / image-remote。 */
  assetMap?: Record<string, AssetMeta>;
  /** 单图大小上限（字节），默认 5MB。 */
  maxImageBytes?: number;
}

interface LooseToken {
  type: string;
  raw?: string;
  text?: string;
  depth?: number;
  lang?: string;
  items?: LooseToken[];
  tokens?: LooseToken[];
  task?: boolean;
}

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** relay 入库时会自动重编码压缩的格式：超限也无需打扰用户，不报问题。 */
const AUTO_COMPRESSED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Video containers X takes as-is; others are converted by the relay at ingest. */
const X_VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime']);

/** An HTML <video> tag anywhere in the source. */
const VIDEO_TAG_RE = /<video\b[^>]*>/i;

/** 主入口：扫描 markdown，返回风格报告。 */
export function checkMarkdownStyle(markdown: string, opts: StyleCheckOptions = {}): StyleReport {
  const issues: StyleIssue[] = [];
  const maxBytes = opts.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const tokens = marked.lexer(markdown) as unknown as LooseToken[];

  // 逐个 top-level token 扫描，同时用 raw 长度累加出源码偏移 → 行号。
  let offset = 0;
  let seenH1 = false;
  for (const t of tokens) {
    const line = lineAt(markdown, offset);
    switch (t.type) {
      case 'table':
        issues.push({
          rule: 'table',
          severity: 'info',
          message: '表格会以 Markdown 块上传，X Article 原生渲染为表格。',
          line,
        });
        break;
      case 'html':
        if (VIDEO_TAG_RE.test(t.raw ?? '')) break; // reported once below as video-html
        issues.push({
          rule: 'html-block',
          severity: 'warning',
          message: 'HTML 块不被支持，转换时会被整段丢弃、内容丢失。',
          suggestion: '把 HTML 改写成等价的 Markdown。',
          line,
          excerpt: excerpt(t.raw),
        });
        break;
      case 'code': {
        const isMermaid = (t.lang ?? '').trim().split(/\s+/)[0].toLowerCase() === 'mermaid';
        issues.push({
          rule: isMermaid ? 'mermaid-block' : 'code-block',
          severity: 'info',
          message: isMermaid
            ? 'mermaid 代码块会在上传时渲染成图片（语法错误会导致上传失败，请先确认图能画出来）。'
            : '代码块会以纯文本代码框呈现（无语法高亮），一般可接受。',
          line,
        });
        break;
      }
      case 'heading': {
        // 层级约定：h1 = 主标题（不进正文），h2 = Heading，h3 = SubHeading。
        const d = t.depth ?? 2;
        if (d === 1) {
          if (seenH1) {
            issues.push({
              rule: 'extra-h1',
              severity: 'info',
              message: '只有第一个 H1 会作为文章主标题，此处 H1 会按 Heading（##）处理。',
              suggestion: '一篇文章保留一个 H1，其余降为 ##。',
              line,
              excerpt: excerpt(t.raw),
            });
          }
          seenH1 = true;
        } else if (d > 3) {
          issues.push({
            rule: 'heading-depth',
            severity: 'info',
            message: `h${d} 标题会被钳到 SubHeading（与 ### 相同，X Article 正文只支持两级标题）。`,
            suggestion: '把结构收敛到 ≤ h3。',
            line,
          });
        }
        break;
      }
      case 'list':
        if (hasNestedList(t)) {
          issues.push({
            rule: 'nested-list',
            severity: 'warning',
            message: '嵌套列表的子项会被静默丢弃（转换器只保留一级列表项）。',
            suggestion: '把列表拍平成一级。',
            line,
            excerpt: excerpt(t.raw),
          });
        }
        if (hasTaskItem(t)) {
          issues.push({
            rule: 'task-list',
            severity: 'info',
            message: '任务列表会渲染成普通列表项，勾选框会丢失。',
            line,
          });
        }
        break;
      default:
        break;
    }
    offset += (t.raw ?? '').length;
  }

  // 脚注：marked 默认不解析 [^1]，会被当字面量文本渲染。用源码正则扫。
  const footnoteRe = /\[\^[^\]]+\]/g;
  let m: RegExpExecArray | null;
  const seenFootnoteLines = new Set<number>();
  while ((m = footnoteRe.exec(markdown))) {
    const line = lineAt(markdown, m.index);
    if (seenFootnoteLines.has(line)) continue;
    seenFootnoteLines.add(line);
    issues.push({
      rule: 'footnote',
      severity: 'warning',
      message: '脚注语法 [^n] 不被解析，会原样显示成文本。',
      suggestion: '把脚注内容内联到正文，或改成普通链接。',
      line,
      excerpt: m[0],
    });
  }

  // <video> tags are not uploaded: block-level ones are dropped and inline ones are
  // pasted as literal text. Point users at the image syntax, which does upload video.
  for (const tag of markdown.matchAll(new RegExp(VIDEO_TAG_RE.source, 'gi'))) {
    issues.push({
      rule: 'video-html',
      severity: 'warning',
      message: '<video> 标签不会被上传成视频，会被丢弃或原样显示成文本。',
      suggestion: '改用图片语法引用视频：![](clip.mp4)。',
      line: lineAt(markdown, tag.index ?? 0),
      excerpt: excerpt(tag[0]),
    });
  }

  // 图片：结合 assetMap 判定 远程 / 缺失 / 过大。
  const assetMap = opts.assetMap ?? {};
  for (const src of collectImageSources(markdown)) {
    const meta = assetMap[src];
    const line = firstLineOfSubstring(markdown, src);
    const isRemote = /^https?:\/\//i.test(src);
    if (meta && meta.resolved === false) {
      issues.push({
        rule: 'image-missing',
        severity: 'error',
        message: `图片路径解析不到本地文件，上传时会被跳过：${src}`,
        suggestion: '修正图片路径。',
        line,
        excerpt: src,
      });
      continue;
    }
    if (!meta && isRemote) {
      issues.push({
        rule: 'image-remote',
        severity: 'warning',
        message: `远程图片 ${src} 插件不会主动下载；上传端需先把它下载进草稿包。`,
        suggestion: '上传端预下载远程图片，或改用本地图片。',
        line,
        excerpt: src,
      });
      continue;
    }
    if (!meta && !isRemote) {
      issues.push({
        rule: 'image-missing',
        severity: 'error',
        message: `本地图片未随草稿包提供字节，上传时会被跳过：${src}`,
        suggestion: '确认图片存在且被上传端解析到。',
        line,
        excerpt: src,
      });
      continue;
    }
    // GIF has its own, larger limit; video limits depend on the account, so leave them to X.
    const kind = meta?.mime !== undefined ? mediaKindFromMime(meta.mime) : 'image';
    if (kind === 'video') {
      if (meta?.mime && !X_VIDEO_MIMES.has(meta.mime)) {
        issues.push({
          rule: 'video-convert',
          severity: 'info',
          message: `视频 ${src}（${meta.mime}）X 不直接支持，中转会用本机 ffmpeg 转成 MP4；电脑上没装 ffmpeg 的话这个视频会被跳过。`,
          suggestion: '先把视频转成 MP4，或安装 ffmpeg。',
          line,
          excerpt: src,
        });
      }
      continue;
    }
    if (kind === 'gif') {
      if (typeof meta?.bytesLen === 'number' && meta.bytesLen > MAX_X_GIF_BYTES) {
        issues.push({
          rule: 'image-too-large',
          severity: 'warning',
          message: `GIF ${src} 约 ${(meta.bytesLen / 1024 / 1024).toFixed(1)}MB，超过 X 的 15MB GIF 上限，上传会被拒。`,
          suggestion: '压缩 GIF，或转成 mp4 视频。',
          line,
          excerpt: src,
        });
      }
      continue;
    }
    // 超限的 PNG/JPEG/WebP 由 relay 入库时静默压缩，不打扰；只有不可压缩的格式才值得报。
    if (
      meta &&
      typeof meta.bytesLen === 'number' &&
      meta.bytesLen > maxBytes &&
      meta.mime !== undefined &&
      !AUTO_COMPRESSED_MIMES.has(meta.mime)
    ) {
      issues.push({
        rule: 'image-too-large',
        severity: 'warning',
        message: `图片 ${src} 约 ${(meta.bytesLen / 1024 / 1024).toFixed(1)}MB，超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB，且 ${meta.mime} 不会被自动压缩，X 可能拒绝。`,
        suggestion: '换成 PNG / JPEG / WebP（超限会自动压缩），或手动缩小。',
        line,
        excerpt: src,
      });
    }
  }

  // 空文档。
  const hasContent = tokens.some((t) => t.type !== 'space' && (t.raw ?? '').trim().length > 0);
  if (!hasContent) {
    issues.push({
      rule: 'empty-doc',
      severity: 'error',
      message: '文档为空，X Article 需要非空正文。',
      suggestion: '添加内容后再上传。',
      line: 1,
    });
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  // 稳定排序：error → warning → info，再按行号。
  const rank = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.line ?? 0) - (b.line ?? 0));

  return { friendly: counts.error === 0 && counts.warning === 0, issues, counts };
}

// ---------------------------------------------------------------------------
// 纯文本兜底预处理
// ---------------------------------------------------------------------------

/**
 * 用户不修改「不友好」构造时的兜底：只降级转换器真正会丢内容的构造——
 * HTML 块（转换时整段丢弃）→ 去标签的普通段落；嵌套列表（子项被丢弃）→ 拍平一级。
 * 其余一切原样保留，包括表格与代码围栏（两者经 MARKDOWN 实体上传，X 原生渲染，
 * 打平反而是内容损失）。产物仍是 Markdown，交给 markdownToContentState 即可。
 *
 * 实现：遍历 top-level token，友好的直接拷贝 token.raw（原样），不友好的替换成降级文本。
 */
export function toPlaintextMarkdown(markdown: string): string {
  const tokens = marked.lexer(markdown) as unknown as LooseToken[];
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'html':
        out += stripHtml(t.raw ?? '').trim() + '\n\n';
        break;
      case 'list':
        out += hasNestedList(t) ? flattenList(t) + '\n\n' : (t.raw ?? '');
        break;
      default:
        out += t.raw ?? '';
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function hasNestedList(listToken: LooseToken): boolean {
  for (const item of listToken.items ?? []) {
    for (const c of item.tokens ?? []) {
      if (c.type === 'list') return true;
    }
  }
  return false;
}

function hasTaskItem(listToken: LooseToken): boolean {
  return (listToken.items ?? []).some((it) => it.task === true);
}

function stripHtml(raw: string): string {
  return raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
}

/** 把（含嵌套的）列表拍平成一级无序列表。 */
function flattenList(listToken: LooseToken): string {
  const lines: string[] = [];
  const walk = (items: LooseToken[]) => {
    for (const item of items) {
      const textParts: string[] = [];
      const nested: LooseToken[] = [];
      for (const c of item.tokens ?? []) {
        if (c.type === 'list') nested.push(c);
        else if (c.type === 'text' || c.type === 'paragraph') textParts.push(c.text ?? '');
        else textParts.push(c.raw ?? c.text ?? '');
      }
      const line = textParts.join(' ').replace(/\s*\n\s*/g, ' ').trim();
      if (line) lines.push('- ' + line);
      if (nested.length) walk(nested.flatMap((n) => n.items ?? []));
    }
  };
  walk(listToken.items ?? []);
  return lines.join('\n');
}

function lineAt(text: string, index: number): number {
  let line = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function firstLineOfSubstring(text: string, sub: string): number | undefined {
  const idx = text.indexOf(sub);
  return idx >= 0 ? lineAt(text, idx) : undefined;
}

function excerpt(raw: string | undefined, max = 80): string | undefined {
  if (!raw) return undefined;
  const one = raw.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}
