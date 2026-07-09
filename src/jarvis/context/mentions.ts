import { App, TFile } from "obsidian";

// ============================================================
// @提及文件选择器 + 图片转码工具
//   @ 触发 → 库内文件模糊搜索 → 插入 [[path]]；屈原经 Read 工具自取内容。
//   图片：File → base64（去 data: 前缀），喂给 UserTurn.images。
// ============================================================

export class MentionPicker {
	constructor(private app: App) {}

	suggest(query: string, limit = 8): TFile[] {
		const q = query.toLowerCase();
		const files = this.app.vault.getMarkdownFiles();
		if (!q) return files.slice(0, limit);
		const scored = files
			.map((f) => ({ f, s: score(f, q) }))
			.filter((x) => x.s > 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, limit)
			.map((x) => x.f);
		return scored;
	}
}

function score(f: TFile, q: string): number {
	const name = f.basename.toLowerCase();
	const path = f.path.toLowerCase();
	if (name === q) return 100;
	if (name.startsWith(q)) return 80;
	if (name.includes(q)) return 60;
	if (path.includes(q)) return 30;
	return 0;
}

export function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const res = String(reader.result);
			const comma = res.indexOf(",");
			resolve(comma >= 0 ? res.slice(comma + 1) : res);
		};
		reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
		reader.readAsDataURL(file);
	});
}
