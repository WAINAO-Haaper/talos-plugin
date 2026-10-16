import { addDraft, getAccessToken, toWeixinError, uploadImage, WeixinApiError } from "../../vendor/serena-post/src/services/weixin-api";
import { verifyPreparedArticle } from "./content";
import { assetDataUrl, decodeImageDataUrl } from "./media";
import { PublishingCheckError, publishingErrorMessage } from "./security";
import type { DraftAdapter, DraftReceipt, PublishingAccount } from "./types";

export interface WeChatDraftArticle {
	title: string;
	author: string;
	digest: string;
	content: string;
	content_source_url: string;
	thumb_media_id: string;
	need_open_comment: number;
	only_fans_can_comment: number;
}

export interface WeChatApiPort {
	getAccessToken: (appId: string, secret: string) => Promise<string>;
	uploadImage: (data: ArrayBuffer, fileName: string, token: string) => Promise<{ media_id: string; url: string }>;
	addDraft: (articles: WeChatDraftArticle[], token: string) => Promise<{ media_id: string }>;
}

export interface WeChatDraftAdapterOptions {
	getSecret(reference: string): string | null | Promise<string | null>;
	api?: WeChatApiPort;
	now?: () => Date;
}

const defaultApi: WeChatApiPort = { getAccessToken, uploadImage, addDraft };
// SerenaPost 1.1.5 DraftConfirmModal preflight limits, scoped to WeChat delivery.
const WECHAT_DRAFT_LIMITS = { title: 64, author: 8, digest: 120 };

function safeApiError(error: unknown): string | undefined {
	if (!(error instanceof WeixinApiError) || !/^-?\d+$/.test(String(error.errcode)) || Number(error.errcode) === 0) return;
	// Rebuild from the numeric code only: the server's errmsg may echo credentials.
	return toWeixinError({ errcode: error.errcode }, "微信接口拒绝了这次请求").message;
}

function aborted(signal: AbortSignal): void {
	if (signal.aborted) throw new PublishingCheckError("已停止后续步骤；已经上传的微信素材会保留，此操作不会撤回远端内容。");
}

function destination(account: PublishingAccount): void {
	if (account.platform !== "wechat" || !account.appId?.trim() || !account.secretRef?.trim()) {
		throw new PublishingCheckError("公众号缺少 AppID 或安全凭据引用，请检查账号设置。");
	}
}

/** Upstream API transport, frozen content, one create request, and no public publish. */
export function createWeChatDraftAdapter(options: WeChatDraftAdapterOptions): DraftAdapter {
	const api = options.api ?? defaultApi;
	return {
		async createDraft(article, account, context) {
			const receipt = (state: DraftReceipt["state"], extra: Partial<DraftReceipt> = {}): DraftReceipt => ({
				platform: "wechat", accountId: account.id, accountLabel: account.label, state,
				snapshotHash: article.fingerprint, updatedAt: (options.now?.() ?? new Date()).toISOString(), ...extra,
			});
			let createRequested = false;
			try {
				destination(account);
				verifyPreparedArticle(article);
				for (const [field, label] of [["title", "标题"], ["author", "署名"], ["digest", "摘要"]] as const) {
					if (article[field].length > WECHAT_DRAFT_LIMITS[field]) throw new PublishingCheckError(`公众号${label}最多 ${WECHAT_DRAFT_LIMITS[field]} 字，请修改后重新预览。`);
				}
				if (!article.cover) throw new PublishingCheckError("公众号草稿必须有本地封面，请选择封面并重新预览。");
				aborted(context.signal);
				const secret = await options.getSecret(account.secretRef!);
				if (!secret?.trim()) throw new PublishingCheckError("安全凭据存储中没有此公众号的 AppSecret，请重新保存账号凭据。");
				aborted(context.signal);
				// Persist sending before the first request. A failed write prevents delivery.
				await context.onProgress(receipt("sending"));
				aborted(context.signal);
				const token = await api.getAccessToken(account.appId!, secret);
				if (!token) throw new PublishingCheckError("微信未返回有效访问令牌，请检查公众号凭据。");
				aborted(context.signal);
				const uploaded = new Map<string, { media_id: string; url: string }>();
				const upload = async (dataUrl: string, fileName: string) => {
					const cached = uploaded.get(dataUrl);
					if (cached) return cached;
					aborted(context.signal);
					const decoded = decodeImageDataUrl(dataUrl);
					const result = await api.uploadImage(decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer, fileName, token);
					if (!result?.media_id || !/^https?:\/\/mmbiz\.(?:qpic|qlogo)\.cn\//i.test(result.url || "")) throw new PublishingCheckError("微信图片上传结果不完整，已停止创建草稿，请检查素材后重试。");
					uploaded.set(dataUrl, result);
					aborted(context.signal);
					return result;
				};
				const cover = await upload(assetDataUrl(article.cover), article.cover.fileName);
				let html = article.wechatHtml;
				const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)];
				const allowed = new Map(article.wechatAssets.map(asset => [assetDataUrl(asset), asset]));
				for (const image of images) {
					const asset = allowed.get(image[1]);
					if (!asset) throw new PublishingCheckError("公众号正文图片没有对应冻结快照，请重新预览。");
					const result = await upload(image[1], asset.fileName);
					html = html.split(`src="${image[1]}"`).join(`src="${result.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
				}
				if (/<img\b[^>]*\bsrc=["'](?:data:|file:|app:)/i.test(html)) throw new PublishingCheckError("公众号正文仍有未上传的本地图片，已停止创建草稿。");
				aborted(context.signal);
				createRequested = true;
				const result = await api.addDraft([{
					title: article.title, author: article.author, digest: article.digest, content: html,
					content_source_url: "", thumb_media_id: cover.media_id, need_open_comment: 0, only_fans_can_comment: 0,
				}], token);
				if (!result?.media_id || typeof result.media_id !== "string") return receipt("unknown", { error: "微信未返回草稿 ID，结果无法确认。请先检查公众号草稿箱，系统不会自动重发。" });
				// An abort cannot undo a successful remote operation.
				return receipt("draft-created", { draftId: result.media_id });
			} catch (error) {
				const rejected = safeApiError(error);
				if (createRequested && !rejected) return receipt("unknown", { error: "创建请求已发出，但微信结果无法确认。请先检查公众号草稿箱，系统不会自动重发；停止操作不会撤回远端内容。" });
				return receipt("failed", { error: rejected || publishingErrorMessage(error, "公众号草稿准备或图片上传失败，尚未发起创建草稿。请检查连接和账号设置。") });
			}
		},
	};
}
