/**
 * 动图和视频：公众号接口只收静态图，也不能自动上传视频。
 * 推公众号前在正文里给它们留一行醒目的提示，推完到编辑器里手动补上。
 * （X 由 Kaitox 扩展直接上传动图和视频，这里只用来统计有哪些；超过 15MB 的动图见 xpush.ts 的 staticGifs。）
 */

export const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
export const GIF_EXT = /\.gif$/i;

export const gifPlaceholder = (name: string) => `【这里换成动图：${name}】`;
export const videoPlaceholder = (name: string) => `【这里插入视频：${name}】`;

export interface MediaMarks {
	text: string;
	gifs: string[];
	videos: string[];
}

/** 从图片引用里取出文件名（去掉路径、#锚点、|别名、URL 参数） */
export function mediaName(ref: string): string {
	let s = ref.split('|')[0].split('#')[0].split('?')[0].trim();
	try { s = decodeURIComponent(s); } catch { /* 保持原样 */ }
	return s.split(/[\\/]/).pop() || s;
}

/**
 * 给正文里的动图和视频加提示：
 * - GIF：图片保留（推送时变成第一帧静态图），后面另起一行「【这里换成动图：xx.gif】」
 * - 视频：整个嵌入换成「【这里插入视频：xx.mp4】」
 * 代码块里的不动。
 */
export function markMedia(markdown: string): MediaMarks {
	const gifs: string[] = [];
	const videos: string[] = [];
	const re = /(```[\s\S]*?```|~~~[\s\S]*?~~~)|!\[\[([^\]\n]+?)\]\]|!\[[^\]\n]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
	const text = markdown.replace(re, (whole, code, wiki, src) => {
		if (code) return whole;
		const name = mediaName(wiki ?? src ?? '');
		if (VIDEO_EXT.test(name)) {
			videos.push(name);
			return `\n\n${videoPlaceholder(name)}\n\n`;
		}
		if (GIF_EXT.test(name)) {
			gifs.push(name);
			return `${whole}\n\n${gifPlaceholder(name)}\n\n`;
		}
		return whole;
	});
	return { text, gifs, videos };
}

/**
 * 数 GIF 有几帧（只数到 2 就停）。解析不了返回 -1（当作动图处理，不改原样）。
 * 只有 1 帧的 GIF 其实是静态图：按动图（tweet_gif）传给 X 会被拒、被扩展悄悄跳过（2026-10-14 实测）。
 */
export function gifFrameCount(b: Uint8Array): number {
	const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
	if (b.length < 13 || ascii(0, 3) !== 'GIF') return -1;
	const skipColorTable = (flags: number) => (flags & 0x80 ? 3 * (1 << ((flags & 0x07) + 1)) : 0);
	const skipSubBlocks = (i: number) => {
		while (i < b.length && b[i] !== 0) i += b[i] + 1;
		return i + 1;
	};
	let i = 13 + skipColorTable(b[10]);
	let frames = 0;
	while (i < b.length) {
		const block = b[i];
		if (block === 0x3b) return frames; // 结尾
		if (block === 0x21) { i = skipSubBlocks(i + 2); continue; } // 扩展块
		if (block !== 0x2c || i + 10 > b.length) return -1;
		if (++frames > 1) return frames;
		i += 10 + skipColorTable(b[i + 9]);
		i = skipSubBlocks(i + 1); // 跳过 LZW 最小码长 + 图像数据
	}
	return frames || -1; // 文件被截断：数到了就算
}
