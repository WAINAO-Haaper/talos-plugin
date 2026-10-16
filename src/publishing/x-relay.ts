/** X article drafts through the local Kaitox extension. No public publishing operation. */
import { createHash, randomUUID } from 'node:crypto';
// Relay timers belong to the desktop transport, independent of Obsidian popout windows.
import { setTimeout as scheduleDelay, clearTimeout as cancelDelay } from 'node:timers';
import {
	DEFAULT_RELAY_BASE,
	DEFAULT_RELAY_PORT,
	HttpRelayClient,
	type DraftBundle,
	type RelayClient,
	type DraftAssetInput,
} from '../../vendor/serena-post/vendor/kaitox/relay-protocol/index';
import { startRelay, type RelayServerHandle, type RelayServerOptions } from '../../vendor/serena-post/vendor/kaitox/relay/server';
import type { DraftAdapter, DraftAdapterContext, DraftReceipt, PreparedArticle, PublishingAccount, PublishingAsset } from './types';

export interface XRelayClock {
	now(): number;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface XRelayAdapterOptions {
	root: string;
	/** Host SecretStorage value; configure the same value in the Chrome extension. */
	token: string;
	openComposer(url: string): Promise<void> | void;
	client?: Pick<RelayClient, 'postDraft' | 'getDraft'>;
	startRelay?: (options: RelayServerOptions) => Promise<RelayServerHandle>;
	clock?: XRelayClock;
	acknowledgementTimeoutMs?: number;
	pollIntervalMs?: number;
	requestTimeoutMs?: number;
	makeId?: () => string;
}

export function xArticleComposeUrl(relayId: string): string {
	const url = new URL('https://x.com/compose/articles');
	url.searchParams.set('kaitoxAutoUpload', '1');
	url.searchParams.set('kaitoxDraftId', relayId);
	return url.toString();
}

const systemClock: XRelayClock = {
	now: () => Date.now(),
	sleep: (ms, signal) => new Promise((resolve, reject) => {
		if (signal.aborted) { reject(new Error('X draft operation was cancelled.')); return; }
		const cleanup = () => signal.removeEventListener('abort', abort);
		const timer = scheduleDelay(() => { cleanup(); resolve(); }, ms);
		const abort = () => { cancelDelay(timer); cleanup(); reject(new Error('X draft operation was cancelled.')); };
		signal.addEventListener('abort', abort, { once: true });
	}),
};

/** The host calls createDraft only after approval of the frozen article and account label. */
export class XRelayAdapter implements DraftAdapter {
	private readonly client: Pick<RelayClient, 'postDraft' | 'getDraft'>;
	private readonly clock: XRelayClock;
	private readonly timeoutMs: number;
	private readonly intervalMs: number;
	private readonly requestTimeoutMs: number;
	private handle?: RelayServerHandle;
	private starting?: Promise<RelayServerHandle>;
	private disposed = false;
	private readonly operations = new Set<AbortController>();

	constructor(private readonly options: XRelayAdapterOptions) {
		if (!options.token.trim()) throw new Error('X relay token is required; configure it in TALOS and the Kaitox Chrome extension.');
		this.client = options.client ?? new HttpRelayClient(DEFAULT_RELAY_BASE, { token: options.token });
		this.clock = options.clock ?? systemClock;
		this.timeoutMs = positive(options.acknowledgementTimeoutMs, 180_000);
		this.intervalMs = positive(options.pollIntervalMs, 3_000);
		this.requestTimeoutMs = positive(options.requestTimeoutMs, 15_000);
	}

	async createDraft(article: PreparedArticle, account: PublishingAccount, context: DraftAdapterContext): Promise<DraftReceipt> {
		let receipt: DraftReceipt = {
			platform: 'x', accountId: account.id, accountLabel: account.label,
			state: 'pending', snapshotHash: article.fingerprint, updatedAt: this.timestamp(),
		};
		const operation = this.begin(context.signal);
		let submitted = false;
		try {
			this.validateAccount(account);
			this.checkAbort(operation.signal);
			// Build exclusively from the approved in-memory snapshot. No note, URL, or vault reads.
			const assets = article.assets.map(asset => assetInput(asset));
			const cover = article.cover ? coverInput(article.cover, new Set(assets.map(asset => asset.fileName.toLowerCase()))) : undefined;
			for (const asset of [...assets, ...(cover ? [cover] : [])]) validateMedia(asset);
			await this.ensureRelay();
			this.checkAbort(operation.signal);
			const id = (this.options.makeId ?? randomUUID)();
			receipt = { ...receipt, state: 'sending', relayId: id, updatedAt: this.timestamp() };
			// Persist the id before POST as well, so a lost HTTP response remains recoverable.
			await context.onProgress(receipt);
			this.checkAbort(operation.signal);
			submitted = true;
			const posted = await this.request(operation.signal, signal => this.client.postDraft({
				kind: 'x-article', title: article.title, markdown: article.xMarkdown,
				mode: 'rich', source: 'obsidian', assets, cover,
				// No sourcePath, asset source, vault name, or local filesystem metadata.
				sourceMeta: { snapshotHash: article.fingerprint },
			}, { signal, id }));
			if (!posted.id || posted.id !== id) {
				throw new Error('X relay returned an unexpected delivery id; reconcile the original delivery before retrying.');
			}
			receipt = { ...receipt, state: 'queued', updatedAt: this.timestamp() };
			await context.onProgress(receipt);
			this.checkAbort(operation.signal);
			await this.options.openComposer(xArticleComposeUrl(id));
			return await this.waitForAcknowledgement(receipt, operation.signal);
		} catch (error) {
			return { ...receipt, state: submitted || operation.signal.aborted ? 'unknown' : 'failed', error: this.errorText(error), updatedAt: this.timestamp() };
		} finally {
			operation.cleanup();
		}
	}

	async reconcile(receipt: DraftReceipt, account: PublishingAccount, signal: AbortSignal): Promise<DraftReceipt> {
		const operation = this.begin(signal);
		try {
			this.validateAccount(account);
			if (receipt.platform !== 'x' || receipt.accountId !== account.id || !receipt.relayId) {
				throw new Error('Reconciliation requires the original X account and relay delivery id.');
			}
			this.checkAbort(operation.signal);
			await this.ensureRelay();
			const bundle = await this.request(operation.signal, requestSignal => this.client.getDraft(receipt.relayId!, { signal: requestSignal }));
			return this.fromAcknowledgement(receipt, bundle) ?? {
				...receipt, state: 'unknown', error: 'The extension has not acknowledged this delivery. Query this delivery again; do not submit it again.', updatedAt: this.timestamp(),
			};
		} catch (error) {
			return { ...receipt, state: 'unknown', error: this.errorText(error), updatedAt: this.timestamp() };
		} finally {
			operation.cleanup();
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const operation of this.operations) operation.abort();
		const handle = this.handle ?? await this.starting?.catch(() => undefined);
		await handle?.close();
		this.handle = undefined;
	}

	private async ensureRelay(): Promise<void> {
		if (this.disposed) throw new Error('X relay adapter has been disposed.');
		if (this.handle) return;
		if (!this.starting) {
			this.starting = (this.options.startRelay ?? startRelay)({ root: this.options.root, token: this.options.token, port: DEFAULT_RELAY_PORT });
		}
		try {
			this.handle = await this.starting;
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
				throw new Error('X relay port 8765 is already in use. TALOS did not reuse or stop that service. Close it yourself before trying again.');
			}
			throw error;
		} finally {
			this.starting = undefined;
		}
	}

	private async waitForAcknowledgement(receipt: DraftReceipt, signal: AbortSignal): Promise<DraftReceipt> {
		const deadline = this.clock.now() + this.timeoutMs;
		// The count bound also protects tests/custom clocks which do not advance.
		const maxPolls = Math.ceil(this.timeoutMs / this.intervalMs) + 1;
		for (let poll = 0; poll < maxPolls && this.clock.now() < deadline; poll++) {
			this.checkAbort(signal);
			const bundle = await this.request(signal, requestSignal => this.client.getDraft(receipt.relayId!, { signal: requestSignal }), Math.min(this.requestTimeoutMs, deadline - this.clock.now()));
			const result = this.fromAcknowledgement(receipt, bundle);
			if (result) return result;
			const remaining = deadline - this.clock.now();
			if (remaining > 0) await this.clock.sleep(Math.min(this.intervalMs, remaining), signal);
		}
		return { ...receipt, state: 'unknown', error: 'Timed out waiting for the Kaitox extension acknowledgement. Reconcile this delivery before retrying.', updatedAt: this.timestamp() };
	}

	private fromAcknowledgement(receipt: DraftReceipt, bundle: DraftBundle): DraftReceipt | undefined {
		if (bundle.id !== receipt.relayId) throw new Error('X relay acknowledgement does not match the original delivery.');
		if (bundle.error || bundle.status === 'failed') {
			return { ...receipt, state: 'unknown', ...(bundle.restId?.trim() ? { draftId: bundle.restId } : {}), error: this.errorText(bundle.error || 'The extension reported a failure after delivery. Check the original draft before retrying.'), updatedAt: this.timestamp() };
		}
		if (bundle.status !== 'done') return undefined;
		if (!bundle.restId?.trim()) {
			return { ...receipt, state: 'unknown', error: 'The extension reported completion without an article id. Reconcile this delivery before retrying.', updatedAt: this.timestamp() };
		}
		// The extension confirms an article id, not the signed-in X identity.
		return { ...receipt, state: 'draft-created', draftId: bundle.restId, draftUrl: 'https://x.com/compose/articles', error: undefined, updatedAt: this.timestamp() };
	}

	private begin(externalSignal: AbortSignal): { signal: AbortSignal; cleanup(): void } {
		const controller = new AbortController();
		const abort = () => controller.abort();
		if (externalSignal.aborted || this.disposed) controller.abort();
		else externalSignal.addEventListener('abort', abort, { once: true });
		this.operations.add(controller);
		return { signal: controller.signal, cleanup: () => { externalSignal.removeEventListener('abort', abort); this.operations.delete(controller); } };
	}

	private async request<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>, timeout = this.requestTimeoutMs): Promise<T> {
		this.checkAbort(signal);
		const controller = new AbortController();
		let timer: ReturnType<typeof scheduleDelay> | undefined;
		let onAbort: (() => void) | undefined;
		const abort = () => controller.abort();
		signal.addEventListener('abort', abort, { once: true });
		try {
			const interrupted = new Promise<never>((_, reject) => {
					onAbort = () => reject(new Error(signal.aborted ? 'X draft operation was cancelled. Reconcile the original delivery.' : 'X relay request timed out. Reconcile the original delivery.'));
				controller.signal.addEventListener('abort', onAbort, { once: true });
				timer = scheduleDelay(abort, Math.max(1, timeout));
			});
			return await Promise.race([interrupted, Promise.resolve().then(() => {
				this.checkAbort(signal);
				return work(controller.signal);
			})]);
		} finally {
			if (timer) cancelDelay(timer);
			if (onAbort) controller.signal.removeEventListener('abort', onAbort);
			signal.removeEventListener('abort', abort);
		}
	}

	private validateAccount(account: PublishingAccount): void {
		if (account.platform !== 'x' || !account.xAccount?.trim()) throw new Error('Select an X account label and manually confirm that account in the Kaitox Chrome extension.');
	}
	private checkAbort(signal: AbortSignal): void {
		if (signal.aborted) throw new Error('X draft operation was cancelled. Reconcile the original delivery if it was sent.');
	}
	private timestamp(): string { return new Date(this.clock.now()).toISOString(); }
	private errorText(error: unknown): string {
		return String(error instanceof Error ? error.message : error).split(this.options.token).join('[redacted]');
	}
}

function positive(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
function assetInput(asset: PublishingAsset, cover = false): DraftAssetInput {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(asset.fileName)) throw new Error('X snapshot contains an unsafe asset filename.');
	return { key: cover ? 'cover' : asset.fileName, src: cover ? '__cover__' : asset.fileName, fileName: asset.fileName, mime: asset.mime, bytes: asset.bytes };
}
/** Cover and body share the relay's filename namespace, even after image conversion. */
function coverInput(asset: PublishingAsset, taken: ReadonlySet<string>): DraftAssetInput {
	const extension = /\.([a-zA-Z0-9]+)$/.exec(asset.fileName)?.[1].toLowerCase() ?? 'bin';
	const base = `cover-${createHash('sha256').update(asset.bytes).digest('hex').slice(0, 24)}`;
	let fileName = `${base}.${extension}`;
	for (let suffix = 1; taken.has(fileName.toLowerCase()); suffix++) fileName = `${base}-${suffix}.${extension}`;
	return { key: 'cover', src: '__cover__', fileName, mime: asset.mime, bytes: asset.bytes };
}
function validateMedia(asset: DraftAssetInput): void {
	if (asset.mime.startsWith('video/') && !['video/mp4', 'video/quicktime'].includes(asset.mime.toLowerCase())) {
		throw new Error('Unsupported video format: use an X-compatible H.264/AAC MP4 or MOV; automatic transcoding is disabled.');
	}
}
