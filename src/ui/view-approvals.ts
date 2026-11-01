// TALOS 控制台审批与候选决策区；由 TalosView 委托调用。
import type { Collected } from "./talos-view-model";
import type { SignalItem } from "../types";
import { decidePendingApproval, decidePreferenceCandidate, openFile } from "../actions";
import { setIcon } from "obsidian";
import type { TalosView } from "../view";

export function renderApprovalSide(view: TalosView): void {
	view.approvalSideEl.empty();
	const d = view.data;
	if (!d) return;
	// 格式未识别时解析结果可能只是部分条目，不能显示为完整待审批数量。
	if (d.setup?.pendingApprovalsPath !== "ok") {
		view.approvalCardEl.toggleClass("is-hidden", false);
		view.approvalSideEl.createDiv({ cls: "approval-summary", text: "审批来源未就绪，请检查" });
		const open = view.approvalSideEl.createEl("button", { cls: "approval-feedback-open", text: "前往待决策" });
		open.type = "button";
		open.addEventListener("click", () => view.openDecisions());
		return;
	}
	view.approvalCardEl.toggleClass("is-hidden", d.approvals.length === 0);
	if (d.approvals.length === 0) return;
	view.approvalSideEl.createDiv({ cls: "approval-summary", text: `${d.approvals.length} 项变更等待决策` });
	const open = view.approvalSideEl.createEl("button", { cls: "approval-feedback-open", text: "前往待决策" });
	open.type = "button";
	open.addEventListener("click", () => view.openDecisions());
}

export function renderApprovalItem(view: TalosView, parent: HTMLElement, it: SignalItem): void {
	const item = parent.createDiv({ cls: "item approval-item" });
	item.createSpan({ cls: "badge", text: "!" });
	item.createEl("span", { cls: "approval-title", text: it.title });
	if (it.path) {
		item.addEventListener("click", () => void openFile(view.app, it.path || ""));
	}

	const actions = item.createDiv({ cls: "approval-actions" });
	createApprovalActionButton(view, actions, "approve", "check", "批准", it);
	createApprovalActionButton(view, actions, "reject", "x", "拒绝", it);
}

export function renderCandidateItem(view: TalosView, parent: HTMLElement, it: SignalItem): void {
	const item = parent.createDiv({ cls: "item approval-item candidate-approval-item" });
	item.createSpan({ cls: "badge candidate-badge", text: "偏" });
	item.createEl("span", { cls: "approval-title", text: it.title });
	if (it.path) {
		item.addEventListener("click", () => void openFile(view.app, it.path || ""));
	}

	const actions = item.createDiv({ cls: "approval-actions" });
	createCandidateActionButton(view, actions, "approve", "check", "批准", it);
	createCandidateActionButton(view, actions, "reject", "x", "拒绝", it);
}

export function renderDecisionWorkspace(view: TalosView, parent: HTMLElement, d: Collected, limit = 2): void {
	parent.addClass("talos-decision-workspace");
	parent.addClass("overview-v2-approval-panel");
	const approvalStatus = d.setup?.pendingApprovalsPath;
	const candidateStatus = d.setup?.candidatesPath;
	const sourceMessage = (status: typeof approvalStatus): string => status === "missing"
		? "来源文件未找到，请在设置中检查。"
		: status === "format" ? "来源文件格式待检查。" : "来源状态尚未核对。";
	const renderSourceHelp = (host: HTMLElement, status: typeof approvalStatus, path: string, label: string): void => {
		host.createDiv({ cls: "empty", text: sourceMessage(status) });
		const canOpen = status === "format" && Boolean(path.trim());
		const button = host.createEl("button", {
			cls: "approval-feedback-open",
			text: canOpen ? `打开${label}来源` : "检查数据来源设置",
			attr: { type: "button" },
		});
		button.addEventListener("click", () => {
			if (canOpen) void openFile(view.app, path);
			else view.navigateToPage("settings");
		});
	};

	const pendingGroup = parent.createDiv({
		cls: "talos-decision-group overview-v2-approval-group overview-pending-panel",
	});
	const pendingHead = pendingGroup.createDiv({
		cls: "talos-decision-group__head overview-v2-approval-group__head",
	});
	pendingHead.createEl("strong", { text: "变更审批" });
	pendingHead.createSpan({ text: approvalStatus === "ok" ? String(d.approvals.length) : "—" });
	const pendingList = pendingGroup.createDiv({
		cls: "approval talos-decision-list overview-approval-list",
	});
	renderApprovalFeedback(view, pendingList);
	if (approvalStatus === "ok") for (const item of d.approvals.slice(0, limit)) {
		renderApprovalItem(view, pendingList, item);
	}
	if (approvalStatus !== "ok") {
		renderSourceHelp(pendingList, approvalStatus, view.plugin.talosSettings.pendingApprovalsPath, "审批");
	} else if (d.approvals.length === 0) {
		pendingList.createDiv({
			cls: "ok",
			text: "当前没有待审批变更",
		});
	}

	const preferenceGroup = parent.createDiv({
		cls: "talos-decision-group overview-v2-approval-group overview-preference-panel",
	});
	const preferenceHead = preferenceGroup.createDiv({
		cls: "talos-decision-group__head overview-v2-approval-group__head",
	});
	preferenceHead.createEl("strong", { text: "偏好确认" });
	preferenceHead.createSpan({ text: candidateStatus === "ok" ? String(d.candidates.length) : "—" });
	const preferenceList = preferenceGroup.createDiv({
		cls: "approval talos-decision-list overview-approval-list",
	});
	renderCandidateFeedback(view, preferenceList);
	if (candidateStatus === "ok") for (const item of d.candidates.slice(0, limit)) {
		renderCandidateItem(view, preferenceList, item);
	}
	if (candidateStatus !== "ok") {
		renderSourceHelp(preferenceList, candidateStatus, view.plugin.talosSettings.candidatesPath, "偏好");
	} else if (d.candidates.length === 0) {
		preferenceList.createDiv({
			cls: "ok",
			text: "当前没有待确认偏好",
		});
	}
}

export function createCandidateActionButton(view: TalosView, parent: HTMLElement, decision: "approve" | "reject", iconName: string, label: string, it: SignalItem): void {
	const button = parent.createEl("button", {
		cls: `approval-action approval-action-${decision}`,
	});
	button.type = "button";
	button.setAttribute("aria-label", `${label}偏好候选：${it.title}`);
	const icon = button.createSpan({ cls: "approval-action-icon" });
	setIcon(icon, iconName);
	button.createSpan({ cls: "approval-action-label", text: label });
	button.addEventListener("click", (event) => {
		void (async () => {
			event.preventDefault();
			event.stopPropagation();
			const siblingButtons = Array.from(
				parent.querySelectorAll<HTMLButtonElement>(".approval-action")
			);
			for (const btn of siblingButtons) btn.disabled = true;
			button.addClass("is-loading");
			const ok = await decidePreferenceCandidate(
				view.app,
				view.plugin.talosSettings,
				it.title,
				decision
			);
			if (ok) {
				view.lastCandidateFeedback = {
					title: it.title,
					decision,
					path: it.path,
					at: view.shortTime(),
				};
				await view.refresh();
			} else {
				button.removeClass("is-loading");
				for (const btn of siblingButtons) btn.disabled = false;
			}
		})();
	});
}

export function createApprovalActionButton(view: TalosView, parent: HTMLElement, decision: "approve" | "reject", iconName: string, label: string, it: SignalItem): void {
	const button = parent.createEl("button", {
		cls: `approval-action approval-action-${decision}`,
	});
	button.type = "button";
	button.setAttribute("aria-label", `${label}：${it.title}`);
	const icon = button.createSpan({ cls: "approval-action-icon" });
	setIcon(icon, iconName);
	button.createSpan({ cls: "approval-action-label", text: label });
	button.addEventListener("click", (event) => {
		void (async () => {
			event.preventDefault();
			event.stopPropagation();
			const siblingButtons = Array.from(
				parent.querySelectorAll<HTMLButtonElement>(".approval-action")
			);
			for (const btn of siblingButtons) btn.disabled = true;
			button.addClass("is-loading");
			const ok = await decidePendingApproval(
				view.app,
				view.plugin.talosSettings,
				it.title,
				decision
			);
			if (ok) {
				view.lastApprovalFeedback = {
					title: it.title,
					decision,
					path: it.path,
					at: view.shortTime(),
				};
				await view.refresh();
			} else {
				button.removeClass("is-loading");
				for (const btn of siblingButtons) btn.disabled = false;
			}
		})();
	});
}

export function renderApprovalFeedback(view: TalosView, parent: HTMLElement): void {
	if (!view.lastApprovalFeedback) return;
	const feedback = view.lastApprovalFeedback;
	const approved = feedback.decision === "approve";
	const executed = feedback.decision === "execute";
	const box = parent.createDiv({
		cls: `approval-feedback ${approved || executed ? "is-approved" : "is-rejected"}`,
	});
	const icon = box.createSpan({ cls: "approval-feedback-icon" });
	setIcon(icon, executed ? "bot" : approved ? "check-circle-2" : "x-circle");
	const copy = box.createDiv({ cls: "approval-feedback-copy" });
	copy.createEl("b", {
		text: executed
			? "已批准并完成模型执行测试"
			: approved
				? "已批准，审批记录已写回"
				: "已拒绝，审批记录已写回",
	});
	copy.createEl("span", { text: feedback.title });
	copy.createEl("small", {
		text: executed
			? `${feedback.at} · 已写回目标文件，并更新审批执行记录。`
			: approved
			? `${feedback.at} · 只记录审批决策，实际变更尚未执行。`
			: `${feedback.at} · 已记录拒绝，提案内容未执行。`,
	});
	const open = box.createEl("button", { cls: "approval-feedback-open", text: "打开记录" });
	open.type = "button";
	open.addEventListener("click", (event) => {
		event.stopPropagation();
		void openFile(view.app, feedback.path || view.plugin.talosSettings.pendingApprovalsPath);
	});
}

export function renderCandidateFeedback(view: TalosView, parent: HTMLElement): void {
	if (!view.lastCandidateFeedback) return;
	const feedback = view.lastCandidateFeedback;
	const approved = feedback.decision === "approve";
	const box = parent.createDiv({
		cls: `approval-feedback ${approved ? "is-approved" : "is-rejected"}`,
	});
	const icon = box.createSpan({ cls: "approval-feedback-icon" });
	setIcon(icon, approved ? "check-circle-2" : "x-circle");
	const copy = box.createDiv({ cls: "approval-feedback-copy" });
	copy.createEl("b", {
		text: approved ? "已批准并移入已确认" : "已拒绝并移入已拒绝",
	});
	copy.createEl("span", { text: feedback.title });
	copy.createEl("small", {
		text: `${feedback.at} · 决策已写回偏好候选池。`,
	});
	const open = box.createEl("button", { cls: "approval-feedback-open", text: "打开记录" });
	open.type = "button";
	open.addEventListener("click", (event) => {
		event.stopPropagation();
		void openFile(view.app, feedback.path || view.plugin.talosSettings.candidatesPath);
	});
}
