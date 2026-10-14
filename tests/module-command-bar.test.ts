import { describe, expect, it, vi } from "vitest";
import { renderModuleCommandBar } from "../src/ui/module-command-bar";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

type MiniListener = Parameters<MiniElement["addEventListener"]>[1];

function createHost() {
	const host = createMiniHost();
	const document = host.element.ownerDocument;
	const createElement = document.createElement.bind(document);
	// The shared fixture predates listener cleanup. Add the browser operation
	// only to this test's elements, without changing the shared DOM helper.
	vi.spyOn(document, "createElement").mockImplementation((tagName) => {
		const element = createElement(tagName);
		Object.assign(element, {
			removeEventListener(type: string, listener: MiniListener) {
				const remaining = (element.listeners.get(type) ?? [])
					.filter((candidate) => candidate !== listener);
				element.listeners.set(type, remaining);
			},
		});
		return element;
	});
	return host;
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const entries = [
	{ id: "capture", label: "记录", description: "记录到收件箱" },
	{ id: "search", label: "检索", description: "查找已有资料" },
	{
		id: "import",
		label: "导入",
		description: "导入现有资料",
		disabled: true,
		disabledReason: "尚未配置导入器",
	},
];

function command(element: MiniElement, id: string): MiniElement {
	const button = element.querySelector<MiniElement>(
		`button[data-module-command='${id}']`
	);
	if (!button) throw new Error(`Missing command: ${id}`);
	return button;
}

describe("module command bar", () => {
	it("renders native themed buttons and invokes the selected command once", async () => {
		const { host, element } = createHost();
		const onInvoke = vi.fn();
		renderModuleCommandBar(host, entries, onInvoke);
		const button = command(element, "capture");

		expect(button.type).toBe("button");
		expect(button.classList.contains("module-hero-action")).toBe(true);
		expect(button.getAttribute("title")).toBe("记录到收件箱");
		button.click();
		expect(onInvoke).toHaveBeenCalledExactlyOnceWith("capture");
		await vi.waitFor(() => expect(button.disabled).toBe(false));
		expect(element.querySelector<MiniElement>("[aria-live='polite']")?.textContent).toBe("");
	});

	it("shows the disabled reason and rejects even a dispatched disabled click", () => {
		const { host, element } = createHost();
		const onInvoke = vi.fn();
		renderModuleCommandBar(host, entries, onInvoke);
		const button = command(element, "import");

		expect(button.disabled).toBe(true);
		expect(button.textContent).toContain("尚未配置导入器");
		expect(button.getAttribute("aria-label")).toContain("尚未配置导入器");
		button.click();
		button.dispatch("click");
		expect(onInvoke).not.toHaveBeenCalled();
	});

	it("blocks double clicks and other commands while a request is pending", async () => {
		const { host, element } = createHost();
		const request = deferred();
		const onInvoke = vi.fn().mockReturnValue(request.promise);
		renderModuleCommandBar(host, entries, onInvoke);
		const capture = command(element, "capture");
		const search = command(element, "search");
		capture.click();
		capture.dispatch("click");
		search.dispatch("click");

		expect(onInvoke).toHaveBeenCalledExactlyOnceWith("capture");
		expect(capture.disabled).toBe(true);
		expect(search.disabled).toBe(true);
		request.resolve();
		await vi.waitFor(() => expect(search.disabled).toBe(false));
		expect(command(element, "import").disabled).toBe(true);
		search.click();
		expect(onInvoke).toHaveBeenLastCalledWith("search");
		expect(onInvoke).toHaveBeenCalledTimes(2);
	});

	it.each(["sync", "async"])("reports %s failures locally and allows retry", async (kind) => {
		const { host, element } = createHost();
		const onInvoke = vi.fn(() => {
			if (kind === "sync") throw new Error("输入无效");
			return Promise.reject(new Error("输入无效"));
		});
		renderModuleCommandBar(host, entries, onInvoke);
		const button = command(element, "capture");
		button.click();

		const status = element.querySelector<MiniElement>("[aria-live='polite']");
		await vi.waitFor(() => expect(status?.textContent).toContain("输入无效"));
		expect(status?.getAttribute("role")).toBe("status");
		expect(button.disabled).toBe(false);
		button.click();
		expect(onInvoke).toHaveBeenCalledTimes(2);
	});

	it.each(["resolve", "reject"])("removes listeners and ignores a late %s after unmount", async (outcome) => {
		const { host, element } = createHost();
		const request = deferred();
		const onInvoke = vi.fn().mockReturnValue(request.promise);
		const bar = renderModuleCommandBar(host, entries, onInvoke);
		const button = command(element, "capture");
		const status = element.querySelector<MiniElement>("[aria-live='polite']");
		button.click();
		const previousStatus = status?.textContent;
		bar.unmount();
		bar.unmount();

		expect(element.children).toHaveLength(0);
		expect(button.listeners.get("click")).toHaveLength(0);
		button.dispatch("click");
		if (outcome === "resolve") request.resolve();
		else request.reject(new Error("迟到错误"));
		await request.promise.catch(() => undefined);
		await Promise.resolve();

		expect(onInvoke).toHaveBeenCalledTimes(1);
		expect(status?.textContent).toBe(previousStatus);
		expect(button.disabled).toBe(true);
	});
});
