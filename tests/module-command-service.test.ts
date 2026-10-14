import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import {
 ModuleCommandService, type ModuleCommandHost,
 type ModuleDataKey, type ModuleFile,
} from '../src/module-commands/service';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const matches = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
const signal = (): AbortSignal => new AbortController().signal;

class MapHost implements ModuleCommandHost {
 readonly data = new Map<string, Uint8Array>();
 readonly mapping: Record<ModuleDataKey, string> & { system: string } = {
  inbox: 'Inbox', logs: 'Logs', insights: 'Insights', assets: 'Assets',
  projects: 'Projects', archive: 'Archive', identity: 'Identity', output: 'Output', system: 'System',
 };
 rejectWrites = false;
 beforeWrite?: (path: string, content: Uint8Array, count: number) => void;
 afterWrite?: (path: string, content: Uint8Array, count: number) => void;
 beforeRemove?: (path: string) => void;
 roots = (): Record<ModuleDataKey, string> & { system?: string } => ({ ...this.mapping });
 files = (): ModuleFile[] => [...this.data].map(([path, content]) => ({ path, extension: path.split('.').pop() ?? '', size: content.length, mtime: this.now().getTime() }));
 exists = async (path: string): Promise<boolean> => this.data.has(path);
 read = async (path: string): Promise<Uint8Array> => {
  const value = this.data.get(path);
  if (!value) throw new Error('File missing');
  return new Uint8Array(value);
 };
 write = vi.fn(async (path: string, content: Uint8Array, expected?: Uint8Array | null): Promise<void> => {
  const count = this.write.mock.calls.length;
  this.beforeWrite?.(path, content, count);
  const current = this.data.get(path);
  if (expected === undefined) throw new Error('Missing conditional-write precondition');
  if (expected === null ? current !== undefined : !current || !matches(current, expected)) throw new Error('Conditional write conflict');
  this.data.set(path, new Uint8Array(content));
  this.afterWrite?.(path, content, count);
 });
 remove = vi.fn(async (path: string, expected?: Uint8Array): Promise<void> => {
  this.beforeRemove?.(path);
  const current = this.data.get(path);
  if (!expected || !current || !matches(current, expected)) throw new Error('Conditional delete conflict');
  this.data.delete(path);
 });
 assertPath = vi.fn(async (path: string, write: boolean): Promise<void> => {
  if (write && this.rejectWrites) throw new Error('Permission changed');
  if (path.startsWith('Outside/')) throw new Error('Outside allowed scope');
 });
 now = (): Date => new Date('2026-09-05T08:00:00Z');
 seed(path: string, content: string | Uint8Array): void { this.data.set(path, typeof content === 'string' ? bytes(content) : new Uint8Array(content)); }
 snapshot(): Map<string, Uint8Array> { return new Map([...this.data].map(([path, content]) => [path, new Uint8Array(content)])); }
}

describe('native module import/export and supported conversions', () => {
 it('puts the created review report before source references even with more than 100 activity files', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  for (let i = 0; i < 110; i++) host.seed(`Inbox/activity-${i}.md`, 'activity');
  const plan = await service.prepare('flow.review', { content: 'confirmed review' });
  expect(plan.result.paths[0]).toBe(plan.changes[0].path);
  expect(plan.result.paths[0]).toContain('Logs/复盘草稿-');
 });

 it('initializes all eight configured data modules without overwriting existing identity', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  host.seed('Identity/身份.md', 'existing identity');
  const plan = await service.prepare('setup.initialize', { owner_name: 'sample', primary_goal: 'sample goal' });
  expect(plan.changes).toHaveLength(8);
  await service.apply(plan, signal());
  expect(decoder.decode(host.data.get('Identity/身份.md'))).toBe('existing identity');
 });

 it('previews without writes and retains MD/TXT/CSV/JSON and binary originals byte-for-byte', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const input = [
   { name: '中文.md', content: bytes('---\ntype: system\n---\n# 用户原文\r\n') },
   { name: '资料.txt', content: bytes('<script>hello</script>\n中文😀') },
   { name: '表格.csv', content: bytes('名称,数值\n一,01\n') },
   { name: '数据.json', content: bytes('{"id":12345678901234567890}') },
   { name: '图像.webp', content: Uint8Array.of(0, 255, 128, 42) },
   { name: '视频.mov', content: Uint8Array.from({ length: 256 }, (_, index) => index) },
  ];
  const plan = await service.prepare('library.import', { files: input });
  expect(host.data.size).toBe(0); expect(host.write).not.toHaveBeenCalled();
  expect(plan.changes).toHaveLength(10);
  await service.apply(plan, signal());
  for (const file of input) {
   const path = [...host.data.keys()].find(candidate => candidate.endsWith(`/原件/${file.name}`));
   expect(path).toBeDefined(); expect(host.data.get(path!)).toEqual(file.content);
  }
  const standard = [...host.data].filter(([path]) => path.includes('/标准内容/'));
  expect(standard).toHaveLength(4);
  expect(decoder.decode(standard.find(([path]) => path.endsWith('资料.txt.md'))![1])).toContain('```text');
  expect(decoder.decode(standard.find(([path]) => path.endsWith('中文.md.md'))![1])).toMatch(/^---\ntitle:/);
 });

 it('copies caller bytes so later changes cannot alter the preview or write', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const content = Uint8Array.of(1, 2, 3);
  const plan = await service.prepare('library.import', { files: [{ name: 'x.bin', content }] });
  content.fill(99);
  await service.apply(plan, signal());
  expect(host.data.get(plan.changes[0].path)).toEqual(Uint8Array.of(1, 2, 3));
 });

 it('keeps malformed or unknown documents as original-only with honest warnings', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('library.import', { files: [
   { name: 'bad.json', content: bytes('{') },
   { name: 'bad.csv', content: bytes('a,"unfinished') },
   { name: 'bad.txt', content: Uint8Array.of(0xc3, 0x28) },
   { name: 'scan.pdf', content: bytes('%PDF-1.7') },
  ] });
  expect(plan.changes).toHaveLength(4); expect(plan.result.warnings.length).toBeGreaterThanOrEqual(4);
  expect(plan.changes.every(change => change.path.includes('/原件/'))).toBe(true);
  await service.apply(plan, signal()); expect(host.data.size).toBe(4);
 });

 it('round-trips explicitly selected personal identity, text and media through a data package', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const originals = new Map<string, Uint8Array>([
   ['Identity/身份.md', bytes('# 用户身份\n中文')], ['Assets/图.png', Uint8Array.of(0, 128, 255)],
   ['Assets/视频.mp4', Uint8Array.of(255, 0, 50, 128)], ['Inbox/a.csv', bytes('x,y\r\n1,2\r\n')],
   ['Inbox/a.json', bytes('{"nested":{"value":true}}')], ['Logs/今日.txt', bytes('记录😀')],
  ]);
  for (const [path, content] of originals) host.seed(path, content);
  const plan = await service.prepare('library.backup', { paths: 'Identity\nAssets\nInbox\nLogs\n' });
  await service.apply(plan, signal());
  const packaged = host.data.get(plan.changes[0].path)!;
  const restored = await service.prepare('library.restore', { files: [{ name: 'backup.json', content: packaged }] });
  await service.apply(restored, signal());
  for (const [path, content] of originals) {
   expect(host.data.get(path)).toEqual(content);
   const destination = restored.changes.find(change => change.path.endsWith(`/${path}`));
   expect(destination).toBeDefined(); expect(host.data.get(destination!.path)).toEqual(content);
  }
 });

 it('reports only actual convert support and preserves source bytes', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  host.seed('Inbox/a.txt', '<script>hello</script>'); host.seed('Inbox/b.html', '<b>x</b>'); host.seed('Inbox/c.vtt', 'WEBVTT');
  const info = await service.prepare('convert.inspect');
  expect(info.result.text).toContain('Inbox/a.txt：基础文本转换可用');
  expect(info.result.text).toContain('Inbox/b.html：原件可保留；需要格式解析器');
  expect(info.result.text).toContain('Inbox/c.vtt：原件可保留；需要格式解析器');
  const plan = await service.prepare('convert.convert', { path: 'Inbox/a.txt', format: '.HTML' });
  await service.apply(plan, signal());
  expect(decoder.decode(host.data.get(plan.changes[0].path))).toContain('&lt;script&gt;');
  expect(decoder.decode(host.data.get('Inbox/a.txt'))).toBe('<script>hello</script>');
  await expect(service.prepare('convert.convert', { path: 'Inbox/b.html', format: 'md' })).rejects.toThrow('暂不支持');
 });

 it.each(['media.ocr', 'media.transcribe'])('does not claim external recognition for %s', async action => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  await expect(service.prepare(action)).rejects.toThrow('尚未配置'); expect(host.write).not.toHaveBeenCalled();
 });
});

describe('bounded local cycle and deterministic repair', () => {
 it('produces and reads real files in a clean fictional vault', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'talos-fictional-cycle-'));
  const roots = { inbox: '00-收件箱', logs: '01-日志', insights: '02-洞察', assets: '03-素材', projects: '04-项目', archive: '05-归档', identity: 'System/Identity', output: '输出', system: 'System' };
  const known = new Set<string>();
  const disk = (path: string): string => {
   const full = resolve(vault, path);
   if (!full.startsWith(`${vault}${sep}`)) throw new Error('Path escaped fictional vault');
   return full;
  };
  const seed = async (path: string, text: string): Promise<void> => { await mkdir(dirname(disk(path)), { recursive: true }); await writeFile(disk(path), text); known.add(path); };
  const current = async (path: string): Promise<Uint8Array | null> => await readFile(disk(path)).then(data => new Uint8Array(data), (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  try {
   await seed('00-收件箱/虚构项目.md', '# 虚构项目\n实验资料。\n');
   await seed('04-项目/待修复.md', '# Project body\n');
   await seed('System/working-memory/candidates-staging.md', '# 显式表达暂存\n');
   const host: ModuleCommandHost = {
    roots: () => roots,
    files: () => [...known].map(path => ({ path, extension: path.split('.').pop() ?? '', size: 0, mtime: Date.parse('2026-09-05') })),
    exists: async path => (await stat(disk(path)).then(() => true, () => false)),
    read: async path => { const data = await current(path); if (!data) throw new Error('Missing fictional file'); return data; },
    write: async (path, content, expected) => {
     const before = await current(path);
     if (expected === undefined || (expected === null ? before !== null : before === null || !matches(before, expected))) throw new Error('Conditional write conflict');
     await mkdir(dirname(disk(path)), { recursive: true });
     await writeFile(disk(path), content, { flag: expected === null ? 'wx' : 'w' }); known.add(path);
    },
    remove: async (path, expected) => {
     const before = await current(path);
     if (!expected || !before || !matches(before, expected)) throw new Error('Conditional delete conflict');
     await unlink(disk(path)); known.delete(path);
    },
    assertPath: async path => { disk(path); },
    now: () => new Date('2026-09-05T08:00:00Z'),
   };
   const service = new ModuleCommandService(host);
   const cycle = await service.prepare('flow.cycle', { path: '00-收件箱/虚构项目.md', content: '这个虚构项目需要每周核对。', memory_kind: '明确偏好' });
   expect(await current(cycle.changes[0].path)).toBeNull();
   await service.apply(cycle, signal());
   for (const change of cycle.changes) expect(await current(change.path)).toEqual(change.after);
   expect(decoder.decode(await current('System/working-memory/candidates-staging.md') ?? bytes(''))).toContain('待偏好消化');
   const search = await service.prepare('search.find', { query: '实验资料' });
   expect(search.result.paths.some(path => path.startsWith('02-洞察/资料索引-'))).toBe(true);
   const repair = await service.prepare('system.repair', { scope: '04-项目' });
   expect(repair.changes.map(change => change.path)).toEqual(['04-项目/待修复.md']);
   await service.apply(repair, signal());
   expect(decoder.decode(await current('04-项目/待修复.md') ?? bytes(''))).toBe('---\n---\n\n# Project body\n');
  } finally { await rm(vault, { recursive: true, force: true }); }
 });

 it('writes an actual intake copy, searchable index, confirmed memory, maintenance record and receipt', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const original = '# 虚构项目\n下一步是整理样本。\n';
  host.seed('Inbox/项目.md', original);
  host.seed('System/working-memory/candidates-staging.md', '# 显式表达暂存\n');
  const before = host.snapshot();
  const plan = await service.prepare('flow.cycle', { path: 'Inbox/项目.md', content: '我希望每周检查这个虚构项目。' });
  expect(host.data).toEqual(before);
  expect(host.write).not.toHaveBeenCalled();
  expect(plan.changes).toHaveLength(6);
  expect(plan.changes.map(change => change.path)).toEqual(expect.arrayContaining([
   expect.stringContaining('Assets/入库-'), expect.stringContaining('Insights/资料索引-'),
   'System/working-memory/daily/2026-09-05.md', expect.stringContaining('Logs/维护检查-'), expect.stringContaining('Output/本地资料闭环-'),
  ]));
  await service.apply(plan, signal());
  const path = (prefix: string): string => plan.changes.find(change => change.path.startsWith(prefix))!.path;
  expect(host.data.get(path('Assets/入库-'))).toEqual(bytes(original));
  expect(decoder.decode(host.data.get(plan.changes.find(change => change.path.endsWith('/标准内容.md'))!.path))).toContain(original);
  const index: unknown = JSON.parse(decoder.decode(host.data.get(path('Insights/资料索引-'))));
  expect(index).toMatchObject({ schema: 'talos.local-text-index', source_path: 'Inbox/项目.md', text: original });
  expect(decoder.decode(host.data.get('System/working-memory/daily/2026-09-05.md'))).toContain('我希望每周检查这个虚构项目。');
  expect(decoder.decode(host.data.get('System/working-memory/candidates-staging.md'))).toBe('# 显式表达暂存\n');
  expect(decoder.decode(host.data.get(path('Logs/维护检查-')))).toContain('来源缺少元数据，原文未修改');
  expect(decoder.decode(host.data.get(path('Output/本地资料闭环-')))).toContain(plan.changes.find(change => change.path.endsWith('/标准内容.md'))!.path);
  expect(decoder.decode(host.data.get('Inbox/项目.md'))).toBe(original);
  await service.undo(plan);
  expect(host.data).toEqual(before);
 });

 it('stages an explicit preference without adopting it into identity', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  host.seed('Inbox/source.md', '# Source\n');
  host.seed('Identity/PROFILE.md', '# Existing identity\n');
  host.seed('System/working-memory/candidates-staging.md', '# Existing staging\n');
  const plan = await service.prepare('flow.cycle', { path: 'Inbox/source.md', content: '请用简短中文回答。', memory_kind: '明确偏好' });
  await service.apply(plan, signal());
  expect(decoder.decode(host.data.get('Identity/PROFILE.md'))).toBe('# Existing identity\n');
  expect(decoder.decode(host.data.get('System/working-memory/daily/2026-09-05.md'))).toContain('请用简短中文回答。');
  expect(decoder.decode(host.data.get('System/working-memory/candidates-staging.md'))).toContain('状态：待偏好消化；未写入正式个人档案。');
  expect(plan.result.warnings.join(' ')).toContain('不会自动晋升正式偏好');
 });

 it('rejects a changed source after preview and does not infer memory from imported text', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  host.seed('Inbox/source.txt', 'a private sample');
  await expect(service.prepare('flow.cycle', { path: 'Inbox/source.txt' })).rejects.toThrow('用户确认记忆');
  await expect(service.prepare('flow.cycle', { path: 'Identity/PROFILE.md', content: 'confirmed' })).rejects.toThrow('收件箱');
  const plan = await service.prepare('flow.cycle', { path: 'Inbox/source.txt', content: 'confirmed' });
  host.seed('Inbox/source.txt', 'later user edit');
  await expect(service.apply(plan, signal())).rejects.toThrow('重新预览');
  expect([...host.data.keys()]).toEqual(['Inbox/source.txt']);
  expect(host.write).not.toHaveBeenCalled();
 });

 it('repairs only deterministic missing frontmatter and preserves every body byte', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  host.seed('Inbox/ordinary.md', '# Header\r\n中文正文\r\n');
  host.seed('Inbox/with-fm.md', '---\nstatus: custom\n---\n\n# unchanged');
  host.seed('Inbox/broken.md', '---\nstatus: unfinished\n# body');
  host.seed('Identity/PROFILE.md', '# personal meaning');
  host.seed('Inbox/README.md', '# folder readme');
  const plan = await service.prepare('system.repair');
  expect(host.write).not.toHaveBeenCalled();
  expect(plan.changes.map(change => change.path)).toEqual(['Inbox/ordinary.md']);
  expect(plan.details.join('\n')).toContain('Identity/PROFILE.md：身份文件需通过专用入口处理');
  expect(plan.details.join('\n')).toContain('Inbox/broken.md：元数据不完整');
  await service.apply(plan, signal());
  expect(decoder.decode(host.data.get('Inbox/ordinary.md'))).toBe('---\n---\n\n# Header\r\n中文正文\r\n');
  const verified = await service.prepare('system.check');
  expect(verified.details.join('\n')).not.toContain('Inbox/ordinary.md');
  await service.undo(plan);
  expect(decoder.decode(host.data.get('Inbox/ordinary.md'))).toBe('# Header\r\n中文正文\r\n');
 });

 it('limits repair to a selected scope and rejects stale writes', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  host.seed('Inbox/a.md', '# old'); host.seed('Projects/b.md', '# other');
  const plan = await service.prepare('system.repair', { scope: 'Inbox' });
  expect(plan.changes.map(change => change.path)).toEqual(['Inbox/a.md']);
  host.seed('Inbox/a.md', '# later edit');
  await expect(service.apply(plan, signal())).rejects.toThrow('重新预览');
  expect(decoder.decode(host.data.get('Inbox/a.md'))).toBe('# later edit');
  expect(decoder.decode(host.data.get('Projects/b.md'))).toBe('# other');
 });

 it('restores a partially applied repair when the user cancels', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  host.seed('Inbox/a.md', '# A'); host.seed('Inbox/b.md', '# B');
  const before = host.snapshot();
  const plan = await service.prepare('system.repair', { scope: 'Inbox' });
  const abort = new AbortController();
  host.afterWrite = (_path, _content, count) => { if (count === 1) abort.abort(); };
  await expect(service.apply(plan, abort.signal)).rejects.toThrow('已取消');
  expect(host.data).toEqual(before);
 });

 it('fails closed without a system mapping and protects working-memory from generic writes', async () => {
  const host = new MapHost();
  host.seed('Inbox/source.md', '# Source');
  host.seed('System/working-memory/daily/2026-09-05.md', '# Existing memory');
  const service = new ModuleCommandService(host);
  await expect(service.prepare('library.archive', { path: 'System/working-memory/daily/2026-09-05.md' })).rejects.toThrow('工作记忆');
  const oldRoots = host.roots;
  host.roots = () => { const dataRoots = { ...oldRoots() }; delete dataRoots.system; return dataRoots; };
  await expect(service.prepare('flow.cycle', { path: 'Inbox/source.md', content: 'confirmed' })).rejects.toThrow('未配置');
  expect(host.write).not.toHaveBeenCalled();
 });
});

describe('module boundaries and immutable plans', () => {
 it.each(['system.status', 'setup.inspect', 'system.help', 'project.status', 'profile.show', 'media.browse', 'convert.inspect', 'flow.morning', 'system.check', 'search.find'])('keeps %s readonly through prepare and apply', async action => {
  const host = new MapHost(); const service = new ModuleCommandService(host); host.seed('Inbox/a.md', '# 记录');
  const before = host.snapshot(); const plan = await service.prepare(action, { query: '记录' });
  expect(plan.changes).toHaveLength(0); await service.apply(plan, signal());
  expect(host.data).toEqual(before); expect(host.write).not.toHaveBeenCalled(); expect(host.remove).not.toHaveBeenCalled();
 });

 it.each(['Outside/private.md', '../Inbox/x.md', 'Inbox/%2e%2e/private.md', 'Inbox/.secret'])('rejects escaping library paths %s', async path => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  await expect(service.prepare('library.organize', { path, destination: 'Assets' })).rejects.toThrow();
  expect(host.write).not.toHaveBeenCalled();
 });

 it('blocks generic identity writes even when project and identity roots overlap', async () => {
  const host = new MapHost(); host.mapping.identity = 'Projects/Identity'; host.seed('Projects/Identity/profile.md', 'before');
  const service = new ModuleCommandService(host);
  await expect(service.prepare('project.update', { path: 'Projects/Identity/profile.md', content: 'inject' })).rejects.toThrow('身份');
  await expect(service.prepare('library.archive', { path: 'Projects/Identity/profile.md' })).rejects.toThrow('身份');
  await expect(service.prepare('library.organize', { path: 'Projects/Identity/profile.md', destination: 'Projects/Identity' })).rejects.toThrow('身份');
  expect(host.write).not.toHaveBeenCalled();
 });

 it('allows explicit identity update and retains earlier content', async () => {
  const host = new MapHost(); host.seed('Identity/PROFILE.md', '# 原档案'); const service = new ModuleCommandService(host);
  const plan = await service.prepare('profile.update', { content: '用户确认的补充' });
  expect(host.write).not.toHaveBeenCalled(); await service.apply(plan, signal());
  expect(decoder.decode(host.data.get('Identity/PROFILE.md'))).toContain('# 原档案');
  expect(decoder.decode(host.data.get('Identity/PROFILE.md'))).toContain('用户确认的补充');
 });

 it('rejects hidden import names and colliding names before any writes', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  for (const names of [['.env'], ['a.bin', 'A.bin'], ['a', 'a/b']]) {
   await expect(service.prepare('library.import', { files: names.map(name => ({ name, content: bytes('x') })) })).rejects.toThrow();
  }
  expect(host.write).not.toHaveBeenCalled();
 });

 it('rejects forged plans and detects typed-array preview tampering', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('capture.note', { content: '真实内容' });
  await expect(service.apply({ ...plan }, signal())).rejects.toThrow('未知执行计划');
  expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.changes)).toBe(true);
  expect(() => { plan.changes[0].path = 'Identity/injected.md'; }).toThrow();
  plan.changes[0].after.fill(0);
  await expect(service.apply(plan, signal())).rejects.toThrow('已被修改');
  expect(host.write).not.toHaveBeenCalled();
 });
});

describe('conditional writes, cancellation and recovery', () => {
 it('checks source content again after preview, even for a new output file', async () => {
  const host = new MapHost(); host.seed('Inbox/a.txt', 'before'); const service = new ModuleCommandService(host);
  const plan = await service.prepare('convert.convert', { path: 'Inbox/a.txt', format: 'md' });
  host.seed('Inbox/a.txt', 'user edit');
  await expect(service.apply(plan, signal())).rejects.toThrow('重新预览'); expect(host.write).not.toHaveBeenCalled();
 });

 it('checks target changes and permissions and mapping revisions before writing', async () => {
  for (const conflict of ['target', 'permission', 'mapping']) {
   const host = new MapHost(); const service = new ModuleCommandService(host);
   const plan = await service.prepare('capture.note', { content: 'x' });
   if (conflict === 'target') host.seed(plan.changes[0].path, 'user file');
   if (conflict === 'permission') host.rejectWrites = true;
   if (conflict === 'mapping') host.mapping.inbox = 'Changed';
   await expect(service.apply(plan, signal())).rejects.toThrow('重新预览'); expect(host.write).not.toHaveBeenCalled();
  }
 });

 it('uses a conditional precondition to protect edits racing after preflight', async () => {
  const host = new MapHost(); host.seed('Projects/a.md', 'before'); const service = new ModuleCommandService(host);
  const plan = await service.prepare('project.update', { path: 'Projects/a.md', content: 'planned' });
  host.beforeWrite = path => host.seed(path, 'later user edit');
  await expect(service.apply(plan, signal())).rejects.toThrow('未覆盖后续修改');
  expect(decoder.decode(host.data.get('Projects/a.md'))).toBe('later user edit');
 });

 it.each([false, true])('rolls back a partial batch when a host throws before/after writing (%s)', async persistBeforeFailure => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('library.import', { files: [{ name: 'a.txt', content: bytes('first') }, { name: 'b.bin', content: bytes('second') }] });
  const failSecond = (_path: string, _content: Uint8Array, count: number): void => { if (count === 2) throw new Error('sensitive-host-detail'); };
  if (persistBeforeFailure) host.afterWrite = failSecond; else host.beforeWrite = failSecond;
  await expect(service.apply(plan, signal())).rejects.toThrow('已恢复本批次写入');
  expect(host.data.size).toBe(0);
  await expect(service.apply(plan, signal())).rejects.toThrow('失效');
 });

 it('restores an updated file even when the host throws after persisting it', async () => {
  const host = new MapHost(); host.seed('Projects/a.md', 'original'); const service = new ModuleCommandService(host);
  const plan = await service.prepare('project.update', { path: 'Projects/a.md', content: 'new' });
  host.afterWrite = (_path, _content, count) => { if (count === 1) throw new Error('post-write failure'); };
  await expect(service.apply(plan, signal())).rejects.toThrow('已恢复');
  expect(decoder.decode(host.data.get('Projects/a.md'))).toBe('original');
 });

 it('preserves concurrent user edits when rolling back another failed file', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('library.import', { files: [{ name: 'a.bin', content: bytes('a') }, { name: 'b.bin', content: bytes('b') }] });
  host.beforeWrite = (_path, _content, count) => {
   if (count === 2) { host.seed(plan.changes[0].path, 'user changed first'); throw new Error('write failed'); }
  };
  await expect(service.apply(plan, signal())).rejects.toThrow('未覆盖后续修改');
  expect(decoder.decode(host.data.get(plan.changes[0].path))).toBe('user changed first');
 });

 it('cancels before writing and during a batch, restoring the partial batch', async () => {
  for (const during of [false, true]) {
   const host = new MapHost(); const service = new ModuleCommandService(host); const abort = new AbortController();
   const plan = await service.prepare('library.import', { files: [{ name: 'a.txt', content: bytes('a') }] });
   if (during) host.afterWrite = () => abort.abort(); else abort.abort();
   await expect(service.apply(plan, abort.signal)).rejects.toThrow('已取消'); expect(host.data.size).toBe(0);
   if (!during) expect(host.write).not.toHaveBeenCalled();
  }
 });

 it('blocks concurrent and repeated execution of the same plan', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('capture.note', { content: 'one' });
  const first = service.apply(plan, signal());
  await expect(service.apply(plan, signal())).rejects.toThrow('已执行'); await first;
  await expect(service.apply(plan, signal())).rejects.toThrow('已执行'); expect(host.write).toHaveBeenCalledTimes(1);
 });

 it('undoes only this plan using private original snapshots', async () => {
  const host = new MapHost(); host.seed('Projects/a.md', 'original'); const service = new ModuleCommandService(host);
  const plan = await service.prepare('project.update', { path: 'Projects/a.md', content: 'update' });
  await service.apply(plan, signal()); await service.undo(plan);
  expect(decoder.decode(host.data.get('Projects/a.md'))).toBe('original');
  await expect(service.undo(plan)).rejects.toThrow('没有可撤销');
  const creation = await service.prepare('capture.note', { content: 'new note' });
  await service.apply(creation, signal()); await service.undo(creation);
  expect(host.data.has(creation.changes[0].path)).toBe(false); expect(host.data.size).toBe(1);
 });

 it('does not start undo when any target has later user content', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('library.import', { files: [{ name: 'a.bin', content: bytes('a') }, { name: 'b.bin', content: bytes('b') }] });
  await service.apply(plan, signal()); host.seed(plan.changes[0].path, 'user edit');
  await expect(service.undo(plan)).rejects.toThrow('已保留后续修改');
  expect(host.remove).not.toHaveBeenCalled(); expect(host.data.size).toBe(2);
 });

 it('condition-checks undo deletion and leaves a raced user edit intact', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('capture.note', { content: 'new' }); await service.apply(plan, signal());
  host.beforeRemove = path => host.seed(path, 'user changed during undo');
  await expect(service.undo(plan)).rejects.toThrow('已保留后续修改');
  expect(decoder.decode(host.data.get(plan.changes[0].path))).toBe('user changed during undo');
 });

 it('does not offer persistent undo after service recreation or for readonly plans', async () => {
  const host = new MapHost(); const service = new ModuleCommandService(host);
  const plan = await service.prepare('capture.note', { content: 'new' }); await service.apply(plan, signal());
  await expect(new ModuleCommandService(host).undo(plan)).rejects.toThrow('未知执行计划');
  const readonly = await service.prepare('system.status'); await service.apply(readonly, signal());
  await expect(service.undo(readonly)).rejects.toThrow('没有可撤销');
 });
});
