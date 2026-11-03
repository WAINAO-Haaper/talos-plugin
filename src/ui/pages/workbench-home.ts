// 工作台首页统一骨架（三个页签共用）：
// 页头一句结论 → 三个主数字 → 焦点卡 + 次要队列 → 7/5 两列工作区 → 底部按需展开详情。
// 只做结构与层级，颜色全部来自调用方传入的主题强调色。
import type { TalosView } from "../../view";

export interface WorkbenchStat {
	label: string;
	value: string;
	unit?: string;
	sub: string;
	alert?: boolean;
	onActivate?: () => void;
}

export interface WorkbenchFocusRow {
	title: string;
	meta: string;
	go: string;
	onActivate: () => void;
}

export interface WorkbenchRow {
	title: string;
	meta?: string;
	tag?: string;
	onActivate?: () => void;
}

export interface WorkbenchLink {
	label: string;
	onActivate: () => void;
	/** 右键备用动作（复制命令等）。 */
	onSecondary?: () => void;
}

export interface WorkbenchBlock {
	accent: string;
	title: string;
	meta: string;
	rows?: WorkbenchRow[];
	links?: WorkbenchLink[];
	empty?: string;
	/** 自定义内容（决策区、图表、能力浏览等），挂载在行列表之后。 */
	mount?: (host: HTMLElement) => void;
	/** 页内锚点（旧深链仍可定位）。 */
	section?: string;
}

export interface WorkbenchDetail {
	/** 旧深链使用的 page key，同时写入 data-workbench-data。 */
	key: string;
	label: string;
	mount: (host: HTMLElement) => void;
	open?: boolean;
}

export interface WorkbenchHomeOptions {
	eyebrow: string;
	title: string;
	lede: string;
	stats: WorkbenchStat[];
	focus: {
		accent: string;
		kicker: string;
		title: string;
		meta: string;
		cta: string;
		onActivate: () => void;
		rows: WorkbenchFocusRow[];
	};
	blocks: [WorkbenchBlock, WorkbenchBlock];
	details?: WorkbenchDetail[];
}

export interface WorkbenchHomeHandle {
	openDetail(key: string): void;
}


/** 主操作按钮必须是黑色：直接写内联样式，避免主题或宿主按钮样式覆盖。 */
function paintPrimary(button: HTMLElement, root: HTMLElement): void {
	let ink = "#101010";
	let paper = "#F5F2EA";
	try {
		const styles = getComputedStyle(root);
		ink = styles.getPropertyValue("--ink").trim() || ink;
		paper = styles.getPropertyValue("--bg").trim() || paper;
	} catch {
		// 非浏览器环境（测试）直接用主题默认值。
	}
	button.style.setProperty("background-color", ink, "important");
	button.style.setProperty("color", paper, "important");
}

function statNode(parent: HTMLElement, stat: WorkbenchStat, index: number): HTMLElement {
	const node = stat.onActivate
		? parent.createEl("button", { cls: "talos-wb-kpi", attr: { type: "button" } })
		: parent.createDiv({ cls: "talos-wb-kpi" });
	if (stat.onActivate) {
		node.setAttribute("aria-label", `${stat.label}：${stat.value}${stat.unit ?? ""}，${stat.sub}`);
		node.addEventListener("click", stat.onActivate);
	}
	node.dataset.index = String(index);
	if (stat.alert) node.dataset.alert = "true";
	node.createEl("span", { cls: "talos-wb-kpi-label", text: stat.label });
	const value = node.createEl("span", { cls: "talos-wb-kpi-value", text: stat.value });
	if (stat.unit) value.createEl("small", { text: stat.unit });
	node.createEl("span", { cls: "talos-wb-kpi-sub", text: stat.sub });
	if (stat.onActivate) node.createEl("span", { cls: "talos-wb-kpi-go", text: "查看 →" });
	return node;
}

function focusCard(parent: HTMLElement, focus: WorkbenchHomeOptions["focus"]): void {
	const card = parent.createDiv({ cls: "talos-wb-focus-card" });
	card.style.setProperty("--talos-wb-accent", focus.accent);
	const body = card.createDiv({ cls: "talos-wb-focus-body" });
	body.createDiv({ cls: "talos-wb-kicker", text: focus.kicker });
	body.createEl("h2", { cls: "talos-wb-focus-title", text: focus.title });
	body.createEl("p", { cls: "talos-wb-focus-meta", text: focus.meta });
	const cta = card.createEl("button", { cls: "talos-wb-cta", text: focus.cta, attr: { type: "button" } });
	paintPrimary(cta, parent);
	cta.addEventListener("click", focus.onActivate);

	const list = parent.createDiv({ cls: "talos-wb-focus-list" });
	for (const row of focus.rows) {
		const item = list.createEl("button", { cls: "talos-wb-focus-row", attr: { type: "button" } });
		const main = item.createDiv({ cls: "talos-wb-focus-row-main" });
		main.createEl("strong", { text: row.title });
		main.createEl("span", { cls: "talos-wb-focus-row-meta", text: row.meta });
		item.createEl("span", { cls: "talos-wb-go", text: row.go });
		item.addEventListener("click", row.onActivate);
	}
}

function blockNode(parent: HTMLElement, block: WorkbenchBlock): HTMLElement {
	const section = parent.createEl("section", { cls: "talos-wb-block" });
	section.style.setProperty("--talos-wb-accent", block.accent);
	if (block.section) section.dataset.workbenchSection = block.section;
	section.tabIndex = -1;

	const head = section.createEl("header", { cls: "talos-wb-block-head" });
	const heading = head.createEl("h2");
	heading.createEl("i", { cls: "talos-wb-dot" });
	heading.createEl("span", { text: block.title });
	head.createEl("span", { cls: "talos-wb-block-meta", text: block.meta });

	const rows = section.createDiv({ cls: "talos-wb-rows" });
	if (block.empty) rows.createDiv({ cls: "talos-wb-empty", text: block.empty });
	for (const row of block.rows ?? []) {
		const node = row.onActivate
			? rows.createEl("button", { cls: "talos-wb-row", attr: { type: "button" } })
			: rows.createDiv({ cls: "talos-wb-row" });
		const main = node.createDiv({ cls: "talos-wb-row-main" });
		main.createEl("span", { cls: "talos-wb-row-title", text: row.title });
		if (row.meta) main.createEl("span", { cls: "talos-wb-row-meta", text: row.meta });
		if (row.tag) main.createEl("span", { cls: "talos-wb-row-tag", text: row.tag });
		if (row.onActivate) {
			node.createEl("span", { cls: "talos-wb-chev", text: "打开 →" });
			node.addEventListener("click", row.onActivate);
		}
	}

	if (block.mount) {
		const slot = rows.createDiv({ cls: "talos-wb-block-mount" });
		block.mount(slot);
	}

	if (block.links?.length) {
		const links = section.createEl("footer", { cls: "talos-wb-links" });
		for (const link of block.links) {
			const button = links.createEl("button", { cls: "talos-wb-link", text: link.label, attr: { type: "button" } });
			paintPrimary(button, parent);
			button.addEventListener("click", link.onActivate);
			if (link.onSecondary) {
				button.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					link.onSecondary?.();
				});
			}
		}
	}
	return section;
}

/**
 * 渲染统一工作台首页。
 * 详情折叠放在页面底部，只有显式展开或旧深链命中时才挂载完整内容，
 * 首页本身保持一屏高度、没有面板内的第二层滚动。
 */
export function renderWorkbenchHome(
	_view: TalosView,
	page: HTMLElement,
	options: WorkbenchHomeOptions
): WorkbenchHomeHandle {
	const root = page.createDiv({ cls: "talos-wb-home" });

	const head = root.createDiv({ cls: "talos-wb-head" });
	head.createDiv({ cls: "talos-wb-eyebrow", text: options.eyebrow });
	head.createEl("h1", { cls: "talos-wb-title", text: options.title });
	head.createEl("p", { cls: "talos-wb-lede", text: options.lede });

	const kpis = root.createDiv({ cls: "talos-wb-kpis" });
	options.stats.slice(0, 3).forEach((stat, index) => statNode(kpis, stat, index));

	const focus = root.createEl("section", { cls: "talos-wb-focus" });
	focus.setAttribute("aria-label", "今天最该处理");
	focusCard(focus, options.focus);

	const grid = root.createDiv({ cls: "talos-wb-grid" });
	blockNode(grid, options.blocks[0]);
	blockNode(grid, options.blocks[1]);

	const entries = new Map<string, { detail: HTMLDetailsElement; mount: () => void }>();
	if (options.details?.length) {
		const host = root.createDiv({ cls: "talos-wb-details" });
		for (const item of options.details) {
			const detail = host.createEl("details", { cls: "talos-wb-detail" });
			detail.dataset.workbenchData = item.key;
			detail.createEl("summary").createEl("span", { cls: "talos-wb-detail-label", text: item.label });
			let mounted = false;
			const mount = () => {
				if (mounted) return;
				mounted = true;
				const body = detail.createDiv({ cls: "talos-wb-detail-body" });
				item.mount(body);
			};
			detail.addEventListener("toggle", () => { if (detail.open) mount(); });
			entries.set(item.key, { detail, mount });
			if (item.open) {
				detail.open = true;
				mount();
			}
		}
	}

	const openDetail = (key: string): void => {
		const entry = entries.get(key);
		if (!entry) return;
		entry.detail.open = true;
		entry.mount();
		try {
			entry.detail.scrollIntoView({ block: "start", behavior: "smooth" });
		} catch {
			// happy-dom 与部分宿主没有 scrollIntoView，不影响展开。
		}
	};

	for (const item of options.details ?? []) {
		if (item.open) openDetail(item.key);
	}

	return { openDetail };
}
