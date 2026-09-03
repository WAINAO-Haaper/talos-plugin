import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * TALOS–超级大脑状态桥 v1 · Plugin 消费端。
 *
 * 只读取 lili 生成的 `.talos/peer-status/v1/talos-system.json` 派生缓存；
 * 不解析控制仓库、不执行 shell、不调用 Provider、不写入任何文件。
 * 缺失、损坏、超限、symlink、越界或过期一律失败关闭并降级显示。
 */

export const TALOS_PEER_STATUS_CACHE_PATH = ".talos/peer-status/v1/talos-system.json";
export const TALOS_PEER_STATUS_MAX_BYTES = 64 * 1024;
export const TALOS_PEER_STATUS_TTL_MS = 5 * 60 * 1000;
export const TALOS_PEER_STATUS_CONTRACT = "peer-status-v1";

export type PeerReadStatus = "current" | "stale" | "partial" | "unreachable" | "error";

export interface TalosPeerStatusSummary {
	portfolio_revision: number;
	current_focus: { project_id: string; name: string };
	state: { revision: number; status: string; priority: string; last_updated: string };
	active_outcome: { outcome_id: string; title: string; status: string };
	mainline: { work_item_id: string; title: string; status: string };
	next_action: { work_item_id: string; action: string; expected_user_result?: string };
	blockers: ReadonlyArray<{ blocker_id: string; title: string; severity: string; status: string }>;
	checkpoint: {
		build: string;
		tests: string;
		install: string;
		launch: string;
		user_validation: string;
	};
	evidence: { status: string; reference_count: number };
	source_freshness?: { read_status: PeerReadStatus; conflict_reason: string | null };
}

export interface TalosPeerStatusEnvelope {
	schema_version: number;
	snapshot_id: string;
	producer_source_id: string;
	subject_source_id: string;
	generated_at: string;
	expires_at: string;
	sequence: number;
	read_status: PeerReadStatus;
	source_revision: Record<string, string>;
	payload_type: string;
	summary: TalosPeerStatusSummary;
	attention_items: ReadonlyArray<{
		item_id: string;
		kind: string;
		severity: string;
		title: string;
		detail?: string;
	}>;
	privacy: {
		classification: string;
		body_included: boolean;
		credentials_included: boolean;
		absolute_paths_included: boolean;
	};
	source_links?: ReadonlyArray<{ kind: string; reference: string }>;
}

export type TalosPeerStatusState =
	| { state: "disabled" }
	| { state: "missing" }
	| { state: "invalid"; reason: string }
	| { state: "stale"; envelope: TalosPeerStatusEnvelope; readStatus: "stale" }
	| { state: "ready"; envelope: TalosPeerStatusEnvelope; readStatus: "current" | "partial" };

export interface PeerStatusFileStat {
	isFile(): boolean;
	isSymlink(): boolean;
	size: number;
}

export interface PeerStatusFileHost {
	/** Vault 根的绝对路径。 */
	vaultRoot(): string;
	realpath(candidate: string): Promise<string>;
	lstat(candidate: string): Promise<PeerStatusFileStat | null>;
	readFile(candidate: string): Promise<string>;
}

export class NodePeerStatusFileHost implements PeerStatusFileHost {
	constructor(private readonly baseDir: string) {}

	vaultRoot(): string {
		return path.resolve(this.baseDir);
	}

	realpath(candidate: string): Promise<string> {
		return realpath(candidate);
	}

	async lstat(candidate: string): Promise<PeerStatusFileStat | null> {
		try {
			const stats = await lstat(candidate);
			return {
				isFile: () => stats.isFile(),
				isSymlink: () => stats.isSymbolicLink(),
				size: stats.size,
			};
		} catch {
			return null;
		}
	}

	readFile(candidate: string): Promise<string> {
		return import("node:fs/promises").then((fs) => fs.readFile(candidate, "utf8"));
	}
}

const ENVELOPE_REQUIRED_KEYS = [
	"schema_version", "snapshot_id", "producer_source_id", "subject_source_id",
	"generated_at", "expires_at", "sequence", "read_status", "source_revision",
	"payload_type", "summary", "attention_items", "privacy",
] as const;
const ENVELOPE_OPTIONAL_KEYS = ["source_links"] as const;
const READ_STATUSES: readonly PeerReadStatus[] = ["current", "stale", "partial", "unreachable", "error"];

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;

function leakText(value: string): boolean {
	if (value.startsWith("/") || value.startsWith("\\")) return true;
	if (/^[A-Za-z]:[\\/]/.test(value)) return true;
	const lowered = value.toLowerCase();
	if (lowered.includes("/users/") || lowered.includes("/home/") || lowered.includes("/private/")) return true;
	if (lowered.includes("api_key") || lowered.includes("apikey") || lowered.includes("password") || lowered.includes("bearer ")) return true;
	return /sk-[A-Za-z0-9]{16,}/.test(lowered);
}

function scanForLeaks(value: unknown, where: string): void {
	if (typeof value === "string") {
		if (leakText(value)) throw new Error(`状态桥快照 ${where} 包含绝对路径或凭据模式`);
	} else if (Array.isArray(value)) {
		value.forEach((item, index) => scanForLeaks(item, `${where}[${index}]`));
	} else if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) scanForLeaks(item, `${where}.${key}`);
	}
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`状态桥快照 ${where} 不是对象`);
	}
	return value as Record<string, unknown>;
}

function requireKeys(object: Record<string, unknown>, required: readonly string[], optional: readonly string[], where: string): void {
	for (const key of required) {
		if (!(key in object)) throw new Error(`状态桥快照 ${where} 缺少 ${key}`);
	}
	for (const key of Object.keys(object)) {
		if (!required.includes(key) && !optional.includes(key)) {
			throw new Error(`状态桥快照 ${where} 含未声明字段 ${key}`);
		}
	}
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`状态桥快照 ${where} 枚举无效`);
	}
	return value as T;
}

function requireBoundedString(object: Record<string, unknown>, key: string, max: number, where: string): string {
	const value = object[key];
	if (typeof value !== "string" || value.length > max) {
		throw new Error(`状态桥快照 ${where}.${key} 字符串无效`);
	}
	return value;
}

function requireInteger(object: Record<string, unknown>, key: string, where: string): number {
	const value = object[key];
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`状态桥快照 ${where}.${key} 整数无效`);
	}
	return value;
}

export function validateTalosPeerStatusEnvelope(value: unknown): TalosPeerStatusEnvelope {
	const envelope = requireObject(value, "信封");
	requireKeys(envelope, ENVELOPE_REQUIRED_KEYS, ENVELOPE_OPTIONAL_KEYS, "信封");
	if (envelope.schema_version !== 1) throw new Error("状态桥快照版本不受支持");
	if (envelope.payload_type !== "talos-project-status-v1") throw new Error("状态桥快照 payload_type 不受支持");
	if (envelope.producer_source_id !== "lili-product") throw new Error("状态桥快照 producer 不合法");
	if (envelope.subject_source_id !== "context-control") throw new Error("状态桥快照 subject 不合法");
	requireEnum(envelope.read_status, READ_STATUSES, "read_status");
	const sequence = requireInteger(envelope, "sequence", "信封");
	if (sequence < 1) throw new Error("状态桥快照 sequence 必须为正");
	const generatedAt = requireBoundedString(envelope, "generated_at", 64, "信封");
	const expiresAt = requireBoundedString(envelope, "expires_at", 64, "信封");
	if (!RFC3339.test(generatedAt) || !RFC3339.test(expiresAt)) {
		throw new Error("状态桥快照时间不是 RFC3339");
	}
	if (expiresAt <= generatedAt) throw new Error("状态桥快照 expires_at 必须晚于 generated_at");

	const privacy = requireObject(envelope.privacy, "privacy");
	requireKeys(privacy, ["classification", "body_included", "credentials_included", "absolute_paths_included"], [], "privacy");
	if (privacy.classification !== "PRIVATE-local") throw new Error("状态桥快照隐私分类不合法");
	if (privacy.body_included !== false || privacy.credentials_included !== false || privacy.absolute_paths_included !== false) {
		throw new Error("状态桥快照不得包含正文、凭据或绝对路径");
	}

	const revision = requireObject(envelope.source_revision, "source_revision");
	if (Object.keys(revision).length > 8) throw new Error("状态桥快照 source_revision 超限");
	for (const item of Object.values(revision)) {
		if (typeof item !== "string" || item.length > 64) throw new Error("状态桥快照 source_revision 值无效");
	}

	const attention = envelope.attention_items;
	if (!Array.isArray(attention) || attention.length > 20) throw new Error("状态桥快照 attention_items 无效");
	for (const item of attention) {
		const entry = requireObject(item, "关注项");
		requireKeys(entry, ["item_id", "kind", "severity", "title"], ["detail"], "关注项");
		requireEnum(entry.severity, ["info", "low", "medium", "high"], "关注项.severity");
		requireBoundedString(entry, "title", 400, "关注项");
	}

	if (envelope.source_links !== undefined) {
		if (!Array.isArray(envelope.source_links) || envelope.source_links.length > 8) {
			throw new Error("状态桥快照 source_links 无效");
		}
		for (const link of envelope.source_links) {
			requireKeys(requireObject(link, "来源链接"), ["kind", "reference"], [], "来源链接");
		}
	}

	const summary = validateSummary(envelope.summary);
	scanForLeaks(envelope, "信封");
	return { ...envelope, summary } as unknown as TalosPeerStatusEnvelope;
}

function validateSummary(value: unknown): TalosPeerStatusSummary {
	const summary = requireObject(value, "summary");
	requireKeys(
		summary,
		["portfolio_revision", "current_focus", "state", "active_outcome", "mainline", "next_action", "blockers", "checkpoint", "evidence"],
		["source_freshness", "last_receipt"],
		"summary",
	);
	requireInteger(summary, "portfolio_revision", "summary");

	const focus = requireObject(summary.current_focus, "current_focus");
	requireKeys(focus, ["project_id", "name"], [], "current_focus");
	requireBoundedString(focus, "project_id", 128, "current_focus");
	requireBoundedString(focus, "name", 400, "current_focus");

	const state = requireObject(summary.state, "state");
	requireKeys(state, ["revision", "status", "priority", "last_updated"], [], "state");
	requireInteger(state, "revision", "state");
	requireEnum(state.status, ["active", "paused", "review", "completed", "unknown"], "state.status");
	requireEnum(state.priority, ["P0", "P1", "P2", "P3", "unknown"], "state.priority");
	requireBoundedString(state, "last_updated", 10, "state");

	const outcome = requireObject(summary.active_outcome, "active_outcome");
	requireKeys(outcome, ["outcome_id", "title", "status"], [], "active_outcome");
	requireEnum(outcome.status, ["active", "verified", "paused", "closed", "unknown"], "active_outcome.status");

	const mainline = requireObject(summary.mainline, "mainline");
	requireKeys(mainline, ["work_item_id", "title", "status"], [], "mainline");
	requireEnum(mainline.status, ["planned", "in_progress", "active", "implemented", "verified", "paused", "deferred", "blocked", "completed", "unknown"], "mainline.status");

	const next = requireObject(summary.next_action, "next_action");
	requireKeys(next, ["work_item_id", "action"], ["expected_user_result"], "next_action");

	const blockers = summary.blockers;
	if (!Array.isArray(blockers) || blockers.length > 10) throw new Error("状态桥快照 blockers 无效");
	for (const blocker of blockers) {
		const entry = requireObject(blocker, "blocker");
		requireKeys(entry, ["blocker_id", "title", "severity", "status"], [], "blocker");
		requireEnum(entry.severity, ["low", "medium", "high", "critical"], "blocker.severity");
	}

	const checkpoint = requireObject(summary.checkpoint, "checkpoint");
	requireKeys(checkpoint, ["build", "tests", "install", "launch", "user_validation"], [], "checkpoint");
	for (const key of ["build", "tests", "install", "launch"] as const) {
		requireEnum(checkpoint[key], ["passed", "partial", "failed", "not_run", "unknown"], `checkpoint.${key}`);
	}
	requireEnum(checkpoint.user_validation, ["passed", "partial", "failed", "not_run", "unknown"], "checkpoint.user_validation");

	const evidence = requireObject(summary.evidence, "evidence");
	requireKeys(evidence, ["status", "reference_count"], [], "evidence");
	requireEnum(evidence.status, ["verified", "partial", "pending", "not_run", "stale", "rejected", "invalid", "unknown"], "evidence.status");
	requireInteger(evidence, "reference_count", "evidence");

	if (summary.source_freshness !== undefined) {
		const freshness = requireObject(summary.source_freshness, "source_freshness");
		requireKeys(freshness, ["read_status", "conflict_reason"], [], "source_freshness");
		requireEnum(freshness.read_status, READ_STATUSES, "source_freshness.read_status");
	}

	return summary as unknown as TalosPeerStatusSummary;
}

/**
 * Read the derived cache with full pre-parse guards. Never throws for expected
 * degraded conditions — those map to missing/invalid states the UI shows as-is.
 */
export async function readTalosPeerStatus(
	host: PeerStatusFileHost,
	options: { enabled: boolean; now?: Date },
): Promise<TalosPeerStatusState> {
	if (!options.enabled) return { state: "disabled" };
	const now = options.now ?? new Date();

	const root = host.vaultRoot();
	const target = path.resolve(root, TALOS_PEER_STATUS_CACHE_PATH);
	if (target !== root && !target.startsWith(root + path.sep)) {
		return { state: "invalid", reason: "cache-path-escape" };
	}
	const stat = await host.lstat(target);
	if (!stat) return { state: "missing" };
	if (stat.isSymlink()) return { state: "invalid", reason: "cache-is-symlink" };
	if (!stat.isFile()) return { state: "invalid", reason: "cache-not-regular-file" };
	if (stat.size > TALOS_PEER_STATUS_MAX_BYTES) return { state: "invalid", reason: "cache-oversize" };
	// Symlink on any existing ancestor must not relocate the resolved cache
	// (compare against the realpath of the vault root, not the raw string).
	const [resolvedTarget, resolvedRoot] = await Promise.all([host.realpath(target), host.realpath(root)]);
	if (resolvedTarget !== path.resolve(resolvedRoot, TALOS_PEER_STATUS_CACHE_PATH)) {
		return { state: "invalid", reason: "cache-path-symlinked" };
	}

	let text: string;
	try {
		text = await host.readFile(target);
	} catch {
		return { state: "invalid", reason: "cache-unreadable" };
	}
	if (text.length > TALOS_PEER_STATUS_MAX_BYTES) return { state: "invalid", reason: "cache-oversize" };
	if (text.startsWith("﻿")) return { state: "invalid", reason: "cache-bom" };

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { state: "invalid", reason: "cache-not-json" };
	}

	let envelope: TalosPeerStatusEnvelope;
	try {
		envelope = validateTalosPeerStatusEnvelope(parsed);
	} catch (error) {
		return { state: "invalid", reason: error instanceof Error ? `schema:${error.message.slice(0, 48)}` : "schema" };
	}

	const expires = Date.parse(envelope.expires_at);
	if (Number.isFinite(expires) && expires <= now.getTime()) {
		return { state: "stale", envelope, readStatus: "stale" };
	}
	if (envelope.read_status !== "current" && envelope.read_status !== "partial") {
		// Producer-reported stale/unreachable/error is shown honestly as stale.
		return { state: "stale", envelope, readStatus: "stale" };
	}
	return { state: "ready", envelope, readStatus: envelope.read_status };
}

export interface TalosPeerStatusDisplay {
	state: TalosPeerStatusState["state"];
	statusLabel: string;
	focusName: string;
	mainlineTitle: string;
	nextAction: string;
	blockerCount: number;
	blockerTop: string | null;
	revision: string;
	generatedAtLabel: string;
	sequence: number | null;
	reason: string | null;
}

export function talosPeerStatusDisplay(status: TalosPeerStatusState, now: Date = new Date()): TalosPeerStatusDisplay {
	if (status.state === "disabled") {
		return { state: "disabled", statusLabel: "已停用", focusName: "—", mainlineTitle: "—", nextAction: "—", blockerCount: 0, blockerTop: null, revision: "—", generatedAtLabel: "—", sequence: null, reason: null };
	}
	if (status.state === "missing") {
		return { state: "missing", statusLabel: "缺失", focusName: "—", mainlineTitle: "—", nextAction: "打开 lili 生成状态快照", blockerCount: 0, blockerTop: null, revision: "—", generatedAtLabel: "—", sequence: null, reason: "cache-missing" };
	}
	if (status.state === "invalid") {
		return { state: "invalid", statusLabel: "损坏", focusName: "—", mainlineTitle: "—", nextAction: "在 lili 中刷新状态桥", blockerCount: 0, blockerTop: null, revision: "—", generatedAtLabel: "—", sequence: null, reason: status.reason };
	}
	const envelope = status.envelope;
	const summary = envelope.summary;
	const time = Date.parse(envelope.generated_at);
	const generatedAtLabel = Number.isFinite(time)
		? new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
		: "—";
	const openBlockers = summary.blockers.filter((blocker) => blocker.status === "open");
	return {
		state: status.state,
		statusLabel: status.state === "stale" ? "已过期" : summary.source_freshness?.read_status === "partial" || status.readStatus === "partial" ? "部分可用" : "当前",
		focusName: summary.current_focus.name,
		mainlineTitle: summary.mainline.title,
		nextAction: summary.next_action.action,
		blockerCount: openBlockers.length,
		blockerTop: openBlockers[0]?.title ?? null,
		revision: `P${summary.portfolio_revision} · S${summary.state.revision}`,
		generatedAtLabel,
		sequence: envelope.sequence,
		reason: null,
	};
}
