// TALOS 插件控制台动作运行时装配；由 TalosPlugin 委托调用。
import { type ConsoleActionRuntime, createConsoleActionRuntime } from "../console-action-runtime";
import { Notice, normalizePath } from "obsidian";
import { VaultRecoveryStore } from "../task-core/recovery-store";
import { createWindowTimerHost, partialTaskResult } from "../task-core/task-runner";
import type TalosPlugin from "../main";
import { ensureVaultFolder } from "./quyuan-diagnostics";

export function createTalosActionRuntime(plugin: TalosPlugin): ConsoleActionRuntime {
	const actionTimers = createWindowTimerHost(activeWindow);
	const noteRoots = Array.from(
		new Set(
			[
				plugin.talosSettings.inboxFolder,
				plugin.talosSettings.dailyFolder,
				plugin.paths.dir("insights"),
				plugin.paths.dir("output"),
				"00 收件箱",
				"01 日志",
				"30 洞察",
				"70 输出",
			].map((path) => normalizePath(path))
		)
	);
	const executeCallback = async (input: unknown): Promise<unknown> => {
		if (
			!input ||
			typeof input !== "object" ||
			typeof (input as { execute?: unknown }).execute !== "function"
		) {
			throw new Error("该受控动作缺少已批准的执行回调");
		}
		return (input as { execute(): Promise<unknown> }).execute();
	};
	return createConsoleActionRuntime({
		dependencies: {
			refreshStats: async () => {
				plugin.refreshViews();
				return { refreshed: true };
			},
			vaultLint: async () => {
				const notes = plugin.app.vault.getMarkdownFiles();
				const missingFrontmatter = notes.filter(
					(file) =>
						!plugin.app.metadataCache.getFileCache(file)?.frontmatter
				).length;
				new Notice(
					`只读 Lint：扫描 ${notes.length} 篇，缺 frontmatter ${missingFrontmatter} 篇`
				);
				if (missingFrontmatter > 0) {
					return partialTaskResult({
						result: {
							notes: notes.length,
							missingFrontmatter,
						},
						error: `${missingFrontmatter} 篇笔记缺少 frontmatter`,
					});
				}
				return { notes: notes.length, missingFrontmatter };
			},
			deepResearch: async (_input, context) => {
				const { deepResearch } = await import("../actions");
				await deepResearch(
					plugin.app,
					plugin.talosSettings,
					context.signal
				);
				return { requested: true };
			},
			createNote: async (input) => {
				if (
					!input ||
					typeof input !== "object" ||
					typeof (input as { targetPath?: unknown }).targetPath !==
						"string"
				) {
					throw new Error("新建内容缺少目标路径");
				}
				const targetPath = normalizePath(
					(input as { targetPath: string }).targetPath
				);
				if (
					targetPath.startsWith(".talos/private/") ||
					!noteRoots.some(
						(root) =>
							targetPath === root ||
							targetPath.startsWith(`${root}/`)
					)
				) {
					throw new Error(`新建内容目标超出允许范围：${targetPath}`);
				}
				const slash = targetPath.lastIndexOf("/");
				if (slash > 0) {
					await ensureVaultFolder(plugin, targetPath.slice(0, slash));
				}
				const content =
					typeof (input as { content?: unknown }).content === "string"
						? (input as { content: string }).content
						: "# TALOS 行动记录\n";
				await plugin.app.vault.create(targetPath, content);
				return { path: targetPath };
			},
			publishBackfill: executeCallback,
			decideApproval: executeCallback,
			decidePreference: executeCallback,
		},
		scopes: {
			noteWriteScopes: noteRoots.map((path) => `${path}/**`),
		},
		recoveryStore: new VaultRecoveryStore({
			exists: (path) => plugin.app.vault.adapter.exists(path),
			read: (path) => plugin.app.vault.adapter.read(path),
			write: (path, value) =>
				plugin.app.vault.adapter.write(path, value),
			remove: (path) => plugin.app.vault.adapter.remove(path),
		}),
		timers: actionTimers,
	});
}
