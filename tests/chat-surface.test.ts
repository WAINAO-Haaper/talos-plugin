import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	TalosChatSurface,
	type ChatSurfaceWorkbench,
} from "../src/quyuan/chat-surface";
import { createMiniHost } from "./helpers/mini-dom";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const claudianViewSource = readFileSync(
	`${projectRoot}src/quyuan/claudian/features/chat/ClaudianView.ts`,
	"utf8"
);
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");

function workbench(): ChatSurfaceWorkbench & {
	activeTabId: string;
	running: boolean;
	mount: ReturnType<typeof vi.fn>;
	suspend: ReturnType<typeof vi.fn>;
	focusComposer: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
} {
	return {
		activeTabId: "tab-2",
		running: true,
		mount: vi.fn().mockResolvedValue(undefined),
		suspend: vi.fn().mockResolvedValue(undefined),
		focusComposer: vi.fn(),
		destroy: vi.fn().mockResolvedValue(undefined),
	};
}

describe("TalosChatSurface", () => {
	it("mounts the same surface only once for the same container", async () => {
		const runtime = workbench();
		const surface = new TalosChatSurface(runtime);
		const { host } = createMiniHost();

		await surface.mount(host, "chat");
		await surface.mount(host, "chat");

		expect(runtime.mount).toHaveBeenCalledOnce();
		expect(runtime.mount).toHaveBeenCalledWith(host, "chat");
	});

	it("suspends UI without cancelling a running task and restores the tab", async () => {
		const runtime = workbench();
		const surface = new TalosChatSurface(runtime);
		const first = createMiniHost();
		const second = createMiniHost();

		await surface.mount(first.host, "chat");
		await surface.unmount();
		expect(runtime.suspend).toHaveBeenCalledOnce();
		expect(runtime.running).toBe(true);
		expect(runtime.activeTabId).toBe("tab-2");

		await surface.mount(second.host, "chat");
		expect(runtime.mount).toHaveBeenCalledTimes(2);
		expect(runtime.activeTabId).toBe("tab-2");
	});

	it("accepts only the chat history namespace and never requests voice", async () => {
		const runtime = workbench();
		const surface = new TalosChatSurface(runtime);
		const { host } = createMiniHost();

		await expect(
			surface.mount(host, "voice" as "chat")
		).rejects.toThrow("chat");
		expect(runtime.mount).not.toHaveBeenCalled();

		await surface.mount(host, "chat");
		expect(runtime.mount).toHaveBeenLastCalledWith(host, "chat");
	});

	it("delegates composer focus and destroys only on final disposal", async () => {
		const runtime = workbench();
		const surface = new TalosChatSurface(runtime);
		const { host } = createMiniHost();

		await surface.mount(host, "chat");
		surface.focusComposer();
		await surface.unmount();
		expect(runtime.destroy).not.toHaveBeenCalled();

		await surface.dispose();
		expect(runtime.focusComposer).toHaveBeenCalledOnce();
		expect(runtime.destroy).toHaveBeenCalledOnce();
	});

	it("keeps the real embedded suspend path non-destructive", () => {
		const start = claudianViewSource.indexOf("async suspendEmbedded()");
		const end = claudianViewSource.indexOf("focusComposer()", start);
		const suspendSource = claudianViewSource.slice(start, end);
		expect(start).toBeGreaterThan(0);
		expect(suspendSource).toContain("persistTabStateImmediate");
		expect(suspendSource).toContain("viewContainerEl?.remove()");
		expect(suspendSource).not.toContain("cancelStreaming");
		expect(suspendSource).not.toContain("tabManager?.destroy");
	});

	it("keeps the old command id while routing it into the TALOS chat page", () => {
		expect(mainSource).toContain('id: "open-quyuan-v2"');
		expect(mainSource).toContain('leaf.view.navigateToPage("chat")');
		expect(mainSource).toContain('id: "open-quyuan-v2-recovery"');
	});
});
