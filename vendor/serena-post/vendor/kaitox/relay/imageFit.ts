/**
 * 图片体积适配（SerenaPost 版）：X 媒体上传单张上限 5MB，超限图片入库前重编码到限内。
 * 原版 Kaitox relay 用 sharp（原生模块）；插件运行在 Obsidian（Electron 渲染进程）里，
 * 这里改用浏览器 canvas 实现同样的策略：
 *   - 不透明图 → JPEG（白底、质量 0.9）；带透明图 → WebP（保留 alpha）；
 *   - 仍超限则按比例逐级缩小；GIF / SVG 等原样放行；任何失败都原样放行。
 */
export const MAX_X_IMAGE_BYTES = 5_242_880;

const QUALITY = 0.9;
const SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2];
const FITTABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
	const data = ctx.getImageData(0, 0, w, h).data;
	for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
	return false;
}

function toBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), mime, QUALITY));
}

export async function fitImageBytes(
	bytes: Uint8Array,
	mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
	if (bytes.byteLength <= MAX_X_IMAGE_BYTES || !FITTABLE_MIMES.has(mime)) return { bytes, mime };
	if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return { bytes, mime };
	try {
		const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
		const probe = document.createElement('canvas');
		probe.width = bitmap.width;
		probe.height = bitmap.height;
		const pctx = probe.getContext('2d');
		if (!pctx) return { bytes, mime };
		pctx.drawImage(bitmap, 0, 0);
		const transparent = hasTransparency(pctx, probe.width, probe.height);
		const targetMime = transparent ? 'image/webp' : 'image/jpeg';
		for (const scale of SCALE_STEPS) {
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const ctx = canvas.getContext('2d');
			if (!ctx) break;
			if (!transparent) {
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}
			ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const blob = await toBlob(canvas, targetMime);
			if (blob.size <= MAX_X_IMAGE_BYTES) {
				return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: targetMime };
			}
		}
		return { bytes, mime };
	} catch {
		return { bytes, mime };
	}
}
