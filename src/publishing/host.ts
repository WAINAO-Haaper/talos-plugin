import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TFile, type FileSystemAdapter } from "obsidian";
import type TalosPlugin from "../main";
import { inspectVaultPath } from "../ai/context/secret-policy";
import { providerSecretStoreFromApp } from "../ai/provider/secret-storage-runtime";
import { partialTaskResult } from "../task-core/task-runner";
import { prepareArticle, verifyPreparedArticle } from "./content";
import { createWeChatDraftAdapter } from "./wechat";
import { XRelayAdapter } from "./x-relay";
import { FilePublishingStore } from "./store";
import { PublicationService, aggregateRecordState } from "./service";
import type { ArticleInput, PreparedArticle, PublishRecord, PublishingAccount, PublishingConfig } from "./types";

const PRIVATE_ROOT = ".talos/private/publishing";
const ACTION_ID = "publishing-create-drafts";
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif", mp4: "video/mp4", mov: "video/quicktime" };

/** Never follow a note or media symlink outside the active Vault. */
export async function assertPublishingSource(root: string, path: string, configDir: string): Promise<string> {
	if (inspectVaultPath(path, { configDir }).blocked) throw new Error("所选文件位于不可外发的目录");
	const canonicalRoot = await realpath(root);
	const canonicalFile = await realpath(resolve(canonicalRoot, path));
	const rel = relative(canonicalRoot, canonicalFile);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("所选文件超出当前资料库");
	if (inspectVaultPath(rel, { configDir }).blocked) throw new Error("所选文件指向不可外发的目录");
	return canonicalFile;
}

async function privateDirectory(root: string): Promise<string> {
	let current = await realpath(root);
	for (const segment of PRIVATE_ROOT.split("/")) {
		current = join(current, segment);
		try { await mkdir(current, { mode: 0o700 }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
		const info = await lstat(current);
		if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("发布记录目录必须是当前资料库内的真实目录");
	}
	return current;
}

export interface PublishingApproval {
	id: string;
	article: PreparedArticle;
	accounts: PublishingAccount[];
}

export class PublishingHost {
	private service: PublicationService | null = null;
	private serviceInitialization: Promise<PublicationService> | null = null;
	private xAdapter: XRelayAdapter | null = null;
	private pending = new Map<string, PublishingApproval>();
	private activeTasks = new Set<string>();
	private disposed = false;
	private sourceWatches = new Set<() => void>();
	constructor(readonly plugin: TalosPlugin) {}

	private vaultRoot(): string {
		const adapter = this.plugin.app.vault.adapter as FileSystemAdapter;
		if (typeof adapter.getBasePath !== "function") throw new Error("草稿推送需要桌面版 Obsidian");
		return adapter.getBasePath();
	}

	listNotes(): TFile[] {
		return this.plugin.app.vault.getMarkdownFiles().filter(file => !inspectVaultPath(file.path, { configDir: this.plugin.app.vault.configDir }).blocked);
	}

	/** Picker metadata only; bytes are read later through the realpath boundary. */
	listImages(): TFile[] {
		return this.plugin.app.vault.getFiles().filter(file => /^(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.extension)
			&& !inspectVaultPath(file.path, { configDir: this.plugin.app.vault.configDir }).blocked);
	}

	/** Watch the selected note only, and follow its path when that note is renamed. */
	watchSource(path: string, onChange: (currentPath: string) => void): () => void {
		if (this.disposed) return () => {};
		const vault = this.plugin.app.vault;
		let selectedPath = path;
		let active = true;
		const refs = [
			vault.on("modify", file => { if (active && file.path === selectedPath) onChange(selectedPath); }),
			vault.on("delete", file => { if (active && file.path === selectedPath) onChange(selectedPath); }),
			vault.on("rename", (file, oldPath) => {
				if (!active || (oldPath !== selectedPath && file.path !== selectedPath)) return;
				selectedPath = file.path;
				onChange(selectedPath);
			}),
		];
		const stop = () => {
			if (!active) return;
			active = false;
			for (const ref of refs) vault.offref(ref);
			this.sourceWatches.delete(stop);
		};
		this.sourceWatches.add(stop);
		return stop;
	}

	async prepare(input: Omit<ArticleInput, "markdown">): Promise<PreparedArticle> {
		const root = this.vaultRoot();
		const source = await assertPublishingSource(root, input.sourcePath, this.plugin.app.vault.configDir);
		const markdown = await readFile(source, "utf8");
		if (Buffer.byteLength(markdown) > 2_000_000) throw new Error("文章超过 2 MB，请拆分后重试");
		return prepareArticle({ ...input, markdown }, {
			resolveLocalAsset: async (reference, sourcePath) => {
				const clean = reference.replace(/^<|>$/g, "");
				const vault = this.plugin.app.vault;
				const file = this.plugin.app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
				let path = file?.path;
				if (!path && !inspectVaultPath(clean, { configDir: vault.configDir }).blocked) {
					const direct = vault.getAbstractFileByPath(clean);
					if (direct) path = direct.path;
					else if (await vault.adapter.exists(clean)) path = clean;
				}
				path ??= join(dirname(sourcePath), clean).replace(/\\/g, "/");
				const safe = await assertPublishingSource(root, path, this.plugin.app.vault.configDir);
				const info = await lstat(safe);
				if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error("附件不存在或超过首版 100 MB 限制");
				const extension = path.split(".").pop()?.toLowerCase() ?? "";
				const mime = MIME[extension];
				if (!mime) throw new Error(`暂不支持的附件格式：${extension}`);
				return { source: path, fileName: path.split("/").pop() ?? "asset", mime, bytes: new Uint8Array(await readFile(safe)) };
			},
		});
	}

	async loadConfig(): Promise<PublishingConfig> {
		const folder = await privateDirectory(this.vaultRoot());
		let raw: unknown;
		try { raw = JSON.parse(await readFile(join(folder, "accounts.json"), { encoding: "utf8", flag: constants.O_RDONLY | constants.O_NOFOLLOW })) as unknown; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { accounts: [] };
			throw new Error("发布账号配置无法读取；请先修复，避免误投账号");
		}
		const value = raw as Partial<PublishingConfig> | null;
		if (!Array.isArray(value?.accounts)) throw new Error("发布账号配置格式无效");
		const accounts = value.accounts;
		if (accounts.length > 2 || new Set(accounts.map(a => a?.platform)).size !== accounts.length || accounts.some(a => !a || typeof a.id !== "string" || typeof a.label !== "string" || a.label.length > 120 || !["wechat", "x"].includes(a.platform))) throw new Error("发布账号配置格式无效");
		for (const account of accounts) {
			if (account.platform === "wechat") {
				if (!/^wx[a-zA-Z0-9]{16}$/.test(account.appId ?? "")) throw new Error("公众号账号配置无效");
				const id = createHash("sha256").update(`${this.vaultRoot()}\0${account.appId}`).digest("hex").slice(0, 24);
				if (account.id !== `wechat-${id}` || account.secretRef !== `talos-publishing-wechat-${id}`) throw new Error("公众号凭据与当前资料库账号不匹配");
			} else if (!/^[a-zA-Z0-9_]{1,15}$/.test(account.xAccount ?? "") || account.id !== `x-${account.xAccount?.toLowerCase()}`) throw new Error("X 账号配置无效");
		}
		return { accounts };
	}

	async saveAccounts(input: { wechatLabel: string; appId: string; appSecret: string; xAccount: string }): Promise<void> {
		const secretStore = providerSecretStoreFromApp(this.plugin.app);
		if (!secretStore) throw new Error("当前宿主未提供 SecretStorage，不能保存发布账号");
		const appId = input.appId.trim();
		const xAccount = input.xAccount.trim().replace(/^@/, "");
		if (appId && !/^wx[a-zA-Z0-9]{16}$/.test(appId)) throw new Error("请填写完整的公众号 AppID");
		if (xAccount && !/^[a-zA-Z0-9_]{1,15}$/.test(xAccount)) throw new Error("X 账号仅填写用户名，不含网址");
		const accounts: PublishingAccount[] = [];
		if (appId) {
			const id = createHash("sha256").update(`${this.vaultRoot()}\0${appId}`).digest("hex").slice(0, 24);
			const secretRef = `talos-publishing-wechat-${id}`;
			if (input.appSecret.trim()) secretStore.set(secretRef, input.appSecret.trim());
			if (!secretStore.has(secretRef)) throw new Error("该公众号还未保存 AppSecret");
			accounts.push({ id: `wechat-${id}`, platform: "wechat", label: input.wechatLabel.trim() || "公众号", appId, secretRef });
		}
		if (xAccount) accounts.push({ id: `x-${xAccount.toLowerCase()}`, platform: "x", label: `@${xAccount}`, xAccount });
		const folder = await privateDirectory(this.vaultRoot());
		await writeFile(join(folder, "accounts.json.tmp"), JSON.stringify({ accounts }, null, 2), { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW });
		await rename(join(folder, "accounts.json.tmp"), join(folder, "accounts.json"));
	}

	/** This pairing secret is shown only through an explicit copy action. */
	async copyRelayToken(): Promise<void> {
		await navigator.clipboard.writeText(this.relayToken());
	}
	private relayToken(): string {
		const store = providerSecretStoreFromApp(this.plugin.app);
		if (!store) throw new Error("当前宿主未提供 SecretStorage，X 中转保持关闭");
		const id = `talos-publishing-relay-${createHash("sha256").update(this.vaultRoot()).digest("hex").slice(0, 24)}`;
		if (!store.has(id)) store.set(id, randomBytes(32).toString("hex"));
		const token = store.get(id);
		if (!token) throw new Error("无法读取本机中转配对码");
		return token;
	}

	private getService(): Promise<PublicationService> {
		this.serviceInitialization ??= this.initializeService().catch((error: unknown) => { this.serviceInitialization = null; throw error; });
		return this.serviceInitialization;
	}
	private async initializeService(): Promise<PublicationService> {
		if (this.disposed) throw new Error("插件已卸载");
		if (this.service) return this.service;
		const folder = await privateDirectory(this.vaultRoot());
		const scoped = (name: string) => {
			if (!/^[a-z0-9][a-z0-9.-]*$/.test(name)) throw new Error("发布记录路径无效");
			return join(folder, name);
		};
		const store = new FilePublishingStore({
			exists: async name => { try { await lstat(scoped(name)); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; } },
			read: async name => { const p = scoped(name); if ((await lstat(p)).isSymbolicLink()) throw new Error("发布记录不能是符号链接"); return readFile(p, "utf8"); },
			write: (name, value) => writeFile(scoped(name), value, { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW }),
			rename: (from, to) => rename(scoped(from), scoped(to)),
		});
		// Relay startup is lazy inside createDraft/reconcile, never during preview or configuration.
		const x = {
			createDraft: async (...args: Parameters<XRelayAdapter["createDraft"]>) => (await this.getXAdapter(folder)).createDraft(...args),
			reconcile: async (...args: Parameters<XRelayAdapter["reconcile"]>) => (await this.getXAdapter(folder)).reconcile(...args),
		};
		this.service = new PublicationService(store, { wechat: createWeChatDraftAdapter({ getSecret: reference => providerSecretStoreFromApp(this.plugin.app)?.get(reference) ?? null }), x });
		return this.service;
	}
	private async getXAdapter(folder: string): Promise<XRelayAdapter> {
		if (!this.xAdapter) this.xAdapter = new XRelayAdapter({ root: join(folder, "relay"), token: this.relayToken(), openComposer: url => { window.open(url, "_blank", "noopener"); } });
		return this.xAdapter;
	}

	async proposal(article: PreparedArticle, accountIds: string[]): Promise<PublishingApproval> {
		verifyPreparedArticle(article);
		const config = await this.loadConfig();
		const accounts = config.accounts.filter(a => accountIds.includes(a.id));
		if (!accounts.length || accounts.length !== new Set(accountIds).size) throw new Error("请选择有效的目标账号");
		const approval = { id: randomUUID(), article: structuredClone(article), accounts: structuredClone(accounts) };
		if (this.pending.size > 10) this.pending.clear();
		this.pending.set(approval.id, approval);
		return structuredClone(approval);
	}

	/** Release a superseded preview and its potentially large media snapshot immediately. */
	revokeApproval(approvalId: string): void { this.pending.delete(approvalId); }

	async confirm(approvalId: string, onRecord: (record: PublishRecord) => void): Promise<PublishRecord> {
		const approval = this.pending.get(approvalId);
		if (!approval) throw new Error("确认已失效，请重新生成预览");
		this.pending.delete(approvalId);
		verifyPreparedArticle(approval.article);
		const current = (await this.loadConfig()).accounts;
		if (approval.accounts.some(a => JSON.stringify(current.find(c => c.id === a.id)) !== JSON.stringify(a))) throw new Error("目标账号配置已变化，请重新确认");
		const service = await this.getService();
		const runtime = this.plugin.getConsoleActionRuntime();
		if (!runtime.registry.get(ACTION_ID)) runtime.registry.register({
			id: ACTION_ID, label: "创建平台草稿", description: "将已确认的文章和媒体写入指定平台草稿箱，正式发布保留手动", risk: "C", readScope: ["**"], writeScope: [`${PRIVATE_ROOT}/**`], timeoutMs: 16 * 60_000, cancelable: true, reversible: false,
			execute: async (context, input: unknown) => {
				const run = input as { execute: (signal: AbortSignal, taskId: string) => Promise<PublishRecord> };
				const result = await run.execute(context.signal, context.taskId);
				return aggregateRecordState(result) === "draft-created" ? result : partialTaskResult({ result, error: "部分目标未确认创建草稿，请查看分平台回执" });
			},
		});
		let completed: PublishRecord | undefined;
		const task = await runtime.runner.run({ actionId: ACTION_ID, idempotencyKey: `publishing-approval-${approval.id}`, approvalGranted: true,
			request: { readPaths: [approval.article.sourcePath], writePaths: [`${PRIVATE_ROOT}/receipts-a.json`, `${PRIVATE_ROOT}/receipts-b.json`], effects: ["external-publish", "write"] },
			input: { execute: async (signal: AbortSignal, taskId: string) => {
				this.activeTasks.add(taskId);
				try { completed = await service.submit(approval.article, approval.accounts, { signal, taskId }); onRecord(completed); return completed; }
				finally { this.activeTasks.delete(taskId); }
			} },
		});
		if (!completed) throw new Error(task.error || "发送未完成；请查看草稿记录，勿直接重复发送");
		return completed;
	}
	async records(): Promise<PublishRecord[]> { return (await this.getService()).listRecords(); }
	async reconcile(id: string): Promise<PublishRecord> { return (await this.getService()).reconcile(id, (await this.loadConfig()).accounts); }
	cancel(): void { for (const id of this.activeTasks) this.plugin.getConsoleActionRuntime().runner.cancel(id); }
	async dispose(): Promise<void> { this.disposed = true; this.pending.clear(); this.cancel(); for (const stop of this.sourceWatches) stop(); await this.xAdapter?.dispose(); }
}
