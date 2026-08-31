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
    const result = evaluateQuyuanGovernance(
      request({ toolName: "Read", input: { file_path: "02-洞察/安全.md" } })
    );
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("只读操作");
  });

  it("Glob 放行", () => {
    const result = evaluateQuyuanGovernance(
      request({ toolName: "Glob", input: { path: "02-洞察" } })
    );
    expect(result.decision).toBe("allow");
  });

  it.each(["Glob", "Grep", "Search"])(
    "%s 把 Vault 根目录作为显式只读作用域时放行",
    (toolName) => {
      const result = evaluateQuyuanGovernance(
        request({ toolName, input: { path: "." } })
      );
      expect(result).toMatchObject({
        decision: "allow",
        reason: "只读操作",
      });
    }
  );

  it("Read 不把 Vault 根目录当作文件读取目标", () => {
    const result = evaluateQuyuanGovernance(
      request({ toolName: "Read", input: { path: "." } })
    );
    expect(result.decision).toBe("deny");
  });

  it("未分类工具不能伪装成 A 类只读并自动放行", () => {
    const result = evaluateQuyuanGovernance(
      request({ toolName: "ExecuteUnknown", input: {} })
    );
    expect(result.decision).toBe("ask");
    expect(result.reason).toMatch(/未分类工具/);
  });

  it.each([
    ["Read", { file_path: ".TALOS/PRIVATE/provider.json" }],
    ["Glob", { pattern: ".talos/private/**" }],
    ["Grep", { path: "safe/../.talos/private" }],
    ["Search", {}],
  ])("%s 对永久禁区或未分类目标失败关闭", (toolName, input) => {
    const result = evaluateQuyuanGovernance(request({ toolName, input }));
    expect(result.decision).toBe("deny");
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

  it("多文件变更逐目录要求 README，且全部读过后才进入审批", () => {
    const input = {
      changes: [
        { path: "02-洞察/a.md" },
        { path: "03-项目/b.md" },
      ],
    };
    const missing = evaluateQuyuanGovernance(request({
      toolName: "apply_patch",
      input,
      readPaths: new Set(["02-洞察/_README.md"]),
    }));
    expect(missing).toMatchObject({
      decision: "deny",
      requiredReads: ["03-项目/_README.md"],
    });

    const ready = evaluateQuyuanGovernance(request({
      toolName: "apply_patch",
      input,
      readPaths: new Set([
        "02-洞察/_README.md",
        "03-项目/_README.md",
      ]),
    }));
    expect(ready.decision).toBe("ask");
  });

  it("结构化 fileChange 中任一永久禁区目标都会拒绝整批变更", () => {
    const result = evaluateQuyuanGovernance(request({
      toolName: "apply_patch",
      input: {
        changes: [
          { path: "02-洞察/a.md" },
          { path: ".TALOS/PRIVATE/provider.json" },
        ],
      },
      readPaths: new Set(["02-洞察/_README.md"]),
    }));
    expect(result.decision).toBe("deny");
    expect(result.reason).toMatch(/永久禁区/);
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

  it("小写 mutation 工具名不能伪装成只读操作", () => {
    const result = evaluateQuyuanGovernance(
      request({
        toolName: "write",
        readPaths: new Set(["02-洞察/_README.md"]),
      })
    );
    expect(result.decision).toBe("ask");
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
