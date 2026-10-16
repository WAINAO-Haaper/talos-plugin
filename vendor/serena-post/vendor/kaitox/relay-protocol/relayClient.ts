/**
 * RelayClient —— 上传端 / 插件 与 relay 服务之间的 HTTP 契约与一个通用实现。
 *
 * 路由按 kind 命名空间化：草稿路由都在 /:kind/drafts... 下（kind 是不透明
 * 路径段，relay 不解释，见 validate.isValidKindSegment 的字符规则）；
 * /health 与 /setting 是不带前缀的基础设施路由。客户端以 kind 为作用域
 * （构造时指定，默认 'x-article'），服务端按路径段过滤/盖章。
 *
 * 传输格式（v1，零依赖优先）：
 *   - POST /:kind/drafts 用「单个 JSON + base64 资源」的形态，relay 落盘时把 base64
 *     解成二进制写进 assets/。这样 relay 不需要 multipart 解析器（纯 Node builtins）。
 *   - GET /:kind/drafts/:id/assets/:name 回二进制（插件当 Blob 收，走的是更频繁、更在意带宽的方向）。
 *
 * 云端 relay（v2）只要实现同一个 RelayClient 接口即可替换，上层无感。
 */

import type {
  DraftBundle,
  DraftKind,
  DraftListItem,
  DraftMode,
  DraftSource,
  DraftStatus,
  StyleReport,
} from './bundle.js';
import { DEFAULT_DRAFT_KIND, SCHEMA_VERSION } from './bundle.js';
import { bytesToBase64 } from './base64.js';

/** 待上传的一张图片（内存字节形态）。 */
export interface DraftAssetInput {
  /** 稳定 key，如 "img-0"（可等于 src）。 */
  key: string;
  /** Markdown 里原样 src。 */
  src: string;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

/** 构建并投递一份草稿所需的输入。 */
export interface PostDraftInput {
  /** Feature discriminator; defaults to 'x-article'. */
  kind?: DraftKind;
  title: string;
  markdown: string;
  mode: DraftMode;
  source: DraftSource;
  sourceMeta?: Record<string, unknown>;
  styleReport?: StyleReport;
  assets: DraftAssetInput[];
  /** 可选封面图（不进正文；插件建草稿后单独上传设为封面）。 */
  cover?: DraftAssetInput;
}

/** 设置/替换封面所需的输入（内存字节形态）。 */
export interface SetCoverInput {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
  /**
   * 可选原图（用户新选图裁切确认时随成品一起发，落为 bundle.coverOriginal）。
   * 不带时 relay 保留现有原图不动——「基于原图重新裁切」走的就是这条路。
   */
  original?: { fileName: string; mime: string; bytes: Uint8Array };
}

/** relay 客户端接口。本地 relay 与云端 relay 共用。 */
export interface RelayClient {
  health(): Promise<{ ok: boolean; version: string; port?: number }>;
  postDraft(input: PostDraftInput, options?: { signal?: AbortSignal; id?: string }): Promise<{ id: string }>;
  listDrafts(): Promise<DraftListItem[]>;
  getDraft(id: string, options?: { signal?: AbortSignal }): Promise<DraftBundle>;
  getAsset(id: string, fileName: string): Promise<Uint8Array>;
  /** 设置/替换草稿封面（写回 relay，落盘到 assets/；插件「上传封面」用）。 */
  setCover(id: string, cover: SetCoverInput): Promise<void>;
  ack(id: string, patch: { status: DraftStatus; restId?: string; error?: string }): Promise<void>;
  deleteDraft(id: string): Promise<void>;
}

/** POST /drafts 的线上 JSON 形态（relay 端解析这个）。 */
export interface PostDraftWireBody {
  bundle: Omit<DraftBundle, 'status' | 'restId' | 'error'>;
  assets: Array<{ fileName: string; mime: string; base64: string }>;
}

/** PUT /drafts/:id/cover 的线上 JSON 形态（与 POST /drafts 的资源编码一致，base64 免 multipart）。 */
export interface SetCoverWireBody {
  fileName: string;
  mime: string;
  base64: string;
  /** 可选原图，见 {@link SetCoverInput.original}。 */
  original?: { fileName: string; mime: string; base64: string };
}

export interface HttpRelayClientOptions {
  /** 客户端作用域的 kind（决定 /:kind/drafts 路径段与新草稿的 kind）。默认 'x-article'。 */
  kind?: DraftKind;
  /** 注入 fetch（Node 18+/浏览器都有全局 fetch；测试可 mock）。默认取全局。 */
  fetchImpl?: typeof fetch;
  /** 可选 per-install token，作 x-kaitox-token 头。 */
  token?: string;
  /** 生成 id / 时间戳；默认 crypto.randomUUID + new Date()。可注入以便测试。 */
  makeId?: () => string;
  now?: () => string;
}

/** relay 回非 2xx 时抛出；消费方可按 status 程序化分支（如 401 → 提示配 token）。 */
export class RelayHttpError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(`relay ${method} ${url} ${status}${body ? `: ${body}` : ''}`);
    this.name = 'RelayHttpError';
  }
}

/**
 * Default port / base URL of a local relay. The single source of truth for
 * every runtime consumer; apps/extension/manifest.json must stay in sync
 * (its build asserts this — see apps/extension/esbuild.mjs).
 */
export const DEFAULT_RELAY_PORT = 8765;
export const DEFAULT_RELAY_BASE = `http://127.0.0.1:${DEFAULT_RELAY_PORT}`;

/** 基于 fetch 的 RelayClient 实现，Node 与浏览器通用。 */
export class HttpRelayClient implements RelayClient {
  private readonly base: string;
  private readonly kind: DraftKind;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly makeId: () => string;
  private readonly now: () => string;

  constructor(baseUrl: string = DEFAULT_RELAY_BASE, opts: HttpRelayClientOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.kind = opts.kind ?? DEFAULT_DRAFT_KIND;
    const f = opts.fetchImpl ?? (globalThis as any).fetch;
    if (!f) throw new Error('没有可用的 fetch，请通过 opts.fetchImpl 注入。');
    this.fetchImpl = f;
    this.token = opts.token;
    this.makeId = opts.makeId ?? (() => (globalThis as any).crypto.randomUUID());
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) h['x-kaitox-token'] = this.token;
    return h;
  }

  /** /:kind/drafts 前缀（kind 可被单次调用覆盖，如带自定义 kind 的 postDraft）。 */
  private draftsBase(kind: DraftKind = this.kind): string {
    return `${this.base}/${encodeURIComponent(kind)}/drafts`;
  }

  async health(): Promise<{ ok: boolean; version: string; port?: number }> {
    const url = `${this.base}/health`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new RelayHttpError('GET', url, res.status);
    return res.json();
  }

  async postDraft(input: PostDraftInput, options: { signal?: AbortSignal; id?: string } = {}): Promise<{ id: string }> {
    const id = options.id ?? this.makeId();
    const kind = input.kind ?? this.kind;
    const bundle: PostDraftWireBody['bundle'] = {
      schemaVersion: SCHEMA_VERSION,
      id,
      kind,
      title: input.title,
      markdown: input.markdown,
      mode: input.mode,
      assets: input.assets.map((a) => ({
        key: a.key,
        src: a.src,
        fileName: a.fileName,
        mime: a.mime,
        bytesLen: a.bytes.byteLength,
      })),
      cover: input.cover
        ? {
            key: input.cover.key,
            src: input.cover.src,
            fileName: input.cover.fileName,
            mime: input.cover.mime,
            bytesLen: input.cover.bytes.byteLength,
          }
        : undefined,
      styleReport: input.styleReport,
      createdAt: this.now(),
      source: input.source,
      sourceMeta: input.sourceMeta,
    };
    // 封面字节和正文图一起塞进 wire.assets（relay 按 fileName 落盘），插件再按 cover.fileName 取。
    const wireAssets = input.assets.map((a) => ({
      fileName: a.fileName,
      mime: a.mime,
      base64: bytesToBase64(a.bytes),
    }));
    if (input.cover) {
      wireAssets.push({
        fileName: input.cover.fileName,
        mime: input.cover.mime,
        base64: bytesToBase64(input.cover.bytes),
      });
    }
    const body: PostDraftWireBody = {
      bundle,
      assets: wireAssets,
    };
    const url = this.draftsBase(kind);
    const res = await this.fetchImpl(url, {
      method: 'POST',
      signal: options.signal,
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new RelayHttpError('POST', url, res.status, await safeText(res));
    return res.json();
  }

  async listDrafts(): Promise<DraftListItem[]> {
    const url = this.draftsBase();
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new RelayHttpError('GET', url, res.status);
    return res.json();
  }

  async getDraft(id: string, options: { signal?: AbortSignal } = {}): Promise<DraftBundle> {
    const url = `${this.draftsBase()}/${encodeURIComponent(id)}`;
    const res = await this.fetchImpl(url, { signal: options.signal, headers: this.headers() });
    if (!res.ok) throw new RelayHttpError('GET', url, res.status);
    return res.json();
  }

  async getAsset(id: string, fileName: string): Promise<Uint8Array> {
    const url = `${this.draftsBase()}/${encodeURIComponent(id)}/assets/${encodeURIComponent(fileName)}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new RelayHttpError('GET', url, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async setCover(id: string, cover: SetCoverInput): Promise<void> {
    const body: SetCoverWireBody = {
      fileName: cover.fileName,
      mime: cover.mime,
      base64: bytesToBase64(cover.bytes),
      // undefined 时 JSON.stringify 省略该键，旧 relay 收到的 body 与从前一致。
      original: cover.original
        ? {
            fileName: cover.original.fileName,
            mime: cover.original.mime,
            base64: bytesToBase64(cover.original.bytes),
          }
        : undefined,
    };
    const url = `${this.draftsBase()}/${encodeURIComponent(id)}/cover`;
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new RelayHttpError('PUT', url, res.status, await safeText(res));
  }

  async ack(id: string, patch: { status: DraftStatus; restId?: string; error?: string }): Promise<void> {
    const url = `${this.draftsBase()}/${encodeURIComponent(id)}`;
    const res = await this.fetchImpl(url, {
      method: 'PATCH',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new RelayHttpError('PATCH', url, res.status, await safeText(res));
  }

  async deleteDraft(id: string): Promise<void> {
    const url = `${this.draftsBase()}/${encodeURIComponent(id)}`;
    const res = await this.fetchImpl(url, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new RelayHttpError('DELETE', url, res.status);
  }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
