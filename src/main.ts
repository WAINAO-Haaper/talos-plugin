import { Notice, TFile, WorkspaceLeaf, addIcon, debounce, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, TalosSettingTab, TalosSettings, normalizeVisualTheme } from "./settings";
import { TalosView, VIEW_TYPE_TALOS } from "./view";
import { JarvisView, VIEW_TYPE_JARVIS } from "./jarvis-view";
import ClaudianWorkbenchPlugin from "./quyuan/claudian/main";
import { VIEW_TYPE_CLAUDIAN } from "./quyuan/claudian/core/types";
import {
	loadQuyuanSoulContext,
	type QuyuanSoulContext,
} from "./quyuan/persona-context";
import {
	evaluateQuyuanGovernance,
	type QuyuanGovernanceResult,
} from "./quyuan/governance";
import { MicStt, StreamTts } from "./jarvis/voiceio";
import { TALOS_ICON_SVG } from "./talos-mark";

// 统一的 TALOS 品牌图标：库内 02-品牌资产/TALOS-Logo-Reverse-Origin-v1.svg 的实际矢量
// （蓝底 #005CFF + 白色 T 标志，裁去 TALOS 文字，缩放进 100×100 视框）。ribbon 与视图标签共用。
export const TALOS_ICON = "talos-logo";
const QUYUAN_SOUL_START = "<!-- TALOS_QUYUAN_SOUL:START -->";
const QUYUAN_SOUL_END = "<!-- TALOS_QUYUAN_SOUL:END -->";
const QUYUAN_RUNTIME_ERROR_LIMIT = 24;

type QuyuanRuntimeErrorRecord = {
	at: string;
	scope: string;
	message: string;
	stack: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatError(error: unknown): { message: string; stack: string } {
	if (error instanceof Error) {
		return {
			message: error.message || error.name || "Unknown Error",
			stack: error.stack || "",
		};
	}
	if (typeof error === "string") return { message: error, stack: "" };
	try {
		return { message: JSON.stringify(error), stack: "" };
	} catch {
		return { message: String(error), stack: "" };
	}
}

function timestampForPath(date = new Date()): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

export default class TalosPlugin extends ClaudianWorkbenchPlugin {
	talosSettings!: TalosSettings;
	private quyuanSoul: QuyuanSoulContext | null = null;
	private quyuanSoulError = "";
	private quyuanWorkbenchError = "";
	private readonly quyuanRuntimeErrors: QuyuanRuntimeErrorRecord[] = [];
	private readonly quyuanReadPaths = new Set<string>();
	private quyuanTts: StreamTts | null = null;
	private quyuanStt: MicStt | null = null;
	private quyuanWorkbenchReady = false;
	private readonly handleWindowError = (event: ErrorEvent): void => {
		this.recordQuyuanRuntimeError("window.error", event.error ?? event.message);
	};
	private readonly handleWindowRejection = (event: PromiseRejectionEvent): void => {
		this.recordQuyuanRuntimeError("window.unhandledrejection", event.reason);
	};

	protected shouldRegisterWorkbenchRibbon(): boolean {
		return false;
	}

	protected shouldRegisterWorkbenchSettingTab(): boolean {
		return false;
	}

	async onload(): Promise<void> {
		await this.loadTalosSettings();
		this.quyuanTts = new StreamTts(this.talosSettings, () => {});
		this.applyVaultTheme();

		addIcon(TALOS_ICON, TALOS_ICON_SVG);

		this.registerView(
			VIEW_TYPE_TALOS,
			(leaf: WorkspaceLeaf) => new TalosView(leaf, this)
		);
		this.registerView(
			VIEW_TYPE_JARVIS,
			(leaf: WorkspaceLeaf) => new JarvisView(leaf, this)
		);

		this.addRibbonIcon(TALOS_ICON, "打开 TALOS 控制台", () => {
			void this.activateTalosView();
		});

		this.addCommand({
			id: "open",
			name: "Open console",
			callback: () => void this.activateTalosView(),
		});
		this.addCommand({
			id: "open-jarvis",
			name: "打开屈原旧版（回滚）",
			callback: () => void this.activateJarvisView(),
		});
		this.addCommand({
			id: "open-quyuan-v2",
			name: "打开屈原完整工作台",
			callback: () => void this.activateQuyuanV2View(),
		});
		this.addCommand({
			id: "quyuan-diagnostics",
			name: "生成屈原诊断报告",
			callback: () => void this.writeQuyuanDiagnostics(true),
		});
		this.addCommand({
			id: "quyuan-visual-diagnostics",
			name: "生成屈原页面视觉诊断",
			callback: () => void this.writeQuyuanVisualDiagnostics(),
		});

		this.addSettingTab(new TalosSettingTab(this.app, this));

		this.registerDomEvent(window, "error", this.handleWindowError);
		this.registerDomEvent(window, "unhandledrejection", this.handleWindowRejection);

		void this.initializeQuyuanSoul();
		void this.initializeQuyuanWorkbench();

		this.app.workspace.onLayoutReady(() => {
			if (this.talosSettings.openOnStartup) void this.activateHomeView();
		});

		const refresh = debounce(() => this.refreshViews(), 1500, true);
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (f instanceof TFile && f.extension === "md") refresh();
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (f) => {
				if (f instanceof TFile && f.extension === "md") refresh();
			})
		);
		this.registerEvent(this.app.vault.on("delete", () => refresh()));
	}

	private refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS)) {
			const view = leaf.view;
			if (view instanceof TalosView) void view.refresh();
		}
	}

	applyViewSettings(): void {
		this.applyVaultTheme();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS)) {
			const view = leaf.view;
			if (view instanceof TalosView) view.applySettings();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_JARVIS)) {
			const view = leaf.view;
			if (view instanceof JarvisView) view.applyTheme();
		}
	}

	private applyVaultTheme(): void {
		if (!this.talosSettings.syncVaultTheme) {
			activeDocument.body.removeAttribute("data-talos-vault-theme");
			return;
		}
		activeDocument.body.setAttribute(
			"data-talos-vault-theme",
			normalizeVisualTheme(this.talosSettings.visualTheme)
		);
	}

	onunload(): void {
		super.onunload();
		this.quyuanStt?.dispose();
		this.quyuanStt = null;
		this.quyuanTts?.stop();
		this.quyuanTts = null;
		activeDocument.body.removeAttribute("data-talos-vault-theme");
	}

	// 屈原独立对话：在右侧边栏打开（仿 Claudian）
	async activateJarvisView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_JARVIS);
		if (existing.length > 0) {
			const leaf = existing[0];
			if (leaf) void workspace.revealLeaf(leaf);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_JARVIS, active: true });
			void workspace.revealLeaf(leaf);
		}
	}

	async activateQuyuanV2View(): Promise<void> {
		try {
			await this.activateQuyuanV2MainView();
		} catch (error) {
			this.recordQuyuanRuntimeError("activateQuyuanV2View", error);
			console.error("TALOS Quyuan workbench failed to open", error);
			const path = await this.writeQuyuanDiagnostics(false);
			new Notice(`屈原完整工作台打开失败，诊断已写入：${path}`);
		}
	}

	async activateQuyuanV2MainView(): Promise<void> {
		if (!this.quyuanWorkbenchReady) {
			new Notice(
				this.quyuanWorkbenchError
					? `屈原完整工作台加载失败：${this.quyuanWorkbenchError}`
					: "屈原完整工作台仍在初始化，TALOS 控制台已保持可用。"
			);
			return;
		}
		if (!this.quyuanSoul) {
			new Notice(`屈原人格未启动：${this.quyuanSoulError || "缺少强制上下文"}`);
			return;
		}

		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
		const mainLeaf = existing.find(
			(candidate) => candidate.getRoot() === workspace.rootSplit
		);
		const leaf = mainLeaf ?? workspace.getLeaf("tab");
		if (!mainLeaf) {
			await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
		}
		await workspace.revealLeaf(leaf);
		this.scheduleQuyuanWorkbenchCheck(leaf);
	}

	async activateView(): Promise<void> {
		await this.activateQuyuanV2View();
	}

	async activateTalosView(): Promise<void> {
		const leaf = await this.openOrReviveTalosLeaf(true);
		if (leaf) void this.app.workspace.revealLeaf(leaf);
	}

	private async activateHomeView(): Promise<void> {
		const leaf = await this.openOrReviveTalosLeaf(false);
		if (leaf) void this.app.workspace.revealLeaf(leaf);
	}

	private async openOrReviveTalosLeaf(useNewLeaf: boolean): Promise<WorkspaceLeaf | null> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TALOS);
		if (existing.length > 0) {
			const leaf = existing[0];
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_TALOS, active: true });
			const view = leaf.view;
			if (view instanceof TalosView && !view.hasRenderedShell()) {
				await view.recoverFromBlankView();
			}
			return leaf;
		}
		const leaf = workspace.getLeaf(useNewLeaf);
		await leaf.setViewState({ type: VIEW_TYPE_TALOS, active: true });
		const view = leaf.view;
		if (view instanceof TalosView && !view.hasRenderedShell()) {
			await view.recoverFromBlankView();
		}
		return leaf;
	}

	async loadTalosSettings(): Promise<void> {
		const loaded: unknown = await this.loadData();
		const stored = isRecord(loaded) ? loaded : {};
		const namespaced = isRecord(stored.talos) ? stored.talos : stored;
		this.talosSettings = Object.assign({}, DEFAULT_SETTINGS, namespaced);
		this.talosSettings.visualTheme = normalizeVisualTheme(this.talosSettings.visualTheme);
		// 屈原背景效果容错：只接受合法值，否则回退默认
		if (this.talosSettings.quyuanBackground !== "letter-glitch" && this.talosSettings.quyuanBackground !== "grid-scan") {
			this.talosSettings.quyuanBackground = "letter-glitch";
		}
	}

	async saveTalosSettings(): Promise<void> {
		const loaded: unknown = await this.loadData();
		const stored = isRecord(loaded) ? loaded : {};
		await this.saveData({ ...stored, talos: this.talosSettings });
	}

	recordQuyuanRuntimeError(scope: string, error: unknown): void {
		const formatted = formatError(error);
		this.quyuanRuntimeErrors.push({
			at: new Date().toISOString(),
			scope,
			message: formatted.message,
			stack: formatted.stack,
		});
		while (this.quyuanRuntimeErrors.length > QUYUAN_RUNTIME_ERROR_LIMIT) {
			this.quyuanRuntimeErrors.shift();
		}
	}

	async writeQuyuanDiagnostics(openReport = true): Promise<string> {
		const folder = this.talosSettings?.reportsFolder || DEFAULT_SETTINGS.reportsFolder;
		await this.ensureVaultFolder(folder);
		const path = normalizePath(
			`${folder}/talos-quyuan-diagnostics-${timestampForPath()}.md`
		);
		const report = this.buildQuyuanDiagnosticsReport(path);
		// 同一秒内重复生成时文件已存在，create 会抛错——存在则改为覆盖
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, report);
		else await this.app.vault.create(path, report);
		if (openReport) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
		}
		new Notice(`屈原诊断报告已生成：${path}`);
		return path;
	}

	/**
	 * 屈原页白屏视觉诊断（2026-07-10）：面板已挂载、麦克风在工作，但页面一片白
	 * 且拦截点击——说明渲染层被盖住或布局塌了。此命令把控制台视图的 DOM 布局、
	 * 关键节点计算样式、以及视图中心点的元素堆叠链写进 vault 报告，免开 DevTools。
	 */
	async writeQuyuanVisualDiagnostics(): Promise<string> {
		const folder = this.talosSettings?.reportsFolder || DEFAULT_SETTINGS.reportsFolder;
		await this.ensureVaultFolder(folder);
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

		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS);
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
		const existingVisual = this.app.vault.getAbstractFileByPath(path);
		if (existingVisual instanceof TFile) await this.app.vault.modify(existingVisual, lines.join("\n"));
		else await this.app.vault.create(path, lines.join("\n"));
		new Notice(`屈原视觉诊断已生成：${path}`);
		return path;
	}

	private buildQuyuanDiagnosticsReport(path: string): string {
		const workspace = this.app.workspace;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
		const safeWorkbenchSettings = this.settings
			? {
				settingsProvider: this.settings.settingsProvider,
				model: this.settings.model,
				permissionMode: this.settings.permissionMode,
				maxTabs: this.settings.maxTabs,
				chatViewPlacement: this.settings.chatViewPlacement,
				locale: this.settings.locale,
			}
			: null;
		const safeTalosSettings = this.talosSettings
			? {
				visualTheme: this.talosSettings.visualTheme,
				syncVaultTheme: this.talosSettings.syncVaultTheme,
				openOnStartup: this.talosSettings.openOnStartup,
				engineProvider: this.talosSettings.engineProvider,
				quyuanAsrEngine: this.talosSettings.quyuanAsrEngine,
				jarvisVoiceEnabled: this.talosSettings.jarvisVoiceEnabled,
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
				`- 插件版本：\`${this.manifest.version}\``,
				`- 完整工作台视图类型：\`${VIEW_TYPE_CLAUDIAN}\``,
				`- 完整工作台初始化：${this.describeQuyuanWorkbenchStatus()}`,
				`- 屈原人格启动：${this.quyuanSoul ? "✅ 已加载" : `❌ ${this.quyuanSoulError || "未加载"}`}`,
			`- 屈原人格加载时间：${this.quyuanSoul?.loadedAt ? new Date(this.quyuanSoul.loadedAt).toISOString() : "n/a"}`,
			`- 当前工作台 leaf 数：${leaves.length}`,
			"",
			"## Leaf 状态",
			"",
			...this.describeQuyuanLeaves(leaves),
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
			...this.describeQuyuanRuntimeErrors(),
			"",
			"## 下一步",
			"",
			"- 如果 `ClaudianWorkbenchPlugin.onload` 有错误，优先看完整工作台初始化链路。",
			"- 如果 leaf 已创建但 `hasShell=false` 或 `hasTabManager=false`，优先看 `ClaudianView.onOpen` 抛错。",
			"- 如果没有错误但仍不可见，优先查 Obsidian 布局位置、右侧栏折叠状态和 CSS 可见性。",
			"",
		];
		return lines.join("\n");
	}

	private describeQuyuanLeaves(leaves: WorkspaceLeaf[]): string[] {
		if (leaves.length === 0) return ["- 未找到 `talos-quyuan-view` leaf。"];
		const workspace = this.app.workspace;
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

	private describeQuyuanWorkbenchStatus(): string {
		if (this.quyuanWorkbenchReady) return "✅ 已完成";
		if (this.quyuanWorkbenchError) return `❌ ${this.quyuanWorkbenchError}`;
		return "⏳ 初始化中，主控制台不等待此步骤";
	}

	private describeQuyuanRuntimeErrors(): string[] {
		if (this.quyuanRuntimeErrors.length === 0) return ["- 暂无记录。"];
		return this.quyuanRuntimeErrors.flatMap((item, index) => [
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

	private async ensureVaultFolder(folder: string): Promise<void> {
		const path = normalizePath(folder);
		const parts = path.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(current))) {
				try {
					await this.app.vault.createFolder(current);
				} catch {
					/* Folder may have been created by another Obsidian event. */
				}
			}
		}
	}

	private scheduleQuyuanWorkbenchCheck(leaf: WorkspaceLeaf): void {
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
			this.recordQuyuanRuntimeError("activateQuyuanV2View.postOpenCheck", error);
			void this.writeQuyuanDiagnostics(false).then((path) => {
				new Notice(`屈原工作台打开后自检失败，诊断已写入：${path}`);
			});
		}, 1200);
	}

	getQuyuanSoulStatus(): { ready: boolean; error: string; loadedAt: number | null } {
		return {
			ready: this.quyuanSoul !== null,
			error: this.quyuanSoulError,
			loadedAt: this.quyuanSoul?.loadedAt ?? null,
		};
	}

	recordQuyuanToolUse(toolName: string, input: Record<string, unknown>): void {
		if (toolName !== "Read") return;
		const path =
			typeof input.file_path === "string"
				? input.file_path
				: typeof input.path === "string"
					? input.path
					: "";
		if (path) this.quyuanReadPaths.add(path);
	}

	evaluateQuyuanToolPolicy(
		toolName: string,
		input: Record<string, unknown>
	): QuyuanGovernanceResult {
		return evaluateQuyuanGovernance({
			toolName,
			input,
			readPaths: this.quyuanReadPaths,
		});
	}

	async prepareQuyuanInlineEdit(
		path: string
	): Promise<{ decision: "allow" | "deny"; reason: string }> {
		const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "");
		const slash = normalized.lastIndexOf("/");
		const readme = slash < 0
			? "_README.md"
			: `${normalized.slice(0, slash)}/_README.md`;

		try {
			if (!(await this.app.vault.adapter.exists(readme))) {
				return {
					decision: "deny",
					reason: `目标目录缺少 ${readme}，不能安全执行行内编辑`,
				};
			}
			await this.app.vault.adapter.read(readme);
			this.quyuanReadPaths.add(readme);
		} catch (error) {
			return {
				decision: "deny",
				reason: `无法读取 ${readme}：${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}

		const policy = evaluateQuyuanGovernance({
			toolName: "inline-edit",
			input: { file_path: normalized },
			readPaths: this.quyuanReadPaths,
			approvalGranted: true,
		});
		return {
			decision: policy.decision === "allow" ? "allow" : "deny",
			reason: policy.reason,
		};
	}

	onQuyuanAssistantText(content: string): void {
		if (this.talosSettings.jarvisVoiceEnabled) this.quyuanTts?.feed(content);
	}

	onQuyuanAssistantDone(): void {
		if (this.talosSettings.jarvisVoiceEnabled) this.quyuanTts?.flush();
	}

	getQuyuanVoiceEnabled(): boolean {
		return this.talosSettings.jarvisVoiceEnabled;
	}

	async setQuyuanVoiceEnabled(enabled: boolean): Promise<void> {
		this.talosSettings.jarvisVoiceEnabled = enabled;
		if (!enabled) {
			this.stopQuyuanVoiceInput();
			this.stopQuyuanSpeech();
		}
		await this.saveTalosSettings();
	}

	toggleQuyuanVoiceInput(handlers: {
		onInterim: (text: string) => void;
		onFinal: (text: string) => void;
		onStateChange: (listening: boolean, error?: string) => void;
	}): void {
		if (!this.talosSettings.jarvisVoiceEnabled) {
			handlers.onStateChange(false, "请先开启底栏语音总开关");
			return;
		}
		if (this.quyuanStt?.isListening()) {
			this.quyuanStt.stop();
			return;
		}

		this.quyuanStt?.dispose();
		this.quyuanStt = new MicStt(this.talosSettings, handlers);
		this.quyuanStt.start();
	}

	stopQuyuanVoiceInput(): void {
		this.quyuanStt?.stop();
	}

	stopQuyuanSpeech(): void {
		this.quyuanTts?.stop();
	}

	private async initializeQuyuanWorkbench(): Promise<void> {
		this.quyuanWorkbenchReady = false;
		this.quyuanWorkbenchError = "";
		try {
			await super.onload();
			this.quyuanWorkbenchReady = true;
			this.quyuanWorkbenchError = "";
			this.syncQuyuanSoulPrompt();
		} catch (error) {
			this.quyuanWorkbenchReady = false;
			this.quyuanWorkbenchError =
				error instanceof Error ? error.message : String(error);
			this.recordQuyuanRuntimeError("ClaudianWorkbenchPlugin.onload", error);
			console.error("TALOS Quyuan workbench failed to initialize", error);
		}
	}

	private async initializeQuyuanSoul(): Promise<void> {
		try {
			this.quyuanSoul = await loadQuyuanSoulContext(this.app);
			this.quyuanSoulError = "";
			this.syncQuyuanSoulPrompt();
		} catch (error) {
			this.quyuanSoul = null;
			this.quyuanSoulError =
				error instanceof Error ? error.message : String(error);
			this.recordQuyuanRuntimeError("initializeQuyuanSoul", error);
		}
	}

	private syncQuyuanSoulPrompt(): void {
		if (!this.quyuanSoul || !this.settings) return;
		const current = this.settings.systemPrompt || "";
		const escapedStart = QUYUAN_SOUL_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const escapedEnd = QUYUAN_SOUL_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const block = `${QUYUAN_SOUL_START}\n${this.quyuanSoul.systemContext}\n${QUYUAN_SOUL_END}`;
		const blockPattern = new RegExp(
			`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`,
			"m"
		);
		this.settings.systemPrompt = blockPattern.test(current)
			? current.replace(blockPattern, `\n${block}\n`)
			: `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}`;
	}
}
