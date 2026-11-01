import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class Stub {}
	return new Proxy({ __esModule: true, Notice: vi.fn(), setIcon: vi.fn() }, {
		get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : Stub,
		has: () => true,
	});
});
vi.mock("../src/actions", () => new Proxy({ __esModule: true }, {
	get: (target, key: string): unknown => key in target ? target[key as keyof typeof target] : key === "then" ? undefined : vi.fn(),
	has: () => true,
}));
vi.mock("../src/quyuan/voice-panel", () => ({
	QuyuanVoicePanel: class {
		mount(host: HTMLElement) {
			const voice = host.createDiv({ cls: "tq-voice" });
			voice.createDiv({ cls: "tq-talos-ball-host" });
		}
	},
}));

describe("voice stage layout", () => {
	it("keeps the mounted ball in a growing surface below the shortcut", async () => {
		const win = new Window();
		try {
			const doc = win.document;
			function createEl(this: HTMLElement, tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}) {
				const el = this.ownerDocument.createElement(tag);
				if (options.cls) el.className = options.cls;
				if (options.text) el.textContent = options.text;
				for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
				this.appendChild(el);
				return el;
			}
			Object.defineProperties(win.HTMLElement.prototype, {
				createEl: { configurable: true, value: createEl },
				createDiv: { configurable: true, value(this: HTMLElement, options?: { cls?: string; text?: string }) { return createEl.call(this, "div", options); } },
				createSpan: { configurable: true, value(this: HTMLElement, options?: { cls?: string; text?: string }) { return createEl.call(this, "span", options); } },
				empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
			});
			const style = doc.createElement("style");
			style.textContent = readFileSync(new URL("../styles.quyuan-shell.css", import.meta.url), "utf8");
			doc.head.appendChild(style);
			const shell = doc.createElement("section");
			shell.className = "talos-console";
			shell.dataset.talosPage = "jarvis";
			const page = doc.createElement("div");
			page.className = "page-content";
			shell.appendChild(page); doc.body.appendChild(shell);
			const view = {
				voiceMountRevision: 0, activePage: "jarvis", pageEl: page, jarvis: null,
				plugin: { waitForAgentWorkbench: vi.fn().mockResolvedValue({}), talosSettings: {}, saveTalosSettings: vi.fn() },
				app: {}, navigateToPage: vi.fn(),
			};
			const { renderJarvisPage } = await import("../src/ui/pages/workspace-pages");
			await renderJarvisPage(view as never, page as never);
			const shortcut = page.querySelector(".talos-voice-shortcuts")!;
			const surface = page.querySelector(".talos-voice-surface")!;
			const voice = surface.querySelector(".tq-voice")!;
			expect(voice.querySelector(".tq-talos-ball-host")).not.toBeNull();
			expect(win.getComputedStyle(page).flexDirection).toBe("column");
			expect(win.getComputedStyle(shortcut).flex).toBe("0 0 auto");
			expect(win.getComputedStyle(surface).display).toBe("flex");
			expect(win.getComputedStyle(surface).flex).toMatch(/^1 1 0/);
			expect(win.getComputedStyle(surface).minHeight).toBe("0");
			expect(win.getComputedStyle(voice).flex).toBe("1 1 auto");
		} finally { await win.happyDOM.close(); }
	});
});
