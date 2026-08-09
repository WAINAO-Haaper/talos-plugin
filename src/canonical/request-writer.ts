import type { App } from "obsidian";
import type { WritebackIntent } from "../ai/writeback-policy";
import { inspectVaultContent } from "../ai/context/secret-policy";

export const CANONICAL_TALOS_ASK_REQUEST_PATH =
	".talos/command-requests/talos-ask.json";
const REQUEST_DIRECTORY = ".talos/command-requests";
const INPUT_KEYS = new Set([
	"requestId",
	"commandId",
	"timestamp",
	"channel",
	"providerId",
	"query",
	"writebackIntent",
	"approvalState",
]);
const SAFE_ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const CHANNELS = new Set<CanonicalAskChannel>([
	"obsidian",
	"claude",
	"codex",
]);
const WRITEBACK_INTENTS = new Set<WritebackIntent>([
	"display-only",
	"knowledge",
	"output",
]);
const APPROVAL_STATES = new Set<CanonicalApprovalState>([
	"not-required",
	"pending",
	"approved",
	"rejected",
]);

export type CanonicalAskChannel = "obsidian" | "claude" | "codex";
export type CanonicalApprovalState =
	| "not-required"
	| "pending"
	| "approved"
	| "rejected";

export interface CanonicalRequestInput {
	requestId: string;
	commandId: "talos-ask";
	timestamp: string;
	channel: CanonicalAskChannel;
	providerId: string;
	query: string;
	writebackIntent: WritebackIntent;
	approvalState: CanonicalApprovalState;
}

export interface CanonicalRequestPersistence {
	ensureDirectory(path: string): void | Promise<void>;
	write(path: string, value: string): void | Promise<void>;
	rename(from: string, to: string): void | Promise<void>;
}

export interface CanonicalRequestWriteResult {
	path: string;
	request: CanonicalRequestInput;
}

function assertRequestInput(
	input: CanonicalRequestInput
): CanonicalRequestInput {
	const record = input as CanonicalRequestInput & Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!INPUT_KEYS.has(key)) {
			throw new Error(`Canonical request unknown field: ${key}`);
		}
	}
	for (const key of INPUT_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(record, key)) {
			throw new Error(`Canonical request missing field: ${key}`);
		}
	}
	if (!SAFE_ID.test(input.requestId)) {
		throw new Error("Canonical request requestId is invalid");
	}
	if (input.commandId !== "talos-ask") {
		throw new Error("Canonical request commandId must be talos-ask");
	}
	if (
		typeof input.timestamp !== "string" ||
		Number.isNaN(Date.parse(input.timestamp)) ||
		new Date(input.timestamp).toISOString() !== input.timestamp
	) {
		throw new Error("Canonical request timestamp must be ISO-8601 UTC");
	}
	if (!CHANNELS.has(input.channel)) {
		throw new Error("Canonical request channel is invalid");
	}
	if (!SAFE_ID.test(input.providerId)) {
		throw new Error("Canonical request providerId is invalid");
	}
	if (
		typeof input.query !== "string" ||
		input.query.trim() === "" ||
		input.query.length > 100_000
	) {
		throw new Error("Canonical request query is invalid");
	}
	if (!WRITEBACK_INTENTS.has(input.writebackIntent)) {
		throw new Error("Canonical request writebackIntent is invalid");
	}
	if (!APPROVAL_STATES.has(input.approvalState)) {
		throw new Error("Canonical request approvalState is invalid");
	}
	return { ...input };
}

function requestRecord(input: CanonicalRequestInput): Record<string, unknown> {
	return {
		schema_version: 1,
		request_id: input.requestId,
		command_id: input.commandId,
		timestamp: input.timestamp,
		channel: input.channel,
		provider_id: input.providerId,
		query: input.query,
		writeback_intent: input.writebackIntent,
		approval_state: input.approvalState,
	};
}

export class CanonicalRequestWriter {
	constructor(private readonly persistence: CanonicalRequestPersistence) {}

	async write(input: CanonicalRequestInput): Promise<CanonicalRequestWriteResult> {
		const safeInput = assertRequestInput(input);
		const value = `${JSON.stringify(requestRecord(safeInput), null, 2)}\n`;
		if (
			inspectVaultContent(CANONICAL_TALOS_ASK_REQUEST_PATH, value).blocked
		) {
			throw new Error("Canonical request contains secret material");
		}
		const temporaryPath =
			`${REQUEST_DIRECTORY}/.talos-ask.${safeInput.requestId}.tmp`;
		await this.persistence.ensureDirectory(REQUEST_DIRECTORY);
		await this.persistence.write(temporaryPath, value);
		await this.persistence.rename(
			temporaryPath,
			CANONICAL_TALOS_ASK_REQUEST_PATH
		);
		return {
			path: CANONICAL_TALOS_ASK_REQUEST_PATH,
			request: safeInput,
		};
	}
}

async function ensureVaultDirectory(app: App, path: string): Promise<void> {
	let current = "";
	for (const segment of path.split("/")) {
		current = current ? `${current}/${segment}` : segment;
		if (!(await app.vault.adapter.exists(current))) {
			await app.vault.adapter.mkdir(current);
		}
	}
}

export function createVaultCanonicalRequestWriter(
	app: App
): CanonicalRequestWriter {
	return new CanonicalRequestWriter({
		ensureDirectory: (path) => ensureVaultDirectory(app, path),
		write: (path, value) => app.vault.adapter.write(path, value),
		rename: (from, to) => app.vault.adapter.rename(from, to),
	});
}
