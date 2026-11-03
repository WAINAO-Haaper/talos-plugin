// TALOS 控制台模块头图、模块选择与按钮内容；由 TalosView 委托调用。
import { type ModuleHeroOptions, SELECTABLE_MODULES } from "./talos-view-model";
import { openFile } from "../actions";
import { renderTalosPageHeader } from "./page-primitives";
import { setIcon } from "obsidian";
import type { TalosView } from "../view";
import { buildPixelPatrol } from "./view-cosmos";
import { routeContextLabel } from "./navigation-model";

export const COMMAND_ACTION_ICON = "message-square-text";

/** 命令按钮统一的说明：点击填入对话、右键复制。 */
export function commandActionHint(command: string): string {
	return `填入 TALOS 对话「${command}」，按回车发送 · 右键复制`;
}

export function addActionButtonContent(view: TalosView, button: HTMLElement, label: string, variant: "" | "compact" | "mini" = ""): void {
	button.dataset.talosActionButton = "true";
	button.dataset.talosActionVariant = variant;
	const iconWrap = button.createSpan({ cls: "button1__icon-wrapper" });
	const icon = iconWrap.createSpan({ cls: "button1__icon-svg" });
	setIcon(icon, "arrow-up-right");
	const iconCopy = iconWrap.createSpan({
		cls: "button1__icon-svg button1__icon-svg--copy",
	});
	setIcon(iconCopy, "arrow-up-right");
	button.createSpan({ cls: "button1__label", text: label });
	view.syncActionButtonTheme(button, view.plugin.talosSettings.visualTheme || "aurora");
}

export function moduleHero(view: TalosView, parent: HTMLElement, options: ModuleHeroOptions): HTMLElement {
	const hero = renderTalosPageHeader(parent, {
		accent: options.ac,
		icon: options.icon,
		eyebrow: options.eyebrow
			?? [routeContextLabel(view.pageRouter.current()), options.eyebrowDetail].filter(Boolean).join(" · "),
		title: options.title,
		description: options.desc,
		metricLimit: options.metricLimit,
		metrics: options.stats.map((stat) => ({
			label: stat.label,
			value: stat.value,
			detail: stat.sub,
			tone: stat.tone,
			...(stat.onActivate
				? { onActivate: stat.onActivate }
				: stat.path
					? { onActivate: () => void openFile(view.app, stat.path as string) }
					: {}),
		})),
		actions: (options.actions || []).map((action) => {
			const command = action.command;
			if (!command) {
				return {
					label: action.label,
					icon: action.icon,
					onActivate: () => {
						if (action.path) void openFile(view.app, action.path);
					},
				};
			}
			return {
				label: action.label,
				// 旧的「复制」图标会误导：按钮现在把命令送进对话框。
				icon: action.icon === "copy" ? COMMAND_ACTION_ICON : action.icon,
				hint: commandActionHint(command),
				onActivate: () => void view.sendCommandToChat(command),
				onSecondary: () => void view.copyText(command),
			};
		}),
	});

	// 像素场景保留为紧凑身份带，不再占据整页宽的大型 Hero 区域。
	const scene = buildPixelPatrol(view, hero);
	scene.addClass("in-module-hero", "talos-ui-page-header__scene");
	return hero;
}

export function wireModuleSelection(view: TalosView, scope: HTMLElement, selectionScope: string): void {
	const modules = Array.from(scope.querySelectorAll<HTMLElement>(SELECTABLE_MODULES));
	modules.forEach((module, index) => {
		if (module.dataset.talosSelectable === "true") return;
		const label = module.querySelector<HTMLElement>("code, b, .gate-id, .bt")?.textContent
			|| module.textContent
			|| `module-${index + 1}`;
		const key = `${index}:${label.trim().replace(/\s+/g, " ").slice(0, 64)}`;
		module.dataset.talosSelectable = "true";
		module.dataset.talosSelectionScope = selectionScope;
		module.dataset.talosSelectionKey = key;
		module.setAttribute("role", "button");
		module.setAttribute("tabindex", "0");
		module.setAttribute("aria-pressed", "false");

		const select = () => selectModule(view, module, selectionScope, key);
		// 只绑 click：pointerdown+click 双绑会让一次点击选中两次；
		// 键盘激活直接派发 click（click 监听里已含 select），避免三重执行。
		module.addEventListener("click", select);
		module.addEventListener("keydown", (ev) => {
			if (ev.key !== "Enter" && ev.key !== " ") return;
			ev.preventDefault();
			module.click();
		});

		if (view.selectedModuleByScope.get(selectionScope) === key) {
			module.addClass("is-module-selected");
			module.setAttribute("aria-pressed", "true");
		}
	});
}

export function selectModule(view: TalosView, module: HTMLElement, selectionScope: string, key: string): void {
	const candidates = Array.from(
		view.contentEl.querySelectorAll<HTMLElement>("[data-talos-selectable='true']")
	);
	for (const candidate of candidates) {
		if (candidate.dataset.talosSelectionScope !== selectionScope) continue;
		candidate.removeClass("is-module-selected");
		candidate.setAttribute("aria-pressed", "false");
	}
	view.selectedModuleByScope.set(selectionScope, key);
	module.addClass("is-module-selected");
	module.setAttribute("aria-pressed", "true");
}
