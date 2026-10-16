/**
 * Markdown → X Article `content_state`（Draft.js RawDraftContentState）转换器。
 *
 * 这是整个项目里最核心、也最有复用价值的一块：把一份普通 Markdown 变成 X Article
 * 编辑器认识的 blocks + entity_map 结构。映射规则：
 *
 *   Markdown 构造            →  content_state
 *   ---------------------------------------------------------------
 *   段落                      →  unstyled block
 *   #（第一个）               →  文章主标题（不进正文，由 title 字段承载）
 *   ##（及文中额外的 #）      →  header-one（X 编辑器里的 Heading）
 *   ### 及更深                →  header-two（X 编辑器里的 SubHeading；后端只有两级）
 *   > 引用                    →  blockquote block（每个段落一块）
 *   - 列表项                  →  unordered-list-item block（每项一块）
 *   1. 列表项                 →  ordered-list-item block
 *   **bold** / *italic* / ~~del~~ →  inline_style_ranges（Bold/Italic/Strikethrough）
 *   `code`（行内）             →  普通文本（X 无行内代码样式，实测 Code 枚举被拒）
 *   [text](url)              →  LINK 实体 + entity_range 覆盖 text
 *   独占一行的 x/twitter 帖子链接 →  atomic block + TWEET 实体（内嵌引用推文，只取 tweet_id）
 *   ![alt](src)              →  atomic block + MEDIA 实体（图片/GIF/视频需先上传拿 media_id）
 *   ```代码```               →  atomic block + MARKDOWN 实体（整段围栏原样塞进去）
 *   ---（分割线）             →  atomic block + DIVIDER 实体
 *   表格                      →  atomic block + MARKDOWN 实体（X 按 markdown 原生渲染成表格）
 *
 * 关键约定：
 *   - entity 的 key 是从 0 开始、按「文档从上到下的出现顺序」递增的整数。
 *     block 级实体（MEDIA/DIVIDER/MARKDOWN）和 inline 实体（LINK）共用同一个计数器。
 *   - MEDIA 实体的 local_media_id === 它自己的 entity key。
 *   - atomic block 的 text 固定是一个空格 " "，且有且仅有一个 entity_range = {offset:0,length:1}。
 *   - offset/length 用 JS 字符串下标（UTF-16 code unit），CJK 字符按 1 计。
 */

import { marked } from 'marked18';
import type {
  ContentState,
  ContentBlock,
  BlockType,
  EntityMapEntry,
  EntityValue,
  EntityRange,
  InlineStyleRange,
  MediaKind,
} from './types';
import { DRAFT_CATEGORY_BY_KIND } from './media.js';

/** marked 的 token 版本间字段略有差异，这里用一个宽松结构 + 局部 cast 兼容。 */
interface MdToken {
  type: string;
  raw?: string;
  text?: string;
  depth?: number;
  lang?: string;
  href?: string;
  ordered?: boolean;
  tokens?: MdToken[];
  items?: MdToken[];
}

/** 行内解析的中间结果。 */
interface InlineResult {
  text: string;
  styleRanges: InlineStyleRange[];
  entityRanges: EntityRange[];
}

/** 生成 Draft.js 风格的 5 位随机 block key。 */
function randomBlockKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 5; i++) {
    key += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return key;
}

/**
 * 转换器主体。用类是因为要在一次「从上到下」的遍历里维护 blocks、entity_map 和
 * 递增的 entity key 计数器这三份可变状态。
 */
class ContentStateBuilder {
  private blocks: ContentBlock[] = [];
  private entityMap: EntityMapEntry[] = [];
  private nextEntityKey = 0;

  /**
   * @param resolveMediaId  给一个图片 src，返回它上传到 X 后的 media_id。
   *                        返回 undefined 表示没上传成功——该图片会被跳过并记录。
   * @param resolveKind     Media kind of an uploaded src; picks the entity's media_category.
   */
  constructor(
    private readonly resolveMediaId: (src: string) => string | undefined,
    private readonly resolveKind: (src: string) => MediaKind,
  ) {}

  readonly skippedImages: string[] = [];

  /** 第一个 H1 的纯文本，作为文章主标题（该 H1 不进正文）。 */
  derivedTitle: string | undefined;

  build(markdown: string): ContentState {
    const tokens = marked.lexer(markdown) as unknown as MdToken[];
    for (const token of tokens) {
      this.handleBlockToken(token);
    }
    // X 要求正文非空；若最终一个 block 都没有，塞一个空段落兜底。
    if (this.blocks.length === 0) {
      this.pushBlock('unstyled', { text: '', styleRanges: [], entityRanges: [] });
    }
    return { blocks: this.blocks, entity_map: this.entityMap };
  }

  // --- entity / block 基础操作 ---------------------------------------------

  private addEntity(value: EntityValue): number {
    const key = this.nextEntityKey++;
    this.entityMap.push({ key, value });
    return key;
  }

  private pushBlock(type: BlockType, inline: InlineResult): void {
    this.blocks.push({
      key: randomBlockKey(),
      text: inline.text,
      type,
      data: {},
      entity_ranges: inline.entityRanges,
      inline_style_ranges: inline.styleRanges,
    });
  }

  /** 块级实体（图片/分割线/代码/表格）统一走 atomic 宿主块。 */
  private pushAtomic(entityKey: number): void {
    this.blocks.push({
      key: randomBlockKey(),
      text: ' ',
      type: 'atomic',
      data: {},
      entity_ranges: [{ key: entityKey, offset: 0, length: 1 }],
      inline_style_ranges: [],
    });
  }

  /**
   * MARKDOWN 实体（代码块/表格）。X 编辑器实测载荷（2026-07 抓包）：
   * mutability 是 Mutable、markdown 前后带换行——Immutable 能过校验但渲染端丢内容。
   */
  private pushMarkdownEntity(markdown: string): void {
    const md = '\n' + markdown + (markdown.endsWith('\n') ? '' : '\n');
    const key = this.addEntity({ type: 'MARKDOWN', mutability: 'Mutable', data: { markdown: md } });
    this.pushAtomic(key);
  }

  // --- block 级分发 ---------------------------------------------------------

  private handleBlockToken(token: MdToken): void {
    switch (token.type) {
      case 'heading': {
        // 层级约定：第一个 # 是文章主标题（走 title 字段，不进正文）；
        // ## → header-one（X 编辑器的 Heading）；### 及更深 → header-two（SubHeading）。
        // X 后端实测只支持这两级（header-three 会 OperationalError: Internal: Unspecified）。
        const depth = token.depth ?? 2;
        const inline = this.processInline(token.tokens ?? textFallback(token));
        if (depth <= 1 && this.derivedTitle === undefined) {
          this.derivedTitle = inline.text.trim();
          break;
        }
        // 文中额外的 # 按 Heading 处理（一篇文章只该有一个主标题）。
        const type: BlockType = depth <= 2 ? 'header-one' : 'header-two';
        this.pushBlock(type, inline);
        break;
      }
      case 'paragraph':
        // 独占段落的 x/twitter 帖子链接 → 内嵌引用推文；否则按普通段落处理（链接照常走 LINK）。
        if (!this.tryStandaloneTweets(token)) this.handleParagraph(token);
        break;
      case 'blockquote':
        // 引用里通常是若干段落，每段输出一个 blockquote block。
        for (const child of token.tokens ?? []) {
          if (child.type === 'paragraph') {
            this.pushBlock('blockquote', this.processInline(child.tokens ?? textFallback(child)));
          } else if (child.type === 'text') {
            this.pushBlock('blockquote', this.processInline(child.tokens ?? textFallback(child)));
          } else {
            this.handleBlockToken(child);
          }
        }
        break;
      case 'list':
        this.handleList(token);
        break;
      case 'code': {
        // 围栏代码 / ASCII 图 → MARKDOWN 实体，data.markdown 是完整围栏串。
        const lang = (token.lang || 'plaintext').trim() || 'plaintext';
        const fenced = '```' + lang + '\n' + (token.text ?? '') + '\n```';
        this.pushMarkdownEntity(fenced);
        break;
      }
      case 'table': {
        // 表格走 MARKDOWN 实体，X 编辑器/阅读页会把它按 markdown 原生渲染成表格。
        this.pushMarkdownEntity(token.raw ?? '');
        break;
      }
      case 'hr': {
        const key = this.addEntity({ type: 'DIVIDER', mutability: 'Immutable', data: {} });
        this.pushAtomic(key);
        break;
      }
      case 'space':
      case 'html':
        // 空行忽略；裸 HTML 暂不支持（X Article 也不接受任意 HTML）。
        break;
      default:
        // 兜底：当成普通段落文本。
        if (token.text) {
          this.pushBlock('unstyled', { text: token.text, styleRanges: [], entityRanges: [] });
        }
    }
  }

  /**
   * 段落可能夹着图片。图片在 X 里是块级的，所以要把段落按图片切开：
   * 文字部分各自成 unstyled block，图片各自成 atomic MEDIA block。
   */
  private handleParagraph(token: MdToken): void {
    const inlineTokens = token.tokens ?? textFallback(token);
    const runs: MdToken[] = [];
    const flushRun = () => {
      if (runs.length === 0) return;
      const inline = this.processInline(runs);
      if (inline.text.trim().length > 0 || inline.entityRanges.length > 0) {
        this.pushBlock('unstyled', inline);
      }
      runs.length = 0;
    };

    for (const t of inlineTokens) {
      if (t.type === 'image') {
        flushRun();
        this.pushImage(t.href ?? '');
      } else {
        runs.push(t);
      }
    }
    flushRun();
  }

  private pushImage(src: string): void {
    const mediaId = src ? this.resolveMediaId(src) : undefined;
    if (!mediaId) {
      if (src) this.skippedImages.push(src);
      return;
    }
    // local_media_id 必须等于实体自己的 key。addEntity 会把当前 nextEntityKey 分配出去，
    // 所以先取值再建实体，两者一致。
    const key = this.nextEntityKey;
    this.addEntity({
      type: 'MEDIA',
      mutability: 'Immutable',
      data: {
        media_items: [
          { local_media_id: key, media_id: mediaId, media_category: DRAFT_CATEGORY_BY_KIND[this.resolveKind(src)] },
        ],
      },
    });
    this.pushAtomic(key);
  }

  /**
   * 若整段就是「一行或多行、每行都是一条 x/twitter 帖子链接」，把每行转成一个内嵌
   * TWEET 块并返回 true；否则不动、返回 false（交回普通段落处理，链接照常成 LINK）。
   * 段内混了正文的裸链接不算——保持「独占才内嵌」，与 X 粘贴即嵌入的体感一致。
   */
  private tryStandaloneTweets(token: MdToken): boolean {
    const raw = (token.text ?? '').trim();
    if (!raw) return false;
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return false;
    const ids = lines.map(parseTweetId);
    if (ids.some((id) => id === undefined)) return false;
    for (const id of ids) this.pushTweet(id as string);
    return true;
  }

  /** 内嵌引用推文：TWEET 实体 + atomic 宿主块（与 DIVIDER 同构）。 */
  private pushTweet(tweetId: string): void {
    const key = this.addEntity({ type: 'TWEET', mutability: 'Immutable', data: { tweet_id: tweetId } });
    this.pushAtomic(key);
  }

  private handleList(token: MdToken): void {
    const ordered = !!token.ordered;
    const type: BlockType = ordered ? 'ordered-list-item' : 'unordered-list-item';
    for (const item of token.items ?? []) {
      // list_item 通常包一层 text/paragraph，再包 inline tokens。
      const inlineTokens = collectListItemInline(item);
      this.pushBlock(type, this.processInline(inlineTokens));
    }
  }

  // --- inline 级解析 --------------------------------------------------------

  /**
   * 把一串 inline token 拍平成 { 纯文本, 样式区间, 实体区间 }。
   * 递归处理 strong/em/link 等嵌套，offset 用累计文本长度。
   */
  private processInline(tokens: MdToken[]): InlineResult {
    let text = '';
    const styleRanges: InlineStyleRange[] = [];
    const entityRanges: EntityRange[] = [];

    const appendChild = (child: InlineResult) => {
      const base = text.length;
      text += child.text;
      for (const s of child.styleRanges) styleRanges.push({ ...s, offset: s.offset + base });
      for (const e of child.entityRanges) entityRanges.push({ ...e, offset: e.offset + base });
      return { base, length: child.text.length };
    };

    for (const token of tokens) {
      switch (token.type) {
        case 'text':
        case 'escape':
        case 'html': {
          if (token.tokens && token.tokens.length) {
            appendChild(this.processInline(token.tokens));
          } else {
            text += decodeEntities(token.text ?? token.raw ?? '');
          }
          break;
        }
        case 'strong': {
          const { base, length } = appendChild(this.processInline(token.tokens ?? textFallback(token)));
          if (length > 0) styleRanges.push({ offset: base, length, style: 'Bold' });
          break;
        }
        case 'em': {
          const { base, length } = appendChild(this.processInline(token.tokens ?? textFallback(token)));
          if (length > 0) styleRanges.push({ offset: base, length, style: 'Italic' });
          break;
        }
        case 'del': {
          const { base, length } = appendChild(this.processInline(token.tokens ?? textFallback(token)));
          if (length > 0) styleRanges.push({ offset: base, length, style: 'Strikethrough' });
          break;
        }
        case 'codespan': {
          // X 的 style 枚举没有 Code（实测 Code/CODE/InlineCode 都被拒），
          // X Article 编辑器本身也没有行内代码样式 —— 降级为普通文本。
          text += decodeEntities(token.text ?? '');
          break;
        }
        case 'link': {
          const { base, length } = appendChild(this.processInline(token.tokens ?? textFallback(token)));
          if (length > 0 && token.href) {
            const key = this.addEntity({ type: 'LINK', mutability: 'Mutable', data: { url: token.href } });
            entityRanges.push({ key, offset: base, length });
          }
          break;
        }
        case 'br':
          text += '\n';
          break;
        case 'image':
          // 出现在 inline 深处的图片：退化为 alt 文本（块级图片已在段落层处理）。
          text += token.text ?? '';
          break;
        default:
          text += decodeEntities(token.text ?? token.raw ?? '');
      }
    }

    return { text, styleRanges, entityRanges };
  }
}

/** 当 token 没有子 tokens 时，用它的纯文本构造一个 text 子 token。 */
function textFallback(token: MdToken): MdToken[] {
  return [{ type: 'text', text: token.text ?? token.raw ?? '' }];
}

/** list_item → inline tokens。marked 会把内容包在 text/paragraph 里。 */
function collectListItemInline(item: MdToken): MdToken[] {
  const children = item.tokens ?? [];
  const out: MdToken[] = [];
  for (const c of children) {
    if (c.type === 'text' || c.type === 'paragraph') {
      if (c.tokens && c.tokens.length) out.push(...c.tokens);
      else out.push({ type: 'text', text: c.text ?? '' });
    }
    // 嵌套列表 / 其它块暂不展开（保持列表项为单行）。
  }
  return out.length ? out : textFallback(item);
}

/** marked 会把 & < > 等转义成 HTML 实体，塞进 content_state 前要还原成原字符。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 从一条 x.com / twitter.com 的帖子链接里取出数字 tweet_id；不是帖子链接返回 undefined。
 *
 * 整串锚定匹配（`^…$`）：只认「整行就是一条帖子链接」，段内混着正文的裸链接不会命中——
 * 内嵌引用推文只在链接独占一行时触发（见 ContentStateBuilder.tryStandaloneTweets）。
 * 容忍：http/https、子域（www./mobile. 等）、status 前任意路径段（如 i/web/status）、
 * statuses 复数、结尾的 /photo/1、?query、#hash。
 */
export function parseTweetId(url: string): string | undefined {
  const m = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:twitter|x)\.com\/(?:[^/\s]+\/)*status(?:es)?\/(\d+)(?:[/?#]\S*)?$/i.exec(
    url.trim(),
  );
  return m ? m[1] : undefined;
}

/**
 * 收集 markdown 里所有需要上传的图片 src（块级图片），供上传阶段先行处理。
 * 顺序 = 文档出现顺序，已去重。
 */
export function collectImageSources(markdown: string): string[] {
  const tokens = marked.lexer(markdown) as unknown as MdToken[];
  const srcs: string[] = [];
  const seen = new Set<string>();
  const visit = (list: MdToken[]) => {
    for (const t of list) {
      if (t.type === 'image' && t.href) {
        if (!seen.has(t.href)) {
          seen.add(t.href);
          srcs.push(t.href);
        }
      }
      if (t.tokens) visit(t.tokens);
      if (t.items) visit(t.items);
    }
  };
  visit(tokens);
  return srcs;
}

/**
 * 把 markdown 转成 X Article 的 content_state。
 *
 * @param markdown        源 markdown
 * @param mediaIdBySrc    图片 src → 已上传的 media_id 映射（先跑 collectImageSources + 上传得到）
 * @param mediaKindBySrc  src → media kind of the upload (GIF / video); srcs not listed are images
 * @returns               content_state、被跳过（未提供 media_id）的图片列表，
 *                        以及 title（第一个 H1 的纯文本；该 H1 不进正文，没有 H1 则为 undefined）
 */
export function markdownToContentState(
  markdown: string,
  mediaIdBySrc: Record<string, string> | Map<string, string> = {},
  mediaKindBySrc: Record<string, MediaKind> | Map<string, MediaKind> = {},
): { contentState: ContentState; skippedImages: string[]; title?: string } {
  const lookup =
    mediaIdBySrc instanceof Map
      ? (src: string) => mediaIdBySrc.get(src)
      : (src: string) => mediaIdBySrc[src];
  const kindOf =
    mediaKindBySrc instanceof Map
      ? (src: string) => mediaKindBySrc.get(src) ?? 'image'
      : (src: string) => mediaKindBySrc[src] ?? 'image';
  const builder = new ContentStateBuilder(lookup, kindOf);
  const contentState = builder.build(markdown);
  return { contentState, skippedImages: builder.skippedImages, title: builder.derivedTitle };
}
