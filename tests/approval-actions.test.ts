import { describe, it, expect } from "vitest";
import {
  applyPendingApprovalDecision,
  isPendingApprovalStatusLine,
} from "../src/approval-actions";

const fixture = `# 待审批变更

## 当前待审批

### #QA-B 测试审批 [2026-07-08]

**状态**：待审批

**变更内容**：验证界面按钮能否写回审批决策。

**回滚方案**：必要时手动恢复 \`**状态**：待审批\`。

### #KEEP-B 另一条 [2026-07-08]

**状态**：待审批

**变更内容**：用于确认只修改目标块。

## 已解决
`;

function pendingCount(content: string): number {
  const section = content.match(
    /## 当前待审批([\s\S]*?)(?:\n### 后续候选|\n## 保留观察项|\n## 已解决|$)/
  )?.[1] ?? "";
  return section.split("\n").filter(isPendingApprovalStatusLine).length;
}

describe("isPendingApprovalStatusLine", () => {
  it("识别全角冒号的待审批状态行", () => {
    expect(isPendingApprovalStatusLine("**状态**：待审批")).toBe(true);
  });

  it("识别半角冒号的待审批状态行", () => {
    expect(isPendingApprovalStatusLine("**状态**: 待审批")).toBe(true);
  });

  it("不误判回滚方案里提到的状态行", () => {
    expect(
      isPendingApprovalStatusLine("**回滚方案**：恢复 `**状态**：待审批`。")
    ).toBe(false);
  });

  it("不误判被反引号包裹的状态行", () => {
    expect(isPendingApprovalStatusLine("`**状态**：待审批`")).toBe(false);
  });
});

describe("applyPendingApprovalDecision", () => {
  it("批准：写回批准状态、执行结果、界面操作，并从待审批移除", () => {
    const approved = applyPendingApprovalDecision(fixture, {
      title: "#QA-B 测试审批 [2026-07-08]",
      decision: "approve",
      date: "2026-07-08",
      operator: "Haaper",
    });

    expect(approved.ok).toBe(true);
    expect(approved.removedFromPending).toBe(true);
    expect(approved.content).toMatch(
      /\*\*状态\*\*：✅ 已批准（2026-07-08，界面按钮）/
    );
    expect(approved.content).toMatch(
      /\*\*执行结果\*\*：🟡 已记录审批决策，具体变更尚未执行。/
    );
    expect(approved.content).toMatch(
      /\*\*界面操作\*\*：2026-07-08 Haaper 点击「批准」。/
    );
    // 只移除目标项，不影响其他待审批项
    expect(approved.content).toMatch(
      /### #KEEP-B 另一条 \[2026-07-08\][\s\S]*\*\*状态\*\*：待审批/
    );
    expect(pendingCount(approved.content)).toBe(1);
  });

  it("拒绝：写回拒绝状态和未执行说明", () => {
    const rejected = applyPendingApprovalDecision(fixture, {
      title: "#QA-B 测试审批 [2026-07-08]",
      decision: "reject",
      date: "2026-07-08",
    });

    expect(rejected.ok).toBe(true);
    expect(rejected.content).toMatch(
      /\*\*状态\*\*：❌ 已拒绝（2026-07-08，界面按钮）/
    );
    expect(rejected.content).toMatch(
      /\*\*执行结果\*\*：❌ 已拒绝，未执行提案内容。/
    );
    expect(rejected.content).toMatch(
      /\*\*界面操作\*\*：2026-07-08 点击「拒绝」。/
    );
    expect(pendingCount(rejected.content)).toBe(1);
  });

  it("未找到审批项时返回失败且不改内容", () => {
    const missing = applyPendingApprovalDecision(fixture, {
      title: "#MISSING-B 不存在",
      decision: "approve",
      date: "2026-07-08",
    });

    expect(missing.ok).toBe(false);
    expect(missing.content).toBe(fixture);
    expect(missing.message).toMatch(/未找到审批项/);
  });

  it("缺少状态行时返回失败", () => {
    const withoutStatus = fixture.replace(
      "**状态**：待审批",
      "**状态丢失**：待审批"
    );
    const invalid = applyPendingApprovalDecision(withoutStatus, {
      title: "#QA-B 测试审批 [2026-07-08]",
      decision: "approve",
      date: "2026-07-08",
    });

    expect(invalid.ok).toBe(false);
    expect(invalid.content).toBe(withoutStatus);
    expect(invalid.message).toMatch(/缺少状态行/);
  });
});
