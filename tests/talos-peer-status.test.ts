import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	NodePeerStatusFileHost,
	readTalosPeerStatus,
	talosPeerStatusDisplay,
	TALOS_PEER_STATUS_CACHE_PATH,
	TALOS_PEER_STATUS_MAX_BYTES,
	validateTalosPeerStatusEnvelope,
	type PeerStatusFileHost,
} from "../src/peer-status/talos-peer-status";

const NOW = new Date("2026-09-04T10:00:00+08:00");

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema_version: 1,
		snapshot_id: "talos-system-status",
		producer_source_id: "lili-product",
		subject_source_id: "context-control",
		generated_at: "2026-09-04T09:58:00+08:00",
		expires_at: "2026-09-04T10:03:00+08:00",
		sequence: 12,
		read_status: "current",
		source_revision: { portfolio: "1052", state: "212" },
		payload_type: "talos-project-status-v1",
		summary: {
			portfolio_revision: 1052,
			current_focus: { project_id: "talos-system", name: "TALOS System" },
			state: { revision: 212, status: "active", priority: "P0", last_updated: "2026-09-03" },
			active_outcome: { outcome_id: "TALOS.X.V1", title: "统一检索", status: "active" },
			mainline: { work_item_id: "m-1", title: "DF7 影子切换", status: "verified" },
			next_action: { work_item_id: "m-1", action: "冻结本地候选", expected_user_result: "可复算" },
			blockers: [
				{ blocker_id: "G6", title: "新用户验收缺失", severity: "medium", status: "open" },
				{ blocker_id: "G7", title: "法律批准缺失", severity: "critical", status: "open" },
			],
			checkpoint: { build: "not_run", tests: "passed", install: "not_run", launch: "not_run", user_validation: "partial" },
			evidence: { status: "verified", reference_count: 1 },
			source_freshness: { read_status: "current", conflict_reason: null },
		},
		attention_items: [
			{ item_id: "b-g6", kind: "blocker", severity: "medium", title: "G6 未关闭" },
		],
		privacy: {
			classification: "PRIVATE-local",
			body_included: false,
			credentials_included: false,
			absolute_paths_included: false,
		},
		source_links: [{ kind: "canonical-project-read-model", reference: "canonical-v1" }],
		...overrides,
	};
}

const roots: string[] = [];
function makeVault(): string {
	const root = mkdtempSync(join(tmpdir(), "talos-peer-status-"));
	roots.push(root);
	return root;
}
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function writeCache(root: string, payload: unknown): void {
	const target = join(root, TALOS_PEER_STATUS_CACHE_PATH);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
}

describe("talos peer status cache reader", () => {
	it("returns disabled without touching the file system", async () => {
		const root = makeVault();
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: false, now: NOW });
		expect(status.state).toBe("disabled");
	});

	it("reads a valid cache as ready/current", async () => {
		const root = makeVault();
		writeCache(root, validEnvelope());
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("ready");
		if (status.state === "ready") {
			expect(status.readStatus).toBe("current");
			expect(status.envelope.sequence).toBe(12);
			expect(status.envelope.summary.current_focus.project_id).toBe("talos-system");
		}
	});

	it("missing cache degrades to missing, never fabricates data", async () => {
		const root = makeVault();
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("missing");
		expect(talosPeerStatusDisplay(status).statusLabel).toBe("缺失");
	});

	it("expired cache degrades to stale", async () => {
		const root = makeVault();
		writeCache(root, validEnvelope({ expires_at: "2026-09-04T09:59:00+08:00" }));
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("stale");
		expect(talosPeerStatusDisplay(status).statusLabel).toBe("已过期");
	});

	it("producer-reported stale is displayed as stale, not current", async () => {
		const root = makeVault();
		writeCache(root, validEnvelope({ read_status: "stale" }));
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("stale");
	});

	it("producer-reported partial remains partial", async () => {
		const root = makeVault();
		writeCache(root, validEnvelope({ read_status: "partial" }));
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("ready");
		if (status.state === "ready") expect(status.readStatus).toBe("partial");
	});

	it("corrupted JSON fails closed", async () => {
		const root = makeVault();
		writeCache(root, "{not json");
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("invalid");
		if (status.state === "invalid") expect(status.reason).toBe("cache-not-json");
	});

	it("unknown envelope fields fail schema validation", async () => {
		const root = makeVault();
		writeCache(root, validEnvelope({ note_body: "正文" }));
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("invalid");
	});

	it("oversize cache is rejected before parse", async () => {
		const root = makeVault();
		const padded = validEnvelope();
		(padded.attention_items as unknown[]).push({
			item_id: "pad",
			kind: "info",
			severity: "info",
			title: "长".repeat(80),
			detail: "度".repeat(800),
		});
		const text = JSON.stringify(padded);
		expect(text.length).toBeLessThan(TALOS_PEER_STATUS_MAX_BYTES);
		const big = text + " ".repeat(TALOS_PEER_STATUS_MAX_BYTES);
		writeCache(root, big);
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("invalid");
		if (status.state === "invalid") expect(status.reason).toBe("cache-oversize");
	});

	it("absolute path leaks inside the snapshot fail schema validation", async () => {
		const root = makeVault();
		const leaked = validEnvelope();
		(leaked.summary as Record<string, unknown>).mainline = {
			work_item_id: "m-1",
			title: "见 /Users/someone/notes.md",
			status: "verified",
		};
		writeCache(root, leaked);
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("invalid");
	});

	it("privacy flags must be false", () => {
		expect(() => validateTalosPeerStatusEnvelope(validEnvelope({ privacy: {
			classification: "PRIVATE-local",
			body_included: true,
			credentials_included: false,
			absolute_paths_included: false,
		} }))).toThrow(/正文|凭据/);
	});

	it("wrong payload type is rejected", () => {
		expect(() => validateTalosPeerStatusEnvelope(validEnvelope({ payload_type: "superbrain-library-status-v1" }))).toThrow(/payload_type/);
	});

	it("symlinked cache file is rejected", async () => {
		const root = makeVault();
		const outside = makeVault();
		const target = join(root, TALOS_PEER_STATUS_CACHE_PATH);
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(join(outside, "real.json"), JSON.stringify(validEnvelope()));
		symlinkSync(join(outside, "real.json"), target);
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("invalid");
		if (status.state === "invalid") expect(status.reason).toBe("cache-is-symlink");
	});

	it("symlinked ancestor relocating the cache is rejected", async () => {
		const root = makeVault();
		const elsewhere = makeVault();
		const target = join(root, TALOS_PEER_STATUS_CACHE_PATH);
		mkdirSync(join(target, ".."), { recursive: true });
		// .talos/peer-status/v1 directory is a symlink to another tree
		rmSync(join(root, ".talos", "peer-status", "v1"), { recursive: true, force: true });
		symlinkSync(join(elsewhere, "v1-real"), join(root, ".talos", "peer-status", "v1"));
		mkdirSync(join(elsewhere, "v1-real"), { recursive: true });
		writeFileSync(join(elsewhere, "v1-real", "talos-system.json"), JSON.stringify(validEnvelope()));
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		expect(status.state).toBe("invalid");
		if (status.state === "invalid") expect(status.reason).toBe("cache-path-symlinked");
	});

	it("path escapes outside the vault are rejected by containment", async () => {
		const escapingHost: PeerStatusFileHost = {
			vaultRoot: () => resolve("/vault"),
			realpath: async (candidate: string) => candidate,
			lstat: async () => null,
			readFile: async () => "{}",
		};
		const status = await readTalosPeerStatus(escapingHost, { enabled: true, now: NOW });
		expect(status.state).toBe("missing");
	});

	it("display projects focus, mainline, next action and open blockers", async () => {
		const root = makeVault();
		writeCache(root, validEnvelope());
		const status = await readTalosPeerStatus(new NodePeerStatusFileHost(root), { enabled: true, now: NOW });
		const display = talosPeerStatusDisplay(status);
		expect(display.focusName).toBe("TALOS System");
		expect(display.mainlineTitle).toBe("DF7 影子切换");
		expect(display.nextAction).toBe("冻结本地候选");
		expect(display.blockerCount).toBe(2);
		expect(display.revision).toBe("P1052 · S212");
		expect(display.statusLabel).toBe("当前");
	});

	it("envelope type round trip keeps the contract shape", () => {
		const envelope = validateTalosPeerStatusEnvelope(validEnvelope());
		expect(envelope.summary.blockers.length).toBe(2);
		expect(envelope.source_revision.portfolio).toBe("1052");
	});
});
