// TALOS 插件控制台动作运行时装配；由 TalosPlugin 委托调用。
import { type ConsoleActionRuntime, createConsoleActionRuntime } from "../console-action-runtime";
import { TFile, normalizePath } from "obsidian";
import { TRIAGE_TARGET_KEYS } from "../inbox-triage";
import { VaultRecoveryStore } from "../task-core/recovery-store";
import { createWindowTimerHost, partialTaskResult } from "../task-core/task-runner";
import type TalosPlugin from "../main";
import { ensureVaultFolder } from "./quyuan-diagnostics";
import { revealChatSidebar } from "./chat-sidebar-view";

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
				const { vaultLint } = await import("../actions");
				const result = vaultLint(plugin.app);
				const missing = result.missingFrontmatter + result.missingTags + result.missingStatus;
				return missing > 0
					? partialTaskResult({ result, error: `发现 ${missing} 项元数据问题` })
					: result;
			},
			// 保留旧 actionId 的风险合同，但不再启动独立命令或写研究报告。
			deepResearch: async (_input, context) => {
				const { openResearchWorkbench } = await import("../actions");
				return openResearchWorkbench(() => revealChatSidebar(plugin.app.workspace), context.signal);
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
			moveInboxNote: async (input) => {
				const { from, to } = parseInboxMove(input);
				const inboxRoot = normalizePath(plugin.talosSettings.inboxFolder);
				const targetRoots = TRIAGE_TARGET_KEYS.map((key) => normalizePath(plugin.paths.dir(key)));
				if (!from.startsWith(`${inboxRoot}/`)) throw new Error(`分诊来源不在收件箱内：${from}`);
				if (!targetRoots.some((root) => to.startsWith(`${root}/`))) {
					throw new Error(`分诊目标超出允许目录：${to}`);
				}
				const file = plugin.app.vault.getAbstractFileByPath(from);
				if (!(file instanceof TFile)) throw new Error(`收件箱笔记已不存在：${from}`);
				if (plugin.app.vault.getAbstractFileByPath(to)) throw new Error(`目标已有同名笔记：${to}`);
				const slash = to.lastIndexOf("/");
				if (slash > 0) await ensureVaultFolder(plugin, to.slice(0, slash));
				// fileManager.renameFile 会按用户设置同步更新指向该笔记的链接。
				await plugin.app.fileManager.renameFile(file, to);
				return { from, to };
			},
			publishBackfill: executeCallback,
			decideApproval: executeCallback,
			decidePreference: executeCallback,
		},
		scopes: {
			noteWriteScopes: noteRoots.map((path) => `${path}/**`),
			inboxTriageReadScopes: [`${normalizePath(plugin.talosSettings.inboxFolder)}/**`],
			inboxTriageWriteScopes: [
				`${normalizePath(plugin.talosSettings.inboxFolder)}/**`,
				...TRIAGE_TARGET_KEYS.map((key) => `${normalizePath(plugin.paths.dir(key))}/**`),
			],
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

function parseInboxMove(input: unknown): { from: string; to: string } {
	const value = input as { from?: unknown; to?: unknown } | null;
	if (!value || typeof value.from !== "string" || typeof value.to !== "string") {
		throw new Error("分诊归档缺少来源或目标路径");
	}
	return { from: normalizePath(value.from), to: normalizePath(value.to) };
}
