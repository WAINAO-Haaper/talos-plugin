/**
 * Host integration scope: real temporary Vault, content freezing/verification, private
 * file store, PublicationService and console/task runtime. Only Obsidian's sanitizer,
 * SecretStorage, WeChat transport and the X browser relay boundary are substitutes.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { lstat, mkdtemp, mkdir, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type TalosPlugin from '../src/main';
import { TFile } from 'obsidian';
import type { WeChatDraftArticle } from '../src/publishing/wechat';
import type { DraftAdapterContext, DraftReceipt, PreparedArticle, PublishingAccount } from '../src/publishing/types';

const boundary = vi.hoisted(() => ({
	getAccessToken: vi.fn<(appId: string, secret: string) => Promise<string>>(),
	uploadImage: vi.fn<(data: ArrayBuffer, fileName: string, token: string) => Promise<{ media_id: string; url: string }>>(),
	addDraft: vi.fn<(articles: WeChatDraftArticle[], token: string) => Promise<{ media_id: string }>>(),
	xConstruct: vi.fn<(options: unknown) => void>(),
	xCreate: vi.fn<(article: PreparedArticle, account: PublishingAccount, context: DraftAdapterContext) => Promise<DraftReceipt>>(),
	xReconcile: vi.fn<(receipt: DraftReceipt, account: PublishingAccount, signal: AbortSignal) => Promise<DraftReceipt>>(),
	xDispose: vi.fn<() => Promise<void>>(),
}));
vi.mock('obsidian', () => ({
	TFile: class {},
	requestUrl: vi.fn(() => { throw new Error('Unmocked network is prohibited in host integration tests.'); }),
	sanitizeHTMLToDom: (html: string) => {
		// eslint-disable-next-line no-unsanitized/method -- Production content checks remain real; this replaces only Obsidian's DOM API.
		return testWindow.document.createRange().createContextualFragment(html);
	},
}));
vi.mock('../vendor/serena-post/src/services/weixin-api', async importOriginal => ({
	...await importOriginal<typeof import('../vendor/serena-post/src/services/weixin-api')>(),
	getAccessToken: boundary.getAccessToken, uploadImage: boundary.uploadImage, addDraft: boundary.addDraft,
}));
vi.mock('../src/publishing/x-relay', () => ({ XRelayAdapter: class {
	constructor(options: unknown) { boundary.xConstruct(options); }
	createDraft(...args: Parameters<typeof boundary.xCreate>) { return boundary.xCreate(...args); }
	reconcile(...args: Parameters<typeof boundary.xReconcile>) { return boundary.xReconcile(...args); }
	dispose() { return boundary.xDispose(); }
} }));
vi.mock('../src/publishing/wechat', async importOriginal => {
	const actual = await importOriginal<typeof import('../src/publishing/wechat')>();
	return { ...actual, createWeChatDraftAdapter: vi.fn(actual.createWeChatDraftAdapter) };
});

import { assertPublishingSource, PublishingHost } from '../src/publishing/host';
import { FilePublishingStore } from '../src/publishing/store';
import { createWeChatDraftAdapter } from '../src/publishing/wechat';
import { aggregateRecordState } from '../src/publishing/service';
import { createConsoleActionRuntime, type ConsoleActionDependencies } from '../src/console-action-runtime';
import { MemoryRecoveryStore } from '../src/task-core/recovery-store';

const testWindow = new Window();
vi.stubGlobal('document', testWindow.document);
const noNetwork = vi.fn(() => Promise.reject(new Error('External fetch is prohibited in host integration tests.')));
vi.stubGlobal('fetch', noNetwork);
const hosts: PublishingHost[] = [];
const directories: string[] = [];
const appId = 'wx1234567890abcdef';
const appSecret = 'synthetic-publishing-credential';
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9V0AAAAASUVORK5CYII=', 'base64'));

function dependencies(): ConsoleActionDependencies {
	return {
		refreshStats: vi.fn(), vaultLint: vi.fn(), deepResearch: vi.fn(), createNote: vi.fn(),
		publishBackfill: vi.fn(), decideApproval: vi.fn(), decidePreference: vi.fn(),
	};
}
function fileMetadata(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	const dot = name.lastIndexOf('.');
	const file = new TFile();
	file.path = path; file.name = name;
	file.basename = dot < 0 ? name : name.slice(0, dot);
	file.extension = dot < 0 ? '' : name.slice(dot + 1);
	return file;
}
type WatchEvent = 'modify' | 'delete' | 'rename';
interface WatchRef { event: WatchEvent; callback: (file: { path: string }, oldPath?: string) => void; }
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'talos-publishing-host-'));
	directories.push(directory);
	const root = join(directory, 'vault');
	await mkdir(join(root, 'notes'), { recursive: true });
	await mkdir(join(root, 'media'));
	await writeFile(join(root, 'notes/article.md'), '# Article\n\nFrozen **body**.\n\n![body](cover.png)');
	await writeFile(join(root, 'media/cover.png'), png);
	const values = new Map<string, string>();
	const secretStorage = {
		setSecret: vi.fn((id: string, value: string) => { values.set(id, value); }),
		getSecret: vi.fn((id: string) => values.get(id) ?? null),
		listSecrets: vi.fn(() => [...values.keys()]),
	};
	const runtime = createConsoleActionRuntime({
		dependencies: dependencies(), recoveryStore: new MemoryRecoveryStore(),
		timers: { schedule: (callback, timeoutMs) => setTimeout(callback, timeoutMs), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
	});
	const files = [fileMetadata('notes/article.md'), fileMetadata('media/cover.png')];
	const watchers = new Set<WatchRef>();
	const vault = {
		configDir: '.config',
		adapter: {
			getBasePath: () => root,
			exists: vi.fn(async (path: string) => { try { await lstat(join(root, path)); return true; } catch { return false; } }),
		},
		getFiles: () => [...files],
		getMarkdownFiles: () => files.filter(file => file.extension === 'md'),
		getAbstractFileByPath: vi.fn((path: string) => files.find(file => file.path === path) ?? null),
		on: vi.fn((event: WatchEvent, callback: WatchRef['callback']) => { const ref = { event, callback }; watchers.add(ref); return ref; }),
		offref: vi.fn((ref: WatchRef) => { watchers.delete(ref); }),
	};
	const emit = (event: WatchEvent, path: string, oldPath?: string) => {
		for (const ref of [...watchers]) if (ref.event === event) ref.callback({ path }, oldPath);
	};
	const plugin = {
		app: {
			secretStorage,
			vault,
			metadataCache: { getFirstLinkpathDest: (reference: string) => reference === 'cover.png' ? { path: 'media/cover.png' } : null },
		},
		getConsoleActionRuntime: () => runtime,
	} as unknown as TalosPlugin;
	const host = new PublishingHost(plugin);
	hosts.push(host);
	const folder = join(root, '.talos/private/publishing');
	return { host, root, directory, folder, values, secretStorage, runtime, vault, files, watchers, emit };
}
async function configuredFixture(includeX = false) {
	const f = await fixture();
	await f.host.saveAccounts({ wechatLabel: 'Synthetic公众号', appId, appSecret, xAccount: includeX ? 'fixture_user' : '' });
	const article = await f.host.prepare({ sourcePath: 'notes/article.md', title: 'Synthetic title', author: 'Author', digest: 'Summary', coverPath: 'cover.png' });
	const accounts = (await f.host.loadConfig()).accounts;
	return { ...f, article, accounts };
}

beforeEach(() => {
	vi.clearAllMocks();
	boundary.getAccessToken.mockResolvedValue('synthetic-access-token');
	boundary.uploadImage.mockResolvedValue({ media_id: 'synthetic-cover-id', url: 'https://mmbiz.qpic.cn/synthetic.png' });
	boundary.addDraft.mockResolvedValue({ media_id: 'remote-wechat-draft-id' });
	boundary.xDispose.mockResolvedValue(undefined);
	boundary.xCreate.mockImplementation(async (article: PreparedArticle, account: PublishingAccount) => {
		const base: DraftReceipt = { platform: 'x', accountId: account.id, accountLabel: account.label, snapshotHash: article.fingerprint, state: 'failed', updatedAt: '2026-10-17T00:00:00Z' };
		return { ...base, error: 'Synthetic local X preflight rejection before delivery.' };
	});
});
afterEach(async () => {
	await Promise.all(hosts.splice(0).map(host => host.dispose()));
	await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
	expect(noNetwork).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});
afterAll(async () => { await testWindow.happyDOM.close(); vi.unstubAllGlobals(); });

describe('publishing source boundaries in a real temporary Vault', () => {
	it('accepts ordinary files and in-Vault symlinks but rejects an out-of-Vault target', async () => {
		const { root, directory } = await fixture();
		const note = join(root, 'notes/article.md');
		expect(await assertPublishingSource(root, 'notes/article.md', '.config')).toBe(await realpath(note));
		await symlink(note, join(root, 'notes/in-vault.md'));
		expect(await assertPublishingSource(root, 'notes/in-vault.md', '.config')).toBe(await realpath(note));
		const outside = join(directory, 'outside.md');
		await writeFile(outside, 'Synthetic outside content');
		await symlink(outside, join(root, 'notes/outside-alias.md'));
		await expect(assertPublishingSource(root, 'notes/outside-alias.md', '.config')).rejects.toThrow('超出当前资料库');
	});

	it.each(['.config', '.talos/private'])('blocks direct paths and innocently named symlinks into %s', async blockedDirectory => {
		const { root, host } = await fixture();
		await mkdir(join(root, blockedDirectory), { recursive: true });
		await writeFile(join(root, blockedDirectory, 'hidden.md'), 'Synthetic protected content');
		await symlink(join(root, blockedDirectory, 'hidden.md'), join(root, 'notes/ordinary-alias.md'));
		await expect(assertPublishingSource(root, `${blockedDirectory}/hidden.md`, '.config')).rejects.toThrow('不可外发');
		await expect(assertPublishingSource(root, 'notes/ordinary-alias.md', '.config')).rejects.toThrow('不可外发');
		await expect(host.prepare({ sourcePath: 'notes/ordinary-alias.md', title: 'Attempted alias', author: '', digest: '' })).rejects.toThrow('不可外发');
	});
});

describe('publishing file selection and source watching', () => {
	it('lists supported image metadata while filtering protected paths and non-images without reading bytes', async () => {
		const { host, files, vault, secretStorage } = await fixture();
		const supported = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'JPG'].map((extension, index) => `附件/封面${index}.${extension}`);
		files.splice(0, files.length, ...[
			...supported, '.config/hidden.png', '.talos/private/hidden.png', '.talos/secrets/image.png',
			'附件/api-key.png', '附件/video.mp4', '附件/document.pdf', 'notes/article.md',
		].map(fileMetadata));
		expect(host.listImages().map(file => file.path)).toEqual(supported);
		expect(vault.adapter.exists).not.toHaveBeenCalled();
		expect(secretStorage.getSecret).not.toHaveBeenCalled();
	});

	it('notifies only for the selected source, follows its rename, and unregisters all listeners', async () => {
		const { host, emit, watchers, vault } = await fixture();
		const changed = vi.fn();
		const stop = host.watchSource('notes/article.md', changed);
		expect(watchers.size).toBe(3);
		emit('modify', 'notes/other.md');
		emit('delete', 'notes/other.md');
		emit('rename', 'notes/renamed-other.md', 'notes/other.md');
		expect(changed).not.toHaveBeenCalled();
		emit('modify', 'notes/article.md');
		emit('rename', 'notes/renamed.md', 'notes/article.md');
		emit('modify', 'notes/article.md');
		emit('modify', 'notes/renamed.md');
		emit('delete', 'notes/renamed.md');
		expect(changed.mock.calls).toEqual([
			['notes/article.md'], ['notes/renamed.md'], ['notes/renamed.md'], ['notes/renamed.md'],
		]);
		stop(); stop();
		expect(watchers.size).toBe(0);
		expect(vault.offref).toHaveBeenCalledTimes(3);
		emit('modify', 'notes/renamed.md');
		expect(changed).toHaveBeenCalledTimes(4);
	});

	it('removes source listeners on host disposal and cannot add new listeners afterward', async () => {
		const { host, emit, watchers, vault } = await fixture();
		const changed = vi.fn();
		host.watchSource('notes/article.md', changed);
		await host.dispose();
		expect(watchers.size).toBe(0);
		host.watchSource('notes/article.md', changed)();
		expect(vault.on).toHaveBeenCalledTimes(3);
		emit('modify', 'notes/article.md');
		expect(changed).not.toHaveBeenCalled();
	});

	it.each([true, false])('resolves a complete Chinese Vault cover path when indexed=%s without prepending the note folder', async indexed => {
		const { host, root, files, vault } = await fixture();
		const path = '附件/封面/中文封面.png';
		await mkdir(join(root, '附件/封面'), { recursive: true });
		await writeFile(join(root, path), png);
		if (indexed) files.push(fileMetadata(path));
		const prepared = await host.prepare({ sourcePath: 'notes/article.md', title: '中文封面测试', author: '', digest: '', coverPath: path });
		expect(prepared.cover?.bytes).toEqual(png);
		expect(vault.getAbstractFileByPath).toHaveBeenCalledWith(path);
		if (!indexed) expect(vault.adapter.exists).toHaveBeenCalledWith(path);
	});

	it('keeps the realpath boundary for complete cover paths pointing outside the Vault', async () => {
		const { host, root, directory } = await fixture();
		await writeFile(join(directory, 'outside.png'), png);
		await symlink(join(directory, 'outside.png'), join(root, '中文封面.png'));
		await expect(host.prepare({ sourcePath: 'notes/article.md', title: '不可外发', author: '', digest: '', coverPath: '中文封面.png' })).rejects.toThrow('超出当前库范围');
	});
});

describe('PublishingHost account and approval integration', () => {
	it('releases revoked preview snapshots and rejects their tokens before any transport', async () => {
		const { host, article, accounts, secretStorage } = await configuredFixture();
		secretStorage.getSecret.mockClear();
		const approval = await host.proposal(article, accounts.map(account => account.id));
		host.revokeApproval(approval.id);
		host.revokeApproval(approval.id);
		await expect(host.confirm(approval.id, vi.fn())).rejects.toThrow('确认已失效');
		expect(secretStorage.getSecret).not.toHaveBeenCalled();
		expect(boundary.getAccessToken).not.toHaveBeenCalled();
		expect(boundary.addDraft).not.toHaveBeenCalled();
	});

	it('prepares and proposes offline without reading credentials, starting adapters or opening a task', async () => {
		const { host, article, accounts, secretStorage, runtime } = await configuredFixture(true);
		secretStorage.getSecret.mockClear();
		const approval = await host.proposal(article, accounts.map(account => account.id));
		expect(approval.article).toMatchObject({ title: 'Synthetic title', fingerprint: article.fingerprint });
		expect(approval.article.wechatHtml).toContain('<strong');
		expect(boundary.getAccessToken).not.toHaveBeenCalled();
		expect(boundary.addDraft).not.toHaveBeenCalled();
		expect(boundary.xConstruct).not.toHaveBeenCalled();
		expect(createWeChatDraftAdapter).not.toHaveBeenCalled();
		expect(secretStorage.getSecret).not.toHaveBeenCalled();
		expect(runtime.store.list()).toHaveLength(0);
	});

	it('consumes approval exactly once through the real risk C task runner and persists sending before transport', async () => {
		const { host, article, accounts, runtime, folder } = await configuredFixture();
		const approval = await host.proposal(article, accounts.map(account => account.id));
		const run = vi.spyOn(runtime.runner, 'run');
		boundary.getAccessToken.mockImplementation(async (actualAppId: string, actualSecret: string) => {
			expect(actualAppId).toBe(appId);
			expect(actualSecret).toBe(appSecret);
			const records = await host.records();
			expect(records).toHaveLength(1);
			expect(records[0].targets[0].state).toBe('sending');
			// Real disk evidence exists before the first simulated remote request.
			const files = await readdir(folder);
			const slots = await Promise.all(files.filter(file => /^receipts-[ab]\.json$/.test(file)).map(file => readFile(join(folder, file), 'utf8')));
			expect(slots.some(slot => slot.includes('"sending"'))).toBe(true);
			return 'synthetic-access-token';
		});
		// Mutating the returned proposal cannot alter the stored approved snapshot.
		approval.article.title = 'Changed client copy';
		const onRecord = vi.fn();
		const record = await host.confirm(approval.id, onRecord);
		expect(record.targets[0]).toMatchObject({ state: 'draft-created', draftId: 'remote-wechat-draft-id', snapshotHash: article.fingerprint });
		expect(boundary.addDraft.mock.calls[0][0][0].title).toBe('Synthetic title');
		expect(onRecord).toHaveBeenCalledTimes(1);
		expect(runtime.registry.get('publishing-create-drafts')).toMatchObject({ risk: 'C', reversible: false });
		expect(run.mock.calls[0][0]).toMatchObject({ approvalGranted: true, request: { readPaths: ['notes/article.md'], effects: ['external-publish', 'write'] } });
		expect(runtime.store.get(record.taskId!)).toMatchObject({ state: 'completed', riskDecision: 'propose', approvalRequired: false, result: record });
		expect(runtime.store.get(record.taskId!)?.approvedAt).toEqual(expect.any(String));
		await expect(host.confirm(approval.id, onRecord)).rejects.toThrow('确认已失效');
		expect(boundary.addDraft).toHaveBeenCalledTimes(1);
		expect(runtime.store.list()).toHaveLength(1);
	});

	it('rejects and consumes an old approval when account configuration changes', async () => {
		const { host, article, accounts, runtime } = await configuredFixture();
		const approval = await host.proposal(article, accounts.map(account => account.id));
		await host.saveAccounts({ wechatLabel: 'Changed destination label', appId, appSecret: '', xAccount: '' });
		await expect(host.confirm(approval.id, vi.fn())).rejects.toThrow('目标账号配置已变化');
		await expect(host.confirm(approval.id, vi.fn())).rejects.toThrow('确认已失效');
		expect(boundary.getAccessToken).not.toHaveBeenCalled();
		expect(boundary.addDraft).not.toHaveBeenCalled();
		expect(runtime.store.list()).toHaveLength(0);
	});

	it('retains per-platform results and marks the shared task partial when only WeChat succeeds', async () => {
		const { host, article, accounts, runtime } = await configuredFixture(true);
		const approval = await host.proposal(article, accounts.map(account => account.id));
		const record = await host.confirm(approval.id, vi.fn());
		expect(aggregateRecordState(record)).toBe('partial');
		expect(record.targets).toEqual(expect.arrayContaining([
			expect.objectContaining({ platform: 'wechat', state: 'draft-created', draftId: 'remote-wechat-draft-id' }),
			expect.objectContaining({ platform: 'x', state: 'failed' }),
		]));
		expect(runtime.store.get(record.taskId!)).toMatchObject({ state: 'partial', result: record });
		expect(runtime.store.get(record.taskId!)?.error).toContain('分平台回执');
		expect((await host.records())[0]).toEqual(record);
		expect(boundary.addDraft).toHaveBeenCalledTimes(1);
		expect(boundary.xCreate).toHaveBeenCalledTimes(1);
	});

	it('stores AppSecret only in SecretStorage and blocks a tampered reference before reading another provider secret', async () => {
		const { host, article, accounts, folder, secretStorage, values } = await configuredFixture();
		const path = join(folder, 'accounts.json');
		const text = await readFile(path, 'utf8');
		expect(text).not.toContain(appSecret);
		expect(text).not.toContain('"appSecret"');
		expect(secretStorage.setSecret).toHaveBeenCalledWith(accounts[0].secretRef, appSecret);
		expect([...values.values()]).toContain(appSecret);
		const approval = await host.proposal(article, accounts.map(account => account.id));
		values.set('talos-openai-api-key', 'synthetic-unrelated-provider-credential');
		await writeFile(path, JSON.stringify({ accounts: [{ ...accounts[0], secretRef: 'talos-openai-api-key' }] }));
		secretStorage.getSecret.mockClear();
		await expect(host.loadConfig()).rejects.toThrow('公众号凭据与当前资料库账号不匹配');
		await expect(host.proposal(article, accounts.map(account => account.id))).rejects.toThrow('公众号凭据与当前资料库账号不匹配');
		await expect(host.confirm(approval.id, vi.fn())).rejects.toThrow('公众号凭据与当前资料库账号不匹配');
		expect(secretStorage.getSecret).not.toHaveBeenCalled();
		expect(boundary.getAccessToken).not.toHaveBeenCalled();
	});

	it('shares one service and one store load across concurrent public records calls', async () => {
		const { host } = await fixture();
		const load = vi.spyOn(FilePublishingStore.prototype, 'loadRecords');
		const records = await Promise.all(Array.from({ length: 20 }, () => host.records()));
		expect(records).toEqual(Array.from({ length: 20 }, () => []));
		expect(createWeChatDraftAdapter).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(1);
		expect(boundary.xConstruct).not.toHaveBeenCalled();
	});
});
