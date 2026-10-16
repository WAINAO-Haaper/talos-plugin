/**
 * 推送侧共享工具：CLI（bundleBuilder）与 Obsidian 插件构建草稿时的公共纯函数。
 *
 * 只放环境无关的逻辑（不碰 node:path / obsidian API / fetch）——各端的
 * 「怎么把 src 变成字节」（文件系统解析 vs vault 查找）本质不同，留在各端；
 * 这里收敛的是曾经复制粘贴且已分叉的部分：frontmatter 解析、文件名清洗、
 * MIME 猜测，以及 '__cover__' 哨兵约定（不变量 §3.2）的唯一产地。
 */

import type { DraftAssetInput } from '../relay-protocol/index.js';

/**
 * 剥离 YAML frontmatter，返回扁平的标量字段表 + 正文。
 * 只解析 `key: value` 形式的顶层标量（够 title/cover 用），不处理嵌套/列表。
 * 消费方各取所需：CLI/Obsidian 都用 fields.title 与 fields.cover。
 */
export function parseFrontmatter(md: string): { fields: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fields: {}, body: md };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:(.*)$/);
    if (!kv) continue;
    const value = kv[2].trim().replace(/^["']|["']$/g, '');
    if (value) fields[kv[1]] = value;
  }
  return { fields, body: md.slice(m[0].length) };
}

/** 路径或 URL 的最后一段（剥掉 query/hash 与目录）。 */
export function baseName(pathOrUrl: string): string {
  return pathOrUrl.split('?')[0].split('#')[0].split('/').pop() || '';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  // Video: X takes MP4 / MOV; the relay converts the rest to MP4 at ingest (needs ffmpeg).
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
};

/** 按文件名后缀猜 MIME（接受完整路径/URL，内部先取 baseName）。猜不出回退 octet-stream。 */
export function guessMimeFromName(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(baseName(name));
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'application/octet-stream';
}

/**
 * 把原始名清洗成 relay 落盘安全的文件名：只留 [a-zA-Z0-9._-]，无后缀补 .bin，
 * 与 taken 集合去重（-1/-2 后缀）。成功后把结果加入 taken。
 */
export function safeFileName(rawName: string, taken: Set<string>): string {
  let n = (rawName || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!/\.[a-zA-Z0-9]+$/.test(n)) n += '.bin';
  let cand = n;
  let i = 1;
  while (taken.has(cand)) {
    const dot = n.lastIndexOf('.');
    cand = `${n.slice(0, dot)}-${i}${n.slice(dot)}`;
    i++;
  }
  taken.add(cand);
  return cand;
}

/**
 * 构造封面资产 —— '__cover__' 哨兵 + 'cover-' 文件名前缀约定的唯一产地
 * （封面不进正文，不在 assets 里，字节与正文图一样落盘，见 ARCHITECTURE §3.2）。
 */
export function makeCoverAsset(
  bytes: Uint8Array,
  mime: string,
  rawName: string,
  taken: Set<string>,
): DraftAssetInput {
  const fileName = safeFileName(`cover-${baseName(rawName) || 'image'}`, taken);
  return { key: 'cover', src: '__cover__', fileName, mime, bytes };
}
