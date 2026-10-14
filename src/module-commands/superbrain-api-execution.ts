import { getModuleAction } from "./catalog";
import { safeSuperbrainPath, type SuperbrainWorkflowSlug } from "./superbrain-catalog";
import { SuperbrainApiWorkflowService, type SuperbrainApiAction, type SuperbrainApiPlan, type SuperbrainDirectApiPlan } from "./superbrain-workflow-service";
import type { SuperbrainWorkflowResult } from "./superbrain-receipt";
import type { AskEvent } from "../ai/provider/types";
import type { ApiToolRunner } from "../ai/provider/api-agent-runtime";
import { SuperbrainDirectVaultTools, type SuperbrainDirectVaultHost, type SuperbrainDirectVaultChange } from "./superbrain-direct-vault-tools";

export interface ConfirmedApiActionResult {
  actionId: string;
  /** An existing TALOS task must record the user's own confirmation. */
  taskId: string;
  confirmed: true;
  state: "completed" | "partial" | "failed" | "cancelled";
  evidencePaths: string[];
  summary?: string;
}

export interface ApiWorkflowExecutionPort {
  /** Must open the original editable preview and await its explicit confirmation. */
  runWithUserConfirmation(action: SuperbrainApiAction, signal?: AbortSignal): Promise<ConfirmedApiActionResult | null>;
  evidenceExists(path: string): Promise<boolean>;
  saveReceipt(result: ApiWorkflowExecutionResult): Promise<string>;
}

export interface ApiWorkflowExecutionResult extends SuperbrainWorkflowResult {
  providerId: string;
  taskIds: string[];
  rounds: number;
  reason?: string;
  receipt_path?: string;
  changedFiles?: SuperbrainDirectVaultChange[];
  modelText?: string;
}

export interface DirectApiWorkflowExecutionPort {
  vault: SuperbrainDirectVaultHost;
  /** The provider must use this runner and pass abort through to provider.cancel. */
  chat(input: { providerId: string; prompt: string; toolRunner: ApiToolRunner; signal?: AbortSignal }): AsyncIterable<AskEvent>;
  evidenceExists(path: string): Promise<boolean>;
  saveReceipt(result: ApiWorkflowExecutionResult): Promise<string>;
}

/** The model may use Vault tools immediately after the user starts this run. */
export class SuperbrainDirectApiExecution {
  constructor(private readonly port: DirectApiWorkflowExecutionPort) {}

  async run(input: { plan: SuperbrainDirectApiPlan; signal?: AbortSignal; onEvent?: (event: AskEvent) => void }): Promise<ApiWorkflowExecutionResult> {
    const { plan, signal } = input;
    if (!plan.providerId.trim() || !plan.prompt.trim()) throw new Error("模型 API 工作流计划无效");
    const tools = new SuperbrainDirectVaultTools(this.port.vault, signal);
    let modelText = "";
    let reason = "";
    let done = false;
    let modelCalled = false;
    try {
      if (signal?.aborted) throw new Error("已取消 API 工作流");
      modelCalled = true;
      for await (const event of this.port.chat({ providerId: plan.providerId, prompt: plan.prompt, toolRunner: tools, signal })) {
        try { input.onEvent?.(event); } catch { /* display callbacks cannot change the tool outcome */ }
        if (event.type === "text") modelText += event.text;
        if (event.type === "error") reason = event.message;
        if (event.type === "done") done = true;
        if (signal?.aborted) throw new Error("已取消 API 工作流");
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : "模型 API 运行失败";
    }
    if (!done && !reason) reason = "模型 API 没有返回完成信号";
    try { await tools.verifyChanges(); } catch (error) {
      reason = error instanceof Error ? error.message : "运行后文件核对失败";
    }
    const changedFiles = tools.changes();
    const evidence = changedFiles.map(change => safeSuperbrainPath(change.path));
    for (const path of evidence) {
      if (!(await this.port.evidenceExists(path))) reason = `运行后证据文件不存在：${path}`;
    }
    const status: ApiWorkflowExecutionResult["status"] = reason ? "failed" : changedFiles.length ? "completed" : "no_change";
    const result: ApiWorkflowExecutionResult = {
      workflow_id: plan.workflow, host: "api", providerId: plan.providerId,
      status, model_called: modelCalled, receipt_valid: false,
      evidence, log: null, taskIds: [], rounds: 1,
      changedFiles, modelText: modelText.slice(0, 16_000),
      ...(reason ? { reason: reason.slice(0, 500) } : {}),
    };
    try {
      const path = safeSuperbrainPath(await this.port.saveReceipt(result));
      if (!path.startsWith("System/working-memory/workflow-runs/receipts/") || !(await this.port.evidenceExists(path))) throw new Error("API 运行收据未持久保存");
      result.receipt_path = path;
      result.receipt_valid = true;
    } catch (error) {
      result.status = "failed";
      result.receipt_valid = false;
      result.reason = error instanceof Error ? error.message : "API 运行收据保存失败";
    }
    return result;
  }
}

function validEvidence(path: string): string {
  const safe = safeSuperbrainPath(path);
  if (safe.startsWith("System/working-memory/workflow-runs/")) throw new Error("运行日志不能作为成果证据");
  return safe;
}

/** Re-plans only after an approved TALOS task finishes; a model proposal never executes directly. */
export class SuperbrainApiExecution {
  constructor(private readonly planner: SuperbrainApiWorkflowService, private readonly port: ApiWorkflowExecutionPort) {}

  async run(input: { workflow: SuperbrainWorkflowSlug; providerId: string; rule: string; instruction: string; initialPlan?: SuperbrainApiPlan; signal?: AbortSignal; onPlan?: (summary: string, actions: readonly SuperbrainApiAction[]) => void }): Promise<ApiWorkflowExecutionResult> {
    if (input.instruction.length > 12_000) throw new Error("本轮指令过长");
    if (input.initialPlan && (input.initialPlan.workflow !== input.workflow || input.initialPlan.providerId !== input.providerId)) throw new Error("API 预览与本次工作流不匹配");
    const taskIds: string[] = [];
    const evidence = new Set<string>();
    const seen = new Set<string>();
    const feedback: string[] = [];
    let rounds = 0;
    let stopReason = "";
    let sawChange = false;
    for (; rounds < 4 && taskIds.length < 8; rounds++) {
      if (input.signal?.aborted) throw new Error("已取消 API 工作流");
      const continuation = feedback.length
        ? `${input.instruction}\n\n已确认并执行的 TALOS 任务回执：\n${feedback.join("\n")}\n请根据实际结果决定下一步；已执行动作不可重复。无需后续动作时返回 actions=[]。`
        : input.instruction;
      const plan = rounds === 0 && input.initialPlan
        ? input.initialPlan
        : await this.planner.preview(input.workflow, input.providerId, input.rule, continuation.slice(0, 20_000), input.signal);
      input.onPlan?.(plan.summary, plan.actions);
      if (!plan.actions.length) {
        stopReason = plan.summary || "没有后续动作";
        break;
      }
      for (const action of plan.actions) {
        if (input.signal?.aborted) throw new Error("已取消 API 工作流");
        if (!getModuleAction(action.actionId)) throw new Error("API 建议动作未登记");
        const key = JSON.stringify([action.actionId, action.input]);
        if (seen.has(key)) throw new Error("API 重复建议已执行动作，流程停止");
        seen.add(key);
        const result = await this.port.runWithUserConfirmation(action, input.signal);
        if (!result) return this.finish(input, "failed", "使用者关闭了动作确认", taskIds, evidence, rounds + 1, sawChange);
        if (result.confirmed !== true || !result.taskId || result.actionId !== action.actionId) throw new Error("API 动作没有有效的 TALOS 审批任务回执");
        taskIds.push(result.taskId);
        feedback.push(`${action.actionId}: ${result.state}; ${String(result.summary ?? "").slice(0, 500)}; evidence=${result.evidencePaths.slice(0, 12).join(",")}`);
        if (result.state !== "completed") return this.finish(input, "failed", `动作 ${action.actionId} ${result.state}`, taskIds, evidence, rounds + 1, sawChange);
        if (getModuleAction(action.actionId)?.effect === "write") sawChange = true;
        for (const path of result.evidencePaths) evidence.add(validEvidence(path));
        if (taskIds.length >= 8) break;
      }
    }
    if (!stopReason) return this.finish(input, "failed", "已到本轮动作或轮次上限，需复核后继续", taskIds, evidence, rounds, sawChange);
    const status = sawChange ? "completed" : "no_change";
    return this.finish(input, status, stopReason, taskIds, evidence, rounds + 1, sawChange);
  }

  private async finish(
    input: { workflow: SuperbrainWorkflowSlug; providerId: string },
    status: ApiWorkflowExecutionResult["status"], reason: string,
    taskIds: string[], evidence: Set<string>, rounds: number, sawChange: boolean,
  ): Promise<ApiWorkflowExecutionResult> {
    const checked: string[] = [];
    for (const path of evidence) {
      if (!(await this.port.evidenceExists(path))) return this.finishFailed(input, `证据文件不存在：${path}`, taskIds, rounds);
      checked.push(path);
    }
    if (status === "completed" && (!sawChange || !checked.length)) return this.finishFailed(input, "写入任务缺少当前资料文件证据", taskIds, rounds);
    const result: ApiWorkflowExecutionResult = {
      workflow_id: input.workflow, host: "api", providerId: input.providerId,
      status, model_called: true, receipt_valid: status !== "failed",
      evidence: checked, log: null, taskIds: [...taskIds], rounds, reason,
    };
    if (result.receipt_valid) {
      const path = safeSuperbrainPath(await this.port.saveReceipt(result));
      if (!path.startsWith("System/working-memory/workflow-runs/receipts/") || !(await this.port.evidenceExists(path))) return this.finishFailed(input, "API 运行收据未持久保存", taskIds, rounds);
      result.receipt_path = path;
    }
    return result;
  }

  private finishFailed(input: { workflow: SuperbrainWorkflowSlug; providerId: string }, reason: string, taskIds: string[], rounds: number): ApiWorkflowExecutionResult {
    return { workflow_id: input.workflow, host: "api", providerId: input.providerId, status: "failed", model_called: true, receipt_valid: false, evidence: [], log: null, taskIds: [...taskIds], rounds, reason };
  }
}
