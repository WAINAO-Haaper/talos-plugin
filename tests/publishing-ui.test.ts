/**
 * Real happy-dom events and the real publishing UI/X preview renderer.
 * Obsidian Modal, DOM convenience methods, sanitizer, notices, and workspace are
 * test substitutes. Delivery uses a narrow host stub; the settings persistence
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

vi.mock("obsidian", () => ({
	Modal: class {
		readonly modalEl = activeDocument.createElement("section");
		readonly contentEl = activeDocument.createElement("div");
		constructor(readonly app: App) { this.modalEl.append(this.contentEl); }
		setTitle(title: string) { this.modalEl.setAttribute("aria-label", title); }
		open() { activeDocument.body.append(this.modalEl); this.onOpen(); return this; }
		close() { this.onClose(); this.modalEl.remove(); }
		onOpen() {}
		onClose() {}
	},
	Notice: class { constructor(message: string) { obsidianUi.notices.push(message); } },
	TFile: class {},
	requestUrl: vi.fn(() => { throw new Error("Network is forbidden in UI tests"); }),
	sanitizeHTMLToDom: (html: string) => {
		// eslint-disable-next-line no-unsanitized/method -- Test-only Obsidian sanitizer substitute; fixture HTML is local and controlled.
		return activeDocument.createRange().createContextualFragment(html);
	},
}));

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
	sourcePath: "文章/示例.md", title: "冻结后的标题", markdown: "正文", wechatHtml: "<section><p>冻结后的正文</p></section>", xMarkdown: "冻结后的正文",
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
	return {
		listNotes: vi.fn(() => [{ path: "文章/示例.md", basename: "示例", extension: "md" }] as TFile[]),
		loadConfig: vi.fn(async () => ({ accounts: configured })),
		prepare: vi.fn(async (_input: Omit<ArticleInput, "markdown">) => prepared),
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
	const modal = new PublishingModal(app, hostPort(host)); opened.push(modal); modal.open(); return modal;
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
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

describe("PublishingModal real DOM interactions", () => {
	it("previews locally without delivery, shows both real preview panes and the X account check", async () => {
		const host = stubHost();
		const modal = openModal(host); await settle();
		expect(host.confirm).not.toHaveBeenCalled();
		button(modal.contentEl, "生成预览与检查").click(); await settle();
		expect(host.prepare).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: "文章/示例.md", title: "示例" }));
		expect(host.confirm).not.toHaveBeenCalled();
		expect(host.copyRelayToken).not.toHaveBeenCalled();
		const panes = Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".talos-publishing-preview-body"));
		expect(panes).toHaveLength(2);
		expect(panes[0].shadowRoot?.textContent).toContain("冻结后的正文");
		expect(panes[1].shadowRoot?.querySelector(".xp-title")?.textContent).toBe("冻结后的标题");
		expect(modal.contentEl.querySelector(".talos-publishing-confirm")?.textContent).toContain("TALOS 无法验证浏览器账号身份");
		expect(modal.contentEl.querySelector(".talos-publishing-confirm")?.textContent).toContain("Chrome 当前登录的账号");
		expect(button(modal.contentEl, "确认创建草稿").disabled).toBe(true);
		const images = panes.flatMap(pane => Array.from(pane.shadowRoot?.querySelectorAll("img") ?? []));
		expect(images).toHaveLength(1); // The supplied cover only; no upstream author avatar.
		expect(images[0].getAttribute("src")).toMatch(/^data:image\/png;base64,/);
		const buttonLabels = Array.from(modal.contentEl.querySelectorAll("button")).map(element => element.textContent);
		for (const forbidden of ["发布", "正式发布", "立即发布", "一键发布"]) expect(buttonLabels).not.toContain(forbidden);
	});

	it("requires a selected target and a fresh checked confirmation, then sends its exact approval ID once", async () => {
		const host = stubHost();
		const modal = openModal(host); await settle();
		button(modal.contentEl, "生成预览与检查").click(); await settle();
		const targets = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>(".talos-publishing-targets input"));
		targets[0].click(); targets[1].click(); await settle();
		expect(modal.contentEl.querySelector(".talos-publishing-confirm button")).toBeNull();
		expect(host.confirm).not.toHaveBeenCalled();
		targets[1].click(); await settle();
		expect(host.proposal).toHaveBeenLastCalledWith(prepared, ["x-demo"]);
		const send = button(modal.contentEl, "确认创建草稿");
		expect(send.disabled).toBe(true); send.click(); expect(host.confirm).not.toHaveBeenCalled();
		modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")!.click();
		expect(send.disabled).toBe(false); send.click(); await settle();
		const latest = await (host.proposal.mock.results.at(-1)!.value as Promise<PublishingApproval>);
		expect(host.confirm).toHaveBeenCalledExactlyOnceWith(latest.id, expect.any(Function));
		expect(modal.contentEl.querySelector('[role="status"]')?.textContent).toContain("草稿已创建");
	});

	it("invalidates the preview and old send button immediately when an article field changes", async () => {
		const host = stubHost();
		const modal = openModal(host); await settle();
		button(modal.contentEl, "生成预览与检查").click(); await settle();
		const staleSend = button(modal.contentEl, "确认创建草稿");
		modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")!.click();
		enter(field(modal.contentEl, "文章标题"), "修改过的标题");
		expect(modal.contentEl.querySelector(".talos-publishing-preview-body")).toBeNull();
		expect(modal.contentEl.querySelector(".talos-publishing-confirm button")).toBeNull();
		staleSend.click(); await settle();
		expect(host.confirm).not.toHaveBeenCalled();
		button(modal.contentEl, "生成预览与检查").click(); await settle();
		expect(host.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ title: "修改过的标题" }));
		expect(button(modal.contentEl, "确认创建草稿").disabled).toBe(true);
	});

	it("ignores a stale asynchronous preview after the user changes its source", async () => {
		const host = stubHost(); const pending = deferred<PreparedArticle>(); host.prepare.mockReturnValueOnce(pending.promise);
		const modal = openModal(host); await settle();
		button(modal.contentEl, "生成预览与检查").click(); await settle();
		enter(field(modal.contentEl, "文章笔记"), "文章/另一篇.md");
		pending.resolve(prepared); await settle();
		expect(modal.contentEl.querySelector(".talos-publishing-preview-body")).toBeNull();
		expect(host.proposal).not.toHaveBeenCalled();
		expect(host.confirm).not.toHaveBeenCalled();
	});

	it("keeps only the latest target approval when proposals resolve out of order", async () => {
		const host = stubHost(); const first = deferred<PublishingApproval>(); const second = deferred<PublishingApproval>();
		host.proposal.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const modal = openModal(host); await settle();
		button(modal.contentEl, "生成预览与检查").click(); await settle();
		modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-targets input")!.click();
		second.resolve({ id: "new-x-only", article: prepared, accounts: [accounts[1]] }); await settle();
		first.resolve({ id: "old-both-targets", article: prepared, accounts }); await settle();
		const send = button(modal.contentEl, "确认创建草稿");
		modal.contentEl.querySelector<HTMLInputElement>(".talos-publishing-confirm input")!.click(); send.click(); await settle();
		expect(host.confirm).toHaveBeenCalledExactlyOnceWith("new-x-only", expect.any(Function));
	});

	it("shows queued and unknown history honestly and reconciles the existing record without sending again", async () => {
		const host = stubHost(); host.records.mockResolvedValue([record("queued-record", ["queued"]), record("unknown-record", ["unknown"])]);
		const modal = openModal(host); await settle();
		const history = modal.contentEl.querySelector<HTMLElement>(".talos-publishing-history")!;
		expect(history.textContent).toContain("已排队，等待 X 回执");
		expect(history.textContent).toContain("结果待确认");
		expect(history.textContent).not.toContain("草稿已创建");
		button(history, "核对原草稿结果").click(); await settle();
		expect(host.reconcile).toHaveBeenCalledExactlyOnceWith("unknown-record");
		expect(host.confirm).not.toHaveBeenCalled();
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
		const modal = new PublishingSettingsModal(settingsApp, realHost, saved); opened.push(modal); modal.open();
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
