import { describe, expect, it } from "vitest";
import { applyCandidateDecision } from "../src/candidate-actions";

const longCandidate =
  "长标题候选：在跨平台发布时保留完整来源、日期与处理上下文，不能依赖界面的七十字截断，否则批准时无法准确写回原始候选条目";

const fixture = `# 偏好候选

## 待确认

- 喜欢结论先行，正文使用短段落
- ${longCandidate}

## 已确认

- 已有稳定偏好
`;

function section(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const next = lines.findIndex(
    (line, index) => index > start && /^##\s+/.test(line.trim())
  );
  return lines.slice(start + 1, next >= 0 ? next : lines.length).join("\n");
}

describe("applyCandidateDecision", () => {
  it("批准后从待确认移入已有的已确认分区并记录界面操作", () => {
    const result = applyCandidateDecision(fixture, {
      title: "喜欢结论先行，正文使用短段落",
      decision: "approve",
      date: "2026-07-22",
      operator: "TALOS",
    });

    expect(result.ok).toBe(true);
    expect(result.removedFromPending).toBe(true);
    expect(result.message).toContain("已批准");
    expect(section(result.content, "待确认")).not.toContain(
      "- 喜欢结论先行，正文使用短段落"
    );
    expect(section(result.content, "已确认")).toMatch(
      /- 喜欢结论先行，正文使用短段落\n {2}- \*\*界面操作\*\*：2026-07-22 TALOS 点击「批准」。/
    );
    expect(result.content).toContain(`- ${longCandidate}`);
  });

  it("拒绝后创建已拒绝分区并记录界面操作", () => {
    const result = applyCandidateDecision(fixture, {
      title: longCandidate,
      decision: "reject",
      date: "2026-07-22",
    });

    expect(result.ok).toBe(true);
    expect(result.content).toMatch(
      new RegExp(
        `## 已拒绝[\\s\\S]*?- ${longCandidate}[\\s\\S]*?2026-07-22 点击「拒绝」\\。`
      )
    );
    expect(section(result.content, "待确认")).not.toContain(`- ${longCandidate}`);
  });

  it("长标题使用完整文本精确匹配，不依赖七十字截断", () => {
    const result = applyCandidateDecision(fixture, {
      title: longCandidate,
      decision: "approve",
      date: "2026-07-22",
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain(`- ${longCandidate}`);
  });

  it("找不到候选时返回失败且不改变原文", () => {
    const result = applyCandidateDecision(fixture, {
      title: "不存在的候选",
      decision: "approve",
      date: "2026-07-22",
    });

    expect(result.ok).toBe(false);
    expect(result.removedFromPending).toBe(false);
    expect(result.content).toBe(fixture);
    expect(result.message).toContain("未找到偏好候选");
  });

  it("缺少待确认分区时返回失败且不改变原文", () => {
    const content = "# 偏好候选\n\n## 已确认\n\n- 已有稳定偏好\n";
    const result = applyCandidateDecision(content, {
      title: "喜欢结论先行，正文使用短段落",
      decision: "approve",
      date: "2026-07-22",
    });

    expect(result.ok).toBe(false);
    expect(result.content).toBe(content);
    expect(result.message).toContain("未找到「待确认」分区");
  });

  it("空标题时返回失败且不改变原文", () => {
    const result = applyCandidateDecision(fixture, {
      title: "   ",
      decision: "reject",
      date: "2026-07-22",
    });

    expect(result.ok).toBe(false);
    expect(result.content).toBe(fixture);
    expect(result.message).toContain("缺少偏好候选标题");
  });
});
