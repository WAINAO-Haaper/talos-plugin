// TALOS 控制台审批与候选决策区；由 TalosView 委托调用。
import type { Collected } from "./talos-view-model";
import type { SignalItem } from "../types";
import { approveAndExecuteApprovalWithMockModel, decidePendingApproval, decidePreferenceCandidate, openFile } from "../actions";
import { setIcon } from "obsidian";
import type { TalosView } from "../view";

export function renderApprovalSide(view: TalosView): void {
	view.approvalSideEl.empty();
	const d = view.data;
	if (!d) return;
	view.approvalCardEl.toggleClass("is-hidden", d.approvals.length === 0);
	if (d.approvals.length === 0) return;
	for (const it of d.approvals.slice(0, 5)) {
		renderApprovalItem(view, view.approvalSideEl, it);
	}
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
	createApprovalExecuteButton(view, actions, it);
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

	const pendingGroup = parent.createDiv({
		cls: "talos-decision-group overview-v2-approval-group overview-pending-panel",
	});
	const pendingHead = pendingGroup.createDiv({
		cls: "talos-decision-group__head overview-v2-approval-group__head",
	});
	pendingHead.createEl("strong", { text: "变更审批" });
	pendingHead.createSpan({ text: String(d.approvals.length) });
	const pendingList = pendingGroup.createDiv({
		cls: "approval talos-decision-list overview-approval-list",
	});
	renderApprovalFeedback(view, pendingList);
	for (const item of d.approvals.slice(0, limit)) {
		renderApprovalItem(view, pendingList, item);
	}
	if (d.approvals.length === 0) {
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
	preferenceHead.createSpan({ text: String(d.candidates.length) });
	const preferenceList = preferenceGroup.createDiv({
		cls: "approval talos-decision-list overview-approval-list",
	});
	renderCandidateFeedback(view, preferenceList);
	for (const item of d.candidates.slice(0, limit)) {
		renderCandidateItem(view, preferenceList, item);
	}
	if (d.candidates.length === 0) {
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

export function createApprovalExecuteButton(view: TalosView, parent: HTMLElement, it: SignalItem): void {
	const button = parent.createEl("button", {
		cls: "approval-action approval-action-execute",
	});
	button.type = "button";
	button.setAttribute("aria-label", `批准并模型执行：${it.title}`);
	const icon = button.createSpan({ cls: "approval-action-icon" });
	setIcon(icon, "bot");
	button.createSpan({ cls: "approval-action-label", text: "批准+模型" });
	button.addEventListener("click", (event) => {
		void (async () => {
			event.preventDefault();
			event.stopPropagation();
			const siblingButtons = Array.from(
				parent.querySelectorAll<HTMLButtonElement>(".approval-action")
			);
			for (const btn of siblingButtons) btn.disabled = true;
			button.addClass("is-loading");
			const ok = await approveAndExecuteApprovalWithMockModel(
				view.app,
				view.plugin.talosSettings,
				it.title
			);
			if (ok) {
				view.lastApprovalFeedback = {
					title: it.title,
					decision: "execute",
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
