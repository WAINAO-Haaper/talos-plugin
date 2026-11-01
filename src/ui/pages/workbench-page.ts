// 工作台按资料、项目与任务、系统与记忆组织现有功能，沿用原有数据和动作。
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { renderWorkbenchData } from "./workbench-data";
import { renderWorkbenchProjects } from "./workbench-projects";
import { renderWorkbenchSystem } from "./workbench-system";

export type WorkbenchPageKey = "inbox" | "knowledge" | "output" | "projects" | "tasks" | "health" | "capability" | "identity";

const SECTIONS: ReadonlyArray<{ keys: ReadonlyArray<{ key: WorkbenchPageKey; label: string }>; label: string }> = [
	{ label: "资料", keys: [{ key: "inbox", label: "收件" }, { key: "knowledge", label: "知识" }, { key: "output", label: "输出" }] },
	{ label: "项目与任务", keys: [{ key: "projects", label: "项目" }, { key: "tasks", label: "任务与决策" }] },
	{ label: "系统与记忆", keys: [{ key: "health", label: "健康诊断" }, { key: "capability", label: "能力" }, { key: "identity", label: "身份与记忆" }] },
];

/** 原页面键保留为深链，分类导航只改变组织方式。 */
export function renderWorkbenchPage(view: TalosView, page: HTMLElement, d: Collected, pageKey: string): void {
	const section = SECTIONS.find((group) => group.keys.some((item) => item.key === pageKey)) ?? SECTIONS[0];
	const selectedKey = section.keys.some((item) => item.key === pageKey) ? pageKey : section.keys[0].key;
	const categoryNav = page.createDiv({ cls: "talos-panel-tabs__bar workbench-category-nav" });
	categoryNav.setAttribute("role", "tablist");
	categoryNav.setAttribute("aria-label", "工作台分类");
	for (const [index, group] of SECTIONS.entries()) {
		const button = categoryNav.createEl("button", { cls: "talos-panel-tabs__tab", text: group.label, attr: { type: "button" } });
		button.id = `talos-workbench-category-${group.keys[0].key}`;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-controls", "talos-workbench-panel");
		button.setAttribute("aria-selected", String(group === section));
		button.tabIndex = group === section ? 0 : -1;
		button.addEventListener("click", () => view.navigateToPage(group.keys[0].key));
		button.addEventListener("keydown", (event: KeyboardEvent) => {
			const target = event.key === "ArrowRight" ? (index + 1) % SECTIONS.length : event.key === "ArrowLeft" ? (index + SECTIONS.length - 1) % SECTIONS.length : event.key === "Home" ? 0 : event.key === "End" ? SECTIONS.length - 1 : -1;
			if (target < 0) return;
			event.preventDefault();
			const key = SECTIONS[target].keys[0].key;
			view.navigateToPage(key);
			page.ownerDocument.getElementById(`talos-workbench-category-${key}`)?.focus();
		});
	}
	const content = page.createDiv({ cls: "workbench-category-content" });
	content.id = "talos-workbench-panel";
	content.setAttribute("role", "tabpanel");
	content.setAttribute("aria-labelledby", `talos-workbench-category-${section.keys[0].key}`);
	content.dataset.workbenchPage = selectedKey;
	renderWorkbenchContent(view, content, d, selectedKey);
}

/** 经典及 Lens 共用同一分类内容；旧 page key 仍作为定位目标。 */
export function renderWorkbenchContent(view: TalosView, page: HTMLElement, d: Collected, pageKey: string): void {
	if (pageKey === "projects" || pageKey === "tasks") renderWorkbenchProjects(view, page, d, pageKey);
	else if (pageKey === "health" || pageKey === "capability" || pageKey === "identity") renderWorkbenchSystem(view, page, d, pageKey);
	else renderWorkbenchData(view, page, d, pageKey);
}
