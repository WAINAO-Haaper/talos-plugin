import { describe, expect, it, vi } from "vitest";
import { FilePublishingStore, PUBLISHING_RECORD_PATHS, sanitizePublishingError, type PublishingStoreFilePort } from "../src/publishing/store";
import type { PublishRecord } from "../src/publishing/types";

const record: PublishRecord = { id: "draft-1", sourcePath: "notes/article.md", snapshotHash: "snapshot", createdAt: "2026-10-17", updatedAt: "2026-10-17", targets: [{ platform: "x", accountId: "account-1", accountLabel: "X", accountIdentity: "identity-hash", snapshotHash: "snapshot", state: "queued", relayId: "relay-1", updatedAt: "2026-10-17" }] };
function files(rename = true) {
	const data = new Map<string, string>();
	const port: PublishingStoreFilePort = {
		exists: vi.fn(async (path: string) => data.has(path)),
		read: vi.fn(async (path: string) => { if (!data.has(path)) throw new Error("missing"); return data.get(path)!; }),
		write: vi.fn(async (path: string, value: string) => { data.set(path, value); }),
	};
	const renameMock = vi.fn(async (from: string, to: string) => { data.set(to, data.get(from)!); data.delete(from); });
	if (rename) port.rename = renameMock;
	return { port, data, renameMock };
}

describe("private publishing receipt journal", () => {
	it("uses fixed relative paths and serializes complete metadata snapshots", async () => {
		const { port, data, renameMock } = files();
		const store = new FilePublishingStore(port);
		await Promise.all([store.saveRecords([record]), store.saveRecords([{ ...record, updatedAt: "newer" }])]);
		expect((await new FilePublishingStore(port).loadRecords())[0].updatedAt).toBe("newer");
		expect([...data.keys()]).toEqual([...PUBLISHING_RECORD_PATHS]);
		expect(renameMock).toHaveBeenCalledTimes(2);
	});
	it("preserves the previous complete write when atomic replacement fails", async () => {
		const { port, data, renameMock } = files();
		const store = new FilePublishingStore(port);
		await store.saveRecords([record]);
		renameMock.mockRejectedValueOnce(new Error("disk full"));
		await expect(store.saveRecords([{ ...record, updatedAt: "not-committed" }])).rejects.toThrow("disk full");
		expect((await new FilePublishingStore(port).loadRecords())[0].updatedAt).toBe(record.updatedAt);
		expect(data.has("receipts-b.json.tmp")).toBe(true);
	});
	it("blocks rather than treating damaged or tampered records as an empty history", async () => {
		const { port, data } = files(false);
		const store = new FilePublishingStore(port);
		await store.saveRecords([record]);
		data.set("receipts-a.json", "{partial");
		await expect(new FilePublishingStore(port).loadRecords()).rejects.toThrow("禁止自动重发");
		await expect(new FilePublishingStore(port).saveRecords([record])).rejects.toThrow("禁止自动重发");
	});
	it("drops article/credential fields and strips credential-bearing URLs and errors", async () => {
		const { port, data } = files();
		const input = { ...record, markdown: "PRIVATE_BODY", secretRef: "PRIVATE_KEY", targets: [{ ...record.targets[0], secret: "PRIVATE_KEY", draftUrl: "https://example.test/draft?id=123&access_token=URL_SECRET#credential", error: 'appsecret=ERROR_SECRET authorization: Bearer AUTH_SECRET https://example.test/?token=URL_SECRET' }] };
		const store = new FilePublishingStore(port);
		await store.saveRecords([input]);
		const output = (await store.loadRecords())[0];
		expect(output.targets[0].draftUrl).toBe("https://example.test/draft?id=123");
		const serialized = [...data.values()].join("");
		for (const secret of ["PRIVATE_BODY", "PRIVATE_KEY", "URL_SECRET", "ERROR_SECRET", "AUTH_SECRET"]) expect(serialized).not.toContain(secret);
	});
	it("requires a relay id for queued receipts and rejects snapshot mismatch", async () => {
		const { port } = files();
		const store = new FilePublishingStore(port);
		expect(() => store.saveRecords([{ ...record, targets: [{ ...record.targets[0], relayId: undefined }] }])).toThrow("relayId");
		expect(() => store.saveRecords([{ ...record, targets: [{ ...record.targets[0], snapshotHash: "other" }] }])).toThrow("快照不匹配");
	});
	it("blocks missing account identity instead of deduplicating against an unbound account", () => {
		const { port } = files();
		const store = new FilePublishingStore(port);
		expect(() => store.saveRecords([{ ...record, targets: [{ ...record.targets[0], accountIdentity: undefined }] }])).toThrow("accountIdentity");
	});
	it("filters bearer, secret assignments and token URLs without storing arbitrary objects", () => {
		expect(sanitizePublishingError('access_token="SECRET" Bearer BEARER_SECRET https://example.test/?token=URL_SECRET')).not.toMatch(/SECRET/);
		expect(sanitizePublishingError({ token: "SECRET" })).toBe("草稿操作失败");
	});
});
