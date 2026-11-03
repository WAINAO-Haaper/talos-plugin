// Lens 界面语言的 DOM 构造工具。结构与类名逐一对照 TALOS Lens 的模板字符串，
// 但全部用 createElement 生成（不拼接 innerHTML），样式来自同步的 styles.lens.css。
import { setIcon } from "obsidian";

export type LensChild = Node | string | number | null | undefined | false;
export type LensAttrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	attrs: LensAttrs = {},
	...children: LensChild[]
): HTMLElementTagNameMap[K] {
	const node = doc.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === null || value === undefined || value === false) continue;
		if (key === "class") node.className = String(value);
		else if (key === "style") node.setAttribute("style", String(value));
		else node.setAttribute(key, value === true ? "" : String(value));
	}
	append(node, children);
	return node;
}

export function append(parent: Node, children: LensChild[]): void {
	const doc = parent.ownerDocument ?? (parent as Document);
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		parent.appendChild(typeof child === "string" || typeof child === "number" ? doc.createTextNode(String(child)) : child);
	}
}

/**
 * Lens 用 lucide createIcons 把 <i data-lucide> 换成 17×17、描边 2 的 svg。
 * 这里用 Obsidian 内置的同一套 lucide 图标，去掉 svg-icon 类（避免 Obsidian 的图标尺寸规则），
 * 换成 lucide 的类名与尺寸属性，渲染结果与 Lens 一致。
 */
export function icon(doc: Document, name: string): Element {
	const host = doc.createElement("span");
	setIcon(host, name);
	const svg = host.querySelector("svg");
	if (!svg) return doc.createTextNode("") as unknown as Element;
	svg.removeAttribute("class");
	svg.setAttribute("class", `lucide lucide-${name}`);
	svg.setAttribute("width", "17");
	svg.setAttribute("height", "17");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("aria-hidden", "true");
	return svg;
}

export function chip(doc: Document, text: string, tone = ""): HTMLElement {
	return el(doc, "span", { class: "ta-chip", "data-tone": tone }, text);
}

export function button(doc: Document, text: LensChild, attrs: LensAttrs = {}, primary = false): HTMLButtonElement {
	return el(doc, "button", { type: "button", class: `ta-button${primary ? " ta-primary" : ""}`, ...attrs }, text);
}


export function fact(doc: Document, label: string, value: LensChild): HTMLElement {
	return el(doc, "div", { class: "ta-fact" }, el(doc, "span", {}, label), el(doc, "span", {}, value));
}

export function section(doc: Document, title: string, body: LensChild[], action?: LensChild): HTMLElement {
	return el(doc, "section", { class: "ta-section" },
		el(doc, "div", { class: "ta-section-head" }, el(doc, "h2", {}, title), action),
		...body);
}

export function panel(doc: Document, title: string, body: LensChild[], action?: LensChild): HTMLElement {
	return el(doc, "section", { class: "v-panel" },
		el(doc, "div", { class: "v-panel-head" }, el(doc, "h2", {}, title), action),
		...body);
}

/** 页面标题：子页显示所属分组小字，标题 + 副标题，右侧可放操作。 */
export function heading(doc: Document, title: string, subtitle = "", context = "", action?: LensChild): HTMLElement {
	return el(doc, "div", { class: "ta-heading" },
		el(doc, "div", {},
			context ? el(doc, "span", { class: "lens-page-context" }, context) : null,
			el(doc, "div", { class: "lens-page-title" }, el(doc, "h1", {}, title)),
			subtitle ? el(doc, "small", {}, subtitle) : null),
		action);
}

/** 单值比例条（visual-kit meter）。 */
