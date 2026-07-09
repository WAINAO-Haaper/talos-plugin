import { describe, it, expect } from "vitest";
import {
  evaluateQuyuanGovernance,
  type QuyuanToolRequest,
} from "../src/quyuan/governance";
import {
  checkQuyuanCapabilityContract,
  QUYUAN_REQUIRED_CAPABILITIES,
} from "../src/quyuan/contract";

function request(overrides: Partial<QuyuanToolRequest> = {}): QuyuanToolRequest {
  return {
    toolName: "Edit",
    input: { file_path: "02-洞察/测试.md" },
    readPaths: new Set(),
    ...overrides,
  };
}

describe("evaluateQuyuanGovernance — 只读操作", () => {
  it("Read 放行", () => {
    const result = evaluateQuyuanGovernance(request({ toolName: "Read", input: {} }));
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("只读操作");
  });

  it("Glob 放行", () => {
    const result = evaluateQuyuanGovernance(request({ toolName: "Glob", input: {} }));
    expect(result.decision).toBe("allow");
  });
});

describe("evaluateQuyuanGovernance — 写操作必须先读 _README.md", () => {
  it("未读目标目录 _README.md 时 deny", () => {
    const result = evaluateQuyuanGovernance(request());
    expect(result.decision).toBe("deny");
    expect(result.requiredReads).toEqual(["02-洞察/_README.md"]);
  });

  it("已读 _README.md 但未审批时 ask", () => {
    const result = evaluateQuyuanGovernance(
      request({ readPaths: new Set(["02-洞察/_README.md"]) })
    );
    expect(result.decision).toBe("ask");
  });

  it("已读 _README.md 且已审批时 allow", () => {
    const result = evaluateQuyuanGovernance(
      request({
        readPaths: new Set(["02-洞察/_README.md"]),
        approvalGranted: true,
      })
    );
    expect(result.decision).toBe("allow");
  });

  it("路径规范化：反斜杠和 ./ 前缀都能匹配", () => {
    const result = evaluateQuyuanGovernance(
      request({
        input: { file_path: "./02-洞察\\测试.md" },
        readPaths: new Set(["02-洞察/_README.md"]),
      })
    );
    expect(result.decision).toBe("ask");
  });
});

describe("evaluateQuyuanGovernance — 危险操作", () => {
  it("Bash 未审批时 ask", () => {
    const result = evaluateQuyuanGovernance(
      request({ toolName: "Bash", input: { command: "ls" } })
    );
    expect(result.decision).toBe("ask");
  });

  it("Delete 未审批时 ask", () => {
    const result = evaluateQuyuanGovernance(
      request({ toolName: "Delete", input: { file_path: "test.md" } })
    );
    expect(result.decision).toBe("ask");
  });

  it("写操作缺少目标路径时 deny（非 Bash）", () => {
    const result = evaluateQuyuanGovernance(
      request({ toolName: "Write", input: {} })
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/缺少可验证的目标路径/);
  });
});

describe("evaluateQuyuanGovernance — 身份硬闸", () => {
  it("禁止直接写 PROFILE.md", () => {
    const result = evaluateQuyuanGovernance(
      request({
        input: { file_path: "Identity/PROFILE.md" },
        readPaths: new Set(["Identity/_README.md"]),
      })
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/候选池.*\/digest/);
  });

  it("Identity/ 下的文件必须走 identity-change 审批", () => {
    const result = evaluateQuyuanGovernance(
      request({
        input: { file_path: "Identity/CONTEXT.md" },
        readPaths: new Set(["Identity/_README.md"]),
      })
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/B 类审批/);
  });

  it("Identity/ 文件经 identity-change 审批后 allow", () => {
    const result = evaluateQuyuanGovernance(
      request({
        input: { file_path: "Identity/CONTEXT.md" },
        readPaths: new Set(["Identity/_README.md"]),
        approvalGranted: true,
        approvedWorkflow: "identity-change",
      })
    );
    expect(result.decision).toBe("allow");
  });

  it("灵魂/ 文件必须走 persona-change 审批", () => {
    const result = evaluateQuyuanGovernance(
      request({
        input: { file_path: "灵魂/PERSONA.md" },
        readPaths: new Set(["灵魂/_README.md"]),
      })
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/B 类审批/);
  });
});

describe("evaluateQuyuanGovernance — inline-edit", () => {
  it("已读 _README.md 且已审批时 allow", () => {
    const result = evaluateQuyuanGovernance(
      request({
        toolName: "inline-edit",
        input: { file_path: "02-洞察/测试.md" },
        readPaths: new Set(["02-洞察/_README.md"]),
        approvalGranted: true,
      })
    );
    expect(result.decision).toBe("allow");
  });
});

describe("checkQuyuanCapabilityContract", () => {
  it("全部必需能力都满足时 ok", () => {
    const all = new Set([...QUYUAN_REQUIRED_CAPABILITIES, "rewind"]);
    const result = checkQuyuanCapabilityContract({
      provider: "claude",
      supported: all,
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("缺少必需能力时不 ok", () => {
    const partial = new Set(QUYUAN_REQUIRED_CAPABILITIES);
    partial.delete("stream");
    const result = checkQuyuanCapabilityContract({
      provider: "claude",
      supported: partial,
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("stream");
  });
});
