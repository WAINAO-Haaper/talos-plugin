import { afterAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";

vi.mock("obsidian", () => ({ sanitizeHTMLToDom: (html: string) => {
	// eslint-disable-next-line no-unsanitized/method -- Test substitute for the Obsidian sanitizer; production inputs are checked before parsing.
	return document.createRange().createContextualFragment(html);
} }));
vi.mock("../vendor/serena-post/src/utils/image", async (importOriginal) => {
	const original = await importOriginal<typeof import("../vendor/serena-post/src/utils/image")>();
	return { ...original, toUploadable: vi.fn(async (bytes: ArrayBuffer, mime: string) => mime === "image/gif"
		? { data: Uint8Array.from([255, 216, 255, 217]).buffer, mimeType: "image/jpeg" }
		: original.toUploadable(bytes, mime)) };
});

import { prepareArticle, verifyPreparedArticle } from "../src/publishing/content";
import type { ArticleInput } from "../src/publishing/types";
import { toUploadable } from "../vendor/serena-post/src/utils/image";
import { sanitizeHTMLToDom } from "obsidian";
import { XRelayAdapter } from "../src/publishing/x-relay";
import type { RelayClient } from "../vendor/serena-post/vendor/kaitox/relay-protocol/index";

const testWindow = new Window();
vi.stubGlobal("document", testWindow.document);
afterAll(async () => { await testWindow.happyDOM.close(); vi.unstubAllGlobals(); });

const png = () => Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9V0AAAAASUVORK5CYII=", "base64"));
const input = (overrides: Partial<ArticleInput> = {}): ArticleInput => ({ sourcePath: "文章/测试.md", title: "测试标题", markdown: "正文", digest: "摘要", author: "作者", ...overrides });
const now = () => new Date("2026-10-17T00:00:00Z");
const resolve = vi.fn(async (reference: string) => ({ source: `附件/${reference}`, fileName: reference, mime: "image/png", bytes: png() }));

describe("offline frozen publishing content", () => {
	it("uses the upstream marked renderer and inline CSS for real Markdown structures", async () => {
		const article = await prepareArticle(input({ markdown: "---\nprivate: omitted\n---\n# 标题\n\n**粗体**\n\n- 列表\n\n> 引文\n\n|列|值|\n|--|--|\n|甲|乙|\n\n```ts\nconst image = '![[secret.md]]';\n```\n\n`![[code.png]]`" }), { resolveLocalAsset: resolve, now });
		const dom = document.createElement("div");
		dom.append(sanitizeHTMLToDom(article.wechatHtml));
		expect(dom.querySelector("h1")?.textContent).toBe("标题");
		expect(dom.querySelector("strong")?.textContent).toBe("粗体");
		expect(dom.querySelector("ul li")?.textContent).toBe("列表");
		expect(dom.querySelector("blockquote")?.textContent).toContain("引文");
		expect(dom.querySelector("table td")?.textContent).toBe("甲");
		expect(dom.querySelector("pre code")?.textContent).toContain("![[secret.md]]");
		expect(dom.querySelector("h1")?.getAttribute("style")).toContain("font-size: 24px");
		expect(article.markdown).not.toContain("private: omitted");
		expect(article.xMarkdown).toContain("`![[code.png]]`");
	});

	it("resolves local wiki images once by identity and freezes bytes and all send fields", async () => {
		const sourceBytes = png();
		const resolver = vi.fn(async () => ({ source: "附件/图.png", fileName: "图.png", mime: "image/png", bytes: sourceBytes }));
		const article = await prepareArticle(input({ markdown: "![[图.png|300]]\n\n![说明](图.png)\n\n[[另一篇|链接文字]]", coverPath: "图.png" }), { resolveLocalAsset: resolver, now });
		expect(article.assets).toHaveLength(1);
		expect(article.wechatAssets).toHaveLength(1);
		expect(article.xMarkdown).toContain(`![说明](${article.assets[0].fileName})`);
		expect(article.xMarkdown).toContain("链接文字");
		expect(article.wechatHtml.match(/data:image\/png;base64,/g)).toHaveLength(2);
		expect(article.cover?.sha256).toBe(article.assets[0].sha256);
		sourceBytes[0] = 0;
		article.assets[0].bytes[0] = 0;
		expect(article.assets[0].bytes[0]).toBe(0x89);
		expect(Object.isFrozen(article)).toBe(true);
		expect(Object.isFrozen(article.assets)).toBe(true);
		expect(() => verifyPreparedArticle(article)).not.toThrow();
		expect(article.warnings).toContain("库内双链已转为文字；草稿不会附带其他笔记。");
	});

	it("does not turn Markdown image labels into remote resource attributes", async () => {
		const article = await prepareArticle(input({ markdown: '![label" srcset="https://example.com/leak.png](local.png)' }), { resolveLocalAsset: resolve, now });
		const dom = document.createElement("div");
		dom.append(sanitizeHTMLToDom(article.wechatHtml));
		expect(dom.querySelector("img")?.hasAttribute("srcset")).toBe(false);
		expect(dom.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
	});

	it.each(["    ![[private.md]]\n", "`` ![[private.md]] ` code ``", "```\n![remote](https://example.com/image.png)", "> ```\n> ![[private.md]]\n> ```"])("preserves literal media examples inside code without resolving them: %s", async markdown => {
		const resolver = vi.fn();
		const article = await prepareArticle(input({ markdown }), { resolveLocalAsset: resolver, now });
		expect(article.xMarkdown).toBe(markdown);
		expect(resolver).not.toHaveBeenCalled();
	});

	it("keeps raw GIF and MP4 for X while freezing static WeChat images and video placeholders", async () => {
		const gif = Uint8Array.from(Buffer.from("GIF89a", "ascii"));
		const video = Uint8Array.from([0, 0, 0, 16, ...Buffer.from("ftypisom"), 0, 0, 0, 0]);
		const resolver = async (reference: string) => ({ source: reference, fileName: reference, mime: reference.endsWith("gif") ? "image/gif" : "video/mp4", bytes: reference.endsWith("gif") ? gif : video });
		const article = await prepareArticle(input({ markdown: "![[动画.gif]]\n\n![[视频.mp4]]" }), { resolveLocalAsset: resolver, now });
		expect(article.assets.map(asset => asset.mime)).toEqual(["image/gif", "video/mp4"]);
		expect(article.assets[0].bytes).toEqual(gif);
		expect(article.xMarkdown).toContain(`![](${article.assets[1].fileName})`);
		expect(article.xMarkdown).not.toContain("这里插入视频");
		expect(article.wechatAssets[0].mime).toBe("image/jpeg");
		expect(article.wechatHtml).toContain("这里换成动图");
		expect(article.wechatHtml).toContain("这里插入视频");
		expect(article.wechatHtml).not.toContain("video/mp4");
		expect(toUploadable).toHaveBeenCalledWith(expect.any(ArrayBuffer), "image/gif");
		expect(article.warnings).toHaveLength(2);
	});

	it("prepares Chinese attachments and covers into safe names accepted by the real X adapter POST contract", async () => {
		// Relay transport/server and Chrome are injected doubles; preparation and adapter are real.
		const article = await prepareArticle(input({ title: "长".repeat(65), author: "名".repeat(9), digest: "摘".repeat(121), markdown: "![[中文图片.png]]\n\n```mermaid\ngraph TD; A-->B\n```", coverPath: "中文封面.png" }), { resolveLocalAsset: resolve, now });
		expect(article.assets[0].fileName).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/);
		expect(article.cover?.fileName).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/);
		expect(article.xMarkdown).toContain(`](${article.assets[0].fileName})`);
		const client = {
			postDraft: vi.fn<RelayClient["postDraft"]>(async () => ({ id: "unicode-contract" })),
			getDraft: vi.fn<RelayClient["getDraft"]>(async () => ({ schemaVersion: 1, id: "unicode-contract", kind: "x-article", title: article.title, markdown: article.xMarkdown, mode: "rich", assets: [], source: "obsidian", createdAt: article.createdAt, status: "done", restId: "123456" })),
		};
		const adapter = new XRelayAdapter({ root: "/private/tmp/talos-unicode-content-contract", token: "test-pairing-token", makeId: () => "unicode-contract", client, startRelay: async () => ({ port: 8765, close: async () => {} }), openComposer: () => {} });
		try {
			const receipt = await adapter.createDraft(article, { id: "x-demo", platform: "x", label: "@demo", xAccount: "demo" }, { signal: new AbortController().signal, onProgress: async () => {} });
			expect(receipt).toMatchObject({ state: "draft-created", draftId: "123456" });
			expect(client.postDraft).toHaveBeenCalledOnce();
			const sent = client.postDraft.mock.calls[0][0];
			expect(sent.assets?.[0].fileName).toBe(article.assets[0].fileName);
			expect(sent.cover?.fileName).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/);
			expect(sent.cover?.bytes).toEqual(article.cover?.bytes);
			expect(sent.markdown).toContain("```text\ngraph TD; A-->B\n```");
			expect(sent.markdown).not.toContain("```mermaid");
			expect(article.markdown).toContain("```mermaid\ngraph TD; A-->B\n```");
			expect(() => verifyPreparedArticle(article)).not.toThrow();
		} finally { await adapter.dispose(); }
	});

	it("reports actual X style degradation and keeps Mermaid as code without promising image generation", async () => {
		const markdown = "- 一级\n  - 子项\n\n脚注[^1]\n\n- [ ] 任务\n\n#### 深标题\n\n```mermaid\ngraph TD; A-->B\n```";
		const article = await prepareArticle(input({ markdown }), { resolveLocalAsset: resolve, now });
		expect(article.warnings.join("\n")).toContain("子项会被静默丢弃");
		expect(article.warnings.join("\n")).toContain("脚注语法");
		expect(article.warnings.join("\n")).toContain("勾选框会丢失");
		expect(article.warnings.join("\n")).toContain("h4 标题");
		expect(article.warnings.join("\n")).toContain("Mermaid 按代码保留，不会自动生成图片");
		expect(article.warnings.join("\n")).not.toContain("上传时渲染成图片");
		expect(article.xMarkdown).toContain("```text\ngraph TD; A-->B\n```");
		expect(article.markdown).toContain("```mermaid\ngraph TD; A-->B\n```");
		expect(article.wechatHtml).toContain("A--&gt;B");
	});

	it.each(["![远程](https://example.com/a.png)", "![远程][a]\n\n[a]: https://example.com/a.png", "![[https://example.com/a.png]]", '<img src="https://example.com/a.png">', "![[另一篇.md]]", "![笔记](note.md)", "![[不支持.webm]]"])("blocks unsafe or unsupported embeds without reading them: %s", async markdown => {
		const resolver = vi.fn();
		await expect(prepareArticle(input({ markdown }), { resolveLocalAsset: resolver })).rejects.toThrow();
		expect(resolver).not.toHaveBeenCalled();
	});

	it("rejects remote covers, failed boundary reads, and fake image bytes without leaking error details", async () => {
		await expect(prepareArticle(input({ coverPath: "https://example.com/cover.jpg" }), { resolveLocalAsset: resolve })).rejects.toThrow("远程图片");
		await expect(prepareArticle(input({ markdown: "![[image.png]]" }), { resolveLocalAsset: () => Promise.reject(new Error("secret=do-not-show")) })).rejects.toThrow("超出当前库范围");
		await expect(prepareArticle(input({ markdown: "![[fake.png]]" }), { resolveLocalAsset: async () => ({ source: "fake.png", fileName: "fake.png", mime: "image/png", bytes: new TextEncoder().encode("PRIVATE NOTE") }) })).rejects.toThrow("格式无效");
	});

	it("checks external credentials while allowing ordinary publishing text", async () => {
		await expect(prepareArticle(input({ markdown: "authorization: Bearer private-token" }), { resolveLocalAsset: resolve })).rejects.toThrow("凭据");
		await expect(prepareArticle(input({ digest: "AppSecret=1234567890secret" }), { resolveLocalAsset: resolve })).rejects.toThrow("凭据");
		await expect(prepareArticle(input({ markdown: "这篇文章介绍如何配置 API，但没有实际凭据。" }), { resolveLocalAsset: resolve })).resolves.toHaveProperty("fingerprint");
	});

	it("fingerprints sending fields and both media variants, independent of preview time", async () => {
		const base = await prepareArticle(input({ markdown: "![[图.png]]", coverPath: "封面.png" }), { resolveLocalAsset: resolve, now });
		const later = await prepareArticle(input({ markdown: "![[图.png]]", coverPath: "封面.png" }), { resolveLocalAsset: resolve, now: () => new Date("2026-10-18T00:00:00Z") });
		expect(base.fingerprint).toBe(later.fingerprint);
		for (const change of [{ title: "修改标题" }, { author: "另一作者" }, { digest: "修改摘要" }, { sourcePath: "其他.md" }, { xMarkdown: "changed" }, { wechatHtml: "changed" }, { assets: [] }, { wechatAssets: [] }, { cover: undefined }]) {
			expect(() => verifyPreparedArticle({ ...base, ...change })).toThrow("预览内容已变化");
		}
		const tampered = { ...base.assets[0], bytes: png() };
		tampered.bytes[8] ^= 1;
		expect(() => verifyPreparedArticle({ ...base, assets: [tampered] })).toThrow("预览媒体已变化");
	});
});
