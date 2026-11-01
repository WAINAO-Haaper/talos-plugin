// 「今日」页的重要事项收集与行渲染；由今日页、导航计数与审批区复用。
import type { Collected, OverviewAttention } from "../talos-view-model";
import { openFile } from "../../actions";
import { setIcon } from "obsidian";
import type { TalosView } from "../../view";

export function collectOverviewAttention(view: TalosView, d: Collected): OverviewAttention[] {
	const items: OverviewAttention[] = [];
	if (d.setup?.pendingApprovalsPath === "ok" && d.approvals.length > 0) {
		items.push({
			title: `待审批变更 ${d.approvals.length} 项`,
			meta: `${d.approvals[0]?.title || "B/C 类变更"} · 需要决策`,
			detail:
				"这些变更不会自动执行。先处理会阻塞当前工作流或影响身份、规则与系统结构的提案。",
			action: "去待决策处理",
			path: view.plugin.talosSettings.pendingApprovalsPath,
			icon: "clipboard-check",
			tone: "warn",
			target: "decisions",
		});
	}
	if (d.inbox.count > 0) {
		items.push({
			title: `收件箱积压 ${d.inbox.count} 篇`,
			meta: `最老 ${d.inbox.oldestDays} 天 · 建议运行 /intake`,
			detail:
				"优先处理长期滞留条目，避免收件箱变成第二个无人维护的知识库。",
			action: "打开收件箱",
			path: view.paths.readme("inbox"),
			icon: "inbox",
			tone: d.inbox.oldestDays >= 7 ? "hot" : "warn",
		});
	}
	if (d.setup?.candidatesPath === "ok" && d.candidates.length > 0) {
		items.push({
			title: `偏好候选 ${d.candidates.length} 条`,
			meta: "待确认 · 运行 /digest 晋升或退回",
			detail:
				"候选偏好尚未成为稳定规则。集中确认，避免未经验证的信号长期悬空。",
			action: "去待决策处理",
			path: view.plugin.talosSettings.candidatesPath,
			icon: "list-checks",
			tone: "default",
			target: "decisions",
		});
	}
	return items;
}

export function renderOverviewAttentionRows(view: TalosView, parent: HTMLElement, items: OverviewAttention[]): void {
	const list = parent.createDiv({ cls: "overview-v2-attention-list" });
	if (items.length === 0) {
		list.createDiv({
			cls: "ok",
			text: "其余巡检项正常，暂无需要展开的异常。",
		});
		return;
	}
	for (const item of items) {
		const row = list.createDiv({
			cls: `overview-v2-attention-row tone-${item.tone}`,
		});
		row.setAttribute("role", "button");
		row.setAttribute("tabindex", "0");
		row.setAttribute("aria-label", `${item.title}：${item.action}`);
		const icon = row.createSpan({ cls: "overview-v2-attention-row__icon" });
		setIcon(icon, item.icon);
		const copy = row.createDiv({ cls: "overview-v2-attention-row__copy" });
		copy.createEl("strong", { text: item.title });
		copy.createEl("span", { text: item.meta });
		const arrow = row.createSpan({ cls: "overview-v2-attention-row__arrow" });
		setIcon(arrow, "chevron-right");
		const activate = () => {
			if (item.target === "decisions") view.openDecisions();
			else void openFile(view.app, item.path);
		};
		row.addEventListener("click", activate);
		row.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			activate();
		});
	}
}
