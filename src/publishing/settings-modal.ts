import { Modal, Notice, type App } from "obsidian";
import type { PublishingHost } from "./host";

export class PublishingSettingsModal extends Modal {
	constructor(app: App, private readonly host: PublishingHost, private readonly saved: () => void) { super(app); }
	onOpen(): void { this.setTitle("草稿推送账号"); this.modalEl.addClass("talos-publishing-settings"); void this.render().catch(() => new Notice("无法加载发布配置，请检查本地配置文件")); }
	private async render(): Promise<void> {
		const { accounts } = await this.host.loadConfig();
		this.contentEl.empty();
		this.contentEl.createEl("p", { text: "设置只用于创建平台草稿；正式发布仍在平台编辑器里完成。" });
		const wechat = accounts.find(account => account.platform === "wechat");
		const x = accounts.find(account => account.platform === "x");
		const field = (label: string, value: string, type = "text") => {
			const row = this.contentEl.createEl("label", { cls: "talos-publishing-field" });
			row.createSpan({ text: label });
			const input = row.createEl("input", { attr: { type, autocomplete: "off", spellcheck: "false" } }); input.value = value; return input;
		};
		this.contentEl.createEl("h3", { text: "微信公众号" });
		const label = field("账号名称", wechat?.label ?? "");
		const appId = field("AppID", wechat?.appId ?? "");
		const secret = field("AppSecret（已保存时留空沿用）", "", "password");
		this.contentEl.createEl("p", { cls: "setting-item-description", text: "AppSecret 仅存入 Obsidian SecretStorage。请在微信开发者平台配置出口 IP 白名单，并确认账号有草稿箱与素材接口权限。清空 AppID 将停用此目标。" });
		this.contentEl.createEl("h3", { text: "X 文章" });
		const handle = field("Chrome 中用于建稿的 X 用户名", x?.xAccount ?? "");
		this.contentEl.createEl("p", { cls: "setting-item-description", text: "需要 Kaitox Chrome 扩展 0.6.3 或更新版本，以及有 Articles 权限的账号。中转地址为 http://127.0.0.1:8765；将配对码填入扩展的 relay token 设置。TALOS 不读取浏览器 Cookie，每次发送前需确认 Chrome 当前登录账号。" });
		const pair = this.contentEl.createEl("button", { text: "复制 X 中转配对码", attr: { type: "button" } });
		pair.addEventListener("click", () => { void this.host.copyRelayToken().then(() => new Notice("配对码已复制，请粘贴到 Kaitox 扩展的 relay token 设置")).catch(() => new Notice("无法复制配对码，请检查 SecretStorage 和剪贴板权限")); });
		const error = this.contentEl.createDiv({ attr: { role: "alert" } });
		const save = this.contentEl.createEl("button", { text: "保存账号", cls: "mod-cta", attr: { type: "button" } });
		save.addEventListener("click", () => {
			save.disabled = true;
			void this.host.saveAccounts({ wechatLabel: label.value, appId: appId.value, appSecret: secret.value, xAccount: handle.value }).then(() => {
				secret.value = ""; this.saved(); this.close();
			}).catch((cause: unknown) => { error.setText(cause instanceof Error ? cause.message : "保存失败"); }).finally(() => { save.disabled = false; });
		});
	}
	onClose(): void { this.contentEl.empty(); }
}
