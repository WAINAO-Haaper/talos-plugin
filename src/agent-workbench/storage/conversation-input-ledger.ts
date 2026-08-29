import type {
	RuntimeExecutionContext,
	RuntimeId,
	RuntimeInputBlock,
} from "../contracts/runtime-adapter";

export type ConversationInputStage = "staged" | "accepted";

export interface ConversationInputRecord {
	schemaVersion: 1;
	recordId: string;
	conversationId: string;
	turnId: string;
	runtimeId: RuntimeId;
	stage: ConversationInputStage;
	createdAt: string;
	acceptedAt?: string;
	displayText: string;
	inputDigest: string;
	images: Array<{ id: string; name: string; mimeType: string; byteLength: number }>;
	contextPaths: string[];
	nativeUserMessageId?: string;
	nativeAssistantMessageId?: string;
}

interface ConversationInputLedgerState {
	schemaVersion: 1;
	records: ConversationInputRecord[];
}

const MAX_ACCEPTED_RECORDS = 2_000;

export interface ConversationInputLedgerAdapter {
	read(): Promise<ConversationInputLedgerState | null>;
	write(state: ConversationInputLedgerState): Promise<void>;
}

function bytesFromDataUrl(value: string): number {
	const comma = value.indexOf(",");
	if (comma < 0) return 0;
	const payload = value.slice(comma + 1);
	return Math.floor((payload.length * 3) / 4);
}

function stableDigest(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function ledgerPath(value: string): string {
	const normalized = value.replaceAll("\\", "/").trim();
	if (!normalized) return "";
	if (normalized.startsWith("/") || normalized.startsWith("../") || /^[A-Za-z]:\//.test(normalized)) {
		return "[external-context]";
	}
	return normalized;
}

function contextPaths(context: RuntimeExecutionContext | undefined): string[] {
	return [...new Set([
		...(context?.linkedContent?.path ? [context.linkedContent.path] : []),
		...(context?.selections?.flatMap((selection) => selection.path ? [selection.path] : []) ?? []),
		...(context?.externalContextPaths ?? []),
	].map(ledgerPath).filter(Boolean))];
}

export function createConversationInputRecord(input: {
	recordId: string;
	conversationId: string;
	turnId: string;
	runtimeId: RuntimeId;
	createdAt: string;
	displayText: string;
	blocks: RuntimeInputBlock[];
	context?: RuntimeExecutionContext;
}): ConversationInputRecord {
	const images = input.blocks.flatMap((block) => block.type === "image" ? [{
		id: block.id,
		name: block.name,
		mimeType: block.mimeType,
		byteLength: bytesFromDataUrl(block.dataUrl),
	}] : []);
	const paths = contextPaths(input.context);
	const digestSource = JSON.stringify({
		text: input.blocks.flatMap((block) => block.type === "text" ? [block.text] : []),
		images,
		paths,
	});
	return {
		schemaVersion: 1,
		recordId: input.recordId,
		conversationId: input.conversationId,
		turnId: input.turnId,
		runtimeId: input.runtimeId,
		stage: "staged",
		createdAt: input.createdAt,
		displayText: input.displayText,
		inputDigest: stableDigest(digestSource),
		images,
		contextPaths: paths,
	};
}

function normalize(state: ConversationInputLedgerState | null): ConversationInputLedgerState {
	if (!state || state.schemaVersion !== 1 || !Array.isArray(state.records)) {
		return { schemaVersion: 1, records: [] };
	}
	return { schemaVersion: 1, records: state.records.map((record) => ({ ...record })) };
}

/**
 * Durable local-input journal. Image bytes and context content never enter this
 * host-side ledger; only metadata and a deterministic digest are persisted.
 */
export class ConversationInputLedger {
	private tail = Promise.resolve();

	constructor(private readonly adapter: ConversationInputLedgerAdapter) {}

	private transaction<T>(mutate: (state: ConversationInputLedgerState) => T | Promise<T>): Promise<T> {
		const operation = this.tail.then(async () => {
			const state = normalize(await this.adapter.read());
			const result = await mutate(state);
			await this.adapter.write(state);
			return result;
		});
		this.tail = operation.then(() => undefined, () => undefined);
		return operation;
	}

	stage(record: ConversationInputRecord): Promise<void> {
		return this.transaction((state) => {
			if (state.records.some((candidate) => candidate.recordId === record.recordId)) {
				throw new Error(`输入记录重复：${record.recordId}`);
			}
			state.records.push({ ...record });
		});
	}

	accept(recordId: string, input: {
		acceptedAt: string;
		nativeUserMessageId?: string;
		nativeAssistantMessageId?: string;
	}): Promise<void> {
		return this.transaction((state) => {
			const record = state.records.find((candidate) => candidate.recordId === recordId);
			if (!record) throw new Error(`输入记录不存在：${recordId}`);
			record.stage = "accepted";
			record.acceptedAt = input.acceptedAt;
			record.nativeUserMessageId = input.nativeUserMessageId;
			record.nativeAssistantMessageId = input.nativeAssistantMessageId;
			const accepted = state.records
				.filter((candidate) => candidate.stage === "accepted")
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
			if (accepted.length > MAX_ACCEPTED_RECORDS) {
				const expired = new Set(accepted.slice(0, accepted.length - MAX_ACCEPTED_RECORDS).map((candidate) => candidate.recordId));
				state.records = state.records.filter((candidate) => !expired.has(candidate.recordId));
			}
		});
	}

	discard(recordId: string): Promise<void> {
		return this.transaction((state) => {
			state.records = state.records.filter((candidate) => candidate.recordId !== recordId);
		});
	}

	async list(conversationId: string): Promise<ConversationInputRecord[]> {
		await this.tail;
		const state = normalize(await this.adapter.read());
		return state.records
			.filter((record) => record.conversationId === conversationId)
			.map((record) => ({ ...record, images: record.images.map((image) => ({ ...image })), contextPaths: [...record.contextPaths] }));
	}
}
