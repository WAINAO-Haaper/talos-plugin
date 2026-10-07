import { MiniDocument, MiniElement } from "./mini-dom";

// 在 MiniElement 上补齐 Obsidian 对 HTMLElement 的扩展（createDiv / createEl /
// setAttr / setCssProps …），用于直接渲染并断言控制台模块的真实 DOM 输出。

type ElementOptions = {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
};

class TestStyle {
	width = "";
	readonly props: Record<string, string> = {};

	setProperty(name: string, value: string): void {
		this.props[name] = value;
	}
}

export class ObsidianTestElement extends MiniElement {
	readonly style = new TestStyle();
	title = "";

	createEl(tag: string, options: ElementOptions | string = {}): ObsidianTestElement {
		const info = typeof options === "string" ? { cls: options } : options;
		const element = new ObsidianTestElement(tag, this.ownerDocument);
		if (info.cls) element.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
		if (info.text !== undefined) element.textContent = info.text;
		for (const [name, value] of Object.entries(info.attr ?? {})) {
			if (value !== null && value !== false) element.setAttribute(name, String(value));
		}
		this.appendChild(element);
		return element;
	}

	createDiv(options?: ElementOptions | string): ObsidianTestElement {
		return this.createEl("div", options);
	}

	createSpan(options?: ElementOptions | string): ObsidianTestElement {
		return this.createEl("span", options);
	}

	setAttr(name: string, value: string | number | boolean): void {
		this.setAttribute(name, String(value));
	}

	addClass(...classes: string[]): void {
		this.classList.add(...classes);
	}

	toggleClass(cls: string, value: boolean): void {
		this.classList.toggle(cls, value);
	}

	setCssProps(props: Record<string, string>): void {
		for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
	}

	setText(text: string): void {
		this.textContent = text;
	}

	empty(): void {
		this.replaceChildren();
	}

	/** 按 class 查找全部后代（保持文档顺序）。 */
	all(cls: string): ObsidianTestElement[] {
		return this.querySelectorAll<ObsidianTestElement>(`.${cls}`);
	}

	one(cls: string): ObsidianTestElement {
		const found = this.querySelector<ObsidianTestElement>(`.${cls}`);
		if (!found) throw new Error(`missing .${cls}`);
		return found;
	}
}

export function createObsidianHost(): { host: HTMLElement; element: ObsidianTestElement } {
	const element = new ObsidianTestElement("div", new MiniDocument());
	return { host: element as unknown as HTMLElement, element };
}
