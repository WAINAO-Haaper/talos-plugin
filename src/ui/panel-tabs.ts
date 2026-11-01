// 单页原则的合并工具：把同一用途的几个现有面板放进一个页签容器，一次只显示一个。
// 页签首次选中时挂载，切换时保留已挂载内容，避免创建未使用的工具与监听。

export interface PanelTab {
	key: string;
	label: string;
	/** 页签上的数字提示，如待决策数；0 或缺省不显示。 */
	badge?: number;
	render(host: HTMLElement): void;
}

export interface PanelTabsOptions {
	parent: HTMLElement;
	/** 页签组标识，用于在本次会话内记住选中项。 */
	groupKey: string;
	label: string;
	tabs: PanelTab[];
	/** 会话内的选中记录（由视图持有），页面重绘后保留。 */
	selections?: Map<string, string>;
}

export function mountPanelTabs(options: PanelTabsOptions): HTMLElement {
	const doc = options.parent.ownerDocument;
	const root = doc.createElement("section");
	root.className = "talos-panel-tabs";
	root.setAttribute("data-panel-tabs", options.groupKey);
	options.parent.appendChild(root);

	const bar = doc.createElement("div");
	bar.className = "talos-panel-tabs__bar";
	bar.setAttribute("role", "tablist");
	// 用隐藏文字而非 aria-label 命名：Obsidian 会把 aria-label 显示成悬停提示。
	const name = doc.createElement("span");
	name.className = "talos-sr-only";
	name.id = `talos-tabs-${options.groupKey}-label`;
	name.textContent = options.label;
	root.appendChild(name);
	bar.setAttribute("aria-labelledby", name.id);
	root.appendChild(bar);

	const remembered = options.selections?.get(options.groupKey);
	const initial = options.tabs.find((tab) => tab.key === remembered) ?? options.tabs[0];
	const buttons: HTMLButtonElement[] = [];
	const hosts: HTMLElement[] = [];
	const mounted = new Set<number>();

	const select = (index: number, focus: boolean) => {
		options.tabs.forEach((tab, i) => {
			const active = i === index;
			const button = buttons[i];
			button.setAttribute("aria-selected", active ? "true" : "false");
			button.tabIndex = active ? 0 : -1;
			hosts[i].hidden = !active;
			if (active) {
				if (!mounted.has(i)) {
					tab.render(hosts[i]);
					mounted.add(i);
				}
				options.selections?.set(options.groupKey, tab.key);
				if (focus) button.focus();
			}
		});
	};

	options.tabs.forEach((tab, index) => {
		const id = `talos-tab-${options.groupKey}-${tab.key}`;
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "talos-panel-tabs__tab";
		button.id = `${id}-tab`;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-controls", `${id}-panel`);
		button.setAttribute("data-tab", tab.key);
		button.textContent = tab.label;
		if (tab.badge && tab.badge > 0) {
			const badge = doc.createElement("span");
			badge.className = "talos-panel-tabs__badge";
			badge.textContent = String(tab.badge);
			button.appendChild(badge);
		}
		button.addEventListener("click", () => select(index, false));
		button.addEventListener("keydown", (event: KeyboardEvent) => {
			const last = options.tabs.length - 1;
			const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
				: event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
					: event.key === "Home" ? 0
						: event.key === "End" ? last
							: -1;
			if (next < 0) return;
			event.preventDefault();
			select(next, true);
		});
		bar.appendChild(button);
		buttons.push(button);

		const host = doc.createElement("div");
		host.className = "talos-panel-tabs__panel";
		host.id = `${id}-panel`;
		host.setAttribute("role", "tabpanel");
		host.setAttribute("aria-labelledby", button.id);
		root.appendChild(host);
		hosts.push(host);
	});

	select(Math.max(0, options.tabs.indexOf(initial)), false);
	return root;
}
