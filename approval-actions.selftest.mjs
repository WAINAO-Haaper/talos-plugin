import assert from "node:assert/strict";
import {
	applyPendingApprovalDecision,
	isPendingApprovalStatusLine,
} from "./src/approval-actions.ts";

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

function pendingCount(content) {
	const section = content.match(
		/## 当前待审批([\s\S]*?)(?:\n### 后续候选|\n## 保留观察项|\n## 已解决|$)/
	)?.[1] ?? "";
	return section.split("\n").filter(isPendingApprovalStatusLine).length;
}

assert.equal(isPendingApprovalStatusLine("**状态**：待审批"), true);
assert.equal(isPendingApprovalStatusLine("**状态**: 待审批"), true);
assert.equal(isPendingApprovalStatusLine("**回滚方案**：恢复 `**状态**：待审批`。"), false);
assert.equal(isPendingApprovalStatusLine("`**状态**：待审批`"), false);

const approved = applyPendingApprovalDecision(fixture, {
	title: "#QA-B 测试审批 [2026-07-08]",
	decision: "approve",
	date: "2026-07-08",
	operator: "Haaper",
});

assert.equal(approved.ok, true);
assert.equal(approved.removedFromPending, true);
assert.match(
	approved.content,
	/\*\*状态\*\*：✅ 已批准（2026-07-08，界面按钮）/
);
assert.match(
	approved.content,
	/\*\*执行结果\*\*：🟡 已记录审批决策，具体变更尚未执行。/
);
assert.match(
	approved.content,
	/\*\*界面操作\*\*：2026-07-08 Haaper 点击「批准」。/
);
assert.match(
	approved.content,
	/### #KEEP-B 另一条 \[2026-07-08\][\s\S]*\*\*状态\*\*：待审批/
);
assert.equal(pendingCount(approved.content), 1);

const rejected = applyPendingApprovalDecision(fixture, {
	title: "#QA-B 测试审批 [2026-07-08]",
	decision: "reject",
	date: "2026-07-08",
});

assert.equal(rejected.ok, true);
assert.match(
	rejected.content,
	/\*\*状态\*\*：❌ 已拒绝（2026-07-08，界面按钮）/
);
assert.match(rejected.content, /\*\*执行结果\*\*：❌ 已拒绝，未执行提案内容。/);
assert.match(rejected.content, /\*\*界面操作\*\*：2026-07-08 点击「拒绝」。/);
assert.equal(pendingCount(rejected.content), 1);

const missing = applyPendingApprovalDecision(fixture, {
	title: "#MISSING-B 不存在",
	decision: "approve",
	date: "2026-07-08",
});

assert.equal(missing.ok, false);
assert.equal(missing.content, fixture);
assert.match(missing.message, /未找到审批项/);

const withoutStatus = fixture.replace("**状态**：待审批", "**状态丢失**：待审批");
const invalid = applyPendingApprovalDecision(withoutStatus, {
	title: "#QA-B 测试审批 [2026-07-08]",
	decision: "approve",
	date: "2026-07-08",
});

assert.equal(invalid.ok, false);
assert.equal(invalid.content, withoutStatus);
assert.match(invalid.message, /缺少状态行/);

console.log("approval action selftest passed");
