import type { App } from "obsidian";

export const QUYUAN_REQUIRED_CONTEXT = [
	"灵魂/PERSONA.md",
	"灵魂/persona-memory.md",
	"Identity/CONTEXT.md",
] as const;

export type QuyuanContextPath = (typeof QUYUAN_REQUIRED_CONTEXT)[number];

export interface QuyuanContextSource {
	path: QuyuanContextPath;
	content: string;
}

export interface QuyuanSoulContext {
	loadedAt: number;
	sources: QuyuanContextSource[];
	systemContext: string;
}

export class QuyuanSoulBootstrapError extends Error {
	readonly missingPaths: QuyuanContextPath[];

	constructor(missingPaths: QuyuanContextPath[]) {
		super(`屈原人格启动失败，缺少：${missingPaths.join("、")}`);
		this.name = "QuyuanSoulBootstrapError";
		this.missingPaths = missingPaths;
	}
}

export async function loadQuyuanSoulContext(app: App): Promise<QuyuanSoulContext> {
	const sources: QuyuanContextSource[] = [];
	const missing: QuyuanContextPath[] = [];

	for (const path of QUYUAN_REQUIRED_CONTEXT) {
		try {
			if (!(await app.vault.adapter.exists(path))) {
				missing.push(path);
				continue;
			}
			const content = await app.vault.adapter.read(path);
			if (!content.trim()) {
				missing.push(path);
				continue;
			}
			sources.push({ path, content });
		} catch {
			missing.push(path);
		}
	}

	if (missing.length > 0) throw new QuyuanSoulBootstrapError(missing);

	const systemContext = sources
		.map(({ path, content }) => `# 强制上下文：${path}\n\n${content}`)
		.join("\n\n---\n\n");

	return {
		loadedAt: Date.now(),
		sources,
		systemContext,
	};
}

