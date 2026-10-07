// TALOS 插件屈原诊断报告与运行时错误记录；由 TalosPlugin 委托调用。
import { DEFAULT_SETTINGS } from "../settings";
import { Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { QUYUAN_RUNTIME_ERROR_LIMIT, formatError, timestampForPath } from "./plugin-support";
import { VIEW_TYPE_TALOS_AGENT_RECOVERY } from "../agent-workbench/ui/talos-agent-recovery-view";
import { VIEW_TYPE_TALOS } from "../view";
import type TalosPlugin from "../main";

export function recordQuyuanRuntimeError(plugin: TalosPlugin, scope: string, error: unknown): void {
	const formatted = formatError(error);
	plugin.quyuanRuntimeErrors.push({
		at: new Date().toISOString(),
		scope,
		message: formatted.message,
		stack: formatted.stack,
	});
	while (plugin.quyuanRuntimeErrors.length > QUYUAN_RUNTIME_ERROR_LIMIT) {
		plugin.quyuanRuntimeErrors.shift();
	}
}

export async function writeQuyuanDiagnostics(plugin: TalosPlugin, openReport = true): Promise<string> {
	const folder = plugin.talosSettings?.reportsFolder || DEFAULT_SETTINGS.reportsFolder;
	await ensureVaultFolder(plugin, folder);
	const path = normalizePath(
		`${folder}/talos-quyuan-diagnostics-${timestampForPath()}.md`
	);
	const report = buildQuyuanDiagnosticsReport(plugin, path);
	// 同一秒内重复生成时文件已存在，create 会抛错——存在则改为覆盖
	const existing = plugin.app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) await plugin.app.vault.modify(existing, report);
	else await plugin.app.vault.create(path, report);
	if (openReport) {
		const file = plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await plugin.app.workspace.getLeaf(true).openFile(file);
	}
	new Notice(`屈原诊断报告已生成：${path}`);
	return path;
}

/**
 * 屈原页白屏视觉诊断（2026-07-10）：面板已挂载、麦克风在工作，但页面一片白
 * 且拦截点击——说明渲染层被盖住或布局塌了。此命令把控制台视图的 DOM 布局、
 * 关键节点计算样式、以及视图中心点的元素堆叠链写进 vault 报告，免开 DevTools。
 */
export async function writeQuyuanVisualDiagnostics(plugin: TalosPlugin): Promise<string> {
	const folder = plugin.talosSettings?.reportsFolder || DEFAULT_SETTINGS.reportsFolder;
	await ensureVaultFolder(plugin, folder);
	const path = normalizePath(
		`${folder}/talos-quyuan-visual-${timestampForPath()}.md`
	);

	const describe = (el: Element | null, label: string): string => {
		if (!el) return `- ${label}: (不存在)`;
		const rect = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		const cls = (typeof el.className === "string" ? el.className : "")
			.split(/\s+/).filter(Boolean).slice(0, 4).join(".");
		return `- ${label}: \`${el.tagName.toLowerCase()}${cls ? "." + cls : ""}\` ` +
			`${Math.round(rect.width)}×${Math.round(rect.height)} @(${Math.round(rect.left)},${Math.round(rect.top)}) ` +
			`display=${cs.display} opacity=${cs.opacity} visibility=${cs.visibility} ` +
			`position=${cs.position} z=${cs.zIndex} pointerEvents=${cs.pointerEvents} bg=${cs.backgroundColor}`;
	};

	const lines: string[] = [
		"---",
		'title: "TALOS 屈原页面视觉诊断"',
		`date: ${new Date().toISOString()}`,
		"tags: [TALOS, 屈原, diagnostics]",
		"status: active",
		"type: report",
		'summary: "屈原页白屏的 DOM/样式现场快照。"',
		"---",
		"",
		"# TALOS 屈原页面视觉诊断",
		"",
	];

	// 样式表审计：.tq-voice 规则是否真的进了 document、样式是否被截断
	lines.push("## 样式表审计", "");
	const styleTags = Array.from(activeDocument.head.querySelectorAll("style"));
	styleTags.forEach((tag, i) => {
		const text = tag.textContent ?? "";
		if (!text.includes("talos-console") && !text.includes("tq-voice")) return;
		const tail = text.slice(-100).replace(/\s+/g, " ");
		lines.push(
			`- style#${i + 1}: 长度=${text.length} 字符, ` +
			`含 .tq-voice 出现 ${(text.match(/\.tq-voice/g) || []).length} 次, ` +
			`含 page-jarvis 出现 ${(text.match(/page-jarvis|data-talos-page="jarvis"/g) || []).length} 次`,
			`  - 末尾 100 字符: \`${tail}\``
		);
	});
	let tqRuleCount = 0;
	let jarvisGuardCount = 0;
	for (const sheet of Array.from(activeDocument.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		for (const rule of Array.from(rules)) {
			if (!(rule instanceof CSSStyleRule)) continue;
			const sel = rule.selectorText ?? "";
			if (sel.includes(".tq-voice")) tqRuleCount++;
			if (sel.includes('[data-talos-page="jarvis"]')) jarvisGuardCount++;
		}
	}
	lines.push(
		`- 已解析生效的 .tq-voice 规则总数: ${tqRuleCount}`,
		`- 已解析生效的 [data-talos-page="jarvis"] 规则总数: ${jarvisGuardCount}`,
		""
	);

	const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS);
	if (leaves.length === 0) lines.push("- 未找到控制台视图 leaf。");

	leaves.forEach((leaf, i) => {
		const container = leaf.view.containerEl;
		const consoleEl = container.querySelector(".talos-console");
		lines.push(`## Leaf #${i + 1}`, "");
		if (!consoleEl) {
			lines.push("- 未找到 `.talos-console` 根元素（视图 shell 未渲染）。", "");
			lines.push(describe(container, "containerEl"), "");
			return;
		}
		lines.push(
			`- data-talos-page: \`${consoleEl.getAttribute("data-talos-page") ?? "(无)"}\``,
			`- class: \`${consoleEl.className}\``,
			"",
			"### 关键节点",
			"",
			describe(container.querySelector(".view-content"), "view-content"),
			describe(consoleEl, "talos-console"),
			describe(consoleEl.querySelector(".app"), "app"),
			describe(consoleEl.querySelector(".sidebar"), "sidebar"),
			describe(consoleEl.querySelector(".main"), "main"),
			describe(consoleEl.querySelector(".page-content"), "page-content"),
			describe(consoleEl.querySelector(".tq-voice"), "tq-voice"),
			""
		);
		const tq = consoleEl.querySelector(".tq-voice");
		if (tq) {
			lines.push("### tq-voice 子元素", "");
			Array.from(tq.children).forEach((child, j) =>
				lines.push(describe(child, `child#${j + 1}`))
			);
			lines.push("");
		}
		const pc = consoleEl.querySelector(".page-content");
		if (pc && pc !== tq?.parentElement) {
			lines.push("### page-content 子元素", "");
			Array.from(pc.children).forEach((child, j) =>
				lines.push(describe(child, `child#${j + 1}`))
			);
			lines.push("");
		}
		// 视图中心点的元素堆叠：白屏时最上层是谁、谁在拦截点击，一目了然
		const rect = container.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const stack = activeDocument.elementsFromPoint(cx, cy).slice(0, 14);
		lines.push(`### 中心点 (${Math.round(cx)},${Math.round(cy)}) 元素堆叠（上→下）`, "");
		stack.forEach((el, j) => lines.push(describe(el, `#${j + 1}`)));
		lines.push("");
	});

	// 同一秒内重复生成时文件已存在，create 会抛错——存在则改为覆盖
	const existingVisual = plugin.app.vault.getAbstractFileByPath(path);
	if (existingVisual instanceof TFile) await plugin.app.vault.modify(existingVisual, lines.join("\n"));
	else await plugin.app.vault.create(path, lines.join("\n"));
	new Notice(`屈原视觉诊断已生成：${path}`);
	return path;
}

export function buildQuyuanDiagnosticsReport(plugin: TalosPlugin, path: string): string {
	const workspace = plugin.app.workspace;
	const leaves = workspace.getLeavesOfType(VIEW_TYPE_TALOS_AGENT_RECOVERY);
	const service = plugin.agentWorkbenchService;
	const safeWorkbenchSettings = service?.isReady()
		? {
			selection: service.getSelection(),
			workflow: service.getWorkflowMode(),
			permissionMode: service.getPermissionMode(),
			implementation: "talos-native",
		}
		: null;
	const safeTalosSettings = plugin.talosSettings
		? {
			visualTheme: plugin.talosSettings.visualTheme,
			syncVaultTheme: plugin.talosSettings.syncVaultTheme,
			openOnStartup: plugin.talosSettings.openOnStartup,
			engineProvider: plugin.talosSettings.engineProvider,
			quyuanAsrEngine: plugin.talosSettings.quyuanAsrEngine,
			jarvisVoiceEnabled: plugin.talosSettings.jarvisVoiceEnabled,
		}
		: null;

	const lines = [
		"---",
		'title: "TALOS 屈原诊断报告"',
		`date: ${new Date().toISOString()}`,
		"tags: [TALOS, 屈原, diagnostics]",
		"status: active",
		"type: report",
		'summary: "Obsidian 内 TALOS 屈原模块运行时诊断。"',
		"---",
		"",
		"# TALOS 屈原诊断报告",
		"",
			`- 报告文件：\`${path}\``,
			`- 插件版本：\`${plugin.manifest.version}\``,
			`- 完整工作台视图类型：\`${VIEW_TYPE_TALOS_AGENT_RECOVERY}\``,
			`- 完整工作台初始化：${plugin.describeQuyuanWorkbenchStatus()}`,
			`- 屈原人格启动：${plugin.quyuanSoul ? "✅ 已加载" : `❌ ${plugin.quyuanSoulError || "未加载"}`}`,
		`- 屈原人格加载时间：${plugin.quyuanSoul?.loadedAt ? new Date(plugin.quyuanSoul.loadedAt).toISOString() : "n/a"}`,
		`- 当前工作台 leaf 数：${leaves.length}`,
		"",
		"## Leaf 状态",
		"",
		...describeQuyuanLeaves(plugin, leaves),
		"",
		"## 工作台设置快照",
		"",
		"```json",
		JSON.stringify(safeWorkbenchSettings, null, 2),
		"```",
		"",
		"## TALOS 设置快照",
		"",
		"```json",
		JSON.stringify(safeTalosSettings, null, 2),
		"```",
		"",
		"## 最近运行时错误",
		"",
		...describeQuyuanRuntimeErrors(plugin),
		"",
		"## 下一步",
		"",
		"- 如果 `AgentWorkbenchService.initialize` 有错误，优先看原生工作台初始化链路。",
		"- 如果 leaf 已创建但对话内容为空，优先看 `TalosAgentRecoveryView.onOpen` 抛错。",
		"- 如果没有错误但仍不可见，优先查 Obsidian 布局位置、右侧栏折叠状态和 CSS 可见性。",
		"",
	];
	return lines.join("\n");
}

export function describeQuyuanLeaves(plugin: TalosPlugin, leaves: WorkspaceLeaf[]): string[] {
	if (leaves.length === 0) return ["- 未找到 `talos-quyuan-view` leaf。"];
	const workspace = plugin.app.workspace;
	return leaves.map((leaf, index) => {
		const view = leaf.view as unknown as {
			containerEl?: HTMLElement;
			contentEl?: HTMLElement;
			getViewType?: () => string;
			getTabManager?: () => unknown;
		};
		const root = view.containerEl ?? view.contentEl ?? null;
		const rootName = leaf.getRoot() === workspace.rootSplit ? "main" : "sidebar/other";
		const hasShell = !!root?.querySelector(".talos-quyuan-shell, .claudian-container");
		const hasTabManager = typeof view.getTabManager === "function" && !!view.getTabManager();
		const viewType = typeof view.getViewType === "function" ? view.getViewType() : "unknown";
		return `- #${index + 1}: root=${rootName}, viewType=${viewType}, hasShell=${hasShell}, hasTabManager=${hasTabManager}`;
	});
}

export function describeQuyuanRuntimeErrors(plugin: TalosPlugin): string[] {
	if (plugin.quyuanRuntimeErrors.length === 0) return ["- 暂无记录。"];
	return plugin.quyuanRuntimeErrors.flatMap((item, index) => [
		`### ${index + 1}. ${item.scope}`,
		"",
		`- 时间：${item.at}`,
		`- 错误：${item.message}`,
		"",
		"```text",
		item.stack || "(no stack)",
		"```",
		"",
	]);
}

export async function ensureVaultFolder(plugin: TalosPlugin, folder: string): Promise<void> {
	const path = normalizePath(folder);
	const parts = path.split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await plugin.app.vault.adapter.exists(current))) {
			try {
				await plugin.app.vault.createFolder(current);
			} catch {
				/* Folder may have been created by another Obsidian event. */
			}
		}
	}
}

export function scheduleQuyuanWorkbenchCheck(plugin: TalosPlugin, leaf: WorkspaceLeaf): void {
	window.setTimeout(() => {
		const view = leaf.view as unknown as {
			containerEl?: HTMLElement;
			contentEl?: HTMLElement;
			getTabManager?: () => unknown;
		};
		const root = view.containerEl ?? view.contentEl ?? null;
		const hasShell = !!root?.querySelector(".talos-quyuan-shell, .claudian-container");
		const hasTabManager = typeof view.getTabManager === "function" && !!view.getTabManager();
		if (hasShell && hasTabManager) return;
		const error = new Error(
			`屈原完整工作台打开后自检失败：hasShell=${hasShell}, hasTabManager=${hasTabManager}`
		);
		recordQuyuanRuntimeError(plugin, "activateQuyuanV2View.postOpenCheck", error);
		void writeQuyuanDiagnostics(plugin, false).then((path) => {
			new Notice(`屈原工作台打开后自检失败，诊断已写入：${path}`);
		});
	}, 1200);
}
