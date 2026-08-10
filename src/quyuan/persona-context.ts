import type { App } from "obsidian";

// 本模块刻意不依赖 data/schema：只接收三个路径字符串，由调用方（main.ts）
// 按当前目录映射解析后传入。默认值仅作兜底与诊断展示用。
export const QUYUAN_REQUIRED_CONTEXT = [
	"灵魂/PERSONA.md",
	"灵魂/persona-memory.md",
	"Identity/CONTEXT.md",
] as const;

export type QuyuanContextPath = string;

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

/**
 * 加载屈原启动强制上下文。
 * @param requiredPaths 由调用方按当前目录映射解析出的三个路径；缺省用默认结构。
 */
export async function loadQuyuanSoulContext(
	app: App,
	requiredPaths: readonly string[] = QUYUAN_REQUIRED_CONTEXT
): Promise<QuyuanSoulContext> {
	const sources: QuyuanContextSource[] = [];
	const missing: QuyuanContextPath[] = [];
	const required = requiredPaths.length > 0 ? requiredPaths : QUYUAN_REQUIRED_CONTEXT;

	for (const path of required) {
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

/**
 * Preserve the legacy three-file persona contract while allowing Standard
 * Vaults to reuse their canonical confirmed identity files. The fallback is
 * attempted only when the complete primary set cannot be loaded; sources are
 * never mixed across the two identity layouts.
 */
export async function loadQuyuanSoulContextWithFallback(
	app: App,
	primaryPaths: readonly string[],
	fallbackPaths: readonly string[]
): Promise<QuyuanSoulContext> {
	try {
		return await loadQuyuanSoulContext(app, primaryPaths);
	} catch (error) {
		if (!(error instanceof QuyuanSoulBootstrapError)) throw error;
		return loadQuyuanSoulContext(app, fallbackPaths);
	}
}
