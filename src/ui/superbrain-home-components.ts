import { SUPERBRAIN_CANVAS_CARDS, type SuperbrainCanvasCard } from "./superbrain-canvas-layout";

export interface SuperbrainCanvasCardMeta {
	label: string;
	icon: string;
	category: "工作" | "资料" | "系统";
	description: string;
}

export const SUPERBRAIN_CANVAS_CARD_META: Record<SuperbrainCanvasCard, SuperbrainCanvasCardMeta> = {
	focus: { label: "当前焦点", icon: "target", category: "工作", description: "查看当前任务与完成条件，继续今天的工作。" },
	inbox: { label: "收件箱", icon: "inbox", category: "资料", description: "查看待整理资料数量，进入资料入库。" },
	pending: { label: "待确认", icon: "circle-help", category: "工作", description: "查看审批与偏好候选，处理等待确认的内容。" },
	quick: { label: "快捷动作", icon: "zap", category: "工作", description: "从入库、检索、记忆、创作、检查与恢复开始。" },
	recent: { label: "最近资料", icon: "file-text", category: "资料", description: "打开当前资料库中最近修改的笔记。" },
	runs: { label: "运行记录", icon: "history", category: "系统", description: "查看系统操作的运行状态与结果。" },
	recovery: { label: "恢复", icon: "rotate-ccw", category: "系统", description: "核对资料库恢复点，进入恢复工作流。" },
};

export interface SuperbrainHomeSearchPorts {
	files: readonly { path: string; name: string }[];
	actions: readonly { id: string; label: string; icon: string }[];
	openFile(path: string): void;
	openAction(id: string): void;
	icon(el: HTMLElement, name: string): void;
}

interface SearchResult {
	label: string;
	detail: string;
	icon: string;
	open(): void;
}

type Disposer = () => void;

function listen<K extends keyof HTMLElementEventMap>(
	el: HTMLElement,
	type: K,
	handler: (event: HTMLElementEventMap[K]) => void,
	cleanup: Disposer[]
): void {
	el.addEventListener(type, handler);
	cleanup.push(() => el.removeEventListener(type, handler));
}

function removeListeners(cleanup: Disposer[]): void {
	for (const dispose of cleanup.splice(0)) dispose();
}

function matchesQuery(query: string, ...values: string[]): boolean {
	const content = values.join(" ").toLocaleLowerCase();
	return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(part => content.includes(part));
}

export function renderSuperbrainHomeSearch(parent: HTMLElement, ports: SuperbrainHomeSearchPorts): Disposer {
	const document = parent.ownerDocument;
	const root = document.createElement("div");
	root.className = "talos-home-search";
	root.setAttribute("role", "search");
	const mark = document.createElement("span");
	mark.setAttribute("aria-hidden", "true");
	ports.icon(mark, "search");
	root.appendChild(mark);
	const input = document.createElement("input");
	input.type = "search";
	input.className = "talos-home-search__input";
	input.setAttribute("aria-label", "搜索资料与功能");
	input.setAttribute("placeholder", "搜索资料与功能");
	input.setAttribute("autocomplete", "off");
	root.appendChild(input);
	const results = document.createElement("div");
	results.className = "talos-home-search__results";
	results.setAttribute("role", "group");
	results.setAttribute("aria-label", "搜索结果");
	results.hidden = true;
	root.appendChild(results);
	parent.appendChild(root);
	const cleanup: Disposer[] = [];
	const resultCleanup: Disposer[] = [];
	let disposed = false;
	let composing = false;
	let current: SearchResult[] = [];
	const dismiss = (): void => {
		current = [];
		results.hidden = true;
		removeListeners(resultCleanup);
		results.replaceChildren();
	};
	const openResult = (result: SearchResult): void => {
		if (disposed) return;
		dismiss();
		result.open();
	};
	const render = (): void => {
		if (disposed || composing) return;
		dismiss();
		const query = input.value.trim();
		if (!query) return;
		for (const action of ports.actions) {
			if (!matchesQuery(query, action.label, action.id)) continue;
			current.push({ label: action.label, detail: "功能", icon: action.icon, open: () => ports.openAction(action.id) });
			if (current.length === 6) break;
		}
		if (current.length < 6) {
			for (const file of ports.files) {
				if (!matchesQuery(query, file.name, file.path)) continue;
				current.push({ label: file.name, detail: file.path, icon: "file-text", open: () => ports.openFile(file.path) });
				if (current.length === 6) break;
			}
		}
		results.hidden = false;
		if (!current.length) {
			const empty = document.createElement("p");
			empty.className = "talos-home-search__empty";
			empty.setAttribute("role", "status");
			empty.textContent = "没有找到匹配的资料或功能";
			results.appendChild(empty);
			return;
		}
		for (const result of current) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "talos-home-search__result";
			button.setAttribute("aria-label", `${result.label} · ${result.detail}`);
			const icon = document.createElement("span");
			icon.setAttribute("aria-hidden", "true");
			ports.icon(icon, result.icon);
			const copy = document.createElement("span");
			const label = document.createElement("strong");
			label.textContent = result.label;
			const detail = document.createElement("small");
			detail.textContent = result.detail;
			copy.append(label, detail);
			button.append(icon, copy);
			listen(button, "click", () => openResult(result), resultCleanup);
			results.appendChild(button);
		}
	};
	listen(input, "input", render, cleanup);
	listen(input, "compositionstart", () => { composing = true; dismiss(); }, cleanup);
	listen(input, "compositionend", () => { composing = false; render(); }, cleanup);
	listen(input, "keydown", event => {
		if (composing || event.isComposing || Reflect.get(event, "keyCode") === 229) return;
		if (event.key === "Escape") { event.preventDefault(); dismiss(); }
		else if (event.key === "Enter" && !results.hidden && current[0]) { event.preventDefault(); openResult(current[0]); }
	}, cleanup);
	listen(root, "keydown", event => {
		if (event.key !== "Escape" || composing || event.isComposing || Reflect.get(event, "keyCode") === 229) return;
		event.preventDefault();
		dismiss();
		input.focus();
	}, cleanup);
	return () => {
		if (disposed) return;
		disposed = true;
		dismiss();
		removeListeners(cleanup);
		root.remove();
	};
}

export interface SuperbrainCardLibraryPorts {
	added: readonly SuperbrainCanvasCard[];
	onAdd(card: SuperbrainCanvasCard): void;
	icon(el: HTMLElement, name: string): void;
}

let cardLibrarySequence = 0;

export function openSuperbrainCardLibrary(parent: HTMLElement, ports: SuperbrainCardLibraryPorts): Disposer {
	const document = parent.ownerDocument;
	const previousFocus = document.activeElement as HTMLElement | null;
	const dialog = document.createElement("dialog");
	dialog.className = "talos-home-library-modal";
	const titleId = `talos-home-library-title-${++cardLibrarySequence}`;
	dialog.setAttribute("aria-labelledby", titleId);
	const header = document.createElement("header");
	header.className = "talos-home-library-header";
	const title = document.createElement("h2");
	title.id = titleId;
	title.textContent = "添加内容";
	const close = document.createElement("button");
	close.type = "button";
	close.className = "talos-home-library-close";
	close.setAttribute("aria-label", "关闭添加内容");
	ports.icon(close, "x");
	header.append(title, close);
	dialog.appendChild(header);
	const search = document.createElement("input");
	search.type = "search";
	search.className = "talos-home-library-search";
	search.setAttribute("aria-label", "搜索可添加内容");
	search.setAttribute("placeholder", "搜索内容");
	dialog.appendChild(search);
	const filters = document.createElement("div");
	filters.className = "talos-home-library-filters";
	filters.setAttribute("role", "group");
	filters.setAttribute("aria-label", "内容分类");
	dialog.appendChild(filters);
	const grid = document.createElement("div");
	grid.className = "talos-home-library-grid";
	dialog.appendChild(grid);
	parent.appendChild(dialog);
	const cleanup: Disposer[] = [];
	const cardCleanup: Disposer[] = [];
	const added = new Set(ports.added);
	let disposed = false;
	let category = "全部";
	let composing = false;
	const dismiss = (): void => {
		if (disposed) return;
		disposed = true;
		removeListeners(cardCleanup);
		removeListeners(cleanup);
		if (dialog.open) dialog.close();
		dialog.remove();
		previousFocus?.focus?.();
	};
	const categories = new Map<string, HTMLButtonElement>();
	const render = (): void => {
		if (disposed || composing) return;
		removeListeners(cardCleanup);
		grid.replaceChildren();
		for (const [name, button] of categories) button.setAttribute("aria-pressed", String(name === category));
		const query = search.value.trim();
		for (const card of SUPERBRAIN_CANVAS_CARDS) {
			const meta = SUPERBRAIN_CANVAS_CARD_META[card];
			if (category !== "全部" && meta.category !== category) continue;
			if (query && !matchesQuery(query, meta.label, meta.description)) continue;
			const button = document.createElement("button");
			button.type = "button";
			button.className = "talos-home-library-card";
			button.setAttribute("data-card", card);
			button.disabled = added.has(card);
			button.setAttribute("aria-label", `${button.disabled ? "已添加" : "添加"}${meta.label}：${meta.description}`);
			const icon = document.createElement("span");
			icon.setAttribute("aria-hidden", "true");
			ports.icon(icon, meta.icon);
			const label = document.createElement("strong");
			label.textContent = meta.label;
			const preview = document.createElement("span");
			preview.className = "talos-home-library-preview";
			preview.setAttribute("data-card", card);
			preview.setAttribute("aria-hidden", "true");
			const blockCount = card === "quick" ? 5 : card === "focus" ? 3 : card === "inbox" || card === "pending" ? 2 : 4;
			for (let index = 0; index < blockCount; index++) {
				const block = document.createElement("span");
				block.className = "talos-home-library-preview__block";
				preview.appendChild(block);
			}
			const description = document.createElement("span");
			description.className = "talos-home-library-description";
			description.textContent = meta.description;
			const state = document.createElement("span");
			state.className = "talos-home-library-state";
			state.textContent = button.disabled ? "已添加" : "添加";
			button.append(icon, label, preview, description, state);
			listen(button, "click", () => {
				if (disposed || added.has(card)) return;
				dismiss();
				ports.onAdd(card);
			}, cardCleanup);
			grid.appendChild(button);
		}
		if (!grid.childElementCount) {
			const empty = document.createElement("p");
			empty.className = "talos-home-library-empty";
			empty.setAttribute("role", "status");
			empty.textContent = "没有匹配的内容";
			grid.appendChild(empty);
		}
	};
	for (const name of ["全部", "工作", "资料", "系统"]) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "talos-home-library-filter";
		button.textContent = name;
		categories.set(name, button);
		listen(button, "click", () => { category = name; render(); }, cleanup);
		filters.appendChild(button);
	}
	listen(search, "input", render, cleanup);
	listen(search, "compositionstart", () => { composing = true; }, cleanup);
	listen(search, "compositionend", () => { composing = false; render(); }, cleanup);
	listen(close, "click", dismiss, cleanup);
	listen(dialog, "cancel", event => { event.preventDefault(); dismiss(); }, cleanup);
	listen(dialog, "close", dismiss, cleanup);
	render();
	dialog.showModal();
	search.focus();
	return dismiss;
}
