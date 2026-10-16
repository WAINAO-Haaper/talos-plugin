/**
 * 零依赖 wire 校验器 —— 线协议的可执行形态。
 *
 * relay 在边界上用它把畸形请求挡成 400（带 issue 路径），第三方生产者
 * 也可以在发送前用它自检。与 zod 等库不同，这里是手写结构检查，
 * 保持本包「零依赖、两端（Node/浏览器）通用」的属性。
 *
 * 刻意宽松（不变量）：
 *   - 不拒绝未知字段 —— schema 未来的加字段变更不应破坏旧 relay；
 *   - 不约束开放串 kind / source 的「取值」—— relay 对 kind 无感知，
 *     kind 作为 URL 路径段的字符规则见 isValidKindSegment（只在路由层检查）；
 *   - styleReport / sourceMeta 只要求「对象或缺席」—— 它们是建议性载荷；
 *   - 不校验 assets[].src 与 markdown 的对齐 —— 那是 x-article 特性语义
 *     （需要 marked），不属于线协议。
 */

import type { DraftStatus } from './bundle.js';
import type { PostDraftWireBody, SetCoverWireBody } from './relayClient.js';

export interface WireIssue {
  /** JSONPath 风格定位，如 '$.bundle.assets[0].mime'。 */
  path: string;
  message: string;
}

export type WireResult<T> = { ok: true; value: T } | { ok: false; issues: WireIssue[] };

// ---------------------------------------------------------------------------
// kind 作为 URL 路径段的规则（relay 路由层使用）
// ---------------------------------------------------------------------------

/** 与基础设施路由冲突的保留段；'drafts' 保留给旧根路由的 410 提示。 */
export const RESERVED_KIND_SEGMENTS: ReadonlySet<string> = new Set(['health', 'setting', 'drafts']);

/**
 * kind 能否作为 URL 路径段：小写字母/数字开头，只含 [a-z0-9-]，且非保留段。
 * 现有 kind（'x-article'）天然符合；第三方自定义 kind 需遵守同样规则。
 */
export function isValidKindSegment(kind: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(kind) && !RESERVED_KIND_SEGMENTS.has(kind);
}

// ---------------------------------------------------------------------------
// 结构检查
// ---------------------------------------------------------------------------

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pushStr(v: unknown, path: string, issues: WireIssue[], allowEmpty = false): void {
  if (typeof v !== 'string' || (!allowEmpty && !v)) {
    issues.push({ path, message: allowEmpty ? 'expected string' : 'expected non-empty string' });
  }
}

/** DraftAsset 元信息（bundle.assets[] / bundle.cover 共用形态）。 */
function checkAssetMeta(v: unknown, path: string, issues: WireIssue[]): void {
  if (!isRec(v)) {
    issues.push({ path, message: 'expected object' });
    return;
  }
  pushStr(v.key, `${path}.key`, issues);
  pushStr(v.src, `${path}.src`, issues);
  pushStr(v.fileName, `${path}.fileName`, issues);
  pushStr(v.mime, `${path}.mime`, issues);
  if (typeof v.bytesLen !== 'number') issues.push({ path: `${path}.bytesLen`, message: 'expected number' });
}

const DRAFT_STATUSES: ReadonlySet<string> = new Set(['pending', 'uploading', 'done', 'failed']);

/** POST /:kind/drafts 的 body。 */
export function validatePostDraftWireBody(input: unknown): WireResult<PostDraftWireBody> {
  if (!isRec(input)) return { ok: false, issues: [{ path: '$', message: 'expected object' }] };
  const issues: WireIssue[] = [];

  const b = input.bundle;
  if (!isRec(b)) {
    issues.push({ path: '$.bundle', message: 'expected object' });
  } else {
    pushStr(b.id, '$.bundle.id', issues);
    if (b.kind !== undefined) pushStr(b.kind, '$.bundle.kind', issues);
    pushStr(b.title, '$.bundle.title', issues, true);
    pushStr(b.markdown, '$.bundle.markdown', issues, true);
    if (b.mode !== 'rich' && b.mode !== 'plaintext') {
      issues.push({ path: '$.bundle.mode', message: "expected 'rich' | 'plaintext'" });
    }
    if (b.schemaVersion !== undefined && typeof b.schemaVersion !== 'number') {
      issues.push({ path: '$.bundle.schemaVersion', message: 'expected number' });
    }
    pushStr(b.createdAt, '$.bundle.createdAt', issues);
    pushStr(b.source, '$.bundle.source', issues);
    if (!Array.isArray(b.assets)) {
      issues.push({ path: '$.bundle.assets', message: 'expected array' });
    } else {
      b.assets.forEach((a, i) => checkAssetMeta(a, `$.bundle.assets[${i}]`, issues));
    }
    if (b.cover !== undefined) checkAssetMeta(b.cover, '$.bundle.cover', issues);
    if (b.coverOriginal !== undefined) checkAssetMeta(b.coverOriginal, '$.bundle.coverOriginal', issues);
    if (b.styleReport !== undefined && !isRec(b.styleReport)) {
      issues.push({ path: '$.bundle.styleReport', message: 'expected object' });
    }
    if (b.sourceMeta !== undefined && !isRec(b.sourceMeta)) {
      issues.push({ path: '$.bundle.sourceMeta', message: 'expected object' });
    }
  }

  if (!Array.isArray(input.assets)) {
    issues.push({ path: '$.assets', message: 'expected array' });
  } else {
    input.assets.forEach((a, i) => {
      if (!isRec(a)) {
        issues.push({ path: `$.assets[${i}]`, message: 'expected object' });
        return;
      }
      pushStr(a.fileName, `$.assets[${i}].fileName`, issues);
      pushStr(a.mime, `$.assets[${i}].mime`, issues);
      pushStr(a.base64, `$.assets[${i}].base64`, issues, true);
    });
  }

  return issues.length
    ? { ok: false, issues }
    : { ok: true, value: input as unknown as PostDraftWireBody };
}

/** PUT /:kind/drafts/:id/cover 的 body。 */
export function validateSetCoverWireBody(input: unknown): WireResult<SetCoverWireBody> {
  if (!isRec(input)) return { ok: false, issues: [{ path: '$', message: 'expected object' }] };
  const issues: WireIssue[] = [];
  pushStr(input.fileName, '$.fileName', issues);
  pushStr(input.mime, '$.mime', issues);
  pushStr(input.base64, '$.base64', issues);
  if (input.original !== undefined) {
    if (!isRec(input.original)) {
      issues.push({ path: '$.original', message: 'expected object' });
    } else {
      pushStr(input.original.fileName, '$.original.fileName', issues);
      pushStr(input.original.mime, '$.original.mime', issues);
      pushStr(input.original.base64, '$.original.base64', issues);
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: input as unknown as SetCoverWireBody };
}

/** PATCH /:kind/drafts/:id 的 body（上传端回填状态）。 */
export interface AckPatch {
  status: DraftStatus;
  restId?: string;
  error?: string;
}

export function validateAckPatch(input: unknown): WireResult<AckPatch> {
  if (!isRec(input)) return { ok: false, issues: [{ path: '$', message: 'expected object' }] };
  const issues: WireIssue[] = [];
  if (typeof input.status !== 'string' || !DRAFT_STATUSES.has(input.status)) {
    issues.push({ path: '$.status', message: `expected one of ${[...DRAFT_STATUSES].join(' | ')}` });
  }
  if (input.restId !== undefined) pushStr(input.restId, '$.restId', issues);
  if (input.error !== undefined) pushStr(input.error, '$.error', issues, true);
  return issues.length ? { ok: false, issues } : { ok: true, value: input as unknown as AckPatch };
}

/** PATCH /setting 的 body：undefined = 不改，string = 设置，null = 清除。 */
export interface SettingPatch {
  token?: string | null;
}

export function validateSettingPatch(input: unknown): WireResult<SettingPatch> {
  if (!isRec(input)) return { ok: false, issues: [{ path: '$', message: 'expected object' }] };
  const issues: WireIssue[] = [];
  if (input.token !== undefined && input.token !== null && typeof input.token !== 'string') {
    issues.push({ path: '$.token', message: 'expected string | null' });
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: input as unknown as SettingPatch };
}
