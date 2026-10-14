import { clearTimeout, setTimeout } from "node:timers";
import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleActionRuntime } from "../src/console-action-runtime";
import { ModuleCommandController } from "../src/module-commands/controller";
import type { LocalMediaRecognition } from "../src/module-commands/media-recognition";
import type { ModuleCommandHost, ModuleDataKey } from "../src/module-commands/service";
import { MemoryRecoveryStore } from "../src/task-core/recovery-store";
import type { MiniElement } from "./helpers/mini-dom";

const modalState = vi.hoisted(() => ({ opened: [] as unknown[], notices: [] as string[] }));

// Mock only the Obsidian host shell. The controller, service, risk policy,
// registry, task store and runner below are the production implementations.
vi.mock("obsidian", async () => {
	const { MiniDocument, MiniElement } = await import("./helpers/mini-dom");
	type ElementOptions = { text?: string; cls?: string; attr?: Record<string, string>; type?: string; value?: string };
	class HostElement extends MiniElement {
		empty() { this.replaceChildren(); }
		setText(text: string) { this.textContent = text; }
		createEl(tag: string, options: ElementOptions = {}): HostElement {
			const element = this.ownerDocument.createElement(tag) as HostElement;
			if (options.text) element.textContent = options.text;
			if (options.cls) element.className = options.cls;
			if (options.type) element.type = options.type;
			if (options.value) element.value = options.value;
			for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
			this.appendChild(element);
			return element;
		}
		createDiv(options?: ElementOptions) { return this.createEl("div", options); }
		createSpan(options?: ElementOptions) { return this.createEl("span", options); }
	}
	class HostDocument extends MiniDocument {
		override createElement(tag: string): HostElement { return new HostElement(tag, this); }
	}
	class HostModal {
		readonly contentEl = new HostDocument().createElement("div");
		readonly titleEl = new HostDocument().createElement("h1");
		private isOpen = false;
		constructor(readonly app: unknown) {}
		onOpen() {}
		onClose() {}
		open() { this.isOpen = true; modalState.opened.push(this); this.onOpen(); }
		close() { if (this.isOpen) { this.isOpen = false; this.onClose(); } }
	}
	return {
		App: class {},
		Modal: HostModal,
		Notice: class { constructor(message: string) { modalState.notices.push(message); } },
		TFile: class {},
	};
});

interface ModalHandle { contentEl: MiniElement; close(): void }

const controllers: ModuleCommandController[] = [];

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

function harness(conditionalDelete = true, mediaRecognition?: () => LocalMediaRecognition) {
	const roots: Record<ModuleDataKey, string> & { system: string } = {
		inbox: "00 Inbox", logs: "10 Logs", insights: "20 Insights", assets: "30 Assets",
		projects: "40 Projects", archive: "90 Archive", identity: "Identity", output: "70 Output", system: "System",
	};
	const files = new Map<string, Uint8Array>();
	const write = vi.fn(async (path: string, content: Uint8Array) => { files.set(path, new Uint8Array(content)); });
	const host: ModuleCommandHost = {
		conditionalDelete,
		roots: () => roots,
		files: () => [...files].map(([path, bytes]) => ({ path, extension: path.split(".").pop() ?? "", size: bytes.length, mtime: 0 })),
		exists: async path => files.has(path),
		read: async path => {
			const bytes = files.get(path);
			if (!bytes) throw new Error("文件不存在");
			return new Uint8Array(bytes);
		},
		write,
		remove: async path => { files.delete(path); },
		assertPath: async () => {},
		now: () => new Date("2026-09-05T00:00:00.000Z"),
	};
	const recoveryStore = new MemoryRecoveryStore();
	const runtime = createConsoleActionRuntime({
		dependencies: {
			refreshStats: vi.fn(), vaultLint: vi.fn(), deepResearch: vi.fn(), createNote: vi.fn(),
			publishBackfill: vi.fn(), decideApproval: vi.fn(), decidePreference: vi.fn(),
		},
		recoveryStore,
		timers: { schedule: (callback, timeout) => setTimeout(callback, timeout), cancel: handle => clearTimeout(handle as NodeJS.Timeout) },
	});
	const app = {
		workspace: { getActiveFile: () => null, getLeaf: () => ({ openFile: vi.fn() }) },
		vault: { getAbstractFileByPath: () => null },
	} as unknown as App;
	const ask = vi.fn((_query: string, _signal: AbortSignal) => Promise.resolve("回答"));
	const refresh = vi.fn();
	const controller = new ModuleCommandController({ app, runtime, host, refresh, ask, mediaRecognition });
	controllers.push(controller);
	return { controller, runtime, host, files, write, ask, refresh };
}

function modal(): ModalHandle {
	const current = modalState.opened.at(-1) as ModalHandle | undefined;
	if (!current) throw new Error("No command modal was opened");
	return current;
}

function button(root: MiniElement, text: string): MiniElement {
	const found = root.querySelectorAll<MiniElement>("button").find(entry => entry.textContent === text);
	if (!found) throw new Error(`Missing button: ${text}`);
	return found;
}

function fill(root: MiniElement, label: string, text: string): void {
	const input = root.querySelector<MiniElement>(`[aria-label='${label}']`);
	if (!input) throw new Error(`Missing field: ${label}`);
	input.value = text;
	input.dispatch("input");
}

async function previewNote(controller: ModuleCommandController) {
	const closed = controller.open("capture.note");
	const root = modal().contentEl;
	fill(root, "标题", "测试记录");
	fill(root, "内容", "只属于合成测试的内容");
	button(root, "预览操作").click();
	await vi.waitFor(() => expect(root.textContent).toContain("确认执行本次操作"));
	return { root, closed, confirm: button(root, "确认执行本次操作") };
}

beforeEach(() => { modalState.opened.length = 0; modalState.notices.length = 0; });
afterEach(() => { for (const controller of controllers.splice(0)) controller.close(); vi.restoreAllMocks(); });

describe("local media action wiring", () => {
 it("runs configured OCR through the existing read-only task and displays actual text", async () => {
  const recognize = vi.fn(async () => ({ actionId: "media.ocr" as const, path: "30 Assets/sample.png", text: "TALOS 4268", engine: "macos-vision" as const, warnings: ["请核对原图"] }));
  const engine = { unavailable: vi.fn(async () => null), recognize } as unknown as LocalMediaRecognition;
  const test = harness(true, () => engine);
  const closed = test.controller.open("media.ocr");
  const root = modal().contentEl;
  fill(root, "资料路径", "30 Assets/sample.png");
  await vi.waitFor(() => expect(button(root, "执行").disabled).toBe(false));
  button(root, "执行").click();
  await vi.waitFor(() => expect(root.textContent).toContain("TALOS 4268"));
  expect(recognize).toHaveBeenCalledWith("media.ocr", "30 Assets/sample.png", expect.any(AbortSignal));
  expect(test.runtime.store.list()[0]).toMatchObject({ actionId: "module-command-media.ocr", state: "completed", changes: [] });
  modal().close(); await closed;
 });
 it("leaves transcription disabled when the configured engine is missing", async () => {
  const recognize = vi.fn();
  const engine = { unavailable: vi.fn(async () => "本机 Whisper 模型未配置"), recognize } as unknown as LocalMediaRecognition;
  const test = harness(true, () => engine);
  const closed = test.controller.open("media.transcribe");
  const root = modal().contentEl;
  await vi.waitFor(() => expect(root.textContent).toContain("本机 Whisper 模型未配置"));
  expect(button(root, "执行").disabled).toBe(true);
  expect(recognize).not.toHaveBeenCalled();
  modal().close(); await closed;
 });
});

describe("module command controller wiring", () => {
	it("requires the displayed preview before writing through the shared runner exactly once", async () => {
		const test = harness();
		const run = vi.spyOn(test.runtime.runner, "run");
		const { root, confirm } = await previewNote(test.controller);
		expect(test.write).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(test.runtime.store.list()).toHaveLength(0);
		expect(root.textContent).toContain("只属于合成测试的内容");

		confirm.click();
		confirm.dispatch("click");
		await vi.waitFor(() => expect(test.runtime.store.list()[0]?.state).toBe("completed"));
		expect(run).toHaveBeenCalledTimes(1);
		expect(run.mock.calls[0]?.[0]).toMatchObject({ actionId: "module-command-capture.note", approvalGranted: true });
		expect(test.write).toHaveBeenCalledTimes(1);
		expect(test.files.size).toBe(1);
		expect(test.runtime.store.list()[0]?.changes).toEqual([{ path: [...test.files.keys()][0], kind: "create" }]);
		expect(test.runtime.runner.canRevert(test.runtime.store.list()[0].id)).toBe(false);
		await vi.waitFor(() => expect(root.textContent).toContain("撤销本次写入"));
	});

	it("invalidates the old confirmation when the user edits previewed input", async () => {
		const test = harness();
		const { root, confirm } = await previewNote(test.controller);
		fill(root, "内容", "修改后的内容");
		confirm.dispatch("click");
		await Promise.resolve();
		expect(test.write).not.toHaveBeenCalled();
		expect(test.runtime.store.list()).toHaveLength(0);
	});

	it("shows a failed shared task without success-only output controls", async () => {
		const test = harness();
		test.write.mockRejectedValue(new Error("磁盘写入失败"));
		const { root, confirm } = await previewNote(test.controller);
		confirm.click();
		await vi.waitFor(() => expect(test.runtime.store.list()[0]?.state).toBe("failed"));
		await vi.waitFor(() => expect(root.textContent).toContain("已失败"));
		expect(test.runtime.store.list()[0]?.error).toBeTruthy();
		expect(test.files.size).toBe(0);
		expect(test.refresh).not.toHaveBeenCalled();
		expect(root.querySelectorAll<MiniElement>("button").some(entry => entry.textContent.startsWith("打开 "))).toBe(false);
		expect(root.textContent).not.toContain("撤销本次写入");
	});

	it("cancels an active shared task on close before a pending validation can write", async () => {
		const test = harness();
		const gate = deferred<void>();
		const { root, confirm, closed } = await previewNote(test.controller);
		const validation = vi.spyOn(test.host, "assertPath").mockImplementationOnce(async () => { await gate.promise; });
		const run = vi.spyOn(test.runtime.runner, "run");
		confirm.click();
		await vi.waitFor(() => expect(validation).toHaveBeenCalledOnce());
		expect(test.runtime.store.list()[0]?.state).toBe("running");
		test.controller.close();
		await closed;
		expect(test.runtime.store.list()[0]?.state).toBe("cancelled");
		gate.resolve();
		await run.mock.results[0]?.value;
		expect(test.write).not.toHaveBeenCalled();
		expect(root.textContent).toBe("");
	});

	it("does not start an AI request if closed while input collection is yielding", async () => {
		const test = harness();
		const closed = test.controller.open("search.ask");
		const root = modal().contentEl;
		fill(root, "查找或提问内容", "公开测试问题");
		button(root, "使用当前模型提问").click();
		test.controller.close();
		await closed;
		await Promise.resolve();
		expect(test.ask).not.toHaveBeenCalled();
		expect(root.textContent).toBe("");
	});

	it("aborts an active AI request and suppresses its late answer after close", async () => {
		const test = harness();
		const response = deferred<string>();
		test.ask.mockReturnValue(response.promise);
		const closed = test.controller.open("search.ask");
		const root = modal().contentEl;
		fill(root, "查找或提问内容", "公开测试问题");
		button(root, "使用当前模型提问").click();
		await vi.waitFor(() => expect(test.ask).toHaveBeenCalledOnce());
		const signal = test.ask.mock.calls[0]?.[1];
		test.controller.close();
		await closed;
		expect(signal?.aborted).toBe(true);
		response.resolve("迟到的回答");
		await response.promise;
		await Promise.resolve();
		expect(root.textContent).toBe("");
	});

	it("preserves a later user edit and does not claim a conflicting undo succeeded", async () => {
		const test = harness();
		const { root, confirm } = await previewNote(test.controller);
		confirm.click();
		await vi.waitFor(() => expect(root.textContent).toContain("撤销本次写入"));
		const [path] = test.files.keys();
		if (!path) throw new Error("Expected the created note");
		const laterEdit = new TextEncoder().encode("用户随后修改的内容");
		test.files.set(path, laterEdit);
		button(root, "撤销本次写入").click();
		await vi.waitFor(() => expect(root.textContent).toContain("恢复失败"));
		expect(test.files.get(path)).toEqual(laterEdit);
		expect(test.runtime.store.list()[0]?.state).toBe("completed");
		expect(root.textContent).not.toContain("已恢复本次写入前的文件");
	});

	it("updates the shared task only after a successful conditional undo", async () => {
		const test = harness();
		const { root, confirm } = await previewNote(test.controller);
		confirm.click();
		await vi.waitFor(() => expect(root.textContent).toContain("撤销本次写入"));
		button(root, "撤销本次写入").click();
		await vi.waitFor(() => expect(test.runtime.store.list()[0]?.state).toBe("reverted"));
		expect(test.files.size).toBe(0);
		expect(root.textContent).toContain("已恢复本次写入前的文件");
	});

	it("does not offer unsafe deletion undo on a host without conditional removal", async () => {
		const test = harness(false);
		const { root, confirm } = await previewNote(test.controller);
		confirm.click();
		await vi.waitFor(() => expect(test.runtime.store.list()[0]?.state).toBe("completed"));
		expect(root.textContent).not.toContain("撤销本次写入");
		expect(root.textContent).toContain("新建文件不会自动删除");
		expect(test.files.size).toBe(1);
	});

	it("runs a read-only command through the shared runner without a write confirmation", async () => {
		const test = harness();
		const run = vi.spyOn(test.runtime.runner, "run");
		void test.controller.open("system.status");
		const root = modal().contentEl;
		button(root, "执行").click();
		await vi.waitFor(() => expect(test.runtime.store.list()[0]?.state).toBe("completed"));
		expect(run.mock.calls[0]?.[0]).toMatchObject({ actionId: "module-command-system.status", request: { writePaths: [], effects: ["read"] } });
		expect(root.textContent).not.toContain("确认执行本次操作");
		expect(test.write).not.toHaveBeenCalled();
	});

	it.each([
		["media.ocr", "执行", "尚未配置图片文字识别引擎"],
	])("keeps unavailable %s visible and disabled, and can close normally", async (id, label, reason) => {
		const test = harness();
		const prepare = vi.spyOn(test.controller, "prepare");
		const closed = test.controller.open(id);
		const root = modal().contentEl;
		const submit = button(root, label);
		expect(submit.disabled).toBe(true);
		expect(root.textContent).toContain(reason);
		submit.click();
		expect(prepare).not.toHaveBeenCalled();
		expect(test.runtime.store.list()).toHaveLength(0);
		button(root, "关闭").click();
		await closed;
		expect(root.textContent).toBe("");
	});

	it("previews and confirms the local cycle through the existing task runner", async () => {
		const test = harness();
		test.files.set("00 Inbox/sample.md", new TextEncoder().encode("# Fictional source\n"));
		const run = vi.spyOn(test.runtime.runner, "run");
		void test.controller.open("flow.cycle");
		const root = modal().contentEl;
		fill(root, "资料路径", "00 Inbox/sample.md");
		fill(root, "本轮确认的记忆", "Only this confirmed test memory");
		fill(root, "记忆类型", "事实");
		button(root, "预览操作").click();
		await vi.waitFor(() => expect(root.textContent).toContain("确认执行本次操作"));
		expect(test.write).not.toHaveBeenCalled();
		expect(root.textContent).toContain("System/working-memory/daily/2026-09-05.md");
		button(root, "确认执行本次操作").click();
		await vi.waitFor(() => expect(test.runtime.store.list()[0]?.state).toBe("completed"));
		expect(run.mock.calls[0]?.[0]).toMatchObject({ actionId: "module-command-flow.cycle", approvalGranted: true, request: { touchesIdentity: true } });
		expect([...test.files.keys()]).toEqual(expect.arrayContaining([expect.stringContaining("20 Insights/资料索引-"), "System/working-memory/daily/2026-09-05.md"]));
	});

	it("shows deterministic repair targets before allowing a write", async () => {
		const test = harness();
		test.files.set("00 Inbox/unstructured.md", new TextEncoder().encode("# Original content\n"));
		void test.controller.open("system.repair");
		const root = modal().contentEl;
		fill(root, "检查范围", "00 Inbox");
		button(root, "预览操作").click();
		await vi.waitFor(() => expect(root.textContent).toContain("确认执行本次操作"));
		expect(root.textContent).toContain("00 Inbox/unstructured.md");
		expect(test.write).not.toHaveBeenCalled();
		button(root, "确认执行本次操作").click();
		await vi.waitFor(() => expect(test.runtime.store.list()[0]?.state).toBe("completed"));
		expect(new TextDecoder().decode(test.files.get("00 Inbox/unstructured.md"))).toBe("---\n---\n\n# Original content\n");
	});

	it("rejects unknown invocations without opening a modal or scheduling a task", async () => {
		const test = harness();
		await test.controller.open("/unregistered-command");
		expect(modalState.opened).toHaveLength(0);
		expect(modalState.notices.join(" ")).toContain("尚不能直接执行");
		expect(test.runtime.store.list()).toHaveLength(0);
		expect(test.write).not.toHaveBeenCalled();
	});
});
