// TALOS 控制台TALOS、收件箱、对话、语音与设置页渲染；由 TalosView 委托调用。
import type { Collected } from "../talos-view-model";
import { DeferredChatWorkbench } from "../../quyuan/deferred-chat-workbench";
import type { GateItem } from "../../types";
import { Notice, setIcon } from "obsidian";
import { TalosChatSurface } from "../../quyuan/chat-surface";
import { TalosSettingTab } from "../../settings";
import { openFile } from "../../actions";
import { renderTalosEmptyState } from "../page-primitives";
import type { TalosView } from "../../view";
import { fillBanner, fillGateStateChart, fillGates, fillInboxAgeDist, fillInboxClusters, fillSignalList, fillTalosModules } from "../charts/talos-view-charts";
import { moduleHero } from "../view-modules";

export async function renderChatPage(view: TalosView, page: HTMLElement): Promise<void> {
	try {
		if (!view.chatSurface) {
			// D-TLP-014/D-TLP-015：对话页为双通道滑动切换器——
			// DeepSeek Harness（iframe 嵌入 dsh web 桌面界面）｜
			// TALOS 智能体（序列化仍使用 codex 别名以支持二进制回滚）。
			// TALOS 原生工作台另保留独立恢复视图（命令 open-quyuan-v2-recovery）。
			const { HarnessWorkbench } = await import(
				"../../harness/harness-workbench"
			);
			const { TalosAgentWorkbench } = await import(
				"../../agent-workbench/ui/talos-agent-workbench"
			);
			const { HarnessSwitcherWorkbench, normalizeHarnessSurface } =
				await import("../../harness/harness-switcher");
			view.chatSurface = new TalosChatSurface(
				new HarnessSwitcherWorkbench({
					channels: [
						{
							id: "dsh",
							label: "DeepSeek Harness",
							workbench: new HarnessWorkbench({
								manager: view.plugin.getHarnessManager(),
							}),
						},
						{
							id: "codex",
							label: "TALOS 智能体",
							workbench: new DeferredChatWorkbench(async () => {
								const { service } =
									await view.plugin.waitForAgentWorkbench();
								return new TalosAgentWorkbench({
									leaf: view.leaf,
									service,
								});
							}),
						},
					],
					getActiveId: () =>
						normalizeHarnessSurface(
							view.plugin.getAgentWorkbenchSurface()
						),
					setActiveId: (id) => {
						view.plugin.setAgentWorkbenchSurface(id);
					},
					getSwitchHost: () => view.chatSwitchHostEl,
					onSwitchError: (_id, error) => {
						new Notice(`AI 工作区切换失败：${error instanceof Error ? error.message : String(error)}`);
					},
				})
			);
		}
		if (!view.chatSurface) throw new Error("AI 对话 surface 未创建");
		await view.chatSurface.mount(page, "chat");
		if (view.activePage !== "chat") {
			await view.chatSurface.unmount();
			return;
		}
		view.chatMounted = true;
	} catch (error) {
		if (view.activePage !== "chat" || !page.isConnected) return;
		console.error("TALOS AI chat surface failed to mount", error);
		view.chatMounted = false;
		page.empty();
		const panel = page.createDiv({
			cls: "panel talos-chat-migration-panel",
		});
		panel.setCssProps({ "--ac": "#7C3AED" });
		const icon = panel.createDiv({ cls: "talos-chat-migration-icon" });
		setIcon(icon, "triangle-alert");
		const copy = panel.createDiv({ cls: "talos-chat-migration-copy" });
		copy.createEl("h2", { text: "AI 对话加载失败" });
		copy.createEl("p", {
			text: error instanceof Error ? error.message : String(error),
		});
		copy.createEl("small", {
			text: "TALOS 原生恢复视图仍可使用，当前失败不会修改 Vault 内容。",
		});
	}
}

export function renderSettingsPage(view: TalosView, page: HTMLElement): void {
	const shell = page.createDiv({ cls: "talos-inline-settings" });
	const header = shell.createEl("header", {
		cls: "talos-inline-settings__header",
	});
	const identity = header.createDiv({
		cls: "talos-inline-settings__identity",
	});
	const icon = identity.createSpan({ cls: "talos-inline-settings__icon" });
	setIcon(icon, "settings");
	const title = identity.createDiv({ cls: "talos-inline-settings__title" });
	title.createEl("h1", { text: "TALOS 设置" });
	title.createEl("p", {
		text: "界面、目录映射、数据源、AI Provider 与屈原工作台配置",
	});
	const status = header.createDiv({
		cls: "talos-inline-settings__status",
	});
	status.createSpan({ cls: "talos-inline-settings__status-dot" });
	const statusCopy = status.createSpan({
		cls: "talos-inline-settings__status-copy",
	});
	statusCopy.createEl("strong", { text: "本地配置" });
	statusCopy.createEl("small", { text: "修改后自动保存" });
	const body = shell.createDiv({
		cls: "talos-inline-settings__body",
	});
	view.embeddedSettingsTab ??= new TalosSettingTab(view.app, view.plugin);
	view.embeddedSettingsTab.renderInto(body);
	body.addClass("talos-settings--console");
}

export async function renderJarvisPage(view: TalosView, page: HTMLElement): Promise<void> {
	try {
		page.empty();
		page.createDiv({ cls: "empty", text: "屈原模块加载中…" });
		const { QuyuanVoicePanel } = await import("../../quyuan/voice-panel");
		await view.plugin.waitForAgentWorkbench();
		if (view.activePage !== "jarvis") return;
		page.empty();
		if (!view.jarvis) {
			view.jarvis = new QuyuanVoicePanel(
				view.app,
				view.plugin,
				view.plugin.talosSettings,
				() => view.plugin.saveTalosSettings(),
				(pageKey) => view.navigateToPage(pageKey)
			);
		}
		view.jarvis.mount(page);
		view.jarvisMounted = true;
	} catch (error) {
		console.error("TALOS Quyuan voice panel failed to mount", error);
		view.unmountJarvisSafely();
		view.jarvis = null;
		page.empty();
		const panel = page.createDiv({ cls: "panel quyuan-error-panel" });
		const icon = panel.createDiv({ cls: "quyuan-error-icon" });
		setIcon(icon, "triangle-alert");
		const copy = panel.createDiv({ cls: "quyuan-error-copy" });
		copy.createEl("h2", { text: "屈原模块加载失败" });
		copy.createEl("p", {
			text: error instanceof Error ? error.message : "初始化时出现未知错误。",
		});
		const actions = panel.createDiv({ cls: "quyuan-error-actions" });
		const retry = actions.createEl("button", {
			cls: "module-hero-action",
			attr: { type: "button" },
		});
		setIcon(retry.createSpan({ cls: "module-hero-action-icon" }), "rotate-cw");
		retry.createSpan({ text: "重试加载" });
		retry.addEventListener("click", () => view.renderPage());
		const workbench = actions.createEl("button", {
			cls: "module-hero-action",
			attr: { type: "button" },
		});
		setIcon(workbench.createSpan({ cls: "module-hero-action-icon" }), "maximize-2");
		workbench.createSpan({ text: "打开完整工作台" });
		workbench.addEventListener("click", () => void view.plugin.activateQuyuanV2View());
		new Notice("屈原模块加载失败，已显示恢复入口。");
	}
}

export function renderTalosPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const assets =
		d.talosProduct.metrics.find(
			(item) => item.label === "TALOS 资产"
		) || d.talosProduct.metrics[0];
	const delivery =
		d.talosProduct.metrics.find(
			(item) => item.label === "交付 SOP"
		) || d.talosProduct.metrics[1];
	const consoleMod =
		d.talosProduct.metrics.find(
			(item) => item.label === "控制台"
		) || d.talosProduct.metrics[2];
	const allGates = [...d.warRoom.gates, ...d.warRoom.pubActions];

	moduleHero(view, page, {
		ac: "#1D4ED8",
		icon: "filter",
		eyebrow: "TALOS PRODUCT",
		title: "TALOS 产品",
		desc: "产品分区、发布闸门和交付资产集中巡航，避免产品推进散在不同文件里。",
		stats: [
			{
				label: "发布状态",
				value: d.warRoom.stopTriggered ? "暂停" : "可推进",
				sub: `${d.warRoom.published}/${d.warRoom.totalPub} 发布动作完成`,
				path: `${view.paths.talosProjectDir}/tasks.md`,
				tone: d.warRoom.stopTriggered ? "hot" : "good",
			},
			{
				label: assets?.label || "TALOS 资产",
				value: assets?.value || "0",
				sub: assets?.sub,
				path: assets?.path,
				tone: assets?.tone || "default",
			},
			{
				label: delivery?.label || "交付 SOP",
				value: delivery?.value || "0",
				sub: delivery?.sub,
				path: delivery?.path,
				tone: delivery?.tone || "default",
			},
			{
				label: consoleMod?.label || "控制台",
				value: consoleMod?.value || "0",
				sub: consoleMod?.sub,
				path: consoleMod?.path,
				tone: consoleMod?.tone || "default",
			},
		],
		actions: [
			{
				label: "任务闸门",
				icon: "list-checks",
				path: `${view.paths.talosProjectDir}/tasks.md`,
			},
			{
				label: "产品地图",
				icon: "map",
				path: `${view.paths.talosProjectDir}/_README.md`,
			},
			{ label: "发布流", icon: "copy", command: "/output" },
		],
	});

	const primary = page.createDiv({
		cls: "workflow-v2-primary talos-v2-primary",
	});
	primary.setAttribute("data-workflow-layout", "split");

	const release = view.panel(
		primary,
		d.warRoom.stopTriggered ? "#FB7185" : "#4D8DFF",
		"发布态势",
		"发布动作 · 冻结天数 · 闸门状态分布"
	);
	release.addClass("talos-v2-release-panel");
	release.setAttribute("data-workflow-section", "core-data");
	const banner = release.createDiv({
		cls: "banner talos-v2-release-banner",
	});
	banner.setCssProps({
		"--ac": d.warRoom.stopTriggered ? "#FB7185" : "#4D8DFF",
	});
	fillBanner(view, banner, d.warRoom);
	fillGateStateChart(view, 
		release.createDiv({ cls: "talos-v2-gate-chart" }),
		allGates
	);

	const gates = view.panel(
		primary,
		"#FBBF24",
		"关键闸门",
		d.warRoom.stopTriggered
			? "停止条件已触发 · 先处理阻塞"
			: "G1–G7 · PUB-W"
	);
	gates.addClass("talos-v2-gate-panel");
	gates.setAttribute(
		"data-workflow-section",
		"attention-and-actions"
	);
	const gateGroups: Array<[string, string, GateItem[]]> = [
		["统一七门", "G1–G7", d.warRoom.gates],
		["内容发布动作", "PUB-W · 非产品发布门", d.warRoom.pubActions],
	];
	for (const [title, meta, items] of gateGroups) {
		const section = gates.createDiv({
			cls: "talos-v2-gate-group",
		});
		const head = section.createDiv({
			cls: "talos-v2-gate-group__head",
		});
		head.createEl("strong", { text: title });
		head.createEl("span", {
			text: `${items.filter((item) => item.state === "blocked").length} 阻塞 · ${meta}`,
		});
		fillGates(view, section.createDiv({ cls: "gates" }), items);
	}

	const modules = view.panel(
		page,
		"#4D8DFF",
		"产品分区",
		"理论 / 品牌 / 内容 / 产品 / 获客 / 交付 / 控制台"
	);
	modules.addClass("talos-v2-module-panel");
	modules.setAttribute("data-workflow-section", "product-modules");
	fillTalosModules(view, 
		modules.createDiv({ cls: "module-grid" }),
		d.talosProduct.modules
	);
}

export function renderInboxPage(view: TalosView, page: HTMLElement, d: Collected): void {
	const rankedClusters = [...d.inbox.clusters].sort(
		(left, right) => right.count - left.count
	);
	const priorityCluster = rankedClusters[0];

	moduleHero(view, page, {
		ac: "#FBBF24",
		icon: "inbox",
		eyebrow: "INTAKE DIGEST",
		title: "收件箱",
		desc: "先看积压、年龄和主题包，再决定今天是归档、消化，还是只挑高价值条目。",
		stats: [
			{
				label: "待处理",
				value: String(d.inbox.count),
				sub: `${d.inbox.oldestDays}d oldest`,
				path: view.paths.readme("inbox"),
				tone: d.inbox.count > 0 ? "warn" : "good",
			},
			{
				label: "主题包",
				value: String(d.inbox.clusters.length),
				sub: "按标题自动聚类",
				path: view.paths.readme("inbox"),
				tone: "default",
			},
			{
				label: "最近进入",
				value: `${d.inbox.recent.length} 条`,
				sub: "最近改动的收件箱文件",
				path: view.paths.readme("inbox"),
				tone: d.inbox.recent.length > 0 ? "default" : "good",
			},
		],
		actions: [
			{ label: "开始归档", icon: "copy", command: "/intake" },
			{ label: "消化偏好", icon: "copy", command: "/digest" },
			{
				label: "收件地图",
				icon: "external-link",
				path: view.paths.readme("inbox"),
			},
		],
	});

	const triage = page.createDiv({
		cls: "workflow-v2-primary inbox-v2-primary",
	});
	triage.setAttribute("data-workflow-layout", "split");

	const age = view.panel(
		triage,
		"#FBBF24",
		"积压年龄",
		"0–3D · 4–7D · 8–14D · >14D"
	);
	age.setAttribute("data-workflow-section", "core-data");
	if (d.inbox.count > 0) {
		fillInboxAgeDist(view, age.createDiv({ cls: "age-dist" }), d.inbox);
	} else {
		renderTalosEmptyState(
			age,
			"收件箱已清空",
			"当前没有需要分诊的内容，新的输入会继续进入这里。",
			{
				label: "打开收件箱",
				icon: "inbox",
				onActivate: () =>
					void openFile(view.app, view.paths.readme("inbox")),
			}
		);
	}

	const clusters = view.panel(
		triage,
		"#38E1FF",
		"主题分诊",
		priorityCluster
			? `按规模排序 · 先处理「${priorityCluster.name}」`
			: "暂无待消化主题"
	);
	clusters.setAttribute(
		"data-workflow-section",
		"attention-and-actions"
	);
	fillInboxClusters(view, 
		clusters.createDiv({ cls: "cluster-grid" }),
		rankedClusters
	);

	const recent = view.panel(
		page,
		"#A78BFA",
		"最近进入",
		"第三层入口 · 点击打开原文件"
	);
	recent.addClass("inbox-v2-recent-panel");
	recent.setAttribute("data-workflow-section", "recent-entry");
	fillSignalList(view, 
		recent.createDiv({ cls: "detail-list" }),
		d.inbox.recent,
		"收件箱已清空"
	);
}
