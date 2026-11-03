import { setIcon } from "obsidian";

export type TalosUiTone = "default" | "warn" | "hot" | "good";

export interface TalosUiMetric {
	label: string;
	value: string;
	detail?: string;
	tone?: TalosUiTone;
	onActivate?: () => void;
}

export interface TalosUiAction {
	label: string;
	icon: string;
	onActivate: () => void;
	/** 悬停提示，说明点击后去哪里。 */
	hint?: string;
	/** 右键的次要动作（如复制命令）。 */
	onSecondary?: () => void;
}

export interface TalosPageHeaderOptions {
	accent: string;
	icon: string;
	eyebrow: string;
	title: string;
	description: string;
	metrics: TalosUiMetric[];
	/** 仅明确选择的页面展示第五张指标卡；默认仍为四张。 */
	metricLimit?: 4 | 5;
	actions?: TalosUiAction[];
}

function wireActivation(element: HTMLElement, activate: () => void): void {
	element.addClass("is-interactive");
	element.setAttribute("role", "button");
	element.setAttribute("tabindex", "0");
	element.addEventListener("click", (event) => {
		event.preventDefault();
		activate();
	});
	element.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		activate();
	});
}

function renderMetric(parent: HTMLElement, metric: TalosUiMetric, className: string): HTMLElement {
	const item = parent.createDiv({
		cls: `${className} tone-${metric.tone || "default"}`,
	});
	item.createEl("span", { text: metric.label });
	item.createEl("b", { text: metric.value });
	if (metric.detail) item.createEl("small", { text: metric.detail });
	if (metric.onActivate) {
		item.setAttribute("aria-label", `${metric.label}：${metric.value}`);
		wireActivation(item, metric.onActivate);
	}
	return item;
}

export function renderTalosPageHeader(
	parent: HTMLElement,
	options: TalosPageHeaderOptions
): HTMLElement {
	const header = parent.createEl("header", {
		cls: "panel module-hero talos-ui-page-header",
	});
	header.dataset.talosComponent = "page-header";
	header.setCssProps({ "--ac": options.accent });

	const main = header.createDiv({
		cls: "module-hero-main talos-ui-page-header__main",
	});
	const icon = main.createDiv({
		cls: "module-hero-icon talos-ui-page-header__icon",
	});
	setIcon(icon, options.icon);
	const copy = main.createDiv({
		cls: "module-hero-copy talos-ui-page-header__copy",
	});
	copy.createEl("small", {
		cls: "talos-ui-page-header__eyebrow",
		text: options.eyebrow,
	});
	copy.createEl("h1", {
		cls: "module-hero-title talos-ui-page-header__title",
		text: options.title,
	});
	copy.createEl("p", {
		cls: "talos-ui-page-header__description",
		text: options.description,
	});

	const metrics = header.createDiv({
		cls: "module-hero-stats talos-ui-page-header__metrics",
	});
	for (const metric of options.metrics.slice(0, options.metricLimit ?? 4)) {
		renderMetric(
			metrics,
			metric,
			"module-hero-stat talos-ui-page-header__metric"
		);
	}

	if (options.actions?.length) {
		const actions = header.createDiv({
			cls: "module-hero-actions talos-ui-page-header__actions",
		});
		for (const option of options.actions.slice(0, 3)) {
			const button = actions.createEl("button", {
				cls: "module-hero-action talos-ui-page-header__action",
				attr: {
					type: "button",
					"aria-label": option.hint ? `${option.label}：${option.hint}` : option.label,
				},
			});
			if (option.hint) button.title = option.hint;
			const actionIcon = button.createSpan({
				cls: "module-hero-action-icon talos-ui-page-header__action-icon",
			});
			setIcon(actionIcon, option.icon);
			button.createSpan({ text: option.label });
			button.addEventListener("click", (event) => {
				event.preventDefault();
				option.onActivate();
			});
			const secondary = option.onSecondary;
			if (secondary) {
				button.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					secondary();
				});
			}
		}
	}

	return header;
}


export function renderTalosEmptyState(
	parent: HTMLElement,
	title: string,
	description: string,
	action?: TalosUiAction
): HTMLElement {
	const state = parent.createDiv({ cls: "talos-ui-empty-state" });
	state.dataset.talosComponent = "empty-state";
	const icon = state.createSpan({ cls: "talos-ui-empty-state__icon" });
	setIcon(icon, action?.icon || "circle-dashed");
	state.createEl("strong", { text: title });
	state.createEl("p", { text: description });
	if (action) {
		const button = state.createEl("button", {
			cls: "talos-ui-empty-state__action",
			attr: { type: "button" },
		});
		button.setText(action.label);
		button.addEventListener("click", action.onActivate);
	}
	return state;
}
