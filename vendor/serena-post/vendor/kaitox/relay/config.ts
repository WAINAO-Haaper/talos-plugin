/** TALOS adaptation: explicit plugin-private storage and in-memory authentication. */
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { lstat, mkdir } from 'node:fs/promises';
import { DEFAULT_RELAY_PORT } from '../relay-protocol/index';

export const RELAY_VERSION = '0.6.1-serenapost-talos';
export const DEFAULT_PORT = DEFAULT_RELAY_PORT;
export const HOST = '127.0.0.1';

/** No environment variables, home-directory lookup, or plaintext token config. */
export function outboxDir(kind: string, root: string): string {
  return join(root, kind, 'outbox');
}
export function sentDir(kind: string, root: string): string {
  return join(root, kind, 'sent');
}

/**
 * CORS：只放行 x.com / twitter.com 和任意 chrome-extension:// 源。
 * 无 Origin（CLI/同进程/curl）视为放行——它们不是浏览器跨源场景。
 */
const ALLOWED_ORIGIN_RE = [
  /^https?:\/\/(x\.com|twitter\.com|mobile\.twitter\.com)$/i,
  /^chrome-extension:\/\/[a-z]+$/i,
  /^app:\/\/obsidian\.md$/i, // Obsidian 桌面端 renderer
];

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGIN_RE.some((re) => re.test(origin));
}

/** Validate every component before creating/using a directory. Never resolve a link into another tree. */
export async function ensureRelayDirectory(path: string, create = false): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Relay directory must be an absolute normalized path.');
  let current = parse(path).root;
  for (const segment of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Relay storage directories must not contain symbolic links.');
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Relay storage directories must not contain symbolic links.');
    }
  }
}

/** Leaf-file check complements O_NOFOLLOW at each actual read/write/open. */
export async function assertRelayFile(root: string, path: string, allowMissing = false): Promise<void> {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Relay file is outside its private storage root.');
  await ensureRelayDirectory(root);
  await ensureRelayDirectory(dirname(path));
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Relay storage files must not be symbolic links.');
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
