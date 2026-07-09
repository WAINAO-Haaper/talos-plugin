import { describe, it, expect } from "vitest";
import {
  applyApprovalExecutionRecord,
  buildMockModelAppend,
  parseApprovalExecutableSpec,
} from "../src/approval-executor";

const approval = `# 待审批变更

## 当前待审批

### #QA-B3 TALOS 模型执行授权测试 [2026-07-08]

**状态**：✅ 已批准（2026-07-08，界面按钮）
**执行结果**：🟡 已记录审批决策，具体变更尚未执行。
**界面操作**：2026-07-08 TALOS 点击「批准」。

**执行器**：mock-model-file-append
**目标文件**：System/pending-approvals/model-executor-test.md
**执行指令**：读取目标文件并追加模型处理回执。

**回滚方案**：删除目标文件中追加的测试段。

## 已解决
`;

describe("parseApprovalExecutableSpec", () => {
  it("从审批内容解析执行器、目标文件和指令", () => {
    const spec = parseApprovalExecutableSpec(
      approval,
      "#QA-B3 TALOS 模型执行授权测试 [2026-07-08]"
    );

    expect(spec).toEqual({
      title: "#QA-B3 TALOS 模型执行授权测试 [2026-07-08]",
      executor: "mock-model-file-append",
      targetPath: "System/pending-approvals/model-executor-test.md",
      instruction: "读取目标文件并追加模型处理回执。",
    });
  });

  it("未找到审批项时返回 null", () => {
    const missing = parseApprovalExecutableSpec(approval, "#MISSING");
    expect(missing).toBe(null);
  });
});

describe("buildMockModelAppend", () => {
  it("生成含审批溯源和安全边界的回执内容", () => {
    const spec = parseApprovalExecutableSpec(
      approval,
      "#QA-B3 TALOS 模型执行授权测试 [2026-07-08]"
    );
    expect(spec).not.toBe(null);

    const append = buildMockModelAppend({
      title: spec!.title,
      targetPath: spec!.targetPath,
      instruction: spec!.instruction,
      date: "2026-07-08",
      time: "23:40",
      originalContent: "---\ntitle: test\n---\n\n# Test\n正文",
    });

    expect(append).toMatch(/TALOS 模型执行测试 2026-07-08 23:40/);
    expect(append).toMatch(/审批项：#QA-B3 TALOS 模型执行授权测试/);
    expect(append).toMatch(/安全边界：本次只写入此目标文件/);
  });
});

describe("applyApprovalExecutionRecord", () => {
  it("将执行结果写回审批内容", () => {
    const spec = parseApprovalExecutableSpec(
      approval,
      "#QA-B3 TALOS 模型执行授权测试 [2026-07-08]"
    );
    expect(spec).not.toBe(null);

    const recorded = applyApprovalExecutionRecord(approval, {
      title: spec!.title,
      targetPath: spec!.targetPath,
      date: "2026-07-08",
      time: "23:40",
      executor: spec!.executor,
    });

    expect(recorded.ok).toBe(true);
    expect(recorded.content).toMatch(
      /\*\*模型执行结果\*\*：✅ 已执行（2026-07-08 23:40，mock-model-file-append）/
    );
    expect(recorded.content).toMatch(
      /\*\*模型执行目标\*\*：System\/pending-approvals\/model-executor-test\.md/
    );
    expect(recorded.content).toMatch(
      /\*\*执行结果\*\*：✅ 已批准并完成模型执行测试。/
    );
  });
});
