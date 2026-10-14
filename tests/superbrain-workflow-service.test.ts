import { describe, expect, it } from "vitest";
import { SuperbrainApiWorkflowService, SuperbrainWorkflowService } from "../src/module-commands/superbrain-workflow-service";
import type { SuperbrainJsonRunner } from "../src/module-commands/superbrain-tool-service";

describe("superbrain workflow result", () => {
  it("does not turn a claimed completion into success without a current evidence file", async () => {
    const runner: SuperbrainJsonRunner = { async run(_script, args) {
      return args[0] === "plan" ? { status: "ready" } : { workflow_id: "intake", host: "codex", status: "completed", model_called: true, receipt_valid: true, evidence: ["02-洞察/missing.md"], log: null };
    } };
    const service = new SuperbrainWorkflowService(runner, async () => false);
    const plan = await service.preview("intake", "codex");
    await expect(service.run(plan)).rejects.toThrow("证据文件不存在");
  });
  it("rejects API tool names outside the existing module action list", async () => {
    const service = new SuperbrainApiWorkflowService(async () => JSON.stringify({ summary: "do", actions: [{ actionId: "library.restore", input: {}, reason: "overwrite" }] }));
    await expect(service.preview("maintain", "openai-compatible", "rule", "check")).rejects.toThrow("暂不支持");
  });
  it("keeps API output as a proposal with no local write", async () => {
    const service = new SuperbrainApiWorkflowService(async () => JSON.stringify({ summary: "capture", actions: [{ actionId: "capture.note", input: { title: "Test", content: "Draft" }, reason: "save" }] }));
    const result = await service.preview("intake", "openai-compatible", "rule", "test");
    expect(result.actions[0]?.input.title).toBe("Test");
  });
});
