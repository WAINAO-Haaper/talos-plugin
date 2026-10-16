/**
 * Real happy-dom events and the real publishing UI/X preview renderer.
 * Obsidian Modal/FuzzySuggestModal, DOM helpers, sanitizer, notices, and workspace
 * are test substitutes. PreviewController uses its real 350ms Window timers.
 * Delivery uses a narrow host stub; the settings persistence
 * test uses the real PublishingHost with a temporary vault and memory secrets.
 * These checks do not exercise Obsidian, Chrome, WeChat, or a network relay.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, TFile } from "obsidian";
import type TalosPlugin from "../src/main";
import { PublishingHost, type PublishingApproval } from "../src/publishing/host";
import { PublishingModal } from "../src/publishing/modal";
import { PublishingSettingsModal } from "../src/publishing/settings-modal";
import type { ArticleInput, PreparedArticle, PublishRecord, PublishingAccount } from "../src/publishing/types";

const obsidianUi = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock("obsidian", () => {
	class TestModal {
		readonly modalEl = activeDocument.createElement("section");
		readonly contentEl = activeDocument.createElement("div");
		constructor(readonly app: App) { this.modalEl.append(this.contentEl); }
		setTitle(title: string) { this.modalEl.setAttribute("aria-label", title); }
		open() { activeDocument.body.append(this.modalEl); opened.push(this); this.onOpen(); return this; }
		close() { this.onClose(); this.modalEl.remove(); }
		onOpen() {}
		onClose() {}
	}
	class TestFuzzySuggestModal<T> extends TestModal {
		readonly inputEl = activeDocument.createElement("input");
		readonly choices = activeDocument.createElement("div");
		constructor(app: App) { super(app); this.modalEl.className = "mock-fuzzy-suggest"; this.contentEl.append(this.inputEl, this.choices); this.inputEl.addEventListener("input", () => this.renderChoices()); }
		setPlaceholder(value: string) { this.inputEl.placeholder = value; }
		getItems(): T[] { return []; }
		getItemText(_item: T): string { return ""; }
		onChooseItem(_item: T) {}
		open() { super.open(); this.renderChoices(); return this; }
		private renderChoices() {
			this.choices.replaceChildren();
			for (const item of this.getItems().filter(value => this.getItemText(value).includes(this.inputEl.value))) {
				const choice = activeDocument.createElement("button"); choice.textContent = this.getItemText(item);
				choice.addEventListener("click", () => { this.onChooseItem(item); this.close(); }); this.choices.append(choice);
			}
		}
	}
	return {
	Modal: TestModal,
	FuzzySuggestModal: TestFuzzySuggestModal,
	Notice: class { constructor(message: string) { obsidianUi.notices.push(message); } },
	TFile: class {},
	requestUrl: vi.fn(() => { throw new Error("Network is forbidden in UI tests"); }),
	sanitizeHTMLToDom: (html: string) => {
		// eslint-disable-next-line no-unsanitized/method -- Test-only Obsidian sanitizer substitute; fixture HTML is local and controlled.
		return activeDocument.createRange().createContextualFragment(html);
	},
}; });

const testWindow = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
const activeDocument = testWindow.document as unknown as Document;
const temporaryVaults: string[] = [];
const opened: Array<{ close(): void }> = [];
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9V0AAAAASUVORK5CYII=", "base64"));
const accounts: PublishingAccount[] = [
	{ id: "wechat-demo", label: "示例公众号", platform: "wechat", appId: "wx1234567890123456", secretRef: "talos-publishing-wechat-demo" },
	{ id: "x-demo", label: "@demo", platform: "x", xAccount: "demo" },
];
const prepared: PreparedArticle = {
	sourcePath: "文章/示例.md", title: "冻结后的标题", markdown: "# 正文原有 H1\n\n正文", wechatHtml: "<section><h1>正文原有 H1</h1><p>冻结后的正文</p></section>", xMarkdown: "冻结后的正文",
	digest: "摘要", author: "作者", assets: [], wechatAssets: [], warnings: ["示例检查提示"],
	cover: { source: "cover.png", fileName: "cover.png", mime: "image/png", bytes: png, sha256: "fixture-cover" },
	fingerprint: "fixture-frozen-fingerprint", createdAt: "2026-10-17T00:00:00Z",
};

type ElementOptions = { text?: string; cls?: string; attr?: Record<string, string>; value?: string };

beforeAll(() => {
	vi.stubGlobal("window", testWindow);
	vi.stubGlobal("document", activeDocument);
	const prototype = testWindow.HTMLElement.prototype;
	function createEl(this: HTMLElement, tag: string, options: ElementOptions = {}): HTMLElement {
		const element = activeDocument.createElement(tag);
		if (options.text !== undefined) element.textContent = options.text;
		if (options.cls) element.className = options.cls;
		for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
		if (options.value !== undefined) (element as HTMLInputElement).value = options.value;
		this.append(element);
		return element;
	}
	Object.defineProperties(prototype, {
		createEl: { configurable: true, value: createEl },
		createDiv: { configurable: true, value(this: HTMLElement, options?: ElementOptions) { return createEl.call(this, "div", options); } },
		createSpan: { configurable: true, value(this: HTMLElement, options?: ElementOptions) { return createEl.call(this, "span", options); } },
		empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
		setText: { configurable: true, value(this: HTMLElement, text: string) { this.textContent = text; } },
		addClass: { configurable: true, value(this: HTMLElement, ...names: string[]) { this.classList.add(...names); } },
	});
});

afterEach(async () => {
	for (const modal of opened.splice(0)) modal.close();
	activeDocument.body.replaceChildren();
	obsidianUi.notices.length = 0;
	for (const path of temporaryVaults.splice(0)) await rm(path, { recursive: true, force: true });
});

afterAll(async () => { await testWindow.happyDOM.close(); vi.unstubAllGlobals(); });

function record(id = "record-1", states: Array<"queued" | "unknown" | "draft-created"> = ["draft-created"]): PublishRecord {
	return { id, sourcePath: "文章/示例.md", snapshotHash: prepared.fingerprint, createdAt: prepared.createdAt, updatedAt: prepared.createdAt,
		targets: states.map((state, index) => ({ platform: index ? "wechat" : "x", accountId: `target-${index}`, accountLabel: index ? "示例公众号" : "@demo", state, snapshotHash: prepared.fingerprint, updatedAt: prepared.createdAt })) };
}

function stubHost(configured = accounts) {
	let proposalSequence = 0;
	const subscriptions: Array<{ path: string; onChange: (currentPath: string) => void; unsubscribe: ReturnType<typeof vi.fn<() => void>> }> = [];
	return {
		revokeApproval: vi.fn(),
		listNotes: vi.fn(() => [{ path: "文章/示例.md", basename: "示例", extension: "md" }] as TFile[]),
		listImages: vi.fn(() => [{ path: "附件/封面 中文.png", basename: "封面 中文", extension: "png" }] as TFile[]),
		watchSource: vi.fn((path: string, onChange: (currentPath: string) => void) => { const subscription = { path, onChange, unsubscribe: vi.fn<() => void>() }; subscriptions.push(subscription); return subscription.unsubscribe; }),
		subscriptions,
		loadConfig: vi.fn(async () => ({ accounts: configured })),
		prepare: vi.fn(async (input: Omit<ArticleInput, "markdown">) => preparedFor(input)),
		proposal: vi.fn(async (article: PreparedArticle, ids: string[]): Promise<PublishingApproval> => ({ id: `approval-${++proposalSequence}`, article, accounts: configured.filter(account => ids.includes(account.id)) })),
		confirm: vi.fn(async (_id: string, _onRecord: (value: PublishRecord) => void) => record()),
		records: vi.fn(async (): Promise<PublishRecord[]> => []),
		reconcile: vi.fn(async (_id: string) => record()),
		cancel: vi.fn(),
		saveAccounts: vi.fn(async (_input: { wechatLabel: string; appId: string; appSecret: string; xAccount: string }) => {}),
		copyRelayToken: vi.fn(async () => {}),
	};
}

const app = { workspace: { getActiveFile: () => ({ path: "文章/示例.md", basename: "示例", extension: "md" }) } } as unknown as App;
const hostPort = (host: ReturnType<typeof stubHost>) => host as unknown as PublishingHost;
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function openModal(host: ReturnType<typeof stubHost>): PublishingModal {
	const modal = new PublishingModal(app, hostPort(host)); modal.open(); return modal;
}
function preparedFor(input: Omit<ArticleInput, "markdown">): PreparedArticle {
	return { ...prepared, sourcePath: input.sourcePath, title: input.title, digest: input.digest, author: input.author, fingerprint: `fixture-${JSON.stringify(input)}`,
		cover: prepared.cover && { ...prepared.cover, source: input.coverPath ?? prepared.cover.source } };
}
const waitFor = async (assertion: () => void) => vi.waitFor(assertion, { timeout: 2000, interval: 15 });
async function ready(modal: PublishingModal): Promise<void> { await waitFor(() => expect(modal.contentEl.querySelector(".talos-publishing-preview-badge")?.textContent).toContain("预览已更新")); await settle(); }
const pane = (modal: PublishingModal, platform: string) => modal.contentEl.querySelector<HTMLElement>(`.talos-publishing-preview-body[data-platform="${platform}"]`)!;
function expectTitles(modal: PublishingModal, title: string): void {
	expect(pane(modal, "wechat").shadowRoot?.querySelector(".draft-title")?.textContent).toBe(title);
	expect(pane(modal, "x").shadowRoot?.querySelector(".xp-title")?.textContent).toBe(title);
}
function button(root: HTMLElement, label: string): HTMLButtonElement {
	const result = Array.from(root.querySelectorAll("button")).find(element => element.textContent === label);
	if (!result) throw new Error(`Missing UI button: ${label}`);
	return result;
}
function field(root: HTMLElement, label: string): HTMLInputElement {
	const result = Array.from(root.querySelectorAll("label")).find(element => element.querySelector("span")?.textContent === label)?.querySelector("input");
	if (!result) throw new Error(`Missing UI field: ${label}`);
	return result;
}
function enter(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new testWindow.Event("input", { bubbles: true }) as unknown as Event);
}
function select(root: HTMLElement, label: string, value: string): void {
	const input = root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; input.value = value;
	input.dispatchEvent(new testWindow.Event("change", { bubbles: true }) as unknown as Event);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

describe("PublishingModal automatic preview DOM interactions", () => {
	it("automatically prepares the current note without confirming and shows metadata titles plus source H1", async () => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		expect(host.prepare).toHaveBeenCalledOnce();
		expect(host.prepare).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: "文章/示例.md", title: "示例", presentation: { fontSize: 15, lineHeight: 1.75, accent: "#576b95" } }));
		expect(host.confirm).not.toHaveBeenCalled(); expect(host.copyRelayToken).not.toHaveBeenCalled();
		expectTitles(modal, "示例");
		expect(pane(modal, "wechat").shadowRoot?.querySelector("section h1")?.textContent).toBe("正文原有 H1");
		expect(modal.contentEl.querySelector(".talos-publishing-confirm")?.textContent).toContain("TALOS 无法验证浏览器账号身份");
		expect(modal.contentEl.querySelector(".talos-publishing-confirm")?.textContent).toContain("Chrome 当前登录");
		expect(button(modal.contentEl, "确认创建草稿").disabled).toBe(true);
		const images = [pane(modal, "wechat"), pane(modal, "x")].flatMap(body => Array.from(body.shadowRoot?.querySelectorAll("img") ?? []));
		expect(images).toHaveLength(2); // The supplied cover once in each platform; no upstream avatar.
		for (const image of images) expect(image.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
		const labels = Array.from(modal.contentEl.querySelectorAll("button")).map(element => element.textContent);
		for (const forbidden of ["发布", "正式发布", "立即发布", "一键发布"]) expect(labels).not.toContain(forbidden);
	});

	it("debounces real title, color, font and line-height changes for 350ms and updates both metadata titles", async () => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		enter(field(modal.contentEl, "文章标题"), "最新的文章标题");
		enter(field(modal.contentEl, "主题色"), "#123abc"); select(modal.contentEl, "字号", "18"); select(modal.contentEl, "行距", "2.25");
		await new Promise<void>(resolve => { testWindow.setTimeout(resolve, 100); });
		expect(host.prepare).toHaveBeenCalledOnce(); expectTitles(modal, "示例");
		await ready(modal);
		expect(host.prepare).toHaveBeenCalledTimes(2);
		expect(host.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ title: "最新的文章标题", presentation: { fontSize: 18, lineHeight: 2.25, accent: "#123abc" } }));
		expectTitles(modal, "最新的文章标题"); expect(host.confirm).not.toHaveBeenCalled();
	});

	it("revokes old approval synchronously but retains the last picture with an updating warning", async () => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		const currentApproval = (await host.proposal.mock.results.at(-1)!.value) as PublishingApproval;
		const checkbox = modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")!;
		const send = button(modal.contentEl, "确认创建草稿"); checkbox.click(); expect(send.disabled).toBe(false);
		const previous = pane(modal, "wechat"); enter(field(modal.contentEl, "文章标题"), "下一版");
		expect(send.disabled).toBe(true); expect(modal.contentEl.querySelector(".talos-publishing-confirm input")).toBeNull();
		expect(host.revokeApproval).toHaveBeenCalledWith(currentApproval.id);
		expect(pane(modal, "wechat")).toBe(previous);
		expect(modal.contentEl.querySelector(".talos-publishing-previews")?.getAttribute("data-stale")).toBe("true");
		expect(modal.contentEl.querySelector(".talos-publishing-preview-badge")?.textContent).toContain("正在更新");
		checkbox.click(); send.click(); expect(host.confirm).not.toHaveBeenCalled();
		await ready(modal); expectTitles(modal, "下一版");
		expect(modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")?.checked).toBe(false);
		expect(send.disabled).toBe(true);
	});

	it.each(["result", "error"] as const)("coalesces rapid input and ignores an obsolete asynchronous %s", async outcome => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		const pending = deferred<PreparedArticle>(); host.prepare.mockReturnValueOnce(pending.promise);
		enter(field(modal.contentEl, "文章标题"), "旧请求"); await waitFor(() => expect(host.prepare).toHaveBeenCalledTimes(2));
		enter(field(modal.contentEl, "文章标题"), "中间输入"); enter(field(modal.contentEl, "文章标题"), "最终输入");
		if (outcome === "result") pending.resolve({ ...prepared, title: "不应出现的旧结果" }); else pending.reject(new Error("不应出现的旧错误"));
		await settle(); expectTitles(modal, "示例");
		expect(modal.contentEl.textContent).not.toContain("不应出现");
		await ready(modal); expectTitles(modal, "最终输入");
		expect(host.prepare).toHaveBeenCalledTimes(3);
		expect(host.prepare.mock.calls.map(([input]) => input.title)).not.toContain("中间输入");
		expect(host.confirm).not.toHaveBeenCalled();
	});

	it("clears the picture and disables sending when source is emptied even if the old preparation resolves late", async () => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		const pending = deferred<PreparedArticle>(); host.prepare.mockReturnValueOnce(pending.promise);
		button(modal.contentEl, "刷新正文").click(); await waitFor(() => expect(host.prepare).toHaveBeenCalledTimes(2));
		enter(field(modal.contentEl, "文章笔记"), "");
		expect(button(modal.contentEl, "确认创建草稿").disabled).toBe(true);
		expect(modal.contentEl.querySelector(".talos-publishing-preview-body")).toBeNull();
		expect(modal.contentEl.querySelector(".talos-publishing-preview-badge")?.textContent).toBe("等待选稿");
		expect(host.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
		pending.resolve(prepared); await settle();
		expect(modal.contentEl.querySelector(".talos-publishing-preview-body")).toBeNull(); expect(host.confirm).not.toHaveBeenCalled();
	});

	it("does not resurrect old proposals while accounts are deselected, and sends only the newly selected approval", async () => {
		const host = stubHost(); const first = deferred<PublishingApproval>(); const second = deferred<PublishingApproval>();
		host.proposal.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce({ id: "new-x-only", article: prepared, accounts: [accounts[1]] });
		const modal = openModal(host); await ready(modal);
		const targets = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>(".talos-publishing-targets input"));
		targets[0].click(); targets[1].click();
		first.resolve({ id: "old-both", article: prepared, accounts }); second.resolve({ id: "old-x", article: prepared, accounts: [accounts[1]] }); await settle();
		expect(modal.contentEl.querySelector(".talos-publishing-confirm input")).toBeNull();
		const send = button(modal.contentEl, "确认创建草稿"); expect(send.disabled).toBe(true); send.click(); expect(host.confirm).not.toHaveBeenCalled();
		targets[1].click(); await settle();
		expect(host.proposal).toHaveBeenLastCalledWith(expect.objectContaining({ title: "示例" }), ["x-demo"]);
		modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")!.click(); send.click(); await settle();
		expect(host.confirm).toHaveBeenCalledExactlyOnceWith("new-x-only", expect.any(Function));
	});

	it("locks editing during confirmation and calls confirm with the current approval id exactly once", async () => {
		const host = stubHost(); const pending = deferred<PublishRecord>(); host.confirm.mockReturnValueOnce(pending.promise);
		const modal = openModal(host); await ready(modal);
		const approval = await (host.proposal.mock.results.at(-1)!.value as Promise<PublishingApproval>);
		modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")!.click();
		const send = button(modal.contentEl, "确认创建草稿"); send.click(); send.click(); await settle();
		expect(host.confirm).toHaveBeenCalledExactlyOnceWith(approval.id, expect.any(Function));
		for (const control of Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>(".talos-publishing-editor input, .talos-publishing-editor select, .talos-publishing-editor button"))) expect(control.disabled).toBe(true);
		expect(button(modal.contentEl, "账号设置").disabled).toBe(true); expect(button(modal.contentEl, "刷新正文").disabled).toBe(true);
		expect(button(modal.contentEl, "取消等待").hidden).toBe(false);
		pending.resolve(record()); await settle();
		expect(field(modal.contentEl, "文章标题").disabled).toBe(false);
		expect(button(modal.contentEl, "确认创建草稿").disabled).toBe(true);
		expect(host.confirm).toHaveBeenCalledOnce();
	});

	it("refreshes immediately on a watched note change and releases its watch on close", async () => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		expect(host.watchSource).toHaveBeenCalledWith("文章/示例.md", expect.any(Function));
		host.subscriptions[0].onChange("文章/示例.md"); await settle();
		expect(host.prepare).toHaveBeenCalledTimes(2); await ready(modal);
		modal.close(); expect(host.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
	});

	it("follows a watched note rename using its new path without discarding a custom metadata title", async () => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		enter(field(modal.contentEl, "文章标题"), "用户自定义标题"); await ready(modal);
		host.subscriptions[0].onChange("文章/重命名后的文章.md");
		expect(field(modal.contentEl, "文章笔记").value).toBe("文章/重命名后的文章.md");
		expect(field(modal.contentEl, "文章标题").value).toBe("用户自定义标题");
		await ready(modal);
		expect(host.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ sourcePath: "文章/重命名后的文章.md", title: "用户自定义标题" }));
		expectTitles(modal, "用户自定义标题");
		expect(host.watchSource).toHaveBeenCalledOnce(); expect(host.confirm).not.toHaveBeenCalled();
	});

	it("ignores late results and watch callbacks after close without rebuilding detached content", async () => {
		const host = stubHost(); const pending = deferred<PreparedArticle>(); host.prepare.mockReturnValueOnce(pending.promise);
		const modal = openModal(host); await waitFor(() => expect(host.prepare).toHaveBeenCalledOnce());
		modal.close(); expect(host.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
		pending.resolve(prepared); host.subscriptions[0].onChange("文章/示例.md"); await settle();
		expect(modal.contentEl.childElementCount).toBe(0); expect(host.prepare).toHaveBeenCalledOnce();
		expect(host.proposal).not.toHaveBeenCalled(); expect(host.confirm).not.toHaveBeenCalled();
	});

	it("selects a Chinese cover through the native-picker boundary and automatically previews its thumbnail", async () => {
		const host = stubHost(); host.prepare.mockResolvedValueOnce({ ...prepared, title: "示例", cover: undefined });
		const modal = openModal(host); await ready(modal);
		expect(modal.contentEl.querySelector(".talos-publishing-cover-thumb img")).toBeNull();
		button(modal.contentEl, "选择封面").click();
		const picker = activeDocument.querySelector<HTMLElement>(".mock-fuzzy-suggest")!;
		expect(picker.querySelector<HTMLInputElement>("input")?.placeholder).toBe("搜索封面名称或路径");
		enter(picker.querySelector<HTMLInputElement>("input")!, "中文");
		button(picker, "封面 中文 · 附件/封面 中文.png").click();
		expect(field(modal.contentEl, "封面图片").value).toBe("附件/封面 中文.png");
		await ready(modal);
		expect(host.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ coverPath: "附件/封面 中文.png" }));
		expect(modal.contentEl.querySelector(".talos-publishing-cover-thumb img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
		expect(host.confirm).not.toHaveBeenCalled();
	});

	it("switches platform views without preparing again or changing confirmation eligibility", async () => {
		const host = stubHost(); const modal = openModal(host); await ready(modal);
		const checked = modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")!; checked.click();
		const proposalCount = host.proposal.mock.calls.length;
		for (const [label, mode] of [["公众号", "wechat"], ["X 文章", "x"], ["双平台", "both"]]) {
			button(modal.contentEl, label).click();
			expect(modal.contentEl.querySelector(".talos-publishing-previews")?.getAttribute("data-preview-mode")).toBe(mode);
			expect(button(modal.contentEl, label).getAttribute("aria-pressed")).toBe("true");
		}
		expect(host.prepare).toHaveBeenCalledOnce(); expect(host.proposal).toHaveBeenCalledTimes(proposalCount);
		expect(checked.checked).toBe(true); expect(button(modal.contentEl, "确认创建草稿").disabled).toBe(false); expect(host.confirm).not.toHaveBeenCalled();
	});

	it("shows queued and unknown history honestly and reconciles without creating another draft", async () => {
		const host = stubHost(); host.records.mockResolvedValue([record("queued-record", ["queued"]), record("unknown-record", ["unknown"])]);
		const modal = openModal(host); await ready(modal);
		const history = modal.contentEl.querySelector<HTMLElement>(".talos-publishing-history")!;
		expect(history.textContent).toContain("已排队，等待 X 回执"); expect(history.textContent).toContain("结果待确认"); expect(history.textContent).not.toContain("草稿已创建");
		button(history, "核对原草稿结果").click(); await settle();
		expect(host.reconcile).toHaveBeenCalledExactlyOnceWith("unknown-record"); expect(host.confirm).not.toHaveBeenCalled();
	});
});

describe("PublishingSettingsModal real DOM interactions", () => {
	it("opens settings from the workspace with an empty password and pairs only on an explicit click", async () => {
		const host = stubHost(); const modal = openModal(host); await settle();
		button(modal.contentEl, "账号设置").click(); await settle();
		const settings = activeDocument.querySelector<HTMLElement>(".talos-publishing-settings")!;
		expect(settings).not.toBeNull();
		const credentialInput = settings.querySelector<HTMLInputElement>('input[type="password"]')!;
		expect(credentialInput.value).toBe("");
		expect(settings.textContent).toContain("SecretStorage");
		expect(settings.textContent).toContain("每次发送前需确认 Chrome 当前登录账号");
		expect(host.copyRelayToken).not.toHaveBeenCalled();
		button(settings, "复制 X 中转配对码").click(); await settle();
		expect(host.copyRelayToken).toHaveBeenCalledOnce();
		expect(host.saveAccounts).not.toHaveBeenCalled();
	});

	it("saves an entered secret through real SecretStorage while writing only references to the temporary vault config", async () => {
		const root = await mkdtemp(join(tmpdir(), "talos-publishing-ui-")); temporaryVaults.push(root);
		const configDir = "publishing-ui-config";
		const dataPath = join(root, configDir, "plugins/talos/data.json");
		await mkdir(join(root, configDir, "plugins/talos"), { recursive: true });
		await writeFile(dataPath, '{"existing":"unchanged"}');
		const values = new Map<string, string>();
		const secretStorage = { setSecret: vi.fn((key: string, value: string) => { values.set(key, value); }), getSecret: vi.fn((key: string) => values.get(key) ?? null), listSecrets: vi.fn(() => [...values.keys()]) };
		const saveData = vi.fn();
		const settingsApp = { workspace: app.workspace, secretStorage, vault: { adapter: { getBasePath: () => root }, configDir } } as unknown as App;
		const realHost = new PublishingHost({ app: settingsApp, saveData } as unknown as TalosPlugin);
		const saved = vi.fn();
		const modal = new PublishingSettingsModal(settingsApp, realHost, saved); modal.open();
		await vi.waitFor(() => expect(modal.contentEl.querySelector('input[type="password"]')).not.toBeNull());
		enter(field(modal.contentEl, "账号名称"), "新的公众号");
		enter(field(modal.contentEl, "AppID"), "wx1234567890123456");
		const secret = field(modal.contentEl, "AppSecret（已保存时留空沿用）");
		enter(secret, "ui-test-private-secret");
		enter(field(modal.contentEl, "Chrome 中用于建稿的 X 用户名"), "@Demo_Account");
		const save = button(modal.contentEl, "保存账号"); save.click(); expect(save.disabled).toBe(true); save.click();
		await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
		const configText = await readFile(join(root, ".talos/private/publishing/accounts.json"), "utf8");
		const config = await realHost.loadConfig();
		expect(config.accounts).toHaveLength(2);
		expect(config.accounts[0]).toMatchObject({ label: "新的公众号", appId: "wx1234567890123456", platform: "wechat" });
		expect(values.get(config.accounts[0].secretRef!)).toBe("ui-test-private-secret");
		expect(config.accounts[1]).toMatchObject({ xAccount: "Demo_Account", label: "@Demo_Account" });
		expect(configText).not.toContain("ui-test-private-secret");
		expect(configText).not.toContain("appSecret");
		expect(await readFile(dataPath, "utf8")).toBe('{"existing":"unchanged"}');
		expect(saveData).not.toHaveBeenCalled();
		expect(secret.value).toBe("");
		expect(secretStorage.setSecret).toHaveBeenCalledOnce();
		await realHost.dispose();
	});
});
