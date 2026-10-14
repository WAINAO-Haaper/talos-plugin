import { App, Modal, Notice, TFile } from "obsidian";
import { mapSuperbrainFile, type SuperbrainCatalog, type SuperbrainEntry, type SuperbrainToolId, type SuperbrainWorkflowSlug } from "../module-commands/superbrain-catalog";
import { SuperbrainApiWorkflowService, SuperbrainWorkflowService, type SuperbrainApiPlan, type SuperbrainApiAction } from "../module-commands/superbrain-workflow-service";
import type { ApiWorkflowExecutionResult } from "../module-commands/superbrain-api-execution";
import { SuperbrainToolService, SuperbrainScheduleService, SUPERBRAIN_SCHEDULE_JOBS, type SuperbrainScheduleJob, type SuperbrainToolInput } from "../module-commands/superbrain-tool-service";
import type { ModuleCommandController } from "../module-commands/controller";

export interface SuperbrainWorkflowPanelOptions {
	app: App;
	loadCatalog(): Promise<SuperbrainCatalog>;
	readWorkflowRule(slug: SuperbrainWorkflowSlug): Promise<string>;
	workflowService: SuperbrainWorkflowService;
	toolService: SuperbrainToolService;
	scheduleService: SuperbrainScheduleService;
	runTool(plan: Awaited<ReturnType<SuperbrainToolService["preview"]>>, signal?: AbortSignal): Promise<unknown>;
	runWorkflow(plan: Awaited<ReturnType<SuperbrainWorkflowService["preview"]>>, signal?: AbortSignal): Promise<Awaited<ReturnType<SuperbrainWorkflowService["run"]>>>;
	runSchedule(plan: Awaited<ReturnType<SuperbrainScheduleService["preview"]>>, signal?: AbortSignal): Promise<unknown>;
	apiService: SuperbrainApiWorkflowService;
	runApi(plan: SuperbrainApiPlan, rule: string, instruction: string, signal?: AbortSignal, onPlan?: (summary: string, actions: readonly SuperbrainApiAction[]) => void): Promise<ApiWorkflowExecutionResult>;
	apiProviders(): string[];
	moduleCommands: ModuleCommandController;
	moduleRoots(): Record<string, string>;
}

/** A compact detail dialog reached from TALOS's existing module command bar. */
export class SuperbrainWorkflowPanel extends Modal {
	private catalog: SuperbrainCatalog | null = null;
	private current: SuperbrainEntry | null = null;
	private pending: AbortController | null = null;
	private sequence = 0;
	private result!: HTMLElement;

	constructor(private readonly options: SuperbrainWorkflowPanelOptions, private readonly initialId?: string) { super(options.app); }
	onOpen(): void { void this.load(); }
	onClose(): void { this.pending?.abort(); this.pending = null; this.sequence++; this.contentEl.empty(); }

	private async load(): Promise<void> {
		this.titleEl.setText("TALOS · 超级大脑工作流");
		this.contentEl.setText("正在读取当前资料库的工作流目录…");
		try {
			this.catalog = await this.options.loadCatalog();
			if (!this.contentEl.isConnected) return;
			const all = [...this.catalog.workflows, ...this.catalog.mechanisms];
			this.current = all.find(item => item.id === this.initialId) ?? all[0] ?? null;
			this.render();
		} catch (error) {
			this.contentEl.empty();
			this.contentEl.createEl("p", { text: `当前资料库未接入完整工作流目录：${error instanceof Error ? error.message : "读取失败"}`, cls: "mod-warning" });
		}
	}

	private render(): void {
		const current = this.current;
		const catalog = this.catalog;
		if (!current || !catalog) return;
		this.pending?.abort(); this.pending = null; this.sequence++;
		this.titleEl.setText(`TALOS · ${current.id} ${current.title}`);
		this.contentEl.empty();
		const picker = this.contentEl.createEl("select", { attr: { "aria-label": "选择超级大脑工作流或机制" } });
		for (const item of [...catalog.workflows, ...catalog.mechanisms]) {
			picker.createEl("option", { text: `${item.id} · ${item.title}`, value: item.id });
		}
		picker.value = current.id;
		picker.addEventListener("change", () => {
			this.current = [...catalog.workflows, ...catalog.mechanisms].find(item => item.id === picker.value) ?? null;
			this.render();
		});
		this.contentEl.createEl("p", { text: current.summary });
		const files = this.contentEl.createDiv({ cls: "talos-module-command-result" });
		files.createEl("strong", { text: "相关资料" });
		for (const raw of current.files) {
			const path = mapSuperbrainFile(raw, this.options.moduleRoots());
			const button = files.createEl("button", { text: path, attr: { "data-superbrain-file": path } });
			const file = this.app.vault.getAbstractFileByPath(path);
			button.disabled = !(file instanceof TFile);
			button.addEventListener("click", () => { if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file); });
		}
		this.result = this.contentEl.createDiv({ cls: "talos-module-command-result", attr: { "aria-live": "polite" } });
		if (current.tools.length) this.renderTools(current);
		if (current.id === "M07") this.renderSchedule();
		if (current.slug) this.renderWorkflow(current.slug);
	}

	private renderTools(current: SuperbrainEntry): void {
		const block = this.contentEl.createDiv({ cls: "talos-module-command-field" });
		block.createEl("strong", { text: "本地工具" });
		const query = block.createEl("input", { type: "text", attr: { "aria-label": "检索内容", placeholder: "检索内容（用于 search）" } });
		const source = block.createEl("input", { type: "text", attr: { "aria-label": "导出源目录", placeholder: "库内源目录（用于 export）" } });
		const destination = block.createEl("input", { type: "text", attr: { "aria-label": "导出目标目录", placeholder: "库外新目录（用于 export）" } });
		const snapshotOperation = block.createEl("select", { attr: { "aria-label": "快照操作" } });
		for (const operation of ["create", "verify", "restore"] as const) snapshotOperation.createEl("option", { text: operation, value: operation });
		const archive = block.createEl("input", { type: "text", attr: { "aria-label": "快照 ZIP 路径", placeholder: "快照 ZIP 绝对路径（用于 verify/restore）" } });
		for (const tool of current.tools) {
			const button = block.createEl("button", { text: `预览 ${tool}`, attr: { "data-superbrain-tool": tool } });
			button.addEventListener("click", () => void this.previewTool(tool, { query: query.value, source: source.value, destination: destination.value, archive: archive.value, snapshotOperation: snapshotOperation.value as SuperbrainToolInput["snapshotOperation"] }));
		}
	}

	private async previewTool(tool: SuperbrainToolId, input: SuperbrainToolInput): Promise<void> {
		const sequence = ++this.sequence;
		this.pending?.abort(); this.pending = new AbortController();
		this.result.empty(); this.result.createEl("p", { text: `正在预览 ${tool}…` });
		try {
			const plan = await this.options.toolService.preview(tool, input, this.pending.signal);
			if (sequence !== this.sequence) return;
			this.result.empty(); this.result.createEl("pre", { text: JSON.stringify(plan.preview, null, 2).slice(0, 16_000) });
			if (!plan.writes) return;
			const confirm = this.result.createEl("button", { text: `确认执行 ${tool}`, cls: "mod-cta" });
			confirm.addEventListener("click", () => {
				confirm.disabled = true; void this.runTool(plan, sequence);
			});
		} catch (error) { if (sequence === this.sequence) this.showError(error); }
	}

	private async runTool(plan: Awaited<ReturnType<SuperbrainToolService["preview"]>>, sequence: number): Promise<void> {
		try {
			const result = await this.options.runTool(plan, this.pending?.signal);
			if (sequence !== this.sequence) return;
			this.result.empty(); this.result.createEl("pre", { text: JSON.stringify(result, null, 2).slice(0, 16_000) });
		} catch (error) { if (sequence === this.sequence) this.showError(error); }
	}

	private renderSchedule(): void {
		const block = this.contentEl.createDiv({ cls: "talos-module-command-field" });
		block.createEl("strong", { text: "可选主动与定时任务" });
		block.createEl("p", { text: "默认全部关闭；先在 System/自动化/jobs.json 设置启用和本机智能体，再逐项预检。" });
		for (const job of SUPERBRAIN_SCHEDULE_JOBS) {
			const button = block.createEl("button", { text: `预检 ${job}`, attr: { "data-superbrain-job": job } });
			button.addEventListener("click", () => void this.previewSchedule(job));
		}
	}

	private async previewSchedule(job: SuperbrainScheduleJob): Promise<void> {
		const sequence = ++this.sequence;
		this.pending?.abort(); this.pending = new AbortController();
		this.result.empty(); this.result.createEl("p", { text: `正在预检 ${job}…` });
		try {
			const plan = await this.options.scheduleService.preview(job, this.pending.signal);
			if (sequence !== this.sequence) return;
			this.result.empty(); this.result.createEl("pre", { text: JSON.stringify(plan.preview, null, 2).slice(0, 8000) });
			if (!plan.enabled) return;
			const confirm = this.result.createEl("button", { text: `确认运行 ${job}`, cls: "mod-cta" });
			confirm.addEventListener("click", () => { confirm.disabled = true; void this.runSchedule(plan, sequence); });
		} catch (error) { if (sequence === this.sequence) this.showError(error); }
	}

	private async runSchedule(plan: Awaited<ReturnType<SuperbrainScheduleService["preview"]>>, sequence: number): Promise<void> {
		try {
			const result = await this.options.runSchedule(plan, this.pending?.signal);
			if (sequence !== this.sequence) return;
			this.result.empty(); this.result.createEl("pre", { text: JSON.stringify(result, null, 2).slice(0, 16_000) });
			this.result.createEl("p", { text: "任务收据和资料结果仍需逐项核对；系统级调度器由使用者单独配置。" });
		} catch (error) { if (sequence === this.sequence) this.showError(error); }
	}

	private renderWorkflow(slug: SuperbrainWorkflowSlug): void {
		const block = this.contentEl.createDiv({ cls: "talos-module-command-field" });
		block.createEl("strong", { text: "运行工作流" });
		const host = block.createEl("select", { attr: { "aria-label": "选择智能体或模型 API" } });
		host.createEl("option", { text: "本机 Codex", value: "codex" });
		host.createEl("option", { text: "本机 Claude", value: "claude" });
		for (const provider of this.options.apiProviders()) host.createEl("option", { text: `模型 API · ${provider}`, value: provider });
		const instruction = block.createEl("textarea", { attr: { "aria-label": "本次补充说明", rows: "3", placeholder: "本轮目标、范围或需要核对的资料" } });
		const button = block.createEl("button", { text: "预览工作流", cls: "mod-cta", attr: { "data-superbrain-workflow": slug } });
		button.addEventListener("click", () => void this.previewWorkflow(slug, host.value, instruction.value));
	}

	private async previewWorkflow(slug: SuperbrainWorkflowSlug, host: string, instruction: string): Promise<void> {
		const sequence = ++this.sequence;
		this.pending?.abort(); this.pending = new AbortController();
		this.result.empty(); this.result.createEl("p", { text: "正在准备工作流…" });
		try {
			if (host !== "codex" && host !== "claude") {
				const rule = await this.options.readWorkflowRule(slug);
				const plan = await this.options.apiService.preview(slug, host, rule, instruction, this.pending.signal);
				if (sequence !== this.sequence) return;
				this.result.empty(); this.result.createEl("p", { text: plan.summary });
				if (!plan.actions.length) this.result.createEl("p", { text: "模型未提出本地动作；本轮没有文件变更。" });
				for (const action of plan.actions) {
					const row = this.result.createDiv(); row.createEl("span", { text: `${action.actionId} · ${action.reason} ` });
					const button = row.createEl("button", { text: "打开原有预览窗口", attr: { "data-superbrain-api-action": action.actionId } });
					button.addEventListener("click", () => { void this.options.moduleCommands.openSuggested(action.actionId, action.input); });
				}
				this.result.createEl("p", { text: "每项动作在原有窗口检查目标与内容，并单独确认。只有实际执行成功才算文件结果。" });
				const run = this.result.createEl("button", { text: plan.actions.length ? "按原有预览逐项执行" : "确认记录无变化", cls: "mod-cta" });
				run.addEventListener("click", () => { run.disabled = true; void this.runApiWorkflow(plan, rule, instruction, sequence); });
				return;
			}
			const plan = await this.options.workflowService.preview(slug, host, instruction, this.pending.signal);
			if (sequence !== this.sequence) return;
			this.result.empty(); this.result.createEl("pre", { text: JSON.stringify(plan.preview, null, 2).slice(0, 8000) });
			const state = plan.preview as Record<string, unknown>;
			if (state.status !== "ready") { this.result.createEl("p", { text: "本机智能体尚不可运行，请检查安装与配置。" }); return; }
			const confirm = this.result.createEl("button", { text: `确认调用本机 ${host} 运行 /${slug}`, cls: "mod-cta" });
			confirm.addEventListener("click", () => { confirm.disabled = true; void this.runWorkflow(plan, sequence); });
		} catch (error) { if (sequence === this.sequence) this.showError(error); }
	}

	private async runApiWorkflow(plan: SuperbrainApiPlan, rule: string, instruction: string, sequence: number): Promise<void> {
		try {
			const result = await this.options.runApi(plan, rule, instruction, this.pending?.signal, (summary, actions) => {
				if (sequence === this.sequence) this.result.createEl("p", { text: `API 步骤：${summary}（${actions.length} 项）` });
			});
			if (sequence !== this.sequence) return;
			this.result.empty();
			this.result.createEl("p", { text: `API 工作流：${result.status}；已确认任务 ${result.taskIds.length} 项；收据${result.receipt_valid ? "已核对" : "未通过"}。` });
			if (result.reason) this.result.createEl("p", { text: result.reason });
			for (const path of result.evidence) {
				const button = this.result.createEl("button", { text: `查看证据：${path}` });
				button.addEventListener("click", () => { const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file); });
			}
			if (result.receipt_path) this.result.createEl("p", { text: `运行收据：${result.receipt_path}` });
		} catch (error) { if (sequence === this.sequence) this.showError(error); }
	}

	private async runWorkflow(plan: Awaited<ReturnType<SuperbrainWorkflowService["preview"]>>, sequence: number): Promise<void> {
		try {
			const result = await this.options.runWorkflow(plan, this.pending?.signal);
			if (sequence !== this.sequence) return;
			this.result.empty();
			this.result.createEl("p", { text: `运行状态：${result.status}；收据：${result.receipt_valid ? "有效" : "未通过"}；语义结果待使用者核对。` });
			for (const path of result.evidence) {
				const button = this.result.createEl("button", { text: `查看证据：${path}` });
				button.addEventListener("click", () => { const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file); else new Notice("证据文件已变化，请重新核对"); });
			}
		} catch (error) { if (sequence === this.sequence) this.showError(error); }
	}

	private showError(error: unknown): void {
		this.result.empty(); this.result.createEl("p", { text: `未完成：${error instanceof Error ? error.message : "运行失败"}`, cls: "mod-warning" });
	}
}
