import type { DraftAdapter, DraftReceipt, PreparedArticle, PublishRecord, PublishingAccount, PublishingPlatform, PublishingStorePort } from "./types";
import { publishingMetadata, sanitizePublishingError } from "./store";

export type PublicationState = "pending" | "sending" | "queued" | "draft-created" | "failed" | "partial" | "unknown";
export function aggregateRecordState(record: PublishRecord): PublicationState {
	const states = record.targets.map((target) => target.state);
	if (states.includes("unknown")) return "unknown";
	if (states.every((state) => state === "draft-created")) return "draft-created";
	if (states.includes("draft-created")) return "partial";
	if (states.includes("sending")) return "sending";
	if (states.includes("queued")) return "queued";
	if (states.every((state) => state === "failed")) return "failed";
	return "pending";
}

export interface PublicationServiceOptions { now?: () => string; createId?: () => string; }
export interface SubmitDraftOptions { taskId?: string; signal?: AbortSignal; }
type Adapters = Partial<Record<PublishingPlatform, DraftAdapter>>;
interface Target { account: PublishingAccount; identity: string; }

/** The host must obtain TALOS C approval before submit. Locks are local to this service instance. */
export class PublicationService {
	private records?: PublishRecord[];
	private loading?: Promise<PublishRecord[]>;
	private queue: Promise<void> = Promise.resolve();
	private readonly inFlight = new Map<string, Promise<PublishRecord>>();
	private readonly now: () => string;
	private readonly createId: () => string;
	constructor(private readonly store: PublishingStorePort, private readonly adapters: Adapters, options: PublicationServiceOptions = {}) {
		this.now = options.now ?? (() => new Date().toISOString());
		this.createId = options.createId ?? (() => crypto.randomUUID());
	}
	private serialize<T>(work: () => Promise<T>): Promise<T> {
		const result = this.queue.then(work);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}
	private load(): Promise<PublishRecord[]> {
		if (this.records) return Promise.resolve(this.records);
		if (!this.loading) {
			this.loading = this.store.loadRecords().then((loaded) => {
				const records = publishingMetadata(loaded);
				for (const record of records) for (const target of record.targets) {
					if (target.state === "sending") {
						target.state = "unknown";
						target.error = "上次发送未完成，请先核对已有草稿；禁止自动重发";
					}
				}
				this.records = records;
				return records;
			}).catch((error: unknown) => { this.loading = undefined; throw error; });
		}
		return this.loading;
	}
	/** Reading a cloned in-memory snapshot never waits behind a long adapter operation. */
	async listRecords(): Promise<PublishRecord[]> { return publishingMetadata(await this.load()); }

	private async targets(accounts: PublishingAccount[]): Promise<Target[]> {
		if (!accounts.length) throw new Error("请选择明确的发布账号");
		const seen = new Set<string>();
		const targets: Target[] = [];
		for (const input of accounts) {
			const account = { ...input };
			const actualAccount = account.platform === "wechat" ? account.appId : account.xAccount;
			if (!account.id?.trim() || !account.label?.trim() || !actualAccount?.trim() || (account.platform !== "wechat" && account.platform !== "x")) throw new Error("发布账号缺少明确的平台身份");
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([account.platform, account.id, actualAccount])));
			const identity = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
			if (!seen.has(identity)) targets.push({ account, identity });
			seen.add(identity);
		}
		return targets;
	}
	private async persist(): Promise<void> { await this.store.saveRecords(publishingMetadata(this.records ?? [])); }
	private async update(record: PublishRecord, index: number, receipt: DraftReceipt): Promise<void> {
		record.targets[index] = receipt;
		record.updatedAt = this.now();
		await this.persist();
	}
	private bound(receipt: DraftReceipt, expected: DraftReceipt, progress = false): DraftReceipt {
		if (receipt.platform !== expected.platform || receipt.accountId !== expected.accountId || receipt.snapshotHash !== expected.snapshotHash) throw new Error("适配器回执的平台、账号或快照不匹配，请人工核对已有草稿");
		if (receipt.state === "queued" && !receipt.relayId && !expected.relayId) throw new Error("排队回执缺少 relayId，请人工核对已有草稿");
		if (receipt.state === "pending" || (!progress && receipt.state === "sending")) throw new Error("适配器尚未确认草稿结果，请先核对已有草稿");
		return publishingMetadata([{ id: "receipt", sourcePath: "receipt", snapshotHash: expected.snapshotHash, createdAt: this.now(), updatedAt: this.now(), targets: [{ ...receipt, relayId: receipt.relayId ?? expected.relayId, draftId: receipt.draftId ?? expected.draftId, draftUrl: receipt.draftUrl ?? expected.draftUrl, accountLabel: expected.accountLabel, accountIdentity: expected.accountIdentity, updatedAt: this.now() }] }])[0].targets[0];
	}
	private unknown(receipt: DraftReceipt, error: unknown): DraftReceipt { return { ...receipt, state: "unknown", updatedAt: this.now(), error: sanitizePublishingError(error) }; }

	submit(article: PreparedArticle, accounts: PublishingAccount[], options: SubmitDraftOptions = {}): Promise<PublishRecord> {
		const selectedAccounts = accounts.map((account) => ({ ...account }));
		const key = JSON.stringify([article.fingerprint, selectedAccounts.map((account) => [account.platform, account.id, account.platform === "wechat" ? account.appId : account.xAccount]).sort()]);
		const active = this.inFlight.get(key);
		if (active) return active;
		const work = this.serialize(async () => {
			if (!article.fingerprint) throw new Error("缺少冻结文章指纹");
			const targets = await this.targets(selectedAccounts);
			const records = await this.load();
			const receipts = targets.map(({ account, identity }): DraftReceipt => {
				const previous = [...records].reverse().filter((record) => record.snapshotHash === article.fingerprint).flatMap((record) => record.targets).find((receipt) => receipt.platform === account.platform && receipt.accountId === account.id && receipt.accountIdentity === identity);
				if (previous && previous.state !== "failed" && previous.state !== "pending") return { ...previous, accountLabel: account.label };
				return { platform: account.platform, accountId: account.id, accountLabel: account.label, accountIdentity: identity, snapshotHash: article.fingerprint, state: "pending", updatedAt: this.now() };
			});
			const record: PublishRecord = { id: this.createId(), sourcePath: article.sourcePath, snapshotHash: article.fingerprint, createdAt: this.now(), updatedAt: this.now(), ...(options.taskId ? { taskId: options.taskId } : {}), targets: receipts };
			records.push(record);
			try { await this.persist(); } catch (error) { records.pop(); throw error; }
			const signal = options.signal ?? new AbortController().signal;
			for (const [index, target] of targets.entries()) {
				if (record.targets[index].state !== "pending") continue;
				await this.send(record, index, article, target.account, signal);
			}
			return publishingMetadata([record])[0];
		});
		this.inFlight.set(key, work);
		void work.then(() => this.inFlight.delete(key), () => this.inFlight.delete(key));
		return work;
	}
	private async send(record: PublishRecord, index: number, article: PreparedArticle, account: PublishingAccount, signal: AbortSignal): Promise<void> {
		const expected = record.targets[index];
		const adapter = this.adapters[account.platform];
		if (signal.aborted || !adapter) {
			await this.update(record, index, { ...expected, state: "failed", updatedAt: this.now(), error: signal.aborted ? "已取消，未发送" : "未配置此平台的草稿适配器，未发送" });
			return;
		}
		try { await this.update(record, index, { ...expected, state: "sending", updatedAt: this.now() }); }
		catch {
			record.targets[index] = { ...expected, state: "failed", updatedAt: this.now(), error: "发送前回执持久化失败，未发送" };
			try { await this.persist(); } catch { /* No side effect was attempted. */ }
			return;
		}
		if (signal.aborted) {
			record.targets[index] = { ...expected, state: "failed", updatedAt: this.now(), error: "已取消，未发送" };
			try { await this.persist(); } catch { /* No side effect was attempted. */ }
			return;
		}
		let progressError: unknown;
		try {
			const receipt = await adapter.createDraft(article, account, {
				signal,
				onProgress: async (progress) => {
					try { await this.update(record, index, this.bound(progress, record.targets[index], true)); }
					catch (error) { progressError = error; throw error; }
				},
			});
			if (progressError) throw new Error(sanitizePublishingError(progressError));
			const result = this.bound(receipt, record.targets[index]);
			try { await this.update(record, index, result); }
			catch { await this.keepUnknown(record, index, result, "草稿操作已发出，但保存最终回执失败；请核对平台草稿，禁止重发"); }
		} catch (error) { await this.keepUnknown(record, index, record.targets[index], error); }
	}
	private async keepUnknown(record: PublishRecord, index: number, receipt: DraftReceipt, error: unknown): Promise<void> {
		record.targets[index] = this.unknown(receipt, error);
		record.updatedAt = this.now();
		try { await this.persist(); } catch { /* The durable sending/queued marker still blocks automatic retries. */ }
	}

	reconcile(recordId: string, accounts: PublishingAccount[], signal = new AbortController().signal): Promise<PublishRecord> {
		return this.serialize(async () => {
			const record = (await this.load()).find((item) => item.id === recordId);
			if (!record) throw new Error("未找到草稿发布记录");
			const targets = accounts.length ? await this.targets(accounts) : [];
			for (const [index, receipt] of record.targets.entries()) {
				if (receipt.state === "draft-created" || receipt.state === "failed" || receipt.state === "pending") continue;
				const target = targets.find((item) => item.identity === receipt.accountIdentity && item.account.platform === receipt.platform && item.account.id === receipt.accountId);
				const adapter = this.adapters[receipt.platform];
				if (!target || !adapter?.reconcile || (receipt.platform === "wechat" && receipt.state === "unknown" && !receipt.relayId)) {
					await this.keepUnknown(record, index, receipt, "请使用原账号人工核对平台草稿；缺少可查询回执，禁止自动重发");
					continue;
				}
				try { await this.update(record, index, this.bound(await adapter.reconcile({ ...receipt }, target.account, signal), receipt)); }
				catch (error) { await this.keepUnknown(record, index, record.targets[index], error); }
			}
			return publishingMetadata([record])[0];
		});
	}
}
