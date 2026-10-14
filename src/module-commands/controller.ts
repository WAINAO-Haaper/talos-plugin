import { App, Modal, Notice, TFile } from "obsidian";
import type { ConsoleActionRuntime } from "../console-action-runtime";
import { MODULE_ACTIONS, MODULE_COMMAND_GROUPS, getModuleAction, getModuleActionsForGroup, resolveLegacyCommand, type ModuleAction, type ModuleActionId, type ModuleCommandGroupId } from "./catalog";
import { ModuleCommandService, type ModuleCommandHost, type ModuleCommandPlan, type ModuleImportFile } from "./service";
import { completedTaskResult } from "../task-core/task-runner";
import { taskStateLabel } from "../ui/task-state-label";
import type { LocalMediaRecognition, MediaRecognitionAction, MediaRecognitionResult } from "./media-recognition";

export interface ModuleCommandControllerOptions {
 app: App;
 runtime: ConsoleActionRuntime;
 host: ModuleCommandHost;
 refresh(): void;
 ask(query: string, signal: AbortSignal): Promise<string>;
 mediaRecognition?: () => LocalMediaRecognition | undefined;
}

export class ModuleCommandController {
 private readonly service: ModuleCommandService;
 private modal: ModuleCommandModal | null = null;
 constructor(readonly options: ModuleCommandControllerOptions) {
  this.service = new ModuleCommandService(options.host);
  for (const action of MODULE_ACTIONS) {
   options.runtime.registry.register({
    id: `module-command-${action.id}`, label: action.label, description: action.description,
    risk: action.effect === "write" ? "C" : "A", readScope: ["**"],
    writeScope: action.effect === "write" ? ["**"] : [], timeoutMs: 120_000,
    cancelable: true, reversible: false,
    execute: async (context, input) => {
     if (action.id === "media.ocr" || action.id === "media.transcribe") {
      const request = input as { path: string; signal?: AbortSignal };
      const adapter = options.mediaRecognition?.();
      if (!adapter) throw new Error("当前宿主没有本地媒体识别适配器");
      const signal = request.signal ? AbortSignal.any([context.signal, request.signal]) : context.signal;
      return completedTaskResult(await adapter.recognize(action.id, request.path, signal), []);
     }
     const plan = input as ModuleCommandPlan;
     if (plan.actionId !== action.id) throw new Error("执行计划与动作不匹配");
     const result = await this.service.apply(plan, context.signal); options.refresh(); return completedTaskResult(result, plan.changes.map(change => ({ path: change.path, kind: change.before === null ? "create" : "modify" })));
    },
   });
  }
 }
 unavailable(action: ModuleAction): string | null {
  const missing = action.requiresCapabilities.filter(cap => cap !== "ai.ask" && !(this.options.mediaRecognition && (cap === "media.ocr" || cap === "media.transcribe")));
  if (!missing.length) return null;
  const labels: Record<string, string> = { "media.ocr": "尚未配置图片文字识别引擎", "media.transcribe": "尚未配置音视频转写引擎" };
  return missing.map(cap => labels[cap] ?? `需要能力：${cap}`).join("；");
 }
 async open(invocation: string): Promise<void> {
  const clean = invocation.trim().replace(/^\//, "");
  let action = getModuleAction(clean); let group: ModuleCommandGroupId | undefined;
  let args = "";
  const parts = clean.match(/^([a-z]+)\s+([a-z]+)(?:\s+([\s\S]*))?$/);
  if (!action && parts) { action = getModuleAction(`${parts[1]}.${parts[2]}`); if (action) args = parts[3] ?? ""; }
  if (!action && MODULE_COMMAND_GROUPS.some(entry => entry.id === clean)) group = clean as ModuleCommandGroupId;
  if (!action && !group) {
   const resolution = resolveLegacyCommand(invocation);
   if (resolution.kind === "action") { action = resolution.action; args = resolution.args; }
   else if (resolution.kind === "requires-action" && "group" in resolution && typeof resolution.group === "string") group = resolution.group;
   else { new Notice(resolution.kind === "optional-extension" ? `此入口属于可选扩展：${resolution.description}` : "该调用尚不能直接执行，请从模块操作中选择具体动作。", 7000); return; }
  }
  const actions = group ? getModuleActionsForGroup(group) : action ? [action] : [];
  if (!actions.length) return;
  this.modal?.close();
  await new Promise<void>(resolve => {
   const modal = new ModuleCommandModal(this, actions, args, () => { if (this.modal === modal) this.modal = null; resolve(); });
   this.modal = modal; modal.open();
  });
 }
 prepare(id: ModuleActionId, input: Record<string, unknown>): Promise<ModuleCommandPlan> { return this.service.prepare(id, input); }
 async mediaUnavailable(actionId: MediaRecognitionAction): Promise<string | null> {
  const engine = this.options.mediaRecognition?.();
  return engine ? await engine.unavailable(actionId) : "当前宿主没有本地媒体识别适配器";
 }
 async executeMedia(actionId: MediaRecognitionAction, path: string, signal: AbortSignal): Promise<MediaRecognitionResult> {
  const task = await this.options.runtime.runner.run({
   actionId: `module-command-${actionId}`,
   idempotencyKey: `media-recognition:${actionId}:${crypto.randomUUID()}`,
   input: { path, signal },
   request: { readPaths: [path], writePaths: [], effects: ["read"] },
  });
  if (task.state !== "completed" || !task.result || typeof task.result !== "object") throw new Error(task.error ?? `识别任务未完成：${task.state}`);
  return task.result as MediaRecognitionResult;
 }
 /** API suggestions enter the same editable form, preview, and user confirmation as manual actions. */
 async openSuggested(id: ModuleActionId, values: Record<string, string>): Promise<void> {
  const action = getModuleAction(id);
  if (!action || this.unavailable(action)) throw new Error("建议动作当前不可用");
  this.modal?.close();
  await new Promise<void>(resolve => {
   const modal = new ModuleCommandModal(this, [action], "", () => { if (this.modal === modal) this.modal = null; resolve(); }, values);
   this.modal = modal; modal.open();
  });
 }
 canUndo(plan: ModuleCommandPlan): boolean { return plan.changes.every(change => change.before !== null) || this.options.host.conditionalDelete === true; }
 async undo(plan: ModuleCommandPlan): Promise<void> { if (!this.canUndo(plan)) throw new Error("当前宿主保留新建文件，不支持自动删除撤销"); await this.service.undo(plan); this.options.refresh(); }
 close(): void { this.modal?.close(); this.modal = null; }
}

class ModuleCommandModal extends Modal {
 private active: ModuleAction;
 private picker: HTMLSelectElement | null = null;
 private inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
 private result!: HTMLElement;
 private submit!: HTMLButtonElement;
 private closed = false;
 private pending = false;
 private sequence = 0;
 private askAbort: AbortController | null = null;
 private taskId: string | null = null;
 private unsubscribe: (() => void) | null = null;
 constructor(private readonly controller: ModuleCommandController, private readonly actions: ModuleAction[], private readonly args: string, private readonly finished: () => void, private readonly suggested: Record<string, string> = {}) {
  super(controller.options.app); this.active = actions[0]!;
 }
 onOpen(): void { this.render(); }
 private render(): void {
  this.contentEl.empty(); this.inputs.clear(); this.picker = null; this.sequence++;
  this.titleEl.setText(`TALOS · ${MODULE_COMMAND_GROUPS.find(g => g.id === this.active.group)?.label ?? "模块操作"}`);
  if (this.actions.length > 1) {
   const picker = this.contentEl.createEl("select", { attr: { "aria-label": "选择操作" } });
   for (const action of this.actions) picker.createEl("option", { text: `${action.label}${this.controller.unavailable(action) ? "（需配置能力）" : ""}`, value: action.id });
   picker.value = this.active.id; this.picker = picker;
   picker.addEventListener("change", () => { if (this.pending) return; this.active = getModuleAction(picker.value)!; this.render(); });
  }
  this.contentEl.createEl("p", { text: this.active.description });
  for (const field of this.active.inputs) {
   const row = this.contentEl.createEl("label", { cls: "talos-module-command-field" });
   row.createSpan({ text: `${field.label}${field.required ? " *" : ""}` });
   let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
   if (field.type === "textarea") input = row.createEl("textarea", { attr: { rows: "4" } });
   else if (field.type === "select") {
    const select = row.createEl("select"); for (const option of field.options ?? []) select.createEl("option", { text: option, value: option }); input = select;
   } else {
    const element = row.createEl("input", { type: field.type === "file" || field.type === "files" ? "file" : "text" });
    if (field.type === "files") element.multiple = true;
    if (field.type === "path") element.value = this.app.workspace.getActiveFile()?.path ?? "";
    input = element;
   }
   if (this.args && ["query", "path", "content"].includes(field.name) && field.type !== "select") input.value = this.args;
   if (field.type !== "file" && field.type !== "files" && typeof this.suggested[field.name] === "string") input.value = this.suggested[field.name];
   input.setAttribute("aria-label", field.label); input.required = field.required;
   input.addEventListener("input", () => { this.sequence++; this.result?.empty(); });
   row.createEl("small", { text: field.description }); this.inputs.set(field.name, input);
  }
  const unavailable = this.controller.unavailable(this.active);
  if (unavailable) this.contentEl.createEl("p", { text: unavailable, cls: "mod-warning" });
  const controls = this.contentEl.createDiv({ cls: "modal-button-container" });
  const cancel = controls.createEl("button", { text: "关闭" }); cancel.addEventListener("click", () => this.close());
  this.submit = controls.createEl("button", { text: this.active.effect === "write" ? "预览操作" : this.active.id === "search.ask" ? "使用当前模型提问" : "执行", cls: "mod-cta" });
  this.submit.disabled = Boolean(unavailable);
  this.submit.addEventListener("click", () => void this.prepare());
  this.result = this.contentEl.createDiv({ cls: "talos-module-command-result", attr: { "aria-live": "polite" } });
  if (this.active.id === "media.ocr" || this.active.id === "media.transcribe") {
   const id = this.active.id; const submit = this.submit;
   submit.disabled = true;
   this.result.createEl("p", { text: "正在检查本机识别引擎…" });
   void this.controller.mediaUnavailable(id).then(reason => {
    if (this.closed || this.submit !== submit || this.active.id !== id) return;
    this.result.empty();
    if (reason) this.result.createEl("p", { text: reason, cls: "mod-warning" });
    submit.disabled = this.pending || Boolean(reason);
   }).catch(() => { if (!this.closed && this.submit === submit) this.result.setText("本机识别引擎检测失败"); });
  }
 }
 private async values(): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const field of this.active.inputs) {
   const control = this.inputs.get(field.name)!;
   if (field.type === "file" || field.type === "files") {
    const files = Array.from((control as HTMLInputElement).files ?? []);
    if (field.required && !files.length) throw new Error(`请选择${field.label}`);
    if (files.length > 1000 || files.reduce((size, file) => size + file.size, 0) > 80 * 1024 * 1024) throw new Error("选择的文件过大，请分批处理");
    const imported: ModuleImportFile[] = [];
    for (const file of files) imported.push({ name: file.webkitRelativePath || file.name, content: new Uint8Array(await file.arrayBuffer()) });
    input.files = imported;
   } else {
    if (field.required && !control.value.trim()) throw new Error(`请填写${field.label}`);
    input[field.name] = control.value;
   }
  }
  return input;
 }
 private setPending(pending: boolean): void {
  this.pending = pending; if (this.picker) this.picker.disabled = pending; this.submit.disabled = pending || Boolean(this.controller.unavailable(this.active));
  for (const input of this.inputs.values()) input.disabled = pending;
 }
 private async prepare(): Promise<void> {
  if (this.pending || this.closed) return;
  this.setPending(true); this.result.empty(); const current = ++this.sequence;
  this.result.createEl("p", { text: "正在读取并检查…" });
  try {
   const input = await this.values();
   if (this.closed || current !== this.sequence) return;
   if (this.active.id === "media.ocr" || this.active.id === "media.transcribe") {
    this.askAbort = new AbortController();
    const result = await this.controller.executeMedia(this.active.id, typeof input.path === "string" ? input.path : "", this.askAbort.signal);
    if (!this.closed && current === this.sequence) {
     this.result.empty();
     this.result.createEl("p", { text: `${result.engine} · ${result.path}` });
     this.result.createEl("pre", { text: result.text || "未识别出文字" });
     for (const warning of result.warnings) this.result.createEl("p", { text: warning, cls: "mod-warning" });
    }
    return;
   }
   if (this.active.id === "search.ask") {
    this.askAbort = new AbortController();
    const answer = await this.controller.options.ask(typeof input.query === "string" ? input.query : "", this.askAbort.signal);
    if (!this.closed && current === this.sequence) { this.result.empty(); this.result.createEl("pre", { text: answer }); }
    return;
   }
   const plan = await this.controller.prepare(this.active.id, input);
   if (this.closed || current !== this.sequence) return;
   this.result.empty(); this.result.createEl("p", { text: plan.summary });
   for (const line of plan.details.slice(0, 100)) this.result.createEl("div", { text: line });
   for (const warning of plan.result.warnings) this.result.createEl("p", { text: warning, cls: "mod-warning" });
   if (plan.changes.length) {
    this.result.createEl("p", { text: `${plan.changes.length} 个文件将被创建或修改。确认仅覆盖本次预览范围。` });
    if (plan.changes.some(change => change.before === null) && !this.controller.options.host.conditionalDelete) this.result.createEl("p", { text: "如中途失败或取消，已新建的文件会保留供检查，不会自动删除。已有文本修改可在本次会话中条件撤销。" });
    for (const change of plan.changes.slice(0, 100)) {
     this.result.createEl("div", { text: `${change.before === null ? "新建" : "修改"}：${change.path}` });
     if (change.path.endsWith(".md")) {
      const disclosure = this.result.createEl("details"); disclosure.createEl("summary", { text: "查看写入内容" });
      disclosure.createEl("pre", { text: new TextDecoder().decode(change.after).slice(0, 8000) });
     }
    }
    const confirm = this.result.createEl("button", { text: "确认执行本次操作", cls: "mod-cta" });
    confirm.addEventListener("click", () => {
     if (this.pending || this.closed || current !== this.sequence) return;
     confirm.disabled = true; void this.execute(plan);
    });
   } else await this.execute(plan);
  } catch (error) {
   if (!this.closed) { this.result.empty(); this.result.createEl("p", { text: `未完成：${error instanceof Error ? error.message : "未知错误"}`, cls: "mod-warning" }); }
  } finally { this.askAbort = null; if (!this.closed) this.setPending(false); }
 }
 private async execute(plan: ModuleCommandPlan): Promise<void> {
  this.setPending(true);
  const runtime = this.controller.options.runtime;
  const idempotencyKey = `module-command:${plan.actionId}:${Date.now()}:${this.sequence}`;
  this.unsubscribe?.();
  this.unsubscribe = runtime.store.subscribe(task => { if (task.idempotencyKey === idempotencyKey) this.taskId = task.id; });
  try {
   const task = await runtime.runner.run({ actionId: `module-command-${plan.actionId}`, idempotencyKey, input: plan,
    approvalGranted: true,
    request: { readPaths: [...plan.readPaths], writePaths: plan.changes.map(c => c.path), effects: [plan.changes.length ? "write" : "read"], touchesIdentity: plan.actionId === "profile.update" || plan.actionId === "flow.cycle", touchesTopLevelStructure: plan.actionId === "setup.initialize" },
   });
   if (this.closed) return;
   this.result.createEl("p", { text: `${taskStateLabel(task.state)}${task.error ? `：${task.error}` : ""}` });
   if (plan.changes.some(change => change.before === null) && !this.controller.options.host.conditionalDelete) this.result.createEl("p", { text: "新建文件不会自动删除；失败或取消时请核查本次目标。已有文本修改可条件撤销。" });
   if (task.state === "completed") {
    if (plan.result.text) this.result.createEl("pre", { text: plan.result.text });
    for (const path of plan.result.paths.slice(0, 100)) {
     const button = this.result.createEl("button", { text: `打开 ${path}` });
     button.addEventListener("click", () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file);
     });
    }
    if (plan.changes.length && this.controller.canUndo(plan)) {
     const undo = this.result.createEl("button", { text: "撤销本次写入" });
     undo.addEventListener("click", () => { undo.disabled = true; void this.controller.undo(plan).then(() => { runtime.store.transition(task.id, "reverted", { finishedAt: new Date().toISOString() }); if (!this.closed) this.result.createEl("p", { text: "已恢复本次写入前的文件" }); }).catch(() => { if (!this.closed) this.result.createEl("p", { text: "恢复失败，请保留现场检查" }); }); });
    }
   }
  } catch (error) { if (!this.closed) this.result.createEl("p", { text: `未完成：${error instanceof Error ? error.message : "执行失败"}` }); }
  finally { this.unsubscribe?.(); this.unsubscribe = null; this.taskId = null; if (!this.closed) this.setPending(false); }
 }
 onClose(): void {
  this.closed = true; this.sequence++; this.askAbort?.abort();
  if (this.taskId) this.controller.options.runtime.runner.cancel(this.taskId);
  this.unsubscribe?.(); this.contentEl.empty(); this.finished();
 }
}
