import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XRelayAdapter, xArticleComposeUrl, type XRelayAdapterOptions } from '../src/publishing/x-relay';
import type { DraftReceipt, PreparedArticle, PublishingAccount } from '../src/publishing/types';
import { HttpRelayClient, type DraftBundle, type PostDraftInput, type RelayClient } from '../vendor/serena-post/vendor/kaitox/relay-protocol/index';
import { startRelay, type RelayServerHandle } from '../vendor/serena-post/vendor/kaitox/relay/server';
import { PublicationService } from '../src/publishing/service';
import { fitVideoBytes } from '../vendor/serena-post/vendor/kaitox/relay/videoFit';

const account: PublishingAccount = { id: 'x-main', platform: 'x', label: 'Work account', xAccount: '@manually-confirmed' };
function article(): PreparedArticle {
	return {
		sourcePath: 'private-vault/secret-note.md', title: 'Frozen title', markdown: 'Original private source',
		xMarkdown: 'Frozen body ![gif](animated.gif) ![movie](movie.mp4)', wechatHtml: '<p>body</p>',
		digest: 'summary', author: 'author', assets: [
			{ source: '/private/source.gif', fileName: 'animated.gif', mime: 'image/gif', bytes: new Uint8Array([1, 2, 3]), sha256: 'gifhash' },
			{ source: 'https://private.invalid/movie', fileName: 'movie.mp4', mime: 'video/mp4', bytes: new Uint8Array([4, 5]), sha256: 'videohash' },
		], wechatAssets: [{ source: '/private/source.gif', fileName: 'static.jpg', mime: 'image/jpeg', bytes: new Uint8Array([9]), sha256: 'statichash' }],
		warnings: [], fingerprint: 'approved-fingerprint', createdAt: '2026-10-17T00:00:00.000Z',
	};
}
function bundle(patch: Partial<DraftBundle> = {}): DraftBundle {
	return { schemaVersion: 1, id: 'relay-1', kind: 'x-article', title: 'title', markdown: 'body', mode: 'rich', assets: [], source: 'obsidian', createdAt: '2026-10-17T00:00:00.000Z', status: 'pending', ...patch };
}
const adapters: XRelayAdapter[] = [];
const servers: RelayServerHandle[] = [];
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(adapters.splice(0).map(adapter => adapter.dispose()));
	await Promise.all(servers.splice(0).map(server => server.close()));
	await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function setup(overrides: Partial<XRelayAdapterOptions> = {}) {
	let now = 0;
	const events: string[] = [];
	const client = { postDraft: vi.fn<RelayClient['postDraft']>(async () => ({ id: 'relay-1' })), getDraft: vi.fn<RelayClient['getDraft']>(async () => bundle()) };
	const close = vi.fn(async () => {});
	const start = vi.fn(async () => ({ port: 8765, close }));
	const open = vi.fn(async () => { events.push('open'); });
	const adapter = new XRelayAdapter({
		root: '/private/tmp/synthetic-talos-relay', token: 'synthetic-install-token', openComposer: open,
		client, startRelay: start, makeId: () => 'relay-1',
		clock: { now: () => now, sleep: async ms => { now += ms; } },
		acknowledgementTimeoutMs: 30, pollIntervalMs: 10, ...overrides,
	});
	adapters.push(adapter);
	const controller = new AbortController();
	const progress = vi.fn(async (receipt: DraftReceipt) => { events.push(receipt.state); });
	return { adapter, client, close, start, open, controller, progress, events };
}
async function temporaryRoot(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'talos-x-relay-test-')));
	roots.push(root);
	return root;
}

describe('XRelayAdapter draft delivery', () => {
	it('starts lazily, persists relay ids before dispatch/open, and sends only frozen X assets', async () => {
		const fixture = setup();
		expect(fixture.start).not.toHaveBeenCalled();
		fixture.client.getDraft.mockResolvedValue(bundle({ status: 'done', restId: '123456' }));
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result).toMatchObject({ state: 'draft-created', draftId: '123456', relayId: 'relay-1', snapshotHash: 'approved-fingerprint' });
		expect(result).not.toHaveProperty('xAccountVerified');
		expect(fixture.events).toEqual(['sending', 'queued', 'open']);
		expect(fixture.progress.mock.calls.every(([receipt]) => receipt.relayId === 'relay-1')).toBe(true);
		expect(fixture.open).toHaveBeenCalledWith('https://x.com/compose/articles?kaitoxAutoUpload=1&kaitoxDraftId=relay-1');
		const sent = fixture.client.postDraft.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
		expect(sent).toMatchObject({ markdown: article().xMarkdown, sourceMeta: { snapshotHash: 'approved-fingerprint' }, assets: [{ src: 'animated.gif', mime: 'image/gif' }, { src: 'movie.mp4', mime: 'video/mp4' }] });
		expect(JSON.stringify(sent)).not.toMatch(/private-vault|private\/source|private\.invalid|static\.jpg/);
		expect(fixture.start).toHaveBeenCalledWith({ root: '/private/tmp/synthetic-talos-relay', token: 'synthetic-install-token', port: 8765 });
	});

	it('treats queue delivery as unknown until extension acknowledgement', async () => {
		const fixture = setup();
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result).toMatchObject({ state: 'unknown', relayId: 'relay-1' });
		expect(fixture.client.getDraft).toHaveBeenCalledTimes(3);
		expect(fixture.client.postDraft).toHaveBeenCalledTimes(1);
	});

	it.each([
		[{ status: 'done', restId: undefined }, 'unknown'],
		[{ status: 'done', restId: '123', error: 'extension upload failed' }, 'unknown'],
		[{ status: 'failed', restId: '456', error: 'X rejected media' }, 'unknown'],
		[{ status: 'failed', error: 'X rejected media' }, 'unknown'],
	] as const)('requires an article id and no error for success (%j)', async (patch, state) => {
		const fixture = setup();
		fixture.client.getDraft.mockResolvedValue(bundle(patch));
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result.state).toBe(state);
		expect(result.draftId).toBe(patch.restId);
	});

	it('preserves the original relay id when POST response is lost; never retries POST', async () => {
		const fixture = setup();
		fixture.client.postDraft.mockRejectedValue(new Error('connection lost'));
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result).toMatchObject({ state: 'unknown', relayId: 'relay-1' });
		expect(fixture.client.postDraft).toHaveBeenCalledTimes(1);
		expect(fixture.open).not.toHaveBeenCalled();
	});

	it('does not open X or resubmit if persisting queued delivery fails', async () => {
		const fixture = setup();
		fixture.progress.mockImplementation(async receipt => { if (receipt.state === 'queued') throw new Error('disk full'); });
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result).toMatchObject({ state: 'unknown', relayId: 'relay-1', error: 'disk full' });
		expect(fixture.open).not.toHaveBeenCalled();
		expect(fixture.client.postDraft).toHaveBeenCalledTimes(1);
	});

	it('never sends if persisting the preallocated id fails', async () => {
		const fixture = setup();
		fixture.progress.mockRejectedValue(new Error('disk full'));
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result.state).toBe('failed');
		expect(fixture.client.postDraft).not.toHaveBeenCalled();
		expect(fixture.open).not.toHaveBeenCalled();
	});

	it('aborts after queuing without opening X and retains the relay id', async () => {
		const fixture = setup();
		fixture.progress.mockImplementation(async receipt => { if (receipt.state === 'queued') fixture.controller.abort(); });
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result).toMatchObject({ state: 'unknown', relayId: 'relay-1' });
		expect(fixture.open).not.toHaveBeenCalled();
	});

	it('bounds hung requests and disposes an in-flight poll', async () => {
		const fixture = setup({ requestTimeoutMs: 10 });
		fixture.client.getDraft.mockImplementation(() => new Promise(() => {}));
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result).toMatchObject({ state: 'unknown', relayId: 'relay-1' });
		const pending = fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		await vi.waitFor(() => expect(fixture.client.postDraft).toHaveBeenCalledTimes(2));
		await fixture.adapter.dispose();
		expect((await pending).state).toBe('unknown');
		expect(fixture.close).toHaveBeenCalledTimes(1);
	});

	it('reconciles only the original delivery without POST or composer', async () => {
		const fixture = setup();
		const receipt: DraftReceipt = { platform: 'x', accountId: account.id, accountLabel: account.label, state: 'unknown', snapshotHash: 'hash', updatedAt: '', relayId: 'relay-1' };
		fixture.client.getDraft.mockResolvedValue(bundle({ status: 'done', restId: '345' }));
		expect(await fixture.adapter.reconcile(receipt, account, fixture.controller.signal)).toMatchObject({ state: 'draft-created', draftId: '345', relayId: 'relay-1' });
		expect(fixture.client.postDraft).not.toHaveBeenCalled();
		expect(fixture.open).not.toHaveBeenCalled();
		expect(fixture.client.getDraft.mock.calls[0]?.[0]).toBe('relay-1');
	});

	it('keeps post-delivery failures unknown so the service reuses the original delivery', async () => {
		const fixture = setup();
		fixture.client.getDraft.mockResolvedValue(bundle({ status: 'failed', restId: 'partial-article-id', error: 'Extension stopped after creating a partial draft.' }));
		let sequence = 0;
		const service = new PublicationService({ loadRecords: async () => [], saveRecords: async () => {} }, { x: fixture.adapter }, { createId: () => `record-${++sequence}` });
		const first = await service.submit(article(), [account]);
		const second = await service.submit(article(), [account]);
		expect(first.targets[0]).toMatchObject({ state: 'unknown', relayId: 'relay-1', draftId: 'partial-article-id' });
		expect(second.targets[0]).toMatchObject({ state: 'unknown', relayId: 'relay-1', draftId: 'partial-article-id' });
		expect(fixture.client.postDraft).toHaveBeenCalledTimes(1);
	});

	it('requires manual account confirmation before starting or transmitting', async () => {
		const fixture = setup();
		const result = await fixture.adapter.createDraft(article(), { ...account, xAccount: '' }, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result.state).toBe('failed');
		expect(fixture.start).not.toHaveBeenCalled();
		expect(fixture.client.postDraft).not.toHaveBeenCalled();
	});

	it('rejects unsupported video before starting or transmitting', async () => {
		const fixture = setup();
		const input = article(); input.assets[1].mime = 'video/webm';
		const result = await fixture.adapter.createDraft(input, account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result.state).toBe('failed');
		expect(result.error).toContain('automatic transcoding is disabled');
		expect(fixture.start).not.toHaveBeenCalled();
		expect(fixture.client.postDraft).not.toHaveBeenCalled();
	});

	it('fails clearly on occupied port without submitting or reusing it', async () => {
		const fixture = setup({ startRelay: async () => { throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' }); } });
		const result = await fixture.adapter.createDraft(article(), account, { signal: fixture.controller.signal, onProgress: fixture.progress });
		expect(result.state).toBe('failed');
		expect(result.error).toContain('8765 is already in use');
		expect(fixture.client.postDraft).not.toHaveBeenCalled();
	});
});

describe('embedded Kaitox relay, loopback synthetic integration', () => {
	it('authenticates the extension wire protocol and keeps tokens out of files/settings', async () => {
		const root = await temporaryRoot();
		const server = await startRelay({ root, token: 'synthetic-only-secret', port: 0 }); servers.push(server);
		const base = `http://127.0.0.1:${server.port}`;
		// eslint-disable-next-line no-restricted-globals -- Node-only transport for this real ephemeral loopback HTTP integration test.
		const loopbackFetch = fetch;
		const client = new HttpRelayClient(base, { token: 'synthetic-only-secret', makeId: () => 'synthetic-draft' });
		expect((await client.health()).port).toBe(server.port);
		expect((await loopbackFetch(`${base}/x-article/drafts`)).status).toBe(401);
		expect((await loopbackFetch(`${base}/setting`, { headers: { 'x-kaitox-token': 'synthetic-only-secret' } })).status).toBe(200);
		const setting = await loopbackFetch(`${base}/setting`, { headers: { 'x-kaitox-token': 'synthetic-only-secret' } });
		expect(await setting.text()).not.toContain('synthetic-only-secret');
		expect((await loopbackFetch(`${base}/setting`, { method: 'PATCH', headers: { 'x-kaitox-token': 'synthetic-only-secret', 'content-type': 'application/json' }, body: JSON.stringify({ token: 'bad-change' }) })).status).toBe(405);
		expect((await loopbackFetch(`${base}/x-article/drafts`, { headers: { 'x-kaitox-token': 'synthetic-only-secret', Origin: 'https://malicious.invalid' } })).status).toBe(403);
		expect(await client.postDraft({ title: 'Synthetic', markdown: '![gif](demo.gif)', source: 'obsidian', mode: 'rich', assets: [{ key: 'demo.gif', src: 'demo.gif', fileName: 'demo.gif', mime: 'image/gif', bytes: new Uint8Array([71, 73, 70]) }] })).toEqual({ id: 'synthetic-draft' });
		expect((await client.getDraft('synthetic-draft')).status).toBe('pending');
		expect(await client.getAsset('synthetic-draft', 'demo.gif')).toEqual(new Uint8Array([71, 73, 70]));
		await client.ack('synthetic-draft', { status: 'done', restId: '998877' });
		expect(await client.getDraft('synthetic-draft')).toMatchObject({ status: 'done', restId: '998877' });
		expect(await readdir(root)).toEqual(['x-article']);
		expect(await readFile(join(root, 'x-article', 'sent', 'synthetic-draft', 'bundle.json'), 'utf8')).not.toContain('synthetic-only-secret');
		const isolatedRoot = await temporaryRoot();
		const isolated = await startRelay({ root: isolatedRoot, token: 'another-token', port: 0 }); servers.push(isolated);
		const isolatedClient = new HttpRelayClient(`http://127.0.0.1:${isolated.port}`, { token: 'another-token' });
		expect(await isolatedClient.listDrafts()).toEqual([]);
		await expect(startRelay({ root: isolatedRoot, token: 'another-token', port: server.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
		expect((await client.health()).ok).toBe(true);
		await server.close();
		await expect(client.health()).rejects.toThrow();
	});

	it('keeps body and converted cover bytes distinct through the actual adapter/client/relay wire', async () => {
		const root = await temporaryRoot();
		const token = 'synthetic-cover-pairing';
		const server = await startRelay({ root, token, port: 0 }); servers.push(server);
		const client = new HttpRelayClient(`http://127.0.0.1:${server.port}`, { token });
		const body = new Uint8Array([137, 80, 78, 71, 1]);
		const convertedCover = new Uint8Array([137, 80, 78, 71, 2]);
		const coverHash = createHash('sha256').update(convertedCover).digest('hex').slice(0, 24);
		const reserved = `cover-${coverHash}.png`;
		const prepared = article();
		prepared.xMarkdown = `![body](foo.png)\n\n![other](${reserved})`;
		prepared.assets = [
			{ source: 'foo.png', fileName: 'foo.png', mime: 'image/png', bytes: body, sha256: 'body' },
			{ source: reserved, fileName: reserved, mime: 'image/png', bytes: new Uint8Array([3]), sha256: 'reserved' },
		];
		// The approved cover represents foo.svg after its frozen PNG conversion.
		prepared.cover = { source: 'foo.svg', fileName: 'foo.png', mime: 'image/png', bytes: convertedCover, sha256: 'cover' };
		const adapter = new XRelayAdapter({ root, token, client, startRelay: async () => server, makeId: () => 'cover-collision',
			openComposer: async () => {
				const stored = await client.getDraft('cover-collision');
				expect(stored.markdown).toBe(prepared.xMarkdown);
				expect(stored.cover?.fileName).toBe(`cover-${coverHash}-1.png`);
				expect(await client.getAsset(stored.id, 'foo.png')).toEqual(body);
				expect(await client.getAsset(stored.id, reserved)).toEqual(new Uint8Array([3]));
				expect(await client.getAsset(stored.id, stored.cover!.fileName)).toEqual(convertedCover);
				await client.ack(stored.id, { status: 'done', restId: '1234567' });
			},
		}); adapters.push(adapter);
		const result = await adapter.createDraft(prepared, account, { signal: new AbortController().signal, onProgress: async () => {} });
		expect(result).toMatchObject({ state: 'draft-created', draftId: '1234567' });
		expect(prepared.cover.fileName).toBe('foo.png');
		expect(prepared.assets[0].bytes).toEqual(body);
	});

	it('rejects a relay root symlink before opening its listener or touching the outside directory', async () => {
		const parent = await temporaryRoot();
		const outside = await temporaryRoot();
		const root = join(parent, 'relay');
		await symlink(outside, root);
		await expect(startRelay({ root, token: 'synthetic-token', port: 0 })).rejects.toThrow('symbolic links');
		expect(await readdir(outside)).toEqual([]);
	});

	it.each(['outbox', 'assets'])('rejects a symlinked %s directory during actual relay reads and writes', async directory => {
		const root = await temporaryRoot();
		const outside = await temporaryRoot();
		await writeFile(join(outside, 'body.png'), new Uint8Array([99]));
		const server = await startRelay({ root, token: 'synthetic-token', port: 0 }); servers.push(server);
		const client = new HttpRelayClient(`http://127.0.0.1:${server.port}`, { token: 'synthetic-token', makeId: () => 'symlink-draft' });
		const input: PostDraftInput = { title: 'Synthetic', markdown: '![body](body.png)', source: 'obsidian', mode: 'rich', assets: [{ key: 'body.png', src: 'body.png', fileName: 'body.png', mime: 'image/png', bytes: new Uint8Array([1]) }] };
		await client.postDraft(input);
		const target = directory === 'outbox' ? join(root, 'x-article/outbox') : join(root, 'x-article/outbox/symlink-draft/assets');
		await rm(target, { recursive: true });
		await symlink(outside, target);
		await expect(client.postDraft(input)).rejects.toThrow();
		await expect(client.getAsset('symlink-draft', 'body.png')).rejects.toThrow();
		expect(new Uint8Array(await readFile(join(outside, 'body.png')))).toEqual(new Uint8Array([99]));
		expect(await readdir(outside)).toEqual(['body.png']);
	});

	it('preserves compatible video and fails unsupported formats without invoking tools', async () => {
		const bytes = new Uint8Array([0, 1, 2]);
		expect(await fitVideoBytes(bytes, 'video/mp4')).toEqual({ bytes, mime: 'video/mp4' });
		expect(await fitVideoBytes(bytes, 'video/quicktime')).toEqual({ bytes, mime: 'video/quicktime' });
		await expect(fitVideoBytes(bytes, 'video/webm')).rejects.toThrow('automatic transcoding is disabled');
	});

	it('escapes the extension trigger id and never embeds authentication into its URL', () => {
		const url = new URL(xArticleComposeUrl('synthetic id & 123'));
		expect(url.origin + url.pathname).toBe('https://x.com/compose/articles');
		expect(url.searchParams.get('kaitoxDraftId')).toBe('synthetic id & 123');
		expect(url.searchParams.get('kaitoxAutoUpload')).toBe('1');
		expect(url.searchParams.size).toBe(2);
	});
});
