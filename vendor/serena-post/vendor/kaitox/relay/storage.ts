/**
 * 草稿包在磁盘上的读写。按功能（kind）命名空间化：
 * <plugin-private-root>/<kind>/{outbox,sent}/<id>/bundle.json + assets/<fileName>。
 * kind 一律由路由层从 /:kind/... 路径段传入（已校验），storage 只当作目录段用。
 */
import { readFile, writeFile, readdir, rm, rename, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, basename } from 'node:path';
import { base64ToBytes } from '../relay-protocol/index';
import type { DraftBundle, DraftListItem, DraftStatus, PostDraftWireBody } from '../relay-protocol/index';
import { outboxDir, sentDir, ensureRelayDirectory, assertRelayFile } from './config';
import { fitImageBytes } from './imageFit';
import { fitVideoBytes } from './videoFit';

const BUNDLE_FILE = 'bundle.json';
const ASSETS_DIR = 'assets';

/** id / 文件名清洗，防目录穿越。 */
export function sanitizeId(id: string): string {
  const s = basename(String(id)).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!s) throw new Error('非法 id');
  return s;
}
export function sanitizeFileName(name: string): string {
  const s = basename(String(name));
  if (!s || s === '.' || s === '..' || /[\\/]/.test(name)) throw new Error('非法文件名');
  return s;
}

async function ensureDirs(kind: string, root: string): Promise<void> {
  await ensureRelayDirectory(root, true);
  await ensureRelayDirectory(outboxDir(kind, root), true);
  await ensureRelayDirectory(sentDir(kind, root), true);
}

function draftDir(kind: string, id: string, root: string, sent = false): string {
  return join(sent ? sentDir(kind, root) : outboxDir(kind, root), id);
}

/** 落盘一份草稿包（POST /:kind/drafts）。kind 由路由层从路径段传入，用于命名空间与盖章。返回 id。 */
export async function saveDraft(wire: PostDraftWireBody, kind: string, root: string): Promise<string> {
  await ensureDirs(kind, root);
  const id = sanitizeId(wire.bundle.id);
  const dir = draftDir(kind, id, root);
  await ensureRelayDirectory(join(dir, ASSETS_DIR), true);

  // 写资源字节（base64 → 二进制）；超过 X 上限的图片入库前静默压到限内。
  const written = new Map<string, { mime: string; bytesLen: number }>();
  const assetsByName = new Map(wire.assets.map((a) => [sanitizeFileName(a.fileName), a]));
  // TALOS does not discover or execute system transcoding tools; unsupported containers fail explicitly.
  for (const [fileName, a] of assetsByName) {
    const raw = base64ToBytes(a.base64);
    const fit = a.mime.startsWith('video/') ? await fitVideoBytes(raw, a.mime) : await fitImageBytes(raw, a.mime);
    written.set(fileName, { mime: fit.mime, bytesLen: fit.bytes.byteLength });
    await writePrivateFile(root, join(dir, ASSETS_DIR, fileName), fit.bytes);
  }

  const bundle: DraftBundle = {
    ...wire.bundle,
    id,
    // kind 以路径段为准盖章，与草稿所在的命名空间目录一致。
    kind,
    // 重编码可能改变格式与体积，元数据跟着落盘后的实际字节走。
    assets: (wire.bundle.assets ?? []).map((meta) => {
      const w = written.get(sanitizeFileName(meta.fileName));
      return w ? { ...meta, mime: w.mime, bytesLen: w.bytesLen } : meta;
    }),
    status: 'pending',
  };
  await writePrivateFile(root, join(dir, BUNDLE_FILE), JSON.stringify(bundle, null, 2), 'utf8');
  return id;
}

async function readBundleFrom(dir: string, root: string): Promise<DraftBundle | null> {
  try {
    const path = join(dir, BUNDLE_FILE);
    await assertRelayFile(root, path);
    const raw = await readFile(path, { encoding: 'utf8', flag: constants.O_RDONLY | constants.O_NOFOLLOW });
    return JSON.parse(raw) as DraftBundle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** 某个 kind 的草稿列表：outbox（pending/uploading/failed）+ sent（done），按创建时间倒序。
 *  已上传的草稿要留在列表里（消费方按 status 分栏展示），角标等按 status!=='done' 自行过滤。
 *  目录已按 kind 命名空间化，因此天然只含该 kind 的草稿，无需再逐条过滤。 */
export async function listDrafts(kind: string, root: string): Promise<DraftListItem[]> {
  await ensureDirs(kind, root);
  const items: DraftListItem[] = [];
  const seen = new Set<string>();
  // outbox 优先：万一 done 迁移 sent/ 时 rename 失败，两边同 id 以 outbox 为准。
  for (const sent of [false, true]) {
    let ids: string[];
    try {
      const directory = sent ? sentDir(kind, root) : outboxDir(kind, root);
      await ensureRelayDirectory(directory);
      ids = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      continue;
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      const b = await readBundleFrom(draftDir(kind, id, root, sent), root);
      if (!b) continue;
      seen.add(id);
      items.push({
        id: b.id,
        kind: b.kind,
        title: b.title,
        source: b.source,
        createdAt: b.createdAt,
        mode: b.mode,
        status: b.status ?? 'pending',
        counts: b.styleReport?.counts,
        assetCount: b.assets?.length ?? 0,
      });
    }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items;
}

/** 读取某个 kind 下的单个草稿包（先 outbox 后 sent）。 */
export async function getDraft(id: string, kind: string, root: string): Promise<DraftBundle | null> {
  const safe = sanitizeId(id);
  return (
    (await readBundleFrom(draftDir(kind, safe, root), root)) ?? (await readBundleFrom(draftDir(kind, safe, root, true), root))
  );
}

/** 资源文件的绝对路径（存在才返回）。先 outbox 后 sent。 */
export async function getAssetPath(id: string, fileName: string, kind: string, root: string): Promise<string | null> {
  const safe = sanitizeId(id);
  const safeName = sanitizeFileName(fileName);
  for (const sent of [false, true]) {
    const p = join(draftDir(kind, safe, root, sent), ASSETS_DIR, safeName);
    try {
      await assertRelayFile(root, p);
      return p;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

/** 设置/替换封面（PUT /drafts/:id/cover）。写字节并更新 bundle.cover；仅 outbox 里的草稿可改。
 *  body 带 original（用户新选图）时同时落盘原图并替换 bundle.coverOriginal；
 *  不带（基于原图重裁）时保留现有原图。 */
export async function setCover(
  id: string,
  cover: {
    fileName: string;
    mime: string;
    base64: string;
    original?: { fileName: string; mime: string; base64: string };
  },
  kind: string,
  root: string,
): Promise<DraftBundle | null> {
  const safe = sanitizeId(id);
  const dir = draftDir(kind, safe, root);
  const b = await readBundleFrom(dir, root);
  if (!b) return null;
  // 加 cover- 前缀，避免与正文图片同名互踩（正文 assets 的 fileName 来自 markdown src）。
  const fileName = `cover-${sanitizeFileName(cover.fileName)}`;
  const { bytes, mime } = await fitImageBytes(base64ToBytes(cover.base64), cover.mime);
  await ensureRelayDirectory(join(dir, ASSETS_DIR), true);
  await writePrivateFile(root, join(dir, ASSETS_DIR, fileName), bytes);
  let coverOriginal = b.coverOriginal;
  if (cover.original) {
    const origFileName = `cover-original-${sanitizeFileName(cover.original.fileName)}`;
    const fit = await fitImageBytes(base64ToBytes(cover.original.base64), cover.original.mime);
    await writePrivateFile(root, join(dir, ASSETS_DIR, origFileName), fit.bytes);
    coverOriginal = {
      key: 'cover-original',
      src: origFileName,
      fileName: origFileName,
      mime: fit.mime,
      bytesLen: fit.bytes.byteLength,
    };
  }
  // 不再被引用的旧封面/旧原图清掉，避免越攒越多。按「仍被引用集合」判断，防同名误删。
  const referenced = new Set([
    ...(b.assets ?? []).map((a) => a.fileName),
    fileName,
    ...(coverOriginal ? [coverOriginal.fileName] : []),
  ]);
  for (const old of [b.cover?.fileName, b.coverOriginal?.fileName]) {
    if (old && !referenced.has(old)) {
      const oldPath = join(dir, ASSETS_DIR, sanitizeFileName(old));
      await assertRelayFile(root, oldPath, true);
      await rm(oldPath, { force: true });
    }
  }
  const updated: DraftBundle = {
    ...b,
    cover: { key: 'cover', src: fileName, fileName, mime, bytesLen: bytes.byteLength },
    coverOriginal,
  };
  await writePrivateFile(root, join(dir, BUNDLE_FILE), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

/** 更新草稿状态；status='done' 时移入 sent/。 */
export async function patchDraft(
  id: string,
  patch: { status: DraftStatus; restId?: string; error?: string },
  kind: string,
  root: string,
): Promise<DraftBundle | null> {
  const safe = sanitizeId(id);
  const dir = draftDir(kind, safe, root);
  const b = await readBundleFrom(dir, root);
  if (!b) return null;
  const updated: DraftBundle = {
    ...b,
    status: patch.status,
    restId: patch.restId ?? b.restId,
    error: patch.error ?? b.error,
  };
  await writePrivateFile(root, join(dir, BUNDLE_FILE), JSON.stringify(updated, null, 2), 'utf8');
  if (patch.status === 'done') {
    const dest = draftDir(kind, safe, root, true);
    await ensureRelayDirectory(sentDir(kind, root));
    try { await ensureRelayDirectory(dest); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rm(dest, { recursive: true, force: true });
    await ensureRelayDirectory(dir);
    await rename(dir, dest);
  }
  return updated;
}

/** 删除草稿（outbox + sent 都删）。 */
export async function deleteDraft(id: string, kind: string, root: string): Promise<boolean> {
  const safe = sanitizeId(id);
  let removed = false;
  for (const sent of [false, true]) {
    const dir = draftDir(kind, safe, root, sent);
    try {
      await ensureRelayDirectory(dir);
      await lstat(dir);
      await rm(dir, { recursive: true, force: true });
      removed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

async function writePrivateFile(root: string, path: string, data: Uint8Array | string, encoding?: 'utf8'): Promise<void> {
  await assertRelayFile(root, path, true);
  await writeFile(path, data, { encoding, mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW });
}
