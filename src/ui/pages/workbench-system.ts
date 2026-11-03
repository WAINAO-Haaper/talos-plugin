// 系统与记忆：一屏给出「健康分 + 最该修的一条」；错误、循环、能力与身份入口收进底部展开。
import { openFile } from "../../actions";
import type { SignalItem } from "../../types";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { renderWorkbenchHome, type WorkbenchHomeHandle, type WorkbenchRow } from "./workbench-home";

type SystemFocus = "health" | "capability" | "identity";

export function renderWorkbenchSystem(view: TalosView, page: HTMLElement, d: Collected, focusKey: string): void {
	const healthReady = d.setup?.healthLogPath === "ok";
	const healthMetric = d.healthDigest.metrics.find((item) => item.label === "健康分");
	const errors = d.healthDigest.errors;
	const loops = d.healthDigest.loopStatus;
	const failedLoops = loops.filter((item) => /失败|错误|fail|error/i.test(`${item.title}${item.meta}`)).length;
	const anomalies = errors.length + failedLoops;
	const capTotal = d.capGroups.reduce((total, group) => total + group.items.filter((item) => item.origin === "discovered").length, 0);
	const focus: SystemFocus = focusKey === "capability" || focusKey === "identity" ? focusKey : "health";

	let handle: WorkbenchHomeHandle | null = null;

	const pathButton = (host: HTMLElement, label: string, path: string, missing?: boolean): void => {
		const button = host.createEl("button", { cls: "talos-wb-link", text: label, attr: { type: "button" } });
		button.addEventListener("click", () => {
			if (missing) view.navigateToPage("settings");
			else void openFile(view.app, path);
		});
	};
	const commandButton = (host: HTMLElement, label: string, command: string): void => {
		const button = host.createEl("button", { cls: "talos-wb-link", text: label, attr: { type: "button" } });
		button.addEventListener("click", () => void view.sendCommandToChat(command));
	};
	const signals = (host: HTMLElement, items: SignalItem[], empty: string): void => {
		if (!items.length) { host.createDiv({ cls: "talos-wb-empty", text: empty }); return; }
		const list = host.createDiv({ cls: "talos-wb-rows" });
		for (const item of items) {
			const row = list.createEl("button", { cls: "talos-wb-row", attr: { type: "button" } });
			const main = row.createDiv({ cls: "talos-wb-row-main" });
			main.createEl("span", { cls: "talos-wb-row-title", text: item.title });
			main.createEl("span", { cls: "talos-wb-row-meta", text: item.meta || "—" });
			row.createEl("span", { cls: "talos-wb-chev", text: "打开 →" });
			if (item.path) row.addEventListener("click", () => void openFile(view.app, item.path as string));
			else row.disabled = true;
		}
	};

	const diagnosticRows: WorkbenchRow[] = [
		{
			title: "健康日志",
			meta: healthReady ? `最近记录 ${healthMetric?.sub ?? "—"}` : "健康日志未配置或格式待检查",
			onActivate: () => {
				if (healthReady) void openFile(view.app, view.plugin.talosSettings.healthLogPath);
				else view.navigateToPage("settings");
			},
		},
		{
			title: "错误模式",
			meta: d.setup?.errorPatterns === "ok" ? `${errors.length} 条 · 最多 6 条` : "来源待检查",
			onActivate: () => handle?.openDetail("health"),
		},
		{
			title: "循环状态",
			meta: d.setup?.loopHealth === "ok" ? `最近 ${loops.length} 条` : "来源待检查",
			onActivate: () => handle?.openDetail("health"),
		},
	];

	const identityRows: WorkbenchRow[] = [
		{ title: "晨间", meta: "/morning · 工作流", onActivate: () => void view.sendCommandToChat("/morning") },
		{ title: "归档", meta: "/intake · 工作流", onActivate: () => void view.sendCommandToChat("/intake") },
		{ title: "CONTEXT", meta: "当前状态 · 身份与记忆", onActivate: () => void openFile(view.app, view.paths.contextFile) },
		{ title: "PERSONA", meta: "人格与边界 · 身份与记忆", onActivate: () => void openFile(view.app, view.paths.personaFile) },
	];

	handle = renderWorkbenchHome(view, page, {
		eyebrow: "工作台 · 系统与记忆",
		title: "系统与记忆",
		lede: healthReady
			? `健康分 ${healthMetric?.value ?? "—"}，${anomalies} 条异常。${errors[0] ? `先看「${errors[0].title}」，再处理能力与身份入口。` : "先跑一次快检，再处理能力与身份入口。"}`
			: "健康日志未配置。先在设置里指定来源，再回来查看诊断。",
		stats: [
			{
				label: "健康分",
				value: healthReady ? healthMetric?.value ?? "—" : "—",
				unit: "分",
				sub: healthReady ? `最近记录 ${healthMetric?.sub ?? "—"}` : "健康日志未配置",
				onActivate: () => handle?.openDetail("health"),
			},
			{
				label: "异常",
				value: healthReady ? String(anomalies) : "—",
				unit: "条",
				sub: healthReady ? `错误 ${errors.length} · 循环失败 ${failedLoops}` : "来源未就绪",
				alert: healthReady && anomalies > 0,
				onActivate: () => handle?.openDetail("health"),
			},
			{
				label: "能力",
				value: capTotal ? String(capTotal) : "—",
				unit: "个",
				sub: `${d.capGroups.length} 组能力来源`,
				onActivate: () => handle?.openDetail("capability"),
			},
		],
		focus: {
			accent: "#158B69",
			kicker: errors[0] ? "异常 · 建议先修" : "系统状态",
			title: errors[0]?.title ?? (healthReady ? `健康分 ${healthMetric?.value ?? "—"}，当前没有未处理异常` : "健康日志未配置或格式待检查"),
			meta: errors[0]?.meta ?? (healthReady ? `最近记录 ${healthMetric?.sub ?? "—"} · 循环 ${loops.length} 条` : "去设置里指定健康日志来源"),
			cta: healthReady ? "运行快检 →" : "去设置 →",
			onActivate: () => {
				if (healthReady) void view.sendCommandToChat("/maintain quick");
				else view.navigateToPage("settings");
			},
			rows: [
				{
					title: `错误模式 · ${d.setup?.errorPatterns === "ok" ? `${errors.length} 条` : "来源待检查"}`,
					meta: "近 30 天重复出现，均已记录来源",
					go: "查看错误 →",
					onActivate: () => handle?.openDetail("health"),
				},
				{
					title: `循环状态 · ${d.setup?.loopHealth === "ok" ? `${loops.length} 条` : "来源待检查"}`,
					meta: "晨间、复盘与维护循环",
					go: "查看循环 →",
					onActivate: () => handle?.openDetail("health"),
				},
				{
					title: `身份与记忆 · ${d.capGroups.length} 组能力来源`,
					meta: "CONTEXT / PERSONA / PROFILE / 任务池",
					go: "打开身份 →",
					onActivate: () => handle?.openDetail("identity"),
				},
			],
		},
		blocks: [
			{
				accent: "#158B69",
				title: "系统诊断",
				meta: healthReady ? `最近记录 ${healthMetric?.sub ?? "—"}` : "健康日志未配置或格式待检查",
				section: "health",
				empty: healthReady ? undefined : "健康日志未配置或格式待检查",
				rows: diagnosticRows,
				links: [
					{ label: "打开健康日志 →", onActivate: () => void openFile(view.app, view.plugin.talosSettings.healthLogPath) },
					{ label: "审批池", onActivate: () => void openFile(view.app, view.plugin.talosSettings.pendingApprovalsPath) },
					{ label: "处理待决策", onActivate: () => view.openDecisions() },
					{ label: "快检", onActivate: () => void view.sendCommandToChat("/maintain quick") },
				],
			},
			{
				accent: "#14B8A6",
				title: "能力与身份",
				meta: `${capTotal} 个能力 · 4 个身份入口`,
				section: "capability",
				rows: identityRows,
				links: [
					{ label: "查看全部能力 →", onActivate: () => handle?.openDetail("capability") },
					{ label: "身份目录", onActivate: () => void openFile(view.app, view.paths.readme("identity")) },
					{ label: "记忆流", onActivate: () => void view.sendCommandToChat("/memory") },
				],
			},
		],
		details: [
			{
				key: "health",
				label: "展开完整系统健康与诊断",
				open: focus === "health",
				mount: (host) => {
					const actions = host.createDiv({ cls: "talos-wb-links" });
					pathButton(actions, "健康日志", view.plugin.talosSettings.healthLogPath, d.setup?.healthLogPath === "missing");
					pathButton(actions, "审批池", view.plugin.talosSettings.pendingApprovalsPath, d.setup?.pendingApprovalsPath === "missing");
					const decisionsButton = actions.createEl("button", { cls: "talos-wb-link", text: "处理待决策", attr: { type: "button" } });
					decisionsButton.addEventListener("click", () => view.openDecisions());
					commandButton(actions, "快检 /maintain quick", "/maintain quick");
					host.createEl("h3", { cls: "talos-wb-subhead", text: "错误模式" });
					signals(host, d.setup?.errorPatterns === "ok" ? errors : [], d.setup?.errorPatterns === "ok" ? "未识别到可展示记录" : "来源文件未配置或格式待检查。");
					host.createEl("h3", { cls: "talos-wb-subhead", text: "循环状态" });
					signals(host, d.setup?.loopHealth === "ok" ? loops : [], d.setup?.loopHealth === "ok" ? "未识别到可展示记录" : "来源文件未配置或格式待检查。");
				},
			},
			{
				key: "capability",
				label: "展开完整能力调用",
				open: focus === "capability",
				mount: (host) => {
					const tabs = host.createDiv({ cls: "tabs capability-v2-tabs" });
					const listing = host.createDiv({ cls: "commands capability-v2-browser" });
					if (!d.capGroups.some((group) => group.key === view.activeCap)) view.activeCap = d.capGroups[0]?.key ?? "commands";
					const draw = (): void => {
						tabs.empty();
						listing.empty();
						for (const group of d.capGroups) {
							const found = group.items.filter((item) => item.origin === "discovered").length;
							const count = group.sourceStatus === "ready" ? String(found) : group.sourceStatus === "partial" ? `≥${found}` : "—";
							const tab = tabs.createEl("button", { cls: "talos-wb-link", text: `${group.label} ${count}`, attr: { type: "button" } });
							tab.setAttribute("aria-pressed", String(view.activeCap === group.key));
							tab.addEventListener("click", () => { view.activeCap = group.key; draw(); });
						}
						const group = d.capGroups.find((item) => item.key === view.activeCap);
						if (!group) { listing.createDiv({ cls: "talos-wb-empty", text: "暂无能力来源。" }); return; }
						if (group.sourceStatus !== "ready") listing.createDiv({ cls: "talos-wb-empty", text: "部分能力来源不可用；推荐入口不计入已发现数量。" });
						if (!group.items.length) listing.createDiv({ cls: "talos-wb-empty", text: "当前分组没有调用入口。" });
						for (const item of group.items) {
							const card = listing.createDiv({ cls: "talos-wb-cap-card" });
							card.createEl("strong", { text: item.name });
							card.createEl("small", { text: `${item.desc || "—"}${item.origin === "fallback" ? " · 推荐入口，未发现对应文件" : ""}` });
							const actions = card.createDiv({ cls: "talos-wb-links" });
							commandButton(actions, "填入对话", item.invoke);
							const copy = actions.createEl("button", { cls: "talos-wb-link", text: "复制调用", attr: { type: "button" } });
							copy.addEventListener("click", () => void view.copyText(item.invoke));
							if (item.path) pathButton(actions, "打开源文件", item.path);
						}
					};
					draw();
				},
			},
			{
				key: "identity",
				label: "展开完整身份与记忆",
				open: focus === "identity",
				mount: (host) => {
					for (const group of [
						{ title: "用户身份", items: [
							{ title: "TELOS", meta: "使命与目标", path: view.paths.telosFile },
							{ title: "CONTEXT", meta: "当前状态", path: view.paths.contextFile },
							{ title: "PROFILE", meta: "已确认偏好", path: view.paths.profileFile },
							{ title: "战略决策", meta: "方向与判断", path: view.paths.decisionsFile },
						] },
						{ title: "助手人格", items: [
							{ title: "PERSONA", meta: "人格与边界", path: view.paths.personaFile },
							{ title: "persona-memory", meta: "人格记忆", path: view.paths.personaMemoryFile },
						] },
						{ title: "记忆与治理", items: [
							{ title: "任务池", meta: d.setup?.tasksPath === "ok" && d.focusTotal !== undefined ? `${d.focusTotal} 个当前焦点` : "来源待检查", path: view.plugin.talosSettings.tasksPath },
							{ title: "审批池", meta: d.setup?.pendingApprovalsPath === "ok" ? `${d.approvals.length} 项待决策` : "来源待检查", path: view.plugin.talosSettings.pendingApprovalsPath },
							{ title: "偏好候选", meta: d.setup?.candidatesPath === "ok" ? `${d.candidates.length} 条待确认` : "来源待检查", path: view.plugin.talosSettings.candidatesPath },
							{ title: "健康日志", meta: healthReady ? healthMetric?.sub ?? "查看记录" : "来源待检查", path: view.plugin.talosSettings.healthLogPath },
						] },
					]) {
						host.createEl("h3", { cls: "talos-wb-subhead", text: group.title });
						signals(host, group.items as SignalItem[], "暂无入口");
					}
				},
			},
		],
	});

	page.querySelectorAll<HTMLElement>(".talos-wb-detail-body > .talos-ui-page-header").forEach((node) => node.remove());
	void handle;
}
