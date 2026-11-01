import { beforeEach, describe, expect, it, vi } from "vitest";
import { createObsidianHost } from "./helpers/obsidian-dom";
import type { Collected } from "../src/ui/talos-view-model";
import type { TalosView } from "../src/view";

const actions = vi.hoisted(() => ({ approval: vi.fn(async () => true), candidate: vi.fn(async () => true) }));
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../src/actions", () => ({ decidePendingApproval: actions.approval, decidePreferenceCandidate: actions.candidate, openFile: vi.fn() }));
import { renderApprovalSide, renderDecisionWorkspace } from "../src/ui/view-approvals";
import { openFile } from "../src/actions";

function makeView() {
	return { app: {}, plugin: { talosSettings: { pendingApprovalsPath: "approval.md", candidatesPath: "candidates.md" } }, navigateToPage: vi.fn(), refresh: vi.fn(async () => {}), shortTime: () => "now" } as unknown as TalosView;
}
function data(approval: "ok" | "missing" | "format", candidate: "ok" | "missing" | "format"): Collected {
	return { setup: { pendingApprovalsPath: approval, candidatesPath: candidate }, approvals: [{ title: "变更一", path: "approval.md" }], candidates: [{ title: "偏好一", path: "candidates.md" }] } as unknown as Collected;
}

describe("独立的决策来源状态", () => {
	beforeEach(() => { actions.approval.mockClear(); actions.candidate.mockClear(); vi.mocked(openFile).mockClear(); });
	it("审批来源缺失时仍可处理有效偏好", async () => {
		const { host, element } = createObsidianHost();
		renderDecisionWorkspace(makeView(), host, data("missing", "ok"));
		expect(element.one("overview-pending-panel").textContent).toContain("来源文件未找到");
		expect(element.one("overview-pending-panel").all("approval-action")).toHaveLength(0);
		const preference = element.one("overview-preference-panel");
		expect(preference.textContent).toContain("偏好一");
		preference.all("approval-action")[0].click();
		await vi.waitFor(() => expect(actions.candidate).toHaveBeenCalledWith(expect.anything(), expect.anything(), "偏好一", "approve"));
	});
	it("偏好来源格式异常时仍可处理有效审批", async () => {
		const { host, element } = createObsidianHost();
		renderDecisionWorkspace(makeView(), host, data("ok", "format"));
		expect(element.one("overview-preference-panel").textContent).toContain("格式待检查");
		expect(element.one("overview-preference-panel").all("approval-action")).toHaveLength(0);
		const pending = element.one("overview-pending-panel");
		expect(pending.textContent).toContain("变更一");
		pending.all("approval-action")[0].click();
		await vi.waitFor(() => expect(actions.approval).toHaveBeenCalledWith(expect.anything(), expect.anything(), "变更一", "approve"));
	});
	it("来源状态未知时不把缺数据呈现为零项", () => {
		const { host, element } = createObsidianHost();
		renderDecisionWorkspace(makeView(), host, { approvals: [], candidates: [] } as unknown as Collected);
		expect(element.textContent).toContain("来源状态尚未核对");
		expect(element.textContent).not.toContain("当前没有待审批变更");
	});
	it("格式待检查时可分别打开原文件", () => {
		const { host, element } = createObsidianHost(); const view = makeView();
		renderDecisionWorkspace(view, host, data("format", "format"));
		const approval = element.one("overview-pending-panel").one("approval-feedback-open");
		const preference = element.one("overview-preference-panel").one("approval-feedback-open");
		expect(approval.textContent).toBe("打开审批来源"); expect(preference.textContent).toBe("打开偏好来源");
		approval.click(); preference.click();
		expect(vi.mocked(openFile).mock.calls).toEqual([[view.app, "approval.md"], [view.app, "candidates.md"]]);
	});
	it("来源缺失时引导检查设置而不伪装为可打开的文件", () => {
		const { host, element } = createObsidianHost(); const view = makeView();
		const navigate = vi.spyOn(view, "navigateToPage");
		renderDecisionWorkspace(view, host, data("missing", "ok"));
		const button = element.one("overview-pending-panel").one("approval-feedback-open");
		expect(button.textContent).toBe("检查数据来源设置"); button.click();
		expect(navigate).toHaveBeenCalledWith("settings");
		expect(openFile).not.toHaveBeenCalled();
	});
	it("侧栏不会把格式不完整时解析到的部分条目称作完整待审批数量", () => {
		const side = createObsidianHost(); const card = createObsidianHost();
		const open = vi.fn();
		const view = { approvalSideEl: side.host, approvalCardEl: card.host, data: data("format", "ok"), openDecisions: open } as unknown as TalosView;
		renderApprovalSide(view);
		expect(side.element.textContent).toContain("审批来源未就绪");
		expect(side.element.textContent).not.toContain("1 项变更等待决策");
		side.element.one("approval-feedback-open").click(); expect(open).toHaveBeenCalledOnce();
	});
});
