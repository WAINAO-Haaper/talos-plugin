import { afterAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
vi.mock("obsidian", () => ({ sanitizeHTMLToDom: (html: string) => {
	// eslint-disable-next-line no-unsanitized/method -- Test stand-in for the host sanitizer; production preparation validates HTML.
	return testWindow.document.createRange().createContextualFragment(html);
}, requestUrl: vi.fn() }));
import { prepareArticle } from "../src/publishing/content";
import { createWeChatDraftAdapter, type WeChatApiPort } from "../src/publishing/wechat";
import { XRelayAdapter } from "../src/publishing/x-relay";
import type { DraftBundle } from "../vendor/serena-post/vendor/kaitox/relay-protocol/index";
const testWindow = new Window();
vi.stubGlobal("document", testWindow.document);
afterAll(async () => { await testWindow.happyDOM.close(); vi.unstubAllGlobals(); });
import { PublicationService, aggregateRecordState } from "../src/publishing/service";
import type { DraftAdapter, DraftReceipt, PreparedArticle, PublishRecord, PublishingAccount, PublishingStorePort } from "../src/publishing/types";

const wechat: PublishingAccount = { id: "wx", label: "公众号", platform: "wechat", appId: "wx-app", secretRef: "secret/key" };
const x: PublishingAccount = { id: "x", label: "X", platform: "x", xAccount: "@writer" };
const article: PreparedArticle = { sourcePath: "notes/article.md", title: "正文不能进入记录", markdown: "private body", wechatHtml: "<p>private body</p>", xMarkdown: "private body", digest: "digest", author: "author", assets: [], wechatAssets: [], warnings: [], fingerprint: "frozen-snapshot", createdAt: "2026-10-17T00:00:00Z" };
function memoryStore() {
	let records: PublishRecord[] = [];
	return {
		loadRecords: vi.fn(async () => structuredClone(records)),
		saveRecords: vi.fn(async (value: PublishRecord[]) => { records = structuredClone(value); }),
		read: () => structuredClone(records),
	};
}
function receipt(account: PublishingAccount, state: DraftReceipt["state"] = "draft-created", extras: Partial<DraftReceipt> = {}): DraftReceipt {
	return { platform: account.platform, accountId: account.id, accountLabel: "adapter label", snapshotHash: article.fingerprint, state, updatedAt: "2026-10-17T00:00:00Z", ...extras };
}
function success(account: PublishingAccount) {
	return { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => receipt(account, "draft-created", { draftId: `${account.id}-draft` })) };
}
function service(store: PublishingStorePort, adapters: ConstructorParameters<typeof PublicationService>[1]) {
	let id = 0;
	return new PublicationService(store, adapters, { createId: () => `record-${++id}` });
}

describe("native publishing orchestration", () => {
	it("runs real WeChat and X adapters through sending, queued, and final while live records remain readable", async () => {
		const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9V0AAAAASUVORK5CYII=", "base64"));
		const frozen = await prepareArticle({ sourcePath: "article.md", title: "文章", markdown: "正文", digest: "摘要", author: "作者", coverPath: "cover.png" }, { resolveLocalAsset: async (reference) => ({ source: reference, fileName: reference, mime: "image/png", bytes }) });
		const store = memoryStore();
		const api: WeChatApiPort = {
			getAccessToken: vi.fn(async () => {
				expect(store.read()[0].targets[0].state).toBe("sending");
				return "synthetic-token";
			}),
			uploadImage: vi.fn(async () => ({ media_id: "cover-id", url: "https://mmbiz.qpic.cn/test.png" })),
			addDraft: vi.fn(async () => ({ media_id: "wechat-draft" })),
		};
		let reachedQueue!: () => void;
		const queued = new Promise<void>((resolve) => { reachedQueue = resolve; });
		let acknowledge!: (bundle: DraftBundle) => void;
		const acknowledgement = new Promise<DraftBundle>((resolve) => { acknowledge = resolve; });
		const postDraft = vi.fn(async () => {
			expect(store.read()[0].targets[1]).toMatchObject({ state: "sending", relayId: "real-contract-relay" });
			return { id: "real-contract-relay" };
		});
		const xAdapter = new XRelayAdapter({ root: "synthetic-root", token: "synthetic-token", makeId: () => "real-contract-relay", client: { postDraft, getDraft: vi.fn(async () => acknowledgement) }, startRelay: async () => ({ port: 8765, close: async () => {} }), openComposer: () => { reachedQueue(); } });
		try {
			const publisher = service(store, { wechat: createWeChatDraftAdapter({ getSecret: () => "synthetic-secret", api }), x: xAdapter });
			const dispatch = publisher.submit(frozen, [wechat, x]);
			await Promise.race([queued, dispatch.then(() => { throw new Error("Adapters did not reach queued progress"); })]);
			const snapshot = await publisher.listRecords();
			expect(snapshot[0].targets.map((target) => target.state)).toEqual(["draft-created", "queued"]);
			expect(snapshot[0].targets[1].relayId).toBe("real-contract-relay");
			snapshot[0].targets[1].state = "failed";
			expect((await publisher.listRecords())[0].targets[1].state).toBe("queued");
			acknowledge({ schemaVersion: 1, id: "real-contract-relay", kind: "x-article", title: frozen.title, markdown: frozen.xMarkdown, mode: "rich", assets: [], source: "obsidian", createdAt: frozen.createdAt, status: "done", restId: "x-draft" });
			const result = await dispatch;
			expect(result.targets.map((target) => target.state)).toEqual(["draft-created", "draft-created"]);
			expect(result.targets[1]).toMatchObject({ relayId: "real-contract-relay", draftId: "x-draft" });
			expect(postDraft).toHaveBeenCalledTimes(1);
		} finally { await xAdapter.dispose(); }
	});
	it("shares the initial load between concurrent live readers", async () => {
		const store = memoryStore();
		let finishLoad!: (records: PublishRecord[]) => void;
		store.loadRecords.mockImplementation(() => new Promise((resolve) => { finishLoad = resolve; }));
		const publisher = service(store, { x: success(x) });
		const first = publisher.listRecords();
		const second = publisher.listRecords();
		expect(store.loadRecords).toHaveBeenCalledTimes(1);
		finishLoad([]);
		expect(await first).toEqual([]);
		expect(await second).toEqual([]);
		await publisher.submit(article, [x]);
		expect((await publisher.listRecords())[0].targets[0].state).toBe("draft-created");
		expect(store.loadRecords).toHaveBeenCalledTimes(1);
	});
	it("retains the queued relay id when a later progress write fails and omits it", async () => {
		const store = memoryStore();
		const save = store.saveRecords.getMockImplementation()!;
		let count = 0;
		store.saveRecords.mockImplementation(async (records) => { if (++count === 5) throw new Error("later progress write failed"); await save(records); });
		const adapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async (_article, _account, context) => {
			await context.onProgress(receipt(x, "sending", { relayId: "retained-relay" }));
			await context.onProgress(receipt(x, "queued", { relayId: "retained-relay" }));
			await context.onProgress(receipt(x, "queued"));
			return receipt(x);
		}) };
		const publisher = service(store, { x: adapter });
		const result = await publisher.submit(article, [x]);
		expect(result.targets[0]).toMatchObject({ state: "unknown", relayId: "retained-relay" });
		expect((await publisher.listRecords())[0].targets[0]).toMatchObject({ state: "unknown", relayId: "retained-relay" });
	});
	it.each(["pending", "sending"] as const)("rejects an unfinished final return in state %s", async (state) => {
		const adapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => receipt(x, state)) };
		const result = await service(memoryStore(), { x: adapter }).submit(article, [x]);
		expect(result.targets[0].state).toBe("unknown");
	});
	it("still sends the other selected platform when the first target definitely fails", async () => {
		const store = memoryStore();
		const wxAdapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => receipt(wechat, "failed")) };
		const xAdapter = success(x);
		const result = await service(store, { wechat: wxAdapter, x: xAdapter }).submit(article, [wechat, x]);
		expect(result.targets.map((target) => target.state)).toEqual(["failed", "draft-created"]);
		expect(aggregateRecordState(result)).toBe("partial");
	});
	it("creates a new draft when the frozen article fingerprint changes", async () => {
		const store = memoryStore();
		const adapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async (input) => receipt(x, "draft-created", { snapshotHash: input.fingerprint })) };
		const publisher = service(store, { x: adapter });
		await publisher.submit(article, [x]);
		await publisher.submit({ ...article, fingerprint: "changed-snapshot" }, [x]);
		expect(adapter.createDraft).toHaveBeenCalledTimes(2);
	});
	it("never treats a lost queued progress write as success even if the adapter returns success", async () => {
		const store = memoryStore();
		const save = store.saveRecords.getMockImplementation()!;
		let count = 0;
		store.saveRecords.mockImplementation(async (records) => { if (++count === 3) throw new Error("queue write failed"); await save(records); });
		const adapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async (_article, _account, context) => {
			try { await context.onProgress(receipt(x, "queued", { relayId: "durable-relay" })); } catch { /* Simulate a relay which still completes. */ }
			return receipt(x);
		}) };
		const result = await service(store, { x: adapter }).submit(article, [x]);
		expect(result.targets[0]).toMatchObject({ state: "unknown", relayId: "durable-relay" });
		expect(aggregateRecordState(result)).toBe("unknown");
	});
	it("persists sending before either side effect and retains independent platform outcomes", async () => {
		const store = memoryStore();
		const wxAdapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => {
			expect(store.read()[0].targets[0].state).toBe("sending");
			return receipt(wechat);
		}) };
		const xAdapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => receipt(x, "failed", { error: "relay refused before create" })) };
		const result = await service(store, { wechat: wxAdapter, x: xAdapter }).submit(article, [wechat, x]);
		expect(result.targets.map((target) => target.state)).toEqual(["draft-created", "failed"]);
		expect(aggregateRecordState(result)).toBe("partial");
		expect(store.read()[0].targets).toEqual(result.targets);
	});
	it("stores queued relay identity without claiming success", async () => {
		const store = memoryStore();
		const adapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async (_article, _account, context) => {
			const queued = receipt(x, "queued", { relayId: "relay-1" });
			await context.onProgress(queued);
			expect(store.read()[0].targets[0].relayId).toBe("relay-1");
			return queued;
		}) };
		const result = await service(store, { x: adapter }).submit(article, [x]);
		expect(aggregateRecordState(result)).toBe("queued");
	});
	it("coalesces double clicks and reuses durable success after restarting", async () => {
		const store = memoryStore();
		const adapter = success(wechat);
		const publisher = service(store, { wechat: adapter });
		const [first, second] = await Promise.all([publisher.submit(article, [wechat]), publisher.submit(article, [wechat])]);
		expect(first.id).toBe(second.id);
		expect(adapter.createDraft).toHaveBeenCalledTimes(1);
		const restarted = new PublicationService(store, { wechat: adapter });
		const reused = await restarted.submit(article, [wechat]);
		expect(reused.targets[0].draftId).toBe("wx-draft");
		expect(adapter.createDraft).toHaveBeenCalledTimes(1);
	});
	it("keeps unknown outcomes blocked across restart and requires explicit account reconciliation", async () => {
		const store = memoryStore();
		const adapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => { throw new Error("socket disconnected after request"); }), reconcile: vi.fn<NonNullable<DraftAdapter["reconcile"]>>(async () => receipt(wechat)) };
		const first = await service(store, { wechat: adapter }).submit(article, [wechat]);
		expect(first.targets[0].state).toBe("unknown");
		const restarted = new PublicationService(store, { wechat: adapter });
		await restarted.submit(article, [wechat]);
		const reconciled = await restarted.reconcile(first.id, [wechat]);
		expect(reconciled.targets[0].error).toContain("人工核对");
		expect(adapter.createDraft).toHaveBeenCalledTimes(1);
		expect(adapter.reconcile).not.toHaveBeenCalled();
	});
	it("queries queued relays rather than creating another draft", async () => {
		const store = memoryStore();
		const adapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => receipt(x, "queued", { relayId: "relay-2" })), reconcile: vi.fn<NonNullable<DraftAdapter["reconcile"]>>(async (old) => ({ ...old, state: "draft-created", draftId: "existing-draft" })) };
		const first = await service(store, { x: adapter }).submit(article, [x]);
		const restarted = new PublicationService(store, { x: adapter });
		await restarted.submit(article, [x]);
		const result = await restarted.reconcile(first.id, [x]);
		expect(result.targets[0].draftId).toBe("existing-draft");
		expect(adapter.reconcile).toHaveBeenCalledTimes(1);
		expect(adapter.createDraft).toHaveBeenCalledTimes(1);
	});
	it("blocks side effects if the initial record or sending marker cannot be saved", async () => {
		const adapter = success(wechat);
		const broken: PublishingStorePort = { loadRecords: async () => [], saveRecords: async () => { throw new Error("disk full"); } };
		await expect(service(broken, { wechat: adapter }).submit(article, [wechat])).rejects.toThrow("disk full");
		const store = memoryStore();
		store.saveRecords.mockImplementationOnce(async () => undefined).mockRejectedValue(new Error("disk full"));
		const result = await service(store, { wechat: adapter }).submit(article, [wechat]);
		expect(result.targets[0].state).toBe("failed");
		expect(adapter.createDraft).not.toHaveBeenCalled();
	});
	it("preserves unknown and returned ids when final receipt persistence fails", async () => {
		const store = memoryStore();
		const save = store.saveRecords.getMockImplementation()!;
		let count = 0;
		store.saveRecords.mockImplementation(async (records) => { if (++count >= 3) throw new Error("disk full"); await save(records); });
		const adapter = success(wechat);
		const result = await service(store, { wechat: adapter }).submit(article, [wechat]);
		expect(result.targets[0]).toMatchObject({ state: "unknown", draftId: "wx-draft" });
		expect(store.read()[0].targets[0].state).toBe("sending");
		const restarted = new PublicationService(store, { wechat: adapter });
		expect((await restarted.listRecords())[0].targets[0].state).toBe("unknown");
		store.saveRecords.mockImplementation(save);
		await restarted.submit(article, [wechat]);
		expect(adapter.createDraft).toHaveBeenCalledTimes(1);
	});
	it("changes identity when a configured account id points to another actual account", async () => {
		const store = memoryStore();
		const adapter = success(wechat);
		const publisher = service(store, { wechat: adapter });
		const first = await publisher.submit(article, [wechat]);
		const second = await publisher.submit(article, [{ ...wechat, appId: "another-app" }]);
		expect(first.targets[0].accountIdentity).not.toBe(second.targets[0].accountIdentity);
		expect(adapter.createDraft).toHaveBeenCalledTimes(2);
	});
	it("retries only definitively failed selected targets while leaving success intact", async () => {
		const store = memoryStore();
		const wxAdapter = success(wechat);
		const xAdapter = success(x);
		vi.mocked(xAdapter.createDraft).mockResolvedValueOnce(receipt(x, "failed"));
		const publisher = service(store, { wechat: wxAdapter, x: xAdapter });
		await publisher.submit(article, [wechat, x]);
		const result = await publisher.submit(article, [wechat, x]);
		expect(result.targets.map((target) => target.state)).toEqual(["draft-created", "draft-created"]);
		expect(wxAdapter.createDraft).toHaveBeenCalledTimes(1);
		expect(xAdapter.createDraft).toHaveBeenCalledTimes(2);
		await publisher.reconcile(result.id, [wechat, x]);
		expect(result.targets[0].state).toBe("draft-created");
	});
	it("cancels unsent targets without changing already successful receipts", async () => {
		const store = memoryStore();
		const cancellation = new AbortController();
		const wxAdapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => { cancellation.abort(); return receipt(wechat); }) };
		const xAdapter = success(x);
		const result = await service(store, { wechat: wxAdapter, x: xAdapter }).submit(article, [wechat, x], { signal: cancellation.signal });
		expect(result.targets.map((target) => target.state)).toEqual(["draft-created", "failed"]);
		expect(xAdapter.createDraft).not.toHaveBeenCalled();
	});
	it("rejects mismatched or untrackable adapter receipts and never persists credentials or body", async () => {
		const store = memoryStore();
		const wxAdapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => ({ ...receipt(wechat), accountId: "wrong", secretRef: "PRIVATE_CREDENTIAL" })) };
		const first = await service(store, { wechat: wxAdapter }).submit(article, [wechat]);
		expect(first.targets[0]).toMatchObject({ accountId: "wx", snapshotHash: article.fingerprint, state: "unknown" });
		const xAdapter = { createDraft: vi.fn<DraftAdapter["createDraft"]>(async () => receipt(x, "queued", { error: 'access_token=TEST-CRED https://relay.invalid/?token=URL_CREDENTIAL' })) };
		const second = await new PublicationService(store, { x: xAdapter }).submit(article, [x]);
		expect(second.targets[0].state).toBe("unknown");
		const text = JSON.stringify(store.read());
		expect(text).not.toContain("PRIVATE_CREDENTIAL");
		expect(text).not.toContain("URL_CREDENTIAL");
		expect(text).not.toContain("private body");
		expect(text).not.toContain("secret/key");
	});
	it("does not call unselected platforms and refuses an empty target selection", async () => {
		const store = memoryStore();
		const wxAdapter = success(wechat);
		const xAdapter = success(x);
		const publisher = service(store, { wechat: wxAdapter, x: xAdapter });
		await expect(publisher.submit(article, [])).rejects.toThrow("请选择");
		await publisher.submit(article, [x]);
		expect(wxAdapter.createDraft).not.toHaveBeenCalled();
	});
});
