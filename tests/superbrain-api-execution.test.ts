import { describe, expect, it } from "vitest";
import { SuperbrainApiExecution, SuperbrainDirectApiExecution, type ApiWorkflowExecutionPort, type DirectApiWorkflowExecutionPort } from "../src/module-commands/superbrain-api-execution";
import { SuperbrainApiWorkflowService } from "../src/module-commands/superbrain-workflow-service";
import type { SuperbrainDirectVaultHost } from "../src/module-commands/superbrain-direct-vault-tools";

const planner = (answers: Array<{ summary: string; actions: unknown[] }>) => new SuperbrainApiWorkflowService(async () => JSON.stringify(answers.shift() ?? { summary: "完成", actions: [] }));

describe("API workflow execution boundary", () => {
  it("waits for a confirmed TALOS task and current file evidence", async () => {
    const calls: string[] = [];
    const port: ApiWorkflowExecutionPort = {
      async runWithUserConfirmation(action) { calls.push(action.actionId); return { actionId: action.actionId, taskId: "task-1", confirmed: true, state: "completed", evidencePaths: ["00-收件箱/草稿.md"] }; },
      async evidenceExists(path) { return path === "00-收件箱/草稿.md" || path === "System/working-memory/workflow-runs/receipts/mock.json"; },
      async saveReceipt() { return "System/working-memory/workflow-runs/receipts/mock.json"; },
    };
    const executor = new SuperbrainApiExecution(planner([
      { summary: "记录", actions: [{ actionId: "capture.note", input: { title: "草稿", content: "虚构内容" }, reason: "保存" }] },
      { summary: "完成", actions: [] },
    ]), port);
    const result = await executor.run({ workflow: "intake", providerId: "mock-api", rule: "虚构规则", instruction: "记录" });
    expect(calls).toEqual(["capture.note"]);
    expect(result.status).toBe("completed");
    expect(result.receipt_valid).toBe(true);
    expect(result.taskIds).toEqual(["task-1"]);
  });
  it("uses the already reviewed initial plan without another model call", async () => {
    const service = new SuperbrainApiWorkflowService(async () => { throw new Error("unexpected second model call"); });
    const executor = new SuperbrainApiExecution(service, {
      async runWithUserConfirmation() { throw new Error("no action expected"); },
      async evidenceExists(path) { return path === "System/working-memory/workflow-runs/receipts/mock.json"; },
      async saveReceipt() { return "System/working-memory/workflow-runs/receipts/mock.json"; },
    });
    const result = await executor.run({ workflow: "retrieval", providerId: "mock-api", rule: "rule", instruction: "query", initialPlan: { workflow: "retrieval", providerId: "mock-api", summary: "无需写入", actions: [] } });
    expect(result.status).toBe("no_change");
    expect(result.receipt_valid).toBe(true);
  });
  it("fails closed when the receipt is not persisted in the active vault", async () => {
    const port: ApiWorkflowExecutionPort = {
      async runWithUserConfirmation(action) { return { actionId: action.actionId, taskId: "task-3", confirmed: true, state: "completed", evidencePaths: ["00-收件箱/草稿.md"] }; },
      async evidenceExists(path) { return path === "00-收件箱/草稿.md"; },
      async saveReceipt() { return "System/working-memory/workflow-runs/receipts/missing.json"; },
    };
    const executor = new SuperbrainApiExecution(planner([
      { summary: "记录", actions: [{ actionId: "capture.note", input: { title: "x", content: "y" }, reason: "save" }] },
      { summary: "完成", actions: [] },
    ]), port);
    const result = await executor.run({ workflow: "intake", providerId: "mock-api", rule: "rule", instruction: "x" });
    expect(result.status).toBe("failed");
    expect(result.receipt_valid).toBe(false);
  });
  it("does not treat an unconfirmed action or forged evidence as success", async () => {
    const action = { summary: "记录", actions: [{ actionId: "capture.note", input: { title: "x", content: "y" }, reason: "save" }] };
    const cancelled = new SuperbrainApiExecution(planner([action]), { async runWithUserConfirmation() { return null; }, async evidenceExists() { return true; }, async saveReceipt() { return "System/working-memory/workflow-runs/receipts/mock.json"; } });
    expect((await cancelled.run({ workflow: "intake", providerId: "mock-api", rule: "rule", instruction: "x" })).status).toBe("failed");
    const forged = new SuperbrainApiExecution(planner([action]), { async runWithUserConfirmation(a) { return { actionId: a.actionId, taskId: "task-2", confirmed: true, state: "completed", evidencePaths: ["00-收件箱/missing.md"] }; }, async evidenceExists() { return false; }, async saveReceipt() { return "System/working-memory/workflow-runs/receipts/mock.json"; } });
    expect((await forged.run({ workflow: "intake", providerId: "mock-api", rule: "rule", instruction: "x" })).receipt_valid).toBe(false);
  });
});

function directFixture(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const host: SuperbrainDirectVaultHost = {
    files: () => [...files.keys()],
    async assertPath(path) { if (path.startsWith(".talos/") || path.includes("..")) throw new Error("outside"); },
    async exists(path) { return files.has(path); },
    async read(path) { const value = files.get(path); if (value === undefined) throw new Error("missing"); return value; },
    async write(path, content, expected) {
      if (expected === null ? files.has(path) : files.get(path) !== expected) throw new Error("conflict");
      files.set(path, content);
    },
  };
  const service = new SuperbrainApiWorkflowService(async () => { throw new Error("legacy proposal path must not run"); });
  const plan = service.prepareDirect("intake", "openai-compatible", "整理资料并核对出处", "整理新笔记");
  return { files, host, plan };
}

describe("direct API workflow execution", () => {
  it("runs a model tool call immediately and verifies the actual file and receipt", async () => {
    const { files, host, plan } = directFixture();
    let receipt = false;
    const events: string[] = [];
    const port: DirectApiWorkflowExecutionPort = {
      vault: host,
      async *chat(input) {
        expect(input.providerId).toBe("openai-compatible");
        expect(input.prompt).toContain("/intake");
        yield { type: "tool-request", toolCallId: "tool-1", name: "Write", input: { file_path: "00-收件箱/new.md", content: "# New" } };
        const result = await input.toolRunner.run({ id: "tool-1", name: "Write", input: { file_path: "00-收件箱/new.md", content: "# New" } });
        yield { type: "tool-result", toolCallId: "tool-1", output: result.content, isError: result.isError };
        yield { type: "text", text: "已入库" };
        yield { type: "done" };
      },
      async evidenceExists(path) { return files.has(path) || (receipt && path.endsWith("receipt.json")); },
      async saveReceipt(result) { expect(result.changedFiles).toHaveLength(1); receipt = true; return "System/working-memory/workflow-runs/receipts/receipt.json"; },
    };
    const result = await new SuperbrainDirectApiExecution(port).run({ plan, onEvent: event => events.push(event.type) });
    expect(result).toMatchObject({ status: "completed", model_called: true, receipt_valid: true, evidence: ["00-收件箱/new.md"], modelText: "已入库" });
    expect(result.changedFiles?.[0]).toMatchObject({ path: "00-收件箱/new.md", kind: "create", beforeSha256: null });
    expect(files.get("00-收件箱/new.md")).toBe("# New");
    expect(events).toEqual(["tool-request", "tool-result", "text", "done"]);
  });

  it("returns no_change only when the model completes and a receipt is stored", async () => {
    const { files, host, plan } = directFixture();
    let receipt = false;
    const result = await new SuperbrainDirectApiExecution({
      vault: host,
      async *chat() { yield { type: "text", text: "无需修改" }; yield { type: "done" }; },
      async evidenceExists(path) { return files.has(path) || receipt && path.endsWith("receipt.json"); },
      async saveReceipt() { receipt = true; return "System/working-memory/workflow-runs/receipts/receipt.json"; },
    }).run({ plan });
    expect(result.status).toBe("no_change");
    expect(result.receipt_valid).toBe(true);
  });

  it("reports partial writes on provider failure instead of claiming completion", async () => {
    const { files, host, plan } = directFixture();
    let receipt = false;
    const result = await new SuperbrainDirectApiExecution({
      vault: host,
      async *chat(input) {
        await input.toolRunner.run({ id: "tool-1", name: "Write", input: { file_path: "00-收件箱/partial.md", content: "partial" } });
        yield { type: "error", message: "API disconnected", retryable: true };
        yield { type: "done" };
      },
      async evidenceExists(path) { return files.has(path) || receipt && path.endsWith("receipt.json"); },
      async saveReceipt(result) { expect(result.status).toBe("failed"); receipt = true; return "System/working-memory/workflow-runs/receipts/receipt.json"; },
    }).run({ plan });
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("disconnected");
    expect(result.evidence).toEqual(["00-收件箱/partial.md"]);
    expect(result.receipt_valid).toBe(true);
  });

  it("fails when the file changes after its model write or receipt is absent", async () => {
    const { files, host, plan } = directFixture();
    const changed = await new SuperbrainDirectApiExecution({
      vault: host,
      async *chat(input) {
        await input.toolRunner.run({ id: "tool-1", name: "Write", input: { file_path: "00-收件箱/a.md", content: "model" } });
        files.set("00-收件箱/a.md", "external");
        yield { type: "done" };
      },
      async evidenceExists(path) { return files.has(path) || path.endsWith("receipt.json"); },
      async saveReceipt() { return "System/working-memory/workflow-runs/receipts/receipt.json"; },
    }).run({ plan });
    expect(changed.status).toBe("failed");
    expect(changed.reason).toContain("文件已变化");

    const missingReceipt = await new SuperbrainDirectApiExecution({
      vault: host,
      async *chat() { yield { type: "done" }; },
      async evidenceExists() { return false; },
      async saveReceipt() { return "System/working-memory/workflow-runs/receipts/missing.json"; },
    }).run({ plan });
    expect(missingReceipt.status).toBe("failed");
    expect(missingReceipt.receipt_valid).toBe(false);
  });
});
