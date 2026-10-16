import type { DraftReceipt, DraftState, PublishRecord, PublishingStorePort } from "./types";

/** Paths are relative to the private publishing directory supplied by the host. */
export const PUBLISHING_RECORD_PATHS = ["receipts-a.json", "receipts-b.json"] as const;
export interface PublishingStoreFilePort {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, value: string): Promise<void>;
	mkdir?(path: string): Promise<void>;
	rename?(from: string, to: string): Promise<void>;
}

const STATES = new Set<DraftState>(["pending", "sending", "queued", "draft-created", "failed", "unknown"]);
const SECRET_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|appsecret|client[_-]?secret|api[_-]?key|authorization|password|passwd|cookie|signature|credential|key)$/i;

/** Publishing audit contains metadata only. Never persist arbitrary adapter error objects. */
export function sanitizePublishingError(value: unknown): string {
	const message = value instanceof Error ? value.message : typeof value === "string" ? value : "草稿操作失败";
	return message
		.replace(/https?:\/\/[^\s<>"']+/gi, "[链接已移除]")
		.replace(/\bBearer\s+[^\s,;"'}]+/gi, "Bearer [已隐藏]")
		.replace(/(["']?(?:access[_-]?token|refresh[_-]?token|appsecret|client[_-]?secret|secretRef|secret|api[_-]?key|authorization|password|passwd|cookie|credential|token|signature)["']?\s*[:=]\s*)(?:["'][^"']*["']|[^\s,;&}]+)/gi, "$1[已隐藏]")
		.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]+)\b/g, "[已隐藏]")
		.slice(0, 1200);
}

function safeDraftUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || !value) return undefined;
	try {
		const url = new URL(value);
		if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
		for (const key of [...url.searchParams.keys()]) {
			if (SECRET_KEY.test(key) || /token|secret|password|authorization|api[_-]?key/i.test(key)) url.searchParams.delete(key);
		}
		url.hash = "";
		return url.toString();
	} catch { return undefined; }
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("草稿回执存储格式错误");
	return value as Record<string, unknown>;
}
function required(data: Record<string, unknown>, key: string): string {
	if (typeof data[key] !== "string" || !data[key]) throw new Error(`草稿回执缺少 ${key}`);
	return data[key];
}
function optional(data: Record<string, unknown>, key: string): string | undefined {
	if (data[key] === undefined) return undefined;
	return required(data, key);
}

/** Whitelist fields both when reading and writing; article bodies and credentials cannot enter this store. */
export function publishingMetadata(records: readonly PublishRecord[]): PublishRecord[] {
	if (!Array.isArray(records)) throw new Error("草稿回执存储必须是记录列表");
	const ids = new Set<string>();
	return records.map((value) => {
		const data = object(value);
		const id = required(data, "id");
		if (ids.has(id)) throw new Error("草稿回执记录 ID 重复");
		ids.add(id);
		if (!Array.isArray(data.targets) || !data.targets.length) throw new Error("草稿回执缺少发布目标");
		const snapshotHash = required(data, "snapshotHash");
		const targets = data.targets.map((value): DraftReceipt => {
			const target = object(value);
			if (target.platform !== "wechat" && target.platform !== "x") throw new Error("草稿回执平台无效");
			if (!STATES.has(target.state as DraftState)) throw new Error("草稿回执状态无效");
			if (required(target, "snapshotHash") !== snapshotHash) throw new Error("草稿回执快照不匹配");
			const receipt: DraftReceipt = {
				platform: target.platform,
				accountId: required(target, "accountId"),
				accountLabel: required(target, "accountLabel"),
				accountIdentity: required(target, "accountIdentity"),
				state: target.state as DraftState,
				snapshotHash,
				updatedAt: required(target, "updatedAt"),
			};
			for (const key of ["draftId", "relayId"] as const) {
				const field = optional(target, key);
				if (field) receipt[key] = field;
			}
			const draftUrl = safeDraftUrl(target.draftUrl);
			if (draftUrl) receipt.draftUrl = draftUrl;
			if (target.error !== undefined) receipt.error = sanitizePublishingError(target.error);
			if (receipt.state === "queued" && !receipt.relayId) throw new Error("排队回执缺少 relayId，禁止重发");
			return receipt;
		});
		return {
			id, sourcePath: required(data, "sourcePath"), snapshotHash,
			createdAt: required(data, "createdAt"), updatedAt: required(data, "updatedAt"),
			...(optional(data, "taskId") ? { taskId: optional(data, "taskId") } : {}), targets,
		};
	});
}

interface Envelope { version: 1; revision: number; checksum: string; records: PublishRecord[]; }
function checksum(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
	return (hash >>> 0).toString(16);
}

/** In-process serialized, two-slot journal. This is not a cross-process lock. */
export class FilePublishingStore implements PublishingStorePort {
	private queue: Promise<void> = Promise.resolve();
	constructor(private readonly files: PublishingStoreFilePort) {}

	private serialize<T>(work: () => Promise<T>): Promise<T> {
		const result = this.queue.then(work);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}
	private async readCurrent(): Promise<{ envelope?: Envelope; slot: number }> {
		let existed = false;
		const valid: Array<{ envelope: Envelope; slot: number }> = [];
		for (const [slot, path] of PUBLISHING_RECORD_PATHS.entries()) {
			if (!(await this.files.exists(path))) continue;
			existed = true;
			try {
				const data = object(JSON.parse(await this.files.read(path)));
				if (data.version !== 1 || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1 || typeof data.checksum !== "string") throw new Error("无效回执版本");
				if (checksum(JSON.stringify(data.records)) !== data.checksum) throw new Error("回执校验失败");
				const records = publishingMetadata(data.records as PublishRecord[]);
				valid.push({ slot, envelope: { version: 1, revision: data.revision as number, checksum: data.checksum, records } });
			} catch { throw new Error("草稿回执存储已损坏；请恢复记录并人工核对平台草稿，禁止自动重发"); }
		}
		if (existed && !valid.length) throw new Error("草稿回执存储已损坏；请恢复记录并人工核对平台草稿，禁止自动重发");
		valid.sort((a, b) => b.envelope.revision - a.envelope.revision);
		return valid[0] ?? { slot: 1 };
	}
	loadRecords(): Promise<PublishRecord[]> {
		return this.serialize(async () => (await this.readCurrent()).envelope?.records ?? []);
	}
	saveRecords(records: PublishRecord[]): Promise<void> {
		const metadata = publishingMetadata(records);
		return this.serialize(async () => {
			const current = await this.readCurrent();
			const path = PUBLISHING_RECORD_PATHS[1 - current.slot];
			const envelope: Envelope = { version: 1, revision: (current.envelope?.revision ?? 0) + 1, checksum: checksum(JSON.stringify(metadata)), records: metadata };
			const text = JSON.stringify(envelope);
			if (this.files.rename) {
				await this.files.write(`${path}.tmp`, text);
				await this.files.rename(`${path}.tmp`, path);
			} else await this.files.write(path, text);
		});
	}
}
