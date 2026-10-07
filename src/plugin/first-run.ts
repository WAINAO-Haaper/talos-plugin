// TALOS 插件首次运行的库结构检测与上下文初始化；由 TalosPlugin 委托调用。
import { type DataSourceKey, detectSchemaDetailed } from "../data/schema";
import { Notice } from "obsidian";
import { bootstrapTalosVault, createObsidianVaultBootstrapHost } from "../bootstrap/vault-bootstrap";
import { createVaultCanonicalRegistryReader } from "../canonical/registry-reader";
import type TalosPlugin from "../main";
import { recordQuyuanRuntimeError } from "./quyuan-diagnostics";
import { initializeQuyuanSoul } from "./quyuan-workbench-init";

export async function initializeFirstRunContext(plugin: TalosPlugin): Promise<void> {
	await autoDetectVaultSchemaOnFirstRun(plugin);
	const P = plugin.paths;
	try {
		const result = await bootstrapTalosVault({
			host: createObsidianVaultBootstrapHost(plugin.app),
			primaryPersonaPaths: [P.personaFile, P.personaMemoryFile, P.contextFile],
			fallbackPersonaPaths: [
				P.join("identity", "身份.md"),
				P.join("identity", "偏好与边界.md"),
				P.join("identity", "目标.md"),
			],
		});
		if (result.invalidExisting.length > 0) {
			recordQuyuanRuntimeError(plugin, 
				"vaultBootstrap.invalidExisting",
				new Error(`已有脚手架为空或不可读，未覆盖：${result.invalidExisting.join("、")}`),
			);
		}
		try {
			await createVaultCanonicalRegistryReader(plugin.app).read();
		} catch (error) {
			recordQuyuanRuntimeError(plugin, "vaultBootstrap.registry", error);
		}
	} catch (error) {
		recordQuyuanRuntimeError(plugin, "vaultBootstrap", error);
	}
	await initializeQuyuanSoul(plugin);
}

export async function autoDetectVaultSchemaOnFirstRun(plugin: TalosPlugin): Promise<void> {
	try {
		const configured = plugin.talosSettings.vaultSchema;
		if (configured && Object.keys(configured).length > 0) return; // 用户已配置，不动
		if (plugin.talosSettings.schemaAutoDetected) return; // 已自动检测过，不重复打扰

		const result = detectSchemaDetailed(plugin.app);
		plugin.talosSettings.schemaAutoDetected = true;

		// 库里几乎没有可识别目录（例如全新空库）：不硬套，留默认，也不弹窗打扰
		if (result.matchedCount < 3) {
			await plugin.saveTalosSettings();
			return;
		}

		plugin.talosSettings.vaultSchema = { ...result.schema };
		// 统计来源文件：只在识别到时覆盖，避免把用户已改的路径冲掉
		const sourceKeys: DataSourceKey[] = [
			"tasksPath",
			"pendingApprovalsPath",
			"candidatesPath",
			"healthLogPath",
		];
		for (const key of sourceKeys) {
			const found = result.dataSources[key];
			if (found) plugin.talosSettings[key] = found;
		}
		// 收件箱/日记目录跟随识别结果
		plugin.talosSettings.inboxFolder = result.schema.inbox;
		plugin.talosSettings.dailyFolder = result.schema.logs;

		await plugin.saveTalosSettings();
		plugin.refreshViews();

		const renamed = result.entries.filter((e) => e.how === "alias" && e.matched);
		const detail = renamed.length > 0
			? `其中 ${renamed.length} 项按你的命名自动对齐（如 ${renamed
				.slice(0, 2)
				.map((e) => e.matched)
				.join("、")}）`
			: "全部与标准结构一致";
		new Notice(
			`TALOS 已自动识别你的库结构：匹配 ${result.matchedCount}/${result.entries.length} 个模块，${detail}。`
				+ "\n如需调整：设置 → TALOS → 目录映射。",
			12000
		);
	} catch (error) {
		recordQuyuanRuntimeError(plugin, "autoDetectVaultSchema", error);
		console.error("TALOS auto schema detection failed", error);
	}
}
