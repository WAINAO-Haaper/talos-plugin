import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";

vi.mock("obsidian", () => ({ sanitizeHTMLToDom: (html: string) => {
	// eslint-disable-next-line no-unsanitized/method -- Test substitute for the Obsidian sanitizer; production inputs are checked before parsing.
	return document.createRange().createContextualFragment(html);
}, requestUrl: vi.fn() }));

import { prepareArticle } from "../src/publishing/content";
import { createWeChatDraftAdapter, type WeChatApiPort } from "../src/publishing/wechat";
import { WeixinApiError } from "../vendor/serena-post/src/services/weixin-api";
import type { DraftReceipt, PreparedArticle, PublishingAccount } from "../src/publishing/types";

const testWindow = new Window();
vi.stubGlobal("document", testWindow.document);
afterAll(async () => { await testWindow.happyDOM.close(); vi.unstubAllGlobals(); });

const account: PublishingAccount = { id: "wechat-one", label: "测试公众号", platform: "wechat", appId: "wx-test", secretRef: "publishing-wechat-one" };
const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9V0AAAAASUVORK5CYII=", "base64"));
const now = () => new Date("2026-10-17T00:00:00Z");
let article: PreparedArticle;
let api: WeChatApiPort;
let progress: ReturnType<typeof vi.fn<(receipt: DraftReceipt) => Promise<void>>>;

beforeEach(async () => {
	article = await prepareArticle({ sourcePath: "article.md", title: "测试文章", markdown: "![[body.png]]\n\n![[body.png]]", digest: "摘要", author: "作者", coverPath: "cover.png" }, {
		resolveLocalAsset: async reference => ({ source: reference, fileName: reference, mime: "image/png", bytes }), now,
	});
	api = { getAccessToken: vi.fn(async () => "private-access-token"), uploadImage: vi.fn(async () => ({ media_id: "image-id", url: "https://mmbiz.qpic.cn/test.png" })), addDraft: vi.fn(async () => ({ media_id: "remote-draft-id" })) };
	progress = vi.fn(async () => {});
});

const run = (signal = new AbortController().signal) => createWeChatDraftAdapter({ getSecret: () => "private-app-secret", api, now }).createDraft(article, account, { signal, onProgress: progress });

describe("WeChat draft delivery", () => {
	it.each([
		[{ title: "题".repeat(65) }, "标题最多 64 字"],
		[{ author: "名".repeat(9) }, "署名最多 8 字"],
		[{ digest: "摘".repeat(121) }, "摘要最多 120 字"],
	] as const)("rejects oversized WeChat fields before reading credentials or starting a request (%j)", async (change, expected) => {
		article = await prepareArticle({ sourcePath: "article.md", title: "标题", markdown: "正文", digest: "", author: "", coverPath: "cover.png", ...change }, { resolveLocalAsset: async reference => ({ source: reference, fileName: reference, mime: "image/png", bytes }), now });
		const getSecret = vi.fn(() => "secret");
		const receipt = await createWeChatDraftAdapter({ getSecret, api, now }).createDraft(article, account, { signal: new AbortController().signal, onProgress: progress });
		expect(receipt.state).toBe("failed");
		expect(receipt.error).toContain(expected);
		expect(getSecret).not.toHaveBeenCalled();
		expect(api.getAccessToken).not.toHaveBeenCalled();
		expect(progress).not.toHaveBeenCalled();
	});

	it("accepts the upstream WeChat title, author, and digest boundary lengths", async () => {
		article = await prepareArticle({ sourcePath: "article.md", title: "题".repeat(64), markdown: "正文", digest: "摘".repeat(120), author: "名".repeat(8), coverPath: "cover.png" }, { resolveLocalAsset: async reference => ({ source: reference, fileName: reference, mime: "image/png", bytes }), now });
		expect((await run()).state).toBe("draft-created");
		expect(api.addDraft).toHaveBeenCalledOnce();
	});

	it("persists sending before network, uploads frozen bytes once, and requires the remote draft ID", async () => {
		vi.mocked(api.getAccessToken).mockImplementation(async () => { expect(progress).toHaveBeenCalledWith(expect.objectContaining({ state: "sending", snapshotHash: article.fingerprint })); return "private-access-token"; });
		const receipt = await run();
		expect(receipt.state).toBe("draft-created");
		expect(receipt.draftId).toBe("remote-draft-id");
		expect(api.uploadImage).toHaveBeenCalledTimes(1); // Identical cover and body bytes are reused.
		expect(new Uint8Array(vi.mocked(api.uploadImage).mock.calls[0][0])).toEqual(bytes);
		const outgoing = vi.mocked(api.addDraft).mock.calls[0][0][0];
		expect(outgoing).toMatchObject({ title: "测试文章", author: "作者", digest: "摘要", thumb_media_id: "image-id" });
		expect(outgoing.content).toContain('src="https://mmbiz.qpic.cn/test.png"');
		expect(outgoing.content).not.toContain("data:image");
		expect(JSON.stringify([receipt, progress.mock.calls])).not.toMatch(/private-access-token|private-app-secret/);
	});

	it("does not start network without a cover, a secret, an unchanged snapshot, or persisted progress", async () => {
		const withoutCover = await prepareArticle({ sourcePath: "article.md", title: "标题", markdown: "正文", digest: "", author: "" }, { resolveLocalAsset: vi.fn(), now });
		const adapter = createWeChatDraftAdapter({ getSecret: () => null, api, now });
		expect((await adapter.createDraft(withoutCover, account, { signal: new AbortController().signal, onProgress: progress })).error).toContain("必须有本地封面");
		expect((await adapter.createDraft(article, account, { signal: new AbortController().signal, onProgress: progress })).state).toBe("failed");
		expect((await createWeChatDraftAdapter({ getSecret: () => "secret", api, now }).createDraft({ ...article, title: "tampered" }, account, { signal: new AbortController().signal, onProgress: progress })).error).toContain("预览内容已变化");
		progress.mockRejectedValueOnce(new Error("disk unavailable"));
		expect((await run()).state).toBe("failed");
		expect(api.getAccessToken).not.toHaveBeenCalled();
	});

	it("stops before draft creation if any image upload fails instead of silently dropping it", async () => {
		vi.mocked(api.uploadImage).mockRejectedValueOnce(new Error("https://api.weixin.qq.com?access_token=do-not-show"));
		const receipt = await run();
		expect(receipt.state).toBe("failed");
		expect(receipt.error).not.toContain("do-not-show");
		expect(api.addDraft).not.toHaveBeenCalled();
	});

	it("marks a lost create response unknown and never retries automatically", async () => {
		vi.mocked(api.addDraft).mockRejectedValueOnce(new Error("timeout https://api.weixin.qq.com?access_token=TEST-CRED"));
		const receipt = await run();
		expect(receipt.state).toBe("unknown");
		expect(receipt.error).toContain("不会自动重发");
		expect(receipt.error).not.toContain("private-access-token");
		expect(api.addDraft).toHaveBeenCalledTimes(1);
	});

	it("treats a numeric WeChat rejection as failed while ignoring any echoed secret", async () => {
		vi.mocked(api.addDraft).mockRejectedValueOnce(new WeixinApiError("secret=do-not-show", 48001));
		const receipt = await run();
		expect(receipt.state).toBe("failed");
		expect(receipt.error).toContain("48001");
		expect(receipt.error).not.toContain("do-not-show");
		expect(api.addDraft).toHaveBeenCalledTimes(1);
	});

	it("does not claim success when the API omits media_id", async () => {
		vi.mocked(api.addDraft).mockResolvedValueOnce({ media_id: "" });
		expect((await run()).state).toBe("unknown");
	});

	it("stops subsequent requests on abort and does not claim remote rollback", async () => {
		const controller = new AbortController();
		vi.mocked(api.uploadImage).mockImplementationOnce(async () => { controller.abort(); return { media_id: "uploaded", url: "https://mmbiz.qpic.cn/a.png" }; });
		const receipt = await run(controller.signal);
		expect(receipt.state).toBe("failed");
		expect(receipt.error).toContain("不会撤回");
		expect(api.addDraft).not.toHaveBeenCalled();
	});

	it("keeps a confirmed draft when abort arrives after the create request", async () => {
		const controller = new AbortController();
		vi.mocked(api.addDraft).mockImplementationOnce(async () => { controller.abort(); return { media_id: "created-despite-abort" }; });
		expect(await run(controller.signal)).toMatchObject({ state: "draft-created", draftId: "created-despite-abort" });
	});
});
