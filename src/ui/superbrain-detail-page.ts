import { setIcon } from "obsidian";
import { mapSuperbrainFile, type SuperbrainEntry, type SuperbrainToolId, type SuperbrainWorkflowSlug } from "../module-commands/superbrain-catalog";
import { SUPERBRAIN_SCHEDULE_JOBS, type SuperbrainScheduleJob, type SuperbrainToolInput } from "../module-commands/superbrain-tool-service";
import { buildSuperbrainInstruction, superbrainPageSpec, workflowSlugForPage, type SuperbrainPageSpec } from "./superbrain-page-spec";

export interface SuperbrainPreparedWorkflow {
	status: "ready" | "unconfigured";
	summary: string;
	preview?: unknown;
	token?: unknown;
}
export interface SuperbrainPreparedTool { preview: unknown; writes: boolean; token?: unknown }
export interface SuperbrainPreparedSchedule { preview: unknown; enabled: boolean; token?: unknown }

/** Adapters in main.ts keep the UI independent from the existing execution services. */
export interface SuperbrainDetailPorts {
	moduleRoots(): Readonly<Record<string, string>>;
	listFiles(): readonly string[];
	fileExists(path: string): boolean;
	openFile(path: string): void | Promise<void>;
	apiProviders(): readonly { id: string; label: string }[];
	previewWorkflow(slug: SuperbrainWorkflowSlug, engine: string, instruction: string, signal: AbortSignal): Promise<SuperbrainPreparedWorkflow>;
	runWorkflow(token: unknown, signal: AbortSignal): Promise<unknown>;
	previewTool(tool: SuperbrainToolId, input: SuperbrainToolInput, signal: AbortSignal): Promise<SuperbrainPreparedTool>;
	runTool(token: unknown, signal: AbortSignal): Promise<unknown>;
	previewSchedule(job: SuperbrainScheduleJob, signal: AbortSignal): Promise<SuperbrainPreparedSchedule>;
	runSchedule(token: unknown, signal: AbortSignal): Promise<unknown>;
	openPreferenceReview?(): void | Promise<void>;
	openSettings?(): void | Promise<void>;
	hostStatus?(): Readonly<Record<"codex" | "claude" | "api", string>>;
}

type Status = "idle" | "loading" | "ready" | "unconfigured" | "running" | "completed" | "no_change" | "failed";

function node<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className?: string, value?: string): HTMLElementTagNameMap[K] {
	const element = parent.ownerDocument.createElement(tag);
	if (className) element.className = className;
	if (value !== undefined) element.textContent = value;
	parent.appendChild(element);
	return element;
}

function icon(parent: HTMLElement, name: string): void {
	const element = node(parent, "span", "talos-superbrain-detail-icon");
	setIcon(element, name);
}

function button(parent: HTMLElement, label: string, action: () => void, className = "talos-superbrain-detail-button"): HTMLButtonElement {
	const element = node(parent, "button", `${className} talos-focusable`, label);
	element.type = "button";
	element.addEventListener("click", action);
	return element;
}

function labelledInput(parent: HTMLElement, label: string, placeholder: string, kind: "text" | "textarea" = "text"): HTMLInputElement | HTMLTextAreaElement {
	const wrap = node(parent, "label", "talos-superbrain-detail-field");
	node(wrap, "span", undefined, label);
	const input = node(wrap, kind === "textarea" ? "textarea" : "input", "talos-superbrain-detail-input talos-focusable");
	input.placeholder = placeholder;
	input.maxLength = 4_000;
	if (input instanceof HTMLInputElement) input.type = "text";
	return input;
}

function renderDetails(parent: HTMLElement, data: unknown): void {
	if (data === undefined || data === null) return;
	const detail = node(parent, "details", "talos-superbrain-detail-technical");
	node(detail, "summary", undefined, "查看技术结果");
	let raw: string;
	try { raw = JSON.stringify(data, null, 2) ?? "[空结果]"; }
	catch { raw = "[结果不可序列化]"; }
	node(detail, "pre", undefined, raw.slice(0, 16_000));
}

function pathsFromOutcome(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const data = value as Record<string, unknown>;
	const paths = [data.evidence, data.paths, data.receipt_path].flatMap((item): unknown[] => Array.isArray(item) ? item as unknown[] : typeof item === "string" ? [item] : []);
	return [...new Set(paths.filter((path): path is string => typeof path === "string" && path.length > 0))].slice(0, 30);
}

function outcomeStatus(value: unknown): Status {
	if (!value || typeof value !== "object" || Array.isArray(value)) return "completed";
	const data = value as Record<string, unknown>;
	if (data.process_exit_code !== undefined && data.process_exit_code !== 0) return "failed";
	if (data.status === "no_change" || data.status === "already-ran-in-period") return "no_change";
	if (["failed", "partial", "cancelled", "blocked"].includes(String(data.status))) return "failed";
	return "completed";
}

function renderOutcome(parent: HTMLElement, value: unknown, ports: SuperbrainDetailPorts): void {
	const status = outcomeStatus(value);
	parent.replaceChildren();
	parent.removeAttribute("role");
	parent.dataset.status = status;
	const head = node(parent, "div", "talos-superbrain-detail-result-heading");
	icon(head, status === "failed" ? "circle-alert" : status === "no_change" ? "minus-circle" : "circle-check");
	node(head, "strong", undefined, status === "failed" ? "运行未完成" : status === "no_change" ? "本轮无变化" : "运行已结束");
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const data = value as Record<string, unknown>;
		if (typeof data.reason === "string" && data.reason) node(parent, "p", undefined, data.reason);
		else if (typeof data.summary === "string" && data.summary) node(parent, "p", undefined, data.summary);
		if (data.receipt_valid === false) node(parent, "p", "mod-warning", "运行收据未通过核对");
	}
	const evidence = pathsFromOutcome(value);
	for (const path of evidence) {
		const row = button(parent, path, () => { void ports.openFile(path); }, "talos-superbrain-detail-file");
		row.disabled = !ports.fileExists(path);
	}
	if (status !== "failed") node(parent, "small", undefined, "语义结果仍需核对原文与来源。 ");
	renderDetails(parent, value);
}

function renderError(parent: HTMLElement, error: unknown): void {
	parent.replaceChildren();
	parent.dataset.status = "failed";
	parent.setAttribute("role", "alert");
	node(parent, "p", "mod-warning", `未完成：${error instanceof Error ? error.message : "运行失败"}`);
}

function mappedRoots(spec: SuperbrainPageSpec, ports: SuperbrainDetailPorts): string[] {
	return (spec.sourceRoots ?? []).map(root => mapSuperbrainFile(`${root}/_README.md`, ports.moduleRoots()).replace(/\/_README\.md$/, ""));
}

/** Renders one C/M destination. The disposer must run when the console changes page. */
export function renderSuperbrainDetailPage(
	container: HTMLElement,
	entry: SuperbrainEntry,
	ports: SuperbrainDetailPorts,
	onBack: () => void,
): () => void {
	const spec = superbrainPageSpec(entry);
	container.replaceChildren();
	const root = node(container, "section", "talos-superbrain-detail-page");
	root.dataset.superbrainDetailId = entry.id;
	let controller: AbortController | null = null;
	let sequence = 0;
	const begin = (): { signal: AbortSignal; current: () => boolean } => {
		controller?.abort();
		for (const stale of Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-superbrain-run]"))) {
			stale.disabled = true;
			stale.title = "已有新的预览，请重新准备";
		}
		controller = new AbortController();
		const order = ++sequence;
		return { signal: controller.signal, current: () => order === sequence && root.isConnected };
	};

	const header = node(root, "header", "talos-superbrain-detail-header");
	const back = button(header, "返回", onBack, "talos-superbrain-detail-back");
	back.setAttribute("aria-label", "返回超级大脑首页");
	const heading = node(header, "div", "talos-superbrain-detail-title");
	node(heading, "small", undefined, entry.id);
	node(heading, "h1", undefined, entry.title);
	const badge = node(header, "span", "talos-superbrain-detail-scope", "当前资料库");
	badge.title = "功能运行时按当前资料库与宿主权限处理文件";

	const steps = node(root, "ol", "talos-superbrain-detail-steps");
	steps.setAttribute("aria-label", `${entry.title}步骤`);
	for (const item of spec.steps) {
		const li = node(steps, "li");
		icon(li, item.icon);
		node(li, "span", undefined, item.label);
	}

	const grid = node(root, "div", "talos-superbrain-detail-grid");
	const main = node(grid, "div", "talos-superbrain-detail-main");
	const aside = node(grid, "aside", "talos-superbrain-detail-aside");
	const related = node(aside, "section", "talos-superbrain-detail-related");
	const relatedHead = node(related, "div", "talos-superbrain-detail-section-heading");
	icon(relatedHead, "files"); node(relatedHead, "h2", undefined, "相关资料");
	const mappedFiles = entry.files.map(raw => mapSuperbrainFile(raw, ports.moduleRoots()));
	node(related, "small", undefined, `当前库 ${mappedFiles.filter(path => ports.fileExists(path)).length}/${mappedFiles.length} 份可打开`);
	for (const path of mappedFiles) {
		const row = button(related, path.split("/").at(-1) ?? path, () => { void ports.openFile(path); }, "talos-superbrain-detail-file");
		row.title = path;
		row.disabled = !ports.fileExists(path);
		if (row.disabled) row.setAttribute("aria-label", `${path} 不存在`);
	}
	if (entry.id === "M06") node(aside, "p", "talos-superbrain-detail-note", "本次操作范围以当前资料库和宿主权限为准。");
	if (entry.id === "M10") {
		const status = ports.hostStatus?.();
		const host = node(aside, "section", "talos-superbrain-detail-hosts");
		node(host, "h2", undefined, "运行入口");
		for (const key of ["codex", "claude", "api"] as const) node(host, "div", "talos-superbrain-detail-host", `${key === "api" ? "模型 API" : key === "codex" ? "Codex" : "Claude"} · ${status?.[key] ?? "待检测"}`);
	}

	if (spec.mode === "workflow") renderWorkflow(main, entry, spec, ports, begin);
	if (spec.mode === "mechanism") renderMechanism(main, entry, spec, ports, begin);
	if ((spec.tools?.length ?? 0) > 0) renderTools(main, spec, ports, begin);
	if (entry.id === "M07") renderSchedule(main, ports, begin);
	if (spec.extraAction === "preference-review") {
		const section = node(main, "section", "talos-superbrain-detail-operation");
		node(section, "h2", undefined, "偏好审议");
		if (ports.openPreferenceReview) button(section, "打开待审候选", () => { void ports.openPreferenceReview?.(); }, "mod-cta");
		else node(section, "p", undefined, "当前审议入口未接入；可打开右侧候选记录核对。");
	}
	if (spec.extraAction === "settings") {
		const section = node(main, "section", "talos-superbrain-detail-operation");
		node(section, "h2", undefined, "运行设置");
		if (ports.openSettings) button(section, "打开设置", () => { void ports.openSettings?.(); }, "mod-cta");
		else node(section, "p", undefined, "当前设置入口未接入；可打开右侧配置文件核对。");
	}
	return () => { controller?.abort(); sequence++; container.replaceChildren(); };
}

type BeginOperation = () => { signal: AbortSignal; current: () => boolean };

function renderWorkflow(main: HTMLElement, entry: SuperbrainEntry, spec: SuperbrainPageSpec, ports: SuperbrainDetailPorts, begin: BeginOperation): void {
	const section = node(main, "section", "talos-superbrain-detail-operation");
	const head = node(section, "div", "talos-superbrain-detail-section-heading");
	icon(head, "play"); node(head, "h2", undefined, "运行工作流");
	const selected = new Set<string>();
	const roots = mappedRoots(spec, ports);
	if (roots.length) {
		const source = node(section, "div", "talos-superbrain-detail-sources");
		node(source, "h3", undefined, "本次资料");
		const search = labelledInput(source, "查找库内文件", "输入文件名筛选");
		const rows = node(source, "div", "talos-superbrain-detail-source-rows");
		const paths = ports.listFiles().filter(path => roots.some(root => path.startsWith(`${root}/`)) && !path.endsWith("/_README.md"));
		const draw = () => {
			rows.replaceChildren();
			const matches = paths.filter(path => path.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
			if (!matches.length) node(rows, "p", undefined, "当前范围没有匹配的资料");
			for (const path of matches.slice(0, 30)) {
				const label = node(rows, "label", "talos-superbrain-detail-source");
				const box = node(label, "input"); box.type = "checkbox"; box.checked = selected.has(path);
				box.addEventListener("change", () => box.checked ? selected.add(path) : selected.delete(path));
				node(label, "span", undefined, path);
			}
			if (matches.length > 30) node(rows, "small", undefined, `显示 30/${matches.length} 份；继续输入以缩小范围`);
		};
		search.addEventListener("input", draw);
		draw();
	}
	const fields: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
	for (const item of spec.fields ?? []) {
		if (item.kind === "choice") {
			const label = node(section, "label", "talos-superbrain-detail-field");
			node(label, "span", undefined, item.label);
			const input = node(label, "select", "talos-superbrain-detail-input");
			for (const choice of item.choices ?? []) { const option = node(input, "option", undefined, choice); option.value = choice; }
			fields[item.key] = input;
		} else fields[item.key] = labelledInput(section, item.label, item.hint, item.kind);
	}
	const extra = labelledInput(section, "补充说明", "本次还需核对的条件", "textarea");
	const engines = node(section, "div", "talos-superbrain-detail-engines");
	engines.setAttribute("role", "group");
	engines.setAttribute("aria-label", "选择 AI 执行入口");
	const options = [
		{ id: "codex", label: "Codex", icon: "terminal" },
		{ id: "claude", label: "Claude", icon: "terminal" },
		...ports.apiProviders().map(provider => ({ id: `api:${provider.id}`, label: provider.label, icon: "cloud" })),
	];
	let engine = "codex";
	for (const option of options) {
		const item = button(engines, option.label, () => {
			engine = option.id;
			for (const sibling of Array.from(engines.querySelectorAll("button"))) sibling.setAttribute("aria-pressed", String(sibling === item));
		}, "talos-superbrain-detail-engine");
		icon(item, option.icon);
		item.setAttribute("aria-pressed", String(option.id === engine));
	}
	if (!ports.apiProviders().length) node(engines, "small", undefined, "模型 API 未配置");
	const actions = node(section, "div", "talos-superbrain-detail-actions");
	const result = node(section, "div", "talos-superbrain-detail-result");
	result.setAttribute("aria-live", "polite");
	const prepare = button(actions, "准备运行", () => { void (async () => {
		const operation = begin();
		result.replaceChildren(); result.dataset.status = "loading";
		node(result, "p", undefined, "正在准备…");
		try {
			const values = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
			const instruction = buildSuperbrainInstruction(spec, values, [...selected], extra.value);
			const plan = await ports.previewWorkflow(workflowSlugForPage(entry), engine, instruction, operation.signal);
			if (!operation.current()) return;
			result.replaceChildren();
			result.dataset.status = plan.status;
			node(result, "p", plan.status === "unconfigured" ? "mod-warning" : undefined, plan.summary);
			renderDetails(result, plan.preview);
			if (plan.status === "unconfigured") return;
			if (plan.token === undefined) { node(result, "p", "mod-warning", "运行计划缺失，请重新准备"); return; }
			const run = button(result, "运行", () => { void (async () => {
				if (!operation.current()) return;
				run.disabled = true; result.dataset.status = "running";
				try {
					const outcome = await ports.runWorkflow(plan.token, operation.signal);
					if (operation.current()) renderOutcome(result, outcome, ports);
				} catch (error) { if (operation.current()) renderError(result, error); }
			})(); }, "mod-cta");
			run.dataset.superbrainRun = "workflow";
		} catch (error) { if (operation.current()) renderError(result, error); }
	})(); }, "mod-cta");
	prepare.dataset.superbrainWorkflow = entry.slug;
}

function renderMechanism(main: HTMLElement, entry: SuperbrainEntry, _spec: SuperbrainPageSpec, _ports: SuperbrainDetailPorts, _begin: BeginOperation): void {
	const section = node(main, "section", "talos-superbrain-detail-operation");
	const head = node(section, "div", "talos-superbrain-detail-section-heading");
	icon(head, entry.icon); node(head, "h2", undefined, "机制状态");
	node(section, "p", undefined, entry.summary);
	if (entry.id === "M01" || entry.id === "M05") node(section, "small", undefined, "打开右侧原文，核对当前事实与下一步。");
	if (entry.id === "M04") node(section, "small", undefined, "候选需有实际证据；采用状态以记录为准。");
	if (entry.id === "M07") node(section, "small", undefined, "四类任务按当前配置逐项预检；未启用时不会运行。");
	if (entry.id === "M09") node(section, "small", undefined, "恢复操作只写入库外新目录。");
}

function toolInput(parent: HTMLElement, tool: SuperbrainToolId): () => SuperbrainToolInput {
	if (tool === "search") {
		const query = labelledInput(parent, "检索词", "要查找的词或问题");
		return () => ({ query: query.value });
	}
	if (tool === "export") {
		const source = labelledInput(parent, "库内子树", "例如 03-素材/项目A");
		const destination = labelledInput(parent, "库外新目录", "绝对路径");
		return () => ({ source: source.value, destination: destination.value });
	}
	if (tool === "snapshot") {
		const wrap = node(parent, "label", "talos-superbrain-detail-field");
		node(wrap, "span", undefined, "快照操作");
		const operation = node(wrap, "select", "talos-superbrain-detail-input");
		for (const mode of ["create", "verify", "restore"] as const) { const option = node(operation, "option", undefined, mode === "create" ? "创建" : mode === "verify" ? "校验" : "隔离恢复"); option.value = mode; }
		const archive = labelledInput(parent, "快照 ZIP", "校验或恢复时填写绝对路径");
		const destination = labelledInput(parent, "库外新目录", "恢复时填写绝对路径");
		const update = () => { archive.parentElement!.hidden = operation.value === "create"; destination.parentElement!.hidden = operation.value !== "restore"; };
		operation.addEventListener("change", update); update();
		return () => ({ snapshotOperation: operation.value as SuperbrainToolInput["snapshotOperation"], archive: archive.value, destination: destination.value });
	}
	return () => ({});
}

const TOOL_LABELS: Readonly<Record<SuperbrainToolId, string>> = {
	inventory: "盘点", members: "目录成员", index: "更新索引", search: "检索候选",
	health: "结构检查", snapshot: "快照与恢复", export: "可移植导出", selftest: "检测器自测",
};

function renderTools(main: HTMLElement, spec: SuperbrainPageSpec, ports: SuperbrainDetailPorts, begin: BeginOperation): void {
	const section = node(main, "section", "talos-superbrain-detail-operation talos-superbrain-detail-tools");
	const head = node(section, "div", "talos-superbrain-detail-section-heading");
	icon(head, "wrench"); node(head, "h2", undefined, "本地工具");
	for (const tool of spec.tools ?? []) {
		const tile = node(section, "div", "talos-superbrain-detail-tool");
		const title = node(tile, "h3", undefined, TOOL_LABELS[tool]);
		title.title = tool;
		const readInput = toolInput(tile, tool);
		const output = node(tile, "div", "talos-superbrain-detail-result");
		output.setAttribute("aria-live", "polite");
		const preview = button(tile, tool === "snapshot" ? "预检" : "预览", () => { void (async () => {
			const operation = begin(); output.replaceChildren(); output.dataset.status = "loading";
			node(output, "p", undefined, "正在检查…");
			try {
				const plan = await ports.previewTool(tool, readInput(), operation.signal);
				if (!operation.current()) return;
				if (outcomeStatus(plan.preview) === "failed") { renderOutcome(output, plan.preview, ports); return; }
				output.replaceChildren(); output.dataset.status = "ready";
				node(output, "p", undefined, plan.writes ? "预览已完成；可运行。" : "检查已完成；本次无写入。");
				renderDetails(output, plan.preview);
				if (!plan.writes) return;
				if (plan.token === undefined) { node(output, "p", "mod-warning", "运行计划缺失，请重新预览"); return; }
				const run = button(output, "运行", () => { void (async () => {
					if (!operation.current()) return;
					run.disabled = true; output.dataset.status = "running";
					try { const result = await ports.runTool(plan.token, operation.signal); if (operation.current()) renderOutcome(output, result, ports); }
					catch (error) { if (operation.current()) renderError(output, error); }
				})(); }, "mod-cta");
				run.dataset.superbrainRun = tool;
			} catch (error) { if (operation.current()) renderError(output, error); }
		})(); });
		preview.dataset.superbrainTool = tool;
	}
}

function renderSchedule(main: HTMLElement, ports: SuperbrainDetailPorts, begin: BeginOperation): void {
	const section = node(main, "section", "talos-superbrain-detail-operation talos-superbrain-detail-schedule");
	const head = node(section, "div", "talos-superbrain-detail-section-heading");
	icon(head, "clock-3"); node(head, "h2", undefined, "主动与定时");
	const labels: Readonly<Record<SuperbrainScheduleJob, string>> = {
		morning: "晨间", "full-cycle": "全量整理", "weekly-reset": "周度复盘", heartbeat: "心跳",
	};
	for (const job of SUPERBRAIN_SCHEDULE_JOBS) {
		const tile = node(section, "div", "talos-superbrain-detail-tool");
		node(tile, "h3", undefined, labels[job]);
		const output = node(tile, "div", "talos-superbrain-detail-result");
		output.setAttribute("aria-live", "polite");
		const preview = button(tile, "预检", () => { void (async () => {
			const operation = begin(); output.replaceChildren(); output.dataset.status = "loading";
			try {
				const plan = await ports.previewSchedule(job, operation.signal);
				if (!operation.current()) return;
				output.replaceChildren(); output.dataset.status = plan.enabled ? "ready" : "unconfigured";
				node(output, "p", plan.enabled ? undefined : "mod-warning", plan.enabled ? "当前配置允许运行" : "当前任务未启用或条件不满足");
				renderDetails(output, plan.preview);
				if (!plan.enabled) return;
				if (plan.token === undefined) { node(output, "p", "mod-warning", "运行计划缺失，请重新预检"); return; }
				const run = button(output, "运行", () => { void (async () => {
					if (!operation.current()) return;
					run.disabled = true; output.dataset.status = "running";
					try { const result = await ports.runSchedule(plan.token, operation.signal); if (operation.current()) renderOutcome(output, result, ports); }
					catch (error) { if (operation.current()) renderError(output, error); }
				})(); }, "mod-cta");
				run.dataset.superbrainRun = job;
			} catch (error) { if (operation.current()) renderError(output, error); }
		})(); });
		preview.dataset.superbrainJob = job;
	}
}
