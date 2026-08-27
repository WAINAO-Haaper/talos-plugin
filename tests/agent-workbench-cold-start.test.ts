import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ChatSurfaceWorkbench } from "../src/quyuan/chat-surface";
import { DeferredChatWorkbench } from "../src/quyuan/deferred-chat-workbench";

const root = fileURLToPath(new URL("../", import.meta.url));
const mainSource = readFileSync(`${root}src/main.ts`, "utf8");
const viewSource = readFileSync(`${root}src/view.ts`, "utf8");
const switcherSource = readFileSync(`${root}src/harness/harness-switcher.ts`, "utf8");

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

function workbench() {
	const mount = vi.fn(async () => undefined);
	const suspend = vi.fn(async () => undefined);
	const focusComposer = vi.fn();
	const destroy = vi.fn(async () => undefined);
	return {
		value: { mount, suspend, focusComposer, destroy } satisfies ChatSurfaceWorkbench,
		mount,
		destroy,
	};
}

describe("agent workbench cold-start lifecycle", () => {
	it("keeps a restored TALOS channel pending until initialization resolves", async () => {
		const ready = deferred<ChatSurfaceWorkbench>();
		const loaded = workbench();
		const load = vi.fn(() => ready.promise);
		const lazy = new DeferredChatWorkbench(load);
		let settled = false;
		const mounting = lazy.mount({} as HTMLElement, "chat").then(() => {
			settled = true;
		});

		await Promise.resolve();
		expect(settled).toBe(false);
		expect(load).toHaveBeenCalledTimes(1);
		ready.resolve(loaded.value);
		await mounting;

		expect(settled).toBe(true);
		expect(loaded.mount).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("shares one delayed initialization across concurrent restored mounts", async () => {
		const ready = deferred<ChatSurfaceWorkbench>();
		const loaded = workbench();
		const load = vi.fn(() => ready.promise);
		const lazy = new DeferredChatWorkbench(load);
		const first = lazy.mount({} as HTMLElement, "chat");
		const second = lazy.mount({} as HTMLElement, "chat");
		await Promise.resolve();
		expect(load).toHaveBeenCalledTimes(1);
		ready.resolve(loaded.value);
		await Promise.all([first, second]);
		expect(loaded.mount).toHaveBeenCalledTimes(2);
	});

	it("destroys a late workbench when its restored view closes during initialization", async () => {
		const ready = deferred<ChatSurfaceWorkbench>();
		const loaded = workbench();
		const lazy = new DeferredChatWorkbench(() => ready.promise);
		const mounting = lazy.mount({} as HTMLElement, "chat");
		await lazy.destroy();
		ready.resolve(loaded.value);
		await expect(mounting).rejects.toThrow("延迟工作台已释放");
		expect(loaded.destroy).toHaveBeenCalledTimes(1);
	});

	it("propagates the real initialization error instead of a temporary not-ready error", async () => {
		const ready = deferred<ChatSurfaceWorkbench>();
		const lazy = new DeferredChatWorkbench(() => ready.promise);
		const mounting = lazy.mount({} as HTMLElement, "chat");
		ready.reject(new Error("synthetic initialization failure"));
		await expect(mounting).rejects.toThrow("synthetic initialization failure");
	});

	it("wires cold restore through one initialization promise and lazy TALOS channel", () => {
		expect(mainSource).toContain("startQuyuanWorkbenchInitialization");
		expect(mainSource).toContain("waitForAgentWorkbench");
		expect(mainSource).toContain("return this.startQuyuanWorkbenchInitialization()");
		expect(viewSource).toContain("new DeferredChatWorkbench");
		expect(viewSource).toContain("await this.plugin.waitForAgentWorkbench()");
		expect(viewSource).toContain("const { compatibility } = await this.plugin.waitForAgentWorkbench()");
		expect(viewSource).toContain('this.activePage !== "chat" || !page.isConnected');
		expect(viewSource).toContain("...encodeTalosViewState(this.activePage)");
		expect(viewSource).toContain("this.pageRouter.navigate(decodeTalosViewState(state))");
		expect(viewSource).toContain("this.app.workspace.requestSaveLayout()");
	});

	it("mounts a target channel before persisting it and deduplicates concurrent mounts", () => {
		const switchStart = switcherSource.indexOf("private async switchTo");
		const switchEnd = switcherSource.indexOf("private renderActive", switchStart);
		const body = switcherSource.slice(switchStart, switchEnd);
		expect(body.indexOf('await this.ensureChannelMounted(id, "chat")')).toBeGreaterThanOrEqual(0);
		expect(body.indexOf("this.deps.setActiveId(id)")).toBeGreaterThan(
			body.indexOf('await this.ensureChannelMounted(id, "chat")'),
		);
		expect(switcherSource).toContain("channelMounts");
		expect(switcherSource).toContain("onSwitchError");
		expect(switcherSource).toContain("await channel.workbench.destroy()");
	});
});
