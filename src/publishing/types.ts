/** Native draft publishing. Public publication is deliberately not an operation. */
export type PublishingPlatform = "wechat" | "x";

export interface PublishingAccount {
	id: string;
	label: string;
	platform: PublishingPlatform;
	appId?: string;
	secretRef?: string;
	/** User-confirmed Chrome account label; the relay cannot authenticate this identity. */
	xAccount?: string;
}

export interface PublishingAsset {
	source: string;
	fileName: string;
	mime: string;
	bytes: Uint8Array;
	sha256: string;
}

export interface ArticleInput {
	sourcePath: string;
	title: string;
	markdown: string;
	digest: string;
	author: string;
	coverPath?: string;
}

export interface PreparedArticle {
	sourcePath: string;
	title: string;
	markdown: string;
	wechatHtml: string;
	xMarkdown: string;
	digest: string;
	author: string;
	assets: PublishingAsset[];
	/** Platform-specific frozen conversions; never overwrite the original X media. */
	wechatAssets: PublishingAsset[];
	cover?: PublishingAsset;
	warnings: string[];
	fingerprint: string;
	createdAt: string;
}

export type DraftState = "pending" | "sending" | "queued" | "draft-created" | "failed" | "unknown";

export interface DraftReceipt {
	platform: PublishingPlatform;
	accountId: string;
	accountLabel: string;
	/** Hash of platform and actual destination, assigned by the publishing service. */
	accountIdentity?: string;
	state: DraftState;
	snapshotHash: string;
	updatedAt: string;
	draftId?: string;
	draftUrl?: string;
	relayId?: string;
	error?: string;
}

export interface PublishRecord {
	id: string;
	sourcePath: string;
	snapshotHash: string;
	createdAt: string;
	updatedAt: string;
	taskId?: string;
	targets: DraftReceipt[];
}

export interface DraftAdapterContext {
	signal: AbortSignal;
	onProgress(receipt: DraftReceipt): Promise<void>;
}

export interface DraftAdapter {
	createDraft(article: PreparedArticle, account: PublishingAccount, context: DraftAdapterContext): Promise<DraftReceipt>;
	/** Reconcile an existing delivery; never create another draft here. */
	reconcile?(receipt: DraftReceipt, account: PublishingAccount, signal: AbortSignal): Promise<DraftReceipt>;
	dispose?(): Promise<void>;
}

export interface PublishingConfig {
	accounts: PublishingAccount[];
}

export interface PublishingStorePort {
	loadRecords(): Promise<PublishRecord[]>;
	saveRecords(records: PublishRecord[]): Promise<void>;
}
