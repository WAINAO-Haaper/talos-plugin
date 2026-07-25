type Listener = (event: {
	key?: string;
	preventDefault(): void;
	stopPropagation(): void;
}) => void;

class MiniClassList {
	constructor(private readonly element: MiniElement) {}

	add(...tokens: string[]): void {
		const next = new Set(this.element.className.split(/\s+/).filter(Boolean));
		for (const token of tokens) next.add(token);
		this.element.className = Array.from(next).join(" ");
	}

	remove(...tokens: string[]): void {
		const removed = new Set(tokens);
		this.element.className = this.element.className
			.split(/\s+/)
			.filter((token) => token && !removed.has(token))
			.join(" ");
	}

	toggle(token: string, force?: boolean): boolean {
		const has = this.contains(token);
		const enabled = force ?? !has;
		if (enabled) this.add(token);
		else this.remove(token);
		return enabled;
	}

	contains(token: string): boolean {
		return this.element.className.split(/\s+/).includes(token);
	}
}

export class MiniElement {
	readonly children: MiniElement[] = [];
	readonly attributes = new Map<string, string>();
	readonly dataset: Record<string, string> = {};
	readonly classList = new MiniClassList(this);
	readonly listeners = new Map<string, Listener[]>();
	className = "";
	disabled = false;
	hidden = false;
	type = "";
	value = "";
	parentElement: MiniElement | null = null;
	private ownText = "";

	constructor(
		readonly tagName: string,
		readonly ownerDocument: MiniDocument
	) {}

	get textContent(): string {
		return this.ownText + this.children.map((child) => child.textContent).join("");
	}

	set textContent(value: string) {
		this.replaceChildren();
		this.ownText = value;
	}

	appendChild(child: MiniElement): MiniElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	append(...nodes: Array<MiniElement | string>): void {
		for (const node of nodes) {
			if (typeof node === "string") {
				this.ownText += node;
			} else {
				this.appendChild(node);
			}
		}
	}

	replaceChildren(...children: MiniElement[]): void {
		for (const child of this.children) child.parentElement = null;
		this.children.splice(0, this.children.length);
		this.ownText = "";
		for (const child of children) this.appendChild(child);
	}

	remove(): void {
		if (!this.parentElement) return;
		const index = this.parentElement.children.indexOf(this);
		if (index >= 0) this.parentElement.children.splice(index, 1);
		this.parentElement = null;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
		if (name === "class") this.className = value;
		if (name.startsWith("data-")) {
			const key = name
				.slice(5)
				.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
			this.dataset[key] = value;
		}
	}

	getAttribute(name: string): string | null {
		if (name === "class") return this.className || null;
		return this.attributes.get(name) ?? null;
	}

	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, key?: string): void {
		const event = {
			key,
			preventDefault() {},
			stopPropagation() {},
		};
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	click(): void {
		if (!this.disabled) this.dispatch("click");
	}

	querySelector<T = MiniElement>(selector: string): T | null {
		return (this.querySelectorAll(selector)[0] as T | undefined) ?? null;
	}

	querySelectorAll<T = MiniElement>(selector: string): T[] {
		const matches: MiniElement[] = [];
		const visit = (element: MiniElement) => {
			for (const child of element.children) {
				if (child.matches(selector)) matches.push(child);
				visit(child);
			}
		};
		visit(this);
		return matches as T[];
	}

	private matches(selector: string): boolean {
		const attribute = selector.match(
			/^(?:(\w+))?\[([^=\]]+)=["']([^"']+)["']\]$/
		);
		if (attribute) {
			const [, tag, name, value] = attribute;
			return (
				(!tag || this.tagName === tag.toLowerCase()) &&
				this.getAttribute(name) === value
			);
		}
		if (selector.startsWith(".")) {
			return this.classList.contains(selector.slice(1));
		}
		return this.tagName === selector.toLowerCase();
	}
}

export class MiniDocument {
	createElement(tagName: string): MiniElement {
		return new MiniElement(tagName.toLowerCase(), this);
	}
}

export function createMiniHost(): {
	host: HTMLElement;
	element: MiniElement;
} {
	const document = new MiniDocument();
	const element = document.createElement("div");
	return {
		host: element as unknown as HTMLElement,
		element,
	};
}
