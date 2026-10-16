/**
 * 「草稿包」(DraftBundle) —— 上传端与 Chrome 插件之间传输的统一数据契约。
 *
 * 设计要点（见方案）：
 *   - 草稿包携带的是「原始 Markdown + 图片字节」，不是预构建好的 content_state。
 *     因为 content_state 需要 media_id，而 media_id 只有插件在已登录的 x.com 页面里
 *     上传图片后才拿得到。插件收到包后再走 markdownToContentState(md, {src→media_id})。
 *   - assets[].src 必须 === 插件里 collectImageSources(markdown) 解析出的原样 src 字符串，
 *     两端靠它对齐（这是最关键的不变量）。
 */

/** 富文本 or 纯文本兜底。见 plaintext.ts。 */
export type DraftMode = 'rich' | 'plaintext';

/**
 * Feature/target this draft is for. The relay stores and forwards it without
 * interpreting it; consumers route on it. Absent = 'x-article' (v0.2 bundles
 * on disk predate this field). Third-party features use their own string.
 */
export type DraftKind = 'x-article' | (string & {});

/** The kind assumed when a bundle predates the `kind` field (v0.2 disk bundles). */
export const DEFAULT_DRAFT_KIND: DraftKind = 'x-article';

/**
 * Canonical read-side accessor for the "absent kind = 'x-article'" invariant.
 * Use this instead of open-coding `b.kind ?? 'x-article'`.
 */
export function draftKind(b: { kind?: DraftKind }): DraftKind {
  return b.kind ?? DEFAULT_DRAFT_KIND;
}

/** 草稿来自哪个上传端。Third-party pushers may use their own string. */
export type DraftSource = 'cli' | 'obsidian' | 'unknown' | (string & {});

/** relay 侧维护的草稿生命周期状态。 */
export type DraftStatus = 'pending' | 'uploading' | 'done' | 'failed';

/** 风格检查的一条问题。 */
export interface StyleIssue {
  /** 规则 id，如 'table' / 'nested-list' / 'image-missing'。 */
  rule: string;
  severity: 'error' | 'warning' | 'info';
  /** 人类可读描述。 */
  message: string;
  /** 建议怎么改。 */
  suggestion?: string;
  /** 大致源码行号（1 起，近似）。 */
  line?: number;
  /** 触发问题的原文片段（截断）。 */
  excerpt?: string;
}

/** 风格检查报告。 */
export interface StyleReport {
  /** 没有 error/warning 时为 true（info 不影响友好性）。 */
  friendly: boolean;
  issues: StyleIssue[];
  counts: { error: number; warning: number; info: number };
}

/** 草稿包里一张图片资源的元信息（字节单独存磁盘 / 单独传）。 */
export interface DraftAsset {
  /** 稳定 key，如 "img-0"。主要给 Obsidian wikilink 重写用；普通图片可等于 src。 */
  key: string;
  /** Markdown 里出现的原样 src 字符串。必须与 collectImageSources 的输出一致。 */
  src: string;
  /** relay 落盘时的文件名（assets/<fileName>）。 */
  fileName: string;
  mime: string;
  bytesLen: number;
  /** 可选完整性校验。 */
  sha256?: string;
}

/**
 * Current wire schema version, written by clients on every new bundle.
 * Policy: additive changes never bump; incompatible changes bump. Consumers
 * must refuse (with a clear error) versions greater than they know rather
 * than misparse; the relay stores any version blindly.
 */
export const SCHEMA_VERSION = 1;

/** Read-side accessor: absent on v0.2 disk bundles = 1. */
export function bundleSchemaVersion(b: { schemaVersion?: number }): number {
  return b.schemaVersion ?? 1;
}

/** 完整草稿包（存盘 / relay 返回的形态）。 */
export interface DraftBundle {
  /** See {@link SCHEMA_VERSION}; read via {@link bundleSchemaVersion}. */
  schemaVersion: number;
  id: string;
  /** Feature discriminator; absent = 'x-article'. */
  kind?: DraftKind;
  title: string;
  markdown: string;
  mode: DraftMode;
  assets: DraftAsset[];
  /**
   * 可选封面图。不进正文（不在 assets 里、不在 markdown 里），插件建草稿后单独上传并
   * 调 ArticleEntityUpdateCoverMedia。字节和正文图一样落在 assets/<cover.fileName>。
   */
  cover?: DraftAsset;
  /**
   * 可选封面原图（裁切前的源图）。不进正文与 assets[]，永不上传 X；
   * 仅供再次裁切时取回，让用户能基于原图重新调整取景。
   */
  coverOriginal?: DraftAsset;
  styleReport?: StyleReport;
  /** ISO8601。 */
  createdAt: string;
  source: DraftSource;
  sourceMeta?: Record<string, unknown>;

  // --- 以下字段由 relay 维护 ---
  status?: DraftStatus;
  /** 上传成功后插件回填的文章 rest_id。 */
  restId?: string;
  /** 上传失败时的错误信息。 */
  error?: string;
}

/** 列表接口返回的精简条目（不含 markdown / 字节）。 */
export interface DraftListItem {
  id: string;
  /** Feature discriminator; absent = 'x-article'. */
  kind?: DraftKind;
  title: string;
  source: DraftSource;
  createdAt: string;
  mode: DraftMode;
  status: DraftStatus;
  counts?: StyleReport['counts'];
  assetCount: number;
}
