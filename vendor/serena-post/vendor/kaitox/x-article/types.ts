/**
 * X (Twitter) Article 上传相关的类型定义。
 *
 * 对应 x.com 网页端 `ArticleEntityDraftCreate` 的请求体，以及媒体分片上传接口。
 *
 * X Article 的正文用的是 Draft.js 的 `RawDraftContentState` 结构，但有两个 X 自己的改动：
 *   1. `entity_map` 是「数组」而不是 Draft.js 原生的「对象」，每个元素带显式 `key`。
 *   2. 字段名是 snake_case（entity_ranges / inline_style_ranges / entity_map）。
 *
 * 详见 docs/x-article-publish-protocol.md。
 */

// ---------------------------------------------------------------------------
// Draft.js content_state（X Article 正文模型）
// ---------------------------------------------------------------------------

/**
 * 段落级 block 的类型。X 后端实测（2026-07 探针）接受的全集。
 *
 * 注意：`header-three` 和 `code-block` 能过 GraphQL 校验，但后端创建草稿时会报
 * `OperationalError: Internal: Unspecified`——X Article 正文只支持两级标题，
 * 代码块必须走 atomic + MARKDOWN 实体。
 *
 * 新增成员时的更新清单（编译期由 BLOCK_TYPES 覆盖表 + 各 switch 的 assertNever 兜底强制）：
 *   1. 本联合类型 + BLOCK_TYPES 覆盖表；
 *   2. contentState.ts handleBlockToken（生产侧）；
 *   3. previewHtml.ts renderSingleBlock / previewModel.ts groupBlocks（若是列表类）；
 *   4. xArticleClient.ts sanitizeContentState（若 X 拒收需进 BLOCK_TYPE_FALLBACK）；
 *   5. styleCheck.ts（若该结构在 X 端有降级行为，加规则）；
 *   6. test/preview.mjs 真值测试的 fixture。
 */
export type BlockType =
  | 'unstyled' // 普通段落
  | 'header-one' // X 编辑器的 Heading（Markdown ## 映射至此；# 是主标题，走 title 字段不进正文）
  | 'header-two' // X 编辑器的 SubHeading（Markdown ### 及更深钳到这里）
  | 'blockquote' // > 引用
  | 'unordered-list-item' // - 无序列表项
  | 'ordered-list-item' // 1. 有序列表项
  | 'atomic'; // 块级实体（图片 / 分割线 / 代码）的宿主块，text 固定为 " "

/**
 * 行内样式。offset/length 以 JS 字符串下标（UTF-16 code unit）计算。
 *
 * 注意：这是 X GraphQL 的强类型枚举，实测（2026-07 探针）只接受这三个值；
 * `Code` / `CODE` / `InlineCode` / `Underline` 都会 GRAPHQL_VALIDATION_FAILED。
 * X Article 没有行内代码样式，`code` 需降级为普通文本。
 */
export type InlineStyle = 'Bold' | 'Italic' | 'Strikethrough';

export interface InlineStyleRange {
  offset: number;
  length: number;
  style: InlineStyle;
}

/** 把一段文字（offset..offset+length）关联到 entity_map 里 key 对应的实体。 */
export interface EntityRange {
  key: number;
  offset: number;
  length: number;
}

export interface ContentBlock {
  /** Draft.js 的 block key，随机 5 位字符，只要求文档内唯一。 */
  key: string;
  text: string;
  type: BlockType;
  data: Record<string, unknown>;
  entity_ranges: EntityRange[];
  inline_style_ranges: InlineStyleRange[];
}

/**
 * 实体（entity）类型 —— block 级或 inline 级都从这里取 key。
 *
 * 新增成员时的更新清单：EntityValue 变体、contentState.ts 生产侧、
 * previewHtml.ts renderAtomic（块级）/ renderSegment（行内）、test/preview.mjs fixture。
 */
export type EntityType = 'MEDIA' | 'DIVIDER' | 'MARKDOWN' | 'LINK' | 'TWEET';

export interface MediaItem {
  /** 等于该实体在 entity_map 中的 key。 */
  local_media_id: number;
  /** X media 上传（FINALIZE）后拿到的 media_id_string。 */
  media_id: string;
  /** 注意与上传时的 media_category（tweet_image 等）不同；按媒体类型取值，见 media.ts。 */
  media_category: DraftMediaCategory;
}

/**
 * Media kind of a body media item. Decides both the upload category and the
 * content_state category (see media.ts for the mapping).
 */
export type MediaKind = 'image' | 'gif' | 'video';

/** media_category inside content_state MEDIA entities (X article editor enum). */
export type DraftMediaCategory = 'DraftTweetImage' | 'DraftTweetGif' | 'DraftTweetVideo';

export type EntityValue =
  | { type: 'MEDIA'; mutability: 'Immutable'; data: { media_items: MediaItem[] } }
  | { type: 'DIVIDER'; mutability: 'Immutable'; data: Record<string, never> }
  // MARKDOWN 必须是 Mutable：X 编辑器自己的载荷实测如此（2026-07 抓包），
  // Immutable 的 MARKDOWN 实体能过 GraphQL 校验但渲染端会丢内容（表格/代码块消失）。
  | { type: 'MARKDOWN'; mutability: 'Mutable'; data: { markdown: string } }
  | { type: 'LINK'; mutability: 'Mutable'; data: { url: string } }
  // TWEET：内嵌一条帖子（引用推文）。data 只放 tweet_id（X 强类型 input，多余字段会
  // GRAPHQL_VALIDATION_FAILED）。实测载荷里 entity_key(UUID) 可有可无，故省略。
  | { type: 'TWEET'; mutability: 'Immutable'; data: { tweet_id: string } };

export interface EntityMapEntry {
  key: number;
  value: EntityValue;
}

// ---------------------------------------------------------------------------
// 覆盖表与穷尽性断言：联合类型加成员时这里先编译报错，逼着按清单过一遍消费点，
// 避免某个 switch 的 default 静默丢内容。
// ---------------------------------------------------------------------------

/** BlockType 的编译期覆盖表（新增成员先在这里报错）。 */
export const BLOCK_TYPES: Record<BlockType, true> = {
  unstyled: true,
  'header-one': true,
  'header-two': true,
  blockquote: true,
  'unordered-list-item': true,
  'ordered-list-item': true,
  atomic: true,
};

/** InlineStyle 的编译期覆盖表。X GraphQL 强类型枚举，2026-07 实测只有这三个。 */
export const INLINE_STYLES: Record<InlineStyle, true> = {
  Bold: true,
  Italic: true,
  Strikethrough: true,
};

/** EntityType 的编译期覆盖表。 */
export const ENTITY_TYPES: Record<EntityType, true> = {
  MEDIA: true,
  DIVIDER: true,
  MARKDOWN: true,
  LINK: true,
  TWEET: true,
};

/** switch 的穷尽性兜底：漏 case 时编译报错（参数非 never），运行时也吼出来而不是静默丢。 */
export function assertNever(x: never, site: string): never {
  throw new Error(`unhandled ${site}: ${String(x)}`);
}

/** X Article 正文的核心结构。 */
export interface ContentState {
  blocks: ContentBlock[];
  entity_map: EntityMapEntry[];
}

// ---------------------------------------------------------------------------
// X GraphQL: ArticleEntityDraftCreate
// ---------------------------------------------------------------------------

/** ArticleEntityDraftCreate 用到的 feature flags（原样保留）。 */
export interface ArticleFeatures {
  profile_label_improvements_pcf_label_in_post_enabled: boolean;
  responsive_web_profile_redirect_enabled: boolean;
  rweb_tipjar_consumption_enabled: boolean;
  verified_phone_label_enabled: boolean;
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: boolean;
  responsive_web_graphql_timeline_navigation_enabled: boolean;
}

export interface ArticleFieldToggles {
  withPayments: boolean;
  withAuxiliaryUserLabels: boolean;
}

export interface ArticleDraftCreateBody {
  variables: {
    content_state: ContentState;
    title: string;
  };
  features: ArticleFeatures;
  fieldToggles: ArticleFieldToggles;
  queryId: string;
}

// ---------------------------------------------------------------------------
// X GraphQL: ArticleEntityUpdateCoverMedia（设置文章封面/头图）
// ---------------------------------------------------------------------------

/**
 * 封面图引用。media_id 是先经媒体上传（media_category=tweet_image）拿到的 media_id_string；
 * 这里引用时 media_category 与正文图片一样是 DraftTweetImage。
 */
export interface CoverMediaInput {
  media_id: string;
  media_category: 'DraftTweetImage';
}

/**
 * ArticleEntityUpdateCoverMedia 请求体。
 * 注意与 ArticleEntityDraftCreate 的两点不同：
 *   1. features 有三个 flag 取值不同（见 DEFAULT_COVER_MEDIA_FEATURES）；
 *   2. 没有 fieldToggles 字段。
 */
export interface ArticleUpdateCoverMediaBody {
  variables: {
    /** 目标草稿的 rest_id（ArticleEntityDraftCreate 返回的那个）。 */
    articleEntityId: string;
    coverMedia: CoverMediaInput;
  };
  features: ArticleFeatures;
  queryId: string;
}

// ---------------------------------------------------------------------------
// X media upload（分片上传 INIT/APPEND/FINALIZE）
// ---------------------------------------------------------------------------

/**
 * 上传时的 media_category（URL query 参数），与正文里的 DraftTweetImage 不同。
 * Article videos must be tweet_video (see media.ts); amplify_video is what X's tweet
 * composer uses and does not resolve inside an article.
 */
export type UploadMediaCategory = 'tweet_image' | 'tweet_gif' | 'tweet_video' | 'amplify_video';

export interface MediaUploadInitResponse {
  media_id: number;
  media_id_string: string;
  expires_after_secs?: number;
  media_key?: string;
}

/** Async processing state returned by FINALIZE / STATUS for video and GIF uploads. */
export interface MediaProcessingInfo {
  state: 'pending' | 'in_progress' | 'succeeded' | 'failed';
  check_after_secs?: number;
  progress_percent?: number;
  error?: { code?: number; name?: string; message?: string };
}

/** 一次待上传的图片（正文里出现的一张图）。 */
export interface PendingImage {
  /** 源 markdown 里的图片地址，作为去重与回填的 key。 */
  src: string;
  /** 图片二进制。 */
  bytes: Uint8Array | Blob;
  /** MIME，如 image/webp、image/png。INIT 的 media_type。 */
  mimeType: string;
}

// ---------------------------------------------------------------------------
// 鉴权 / 会话
// ---------------------------------------------------------------------------

/**
 * 调 X 私有接口所需的会话凭证。
 * 这些值都取自浏览器里已登录 x.com 的会话，接口本质上是「带着你的登录态替你操作」。
 */
export interface XCredentials {
  /** 公开 web bearer token（所有 x.com 网页端共用同一个）。 */
  bearerToken: string;
  /** CSRF token，等于 cookie 里的 ct0。 */
  csrfToken: string;
  /** 完整 cookie 串。浏览器内（同源 fetch）用 credentials:'include' 时可留空。 */
  cookie?: string;
  /** X-Client-Transaction-Id，跨域调用时 X 可能校验；同源页面内一般可省略。 */
  clientTransactionId?: string;
  /** x-twitter-client-language，默认 en。 */
  clientLanguage?: string;
}
