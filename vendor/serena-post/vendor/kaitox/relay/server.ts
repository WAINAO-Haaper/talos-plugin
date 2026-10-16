/**
 * 本地 relay 的 HTTP 服务（零第三方依赖，纯 node:http）。
 *
 * 实现 @kaitox/relay-protocol 里 RelayClient 的线上契约。路由按 kind 命名空间化
 * （路径段 = kind 原文，relay 不解释，只存储/过滤/校验匹配；规则见
 * relay-protocol 的 isValidKindSegment）：
 *
 *   GET    /health                              （基础设施；token 豁免）
 *   GET    /setting                             （relay 设置视图，永不返回 token 值）
 *   PATCH  /setting                             （body: { token?: string | null }）
 *   POST   /:kind/drafts                        （body: PostDraftWireBody；kind 由路径盖章）
 *   GET    /:kind/drafts                        （服务端按 kind 过滤）
 *   GET    /:kind/drafts/:id
 *   GET    /:kind/drafts/:id/assets/:fileName    （回二进制）
 *   PUT    /:kind/drafts/:id/cover               （body: SetCoverWireBody，设置/替换封面；可带 original 同步存原图）
 *   PATCH  /:kind/drafts/:id                     （body: { status, restId?, error? }）
 *   DELETE /:kind/drafts/:id
 *   /drafts*                                     → 410 Gone（v0.4 前的旧根路由，提示迁移）
 *
 * 请求体在边界上经 relay-protocol 的 wire 校验器检查，畸形回 400 + issue 路径。
 * CORS 只放行 x.com / twitter.com / chrome-extension:// / Obsidian（见 config.isAllowedOrigin）。
 * TALOS always requires an in-memory x-kaitox-token; storage root is explicit.
 */
// Adapted from @kaitox/relay (MIT, https://github.com/kuangjiajia/kaitox-toolkit) for SerenaPost.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { DraftBundle } from '../relay-protocol/index';
import {
  isValidKindSegment,
  validatePostDraftWireBody,
  validateSetCoverWireBody,
  validateAckPatch,
} from '../relay-protocol/index';
import {
  HOST,
  RELAY_VERSION,
  DEFAULT_PORT,
  isAllowedOrigin,
  ensureRelayDirectory,
} from './config';
import {
  saveDraft,
  listDrafts,
  getDraft,
  getAssetPath,
  setCover,
  patchDraft,
  deleteDraft,
} from './storage';

export interface RelayServerHandle {
  port: number;
  close(): Promise<void>;
}

export interface RelayServerOptions {
  /** Absolute plugin-private directory; never the shared ~/.kaitox. */
  root: string;
  /** Loaded from host SecretStorage; retained only in memory. */
  token: string;
  /** The adapter always uses 8765. An ephemeral port is useful for isolated tests. */
  port?: number;
}

interface RelayState {
  readonly token: string;
  readonly root: string;
  port: number;
}

/** Bind our own loopback listener. EADDRINUSE is an error; never reuse another process. */
export async function startRelay(options: RelayServerOptions): Promise<RelayServerHandle> {
  if (!isAbsolute(options.root)) throw new Error('Relay storage root must be an absolute plugin-private directory.');
  if (!options.token.trim()) throw new Error('Relay token is required. Configure the same token in the Kaitox Chrome extension.');
  await ensureRelayDirectory(options.root, true);
  const state: RelayState = { root: options.root, token: options.token, port: options.port ?? DEFAULT_PORT };
  const server: Server = createServer((req, res) => {
    handle(req, res, state).catch((err) => {
      sendJson(req, res, 500, { error: String(err?.message ?? err) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(state.port, HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (address && typeof address !== 'string') state.port = address.port;
  let closed = false;
  return {
    port: state.port,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
        server.closeAllConnections();
      });
    },
  };
}

// ---------------------------------------------------------------------------

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin as string | undefined;
  if (isAllowedOrigin(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-kaitox-token');
  }
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  setCors(req, res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** JSON.parse 包一层：语法错是客户端问题，回 400 而不是 500。 */
async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse(await readBody(req)) };
  } catch {
    return { ok: false };
  }
}

/** GET /setting 的响应形态。永不包含 token 值本身。 */
function settingView(state: RelayState): { port: number; version: string; tokenConfigured: boolean } {
  return { port: state.port, version: RELAY_VERSION, tokenConfigured: Boolean(state.token) };
}

/** 按 id 取某个 kind 下的草稿；不存在 / 非法 id 都视作 404。草稿按 kind 命名空间存储，
 *  只在该 kind 的目录里查找，因此跨命名空间天然不可见。 */
async function getDraftInKind(kind: string, id: string, root: string): Promise<DraftBundle | null> {
  try {
    return await getDraft(id, kind, root);
  } catch {
    return null;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, state: RelayState): Promise<void> {
  const method = req.method ?? 'GET';
  if (!isAllowedOrigin(req.headers.origin)) {
    sendJson(req, res, 403, { error: 'origin not allowed' });
    return;
  }

  // CORS 预检
  if (method === 'OPTIONS') {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['x-article', 'drafts', ':id']

  // GET /health —— 仅存活探测，不校验 token（daemon 探活、status 都靠它）。
  if (method === 'GET' && parts.length === 1 && parts[0] === 'health') {
    sendJson(req, res, 200, { ok: true, version: RELAY_VERSION, port: state.port });
    return;
  }

  // token 校验（配置了才校验）
  if (state.token && req.headers['x-kaitox-token'] !== state.token) {
    sendJson(req, res, 401, { error: 'unauthorized' });
    return;
  }

  // 基础设施：/setting（与 /health 并列，但受 token 保护——改 token 需先出示旧 token）
  if (parts.length === 1 && parts[0] === 'setting') {
    if (method === 'GET') {
      sendJson(req, res, 200, settingView(state));
      return;
    }
    if (method === 'PATCH') {
      sendJson(req, res, 405, { error: 'Relay token is managed by TALOS SecretStorage; configure it in the host and extension.' });
      return;
    }
  }

  // v0.4 前的旧根路由：干净断裂，留一个迁移提示。
  if (parts[0] === 'drafts') {
    sendJson(req, res, 410, {
      error: "routes are namespaced by kind since v0.5: use /:kind/drafts (e.g. /x-article/drafts)",
    });
    return;
  }

  // /:kind/drafts...
  if (parts.length >= 2 && parts[1] === 'drafts') {
    const kind = decodeURIComponent(parts[0]);
    if (!isValidKindSegment(kind)) {
      sendJson(req, res, 400, {
        error: `invalid kind path segment '${kind}' (expected /^[a-z0-9][a-z0-9-]*$/, not a reserved word)`,
      });
      return;
    }

    // GET /:kind/drafts
    if (method === 'GET' && parts.length === 2) {
      sendJson(req, res, 200, await listDrafts(kind, state.root));
      return;
    }
    // POST /:kind/drafts
    if (method === 'POST' && parts.length === 2) {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendJson(req, res, 400, { error: 'invalid JSON body' });
        return;
      }
      const v = validatePostDraftWireBody(body.value);
      if (!v.ok) {
        sendJson(req, res, 400, { error: 'invalid draft bundle', issues: v.issues });
        return;
      }
      // kind 以路径段为准；body 里带了不一致的 kind 视为客户端 bug，明确拒绝。
      if (v.value.bundle.kind !== undefined && v.value.bundle.kind !== kind) {
        sendJson(req, res, 400, {
          error: `bundle.kind '${v.value.bundle.kind}' does not match route kind '${kind}'`,
        });
        return;
      }
      const id = await saveDraft(v.value, kind, state.root);
      sendJson(req, res, 201, { id });
      return;
    }

    const id = parts[2] ? decodeURIComponent(parts[2]) : '';

    // GET /:kind/drafts/:id/assets/:fileName
    if (method === 'GET' && parts.length === 5 && parts[3] === 'assets') {
      if (!(await getDraftInKind(kind, id, state.root))) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      const fileName = decodeURIComponent(parts[4]);
      let p: string | null;
      try {
        p = await getAssetPath(id, fileName, kind, state.root);
      } catch {
        sendJson(req, res, 400, { error: '非法文件名' });
        return;
      }
      if (!p) {
        sendJson(req, res, 404, { error: 'asset not found' });
        return;
      }
      const file = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
      setCors(req, res);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      file.createReadStream().on('error', () => res.destroy()).pipe(res);
      return;
    }

    // GET /:kind/drafts/:id
    if (method === 'GET' && parts.length === 3) {
      const d = await getDraftInKind(kind, id, state.root);
      if (!d) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      sendJson(req, res, 200, d);
      return;
    }

    // PUT /:kind/drafts/:id/cover
    if (method === 'PUT' && parts.length === 4 && parts[3] === 'cover') {
      if (!(await getDraftInKind(kind, id, state.root))) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendJson(req, res, 400, { error: 'invalid JSON body' });
        return;
      }
      const v = validateSetCoverWireBody(body.value);
      if (!v.ok) {
        sendJson(req, res, 400, { error: 'invalid cover body', issues: v.issues });
        return;
      }
      let updated: Awaited<ReturnType<typeof setCover>>;
      try {
        updated = await setCover(id, v.value, kind, state.root);
      } catch {
        sendJson(req, res, 400, { error: '非法文件名' });
        return;
      }
      if (!updated) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      sendJson(req, res, 200, updated);
      return;
    }

    // PATCH /:kind/drafts/:id
    if (method === 'PATCH' && parts.length === 3) {
      if (!(await getDraftInKind(kind, id, state.root))) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendJson(req, res, 400, { error: 'invalid JSON body' });
        return;
      }
      const v = validateAckPatch(body.value);
      if (!v.ok) {
        sendJson(req, res, 400, { error: 'invalid status patch', issues: v.issues });
        return;
      }
      const updated = await patchDraft(id, v.value, kind, state.root);
      if (!updated) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      sendJson(req, res, 200, updated);
      return;
    }

    // DELETE /:kind/drafts/:id
    if (method === 'DELETE' && parts.length === 3) {
      if (!(await getDraftInKind(kind, id, state.root))) {
        sendJson(req, res, 404, { deleted: false });
        return;
      }
      const ok = await deleteDraft(id, kind, state.root);
      sendJson(req, res, ok ? 200 : 404, { deleted: ok });
      return;
    }
  }

  sendJson(req, res, 404, { error: `no route: ${method} ${url.pathname}` });
}
