import { createHash } from "node:crypto";
import { toUploadable } from "../../vendor/serena-post/src/utils/image";
import type { PublishingAsset } from "./types";
import { PublishingCheckError } from "./security";

export interface LocalPublishingResource {
	/** Canonical vault-relative identity, checked by the host's realpath boundary. */
	source: string;
	fileName: string;
	mime: string;
	bytes: Uint8Array | ArrayBuffer;
}

export type LocalPublishingResolver = (reference: string, sourcePath: string) => Promise<LocalPublishingResource>;

export function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function assetDataUrl(asset: PublishingAsset): string {
	return `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}`;
}

/** Typed arrays cannot be frozen. A defensive getter keeps the snapshot immutable. */
export function freezeAsset(source: string, fileName: string, mime: string, input: Uint8Array | ArrayBuffer): PublishingAsset {
	const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input.slice(0));
	return Object.freeze({ source, fileName, mime, sha256: sha256(bytes), get bytes() { return Uint8Array.from(bytes); } });
}

export function assertSupportedMedia(resource: LocalPublishingResource): void {
	const b = resource.bytes instanceof Uint8Array ? resource.bytes : new Uint8Array(resource.bytes);
	const ascii = (at: number, count: number) => String.fromCharCode(...b.subarray(at, at + count));
	const mime = resource.mime.toLowerCase();
	const valid = (mime === "image/png" && ascii(0, 8) === "\x89PNG\r\n\x1a\n")
		|| (/^image\/jpe?g$/.test(mime) && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
		|| (mime === "image/gif" && /^GIF8[79]a$/.test(ascii(0, 6)))
		|| (mime === "image/webp" && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP")
		|| (mime === "image/bmp" && ascii(0, 2) === "BM")
		|| (mime === "image/avif" && ascii(4, 4) === "ftyp" && /avif|avis/.test(ascii(8, 24)))
		|| (mime === "image/svg+xml" && /<svg[\s>]/i.test(Buffer.from(b).toString("utf8")) && !/(?:href\s*=|url\s*\(|@import|<script|<foreignObject)/i.test(Buffer.from(b).toString("utf8")))
		|| (/^video\/(?:mp4|quicktime)$/.test(mime) && /\.(?:mp4|mov)$/i.test(resource.fileName) && ascii(4, 4) === "ftyp");
	if (!valid || b.byteLength === 0) throw new PublishingCheckError("图片或视频格式无效；请使用本地图片或 MP4/MOV 视频，SVG 不能引用外部资源。");
}

export async function wechatImage(asset: PublishingAsset): Promise<PublishingAsset> {
	if (!asset.mime.startsWith("image/")) throw new PublishingCheckError("公众号封面必须是本地图片。");
	const bytes = asset.bytes;
	const result = await toUploadable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, asset.mime);
	if (!/^image\/(?:png|jpeg)$/.test(result.mimeType) || result.data.byteLength > 1024 * 1024) {
		throw new PublishingCheckError("公众号图片转换后仍超过 1MB，请缩小图片后重新预览。");
	}
	const name = asset.fileName.replace(/\.[^.]+$/, "") + (result.mimeType === "image/png" ? ".png" : ".jpg");
	return freezeAsset(name, name, result.mimeType, result.data);
}

export function decodeImageDataUrl(value: string): { mime: string; bytes: Uint8Array } {
	const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
	if (!match) throw new PublishingCheckError("公众号正文包含未冻结或不支持的图片，请重新预览。");
	return { mime: match[1], bytes: Uint8Array.from(Buffer.from(match[2], "base64")) };
}
