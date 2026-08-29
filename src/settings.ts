import {
	App,
	DropdownComponent,
	Notice,
	PluginSettingTab,
	SecretComponent,
	Setting,
	setIcon,
} from "obsidian";
import type TalosPlugin from "./main";
import {
	MODULE_KEYS,
	SCHEMA_LABELS,
	SCHEMA_PRESET_CN,
	SCHEMA_PRESETS,
	detectSchemaDetailed,
	resolveSchema,
	type DataSourceKey,
	type SchemaDetectionResult,
	type TalosSchemaKey,
	type TalosVaultSchema,
} from "./data/schema";
import {
	providerSecretStoreFromApp,
	saveProviderSecret,
} from "./ai/provider/secret-storage-runtime";
import type { LegacySecretField } from "./ai/provider/settings-migration";
import { DEFAULT_DSH_PORT, normalizeDshPort } from "./harness/dsh-runtime";

export type TalosVisualTheme =
	| "aurora"
	| "cosmos-dark"
	| "animal-island"
	| "system-classic"
	| "data-stream"
	| "soft-relief"
	| "geometric-modern"
	| "executive-brief"
	| "paper-ink"
	| "swiss-modern";

export const TALOS_SETTINGS_SCHEMA_VERSION = 1;

/** 屈原语音舞台背景效果（独立于全局 visualTheme） */
export type QuyuanBackgroundType = "letter-glitch" | "grid-scan";

export function normalizeVisualTheme(value: unknown): TalosVisualTheme {
	if (value === "cosmos-dark") return "cosmos-dark";
	if (value === "animal-island") return "animal-island";
	if (value === "system-classic" || value === "macintosh-workstation") return "system-classic";
	if (value === "data-stream" || value === "matrix-rain") return "data-stream";
	if (value === "soft-relief" || value === "neumorphism") return "soft-relief";
	if (value === "geometric-modern" || value === "bauhaus") return "geometric-modern";
	if (value === "executive-brief") return "executive-brief";
	if (value === "paper-ink") return "paper-ink";
	if (value === "swiss-modern") return "swiss-modern";
	return "aurora";
}

export interface TalosSettings {
	settingsSchemaVersion: number;
	eyebrow: string;
	mainTitle: string;
	visualTheme: TalosVisualTheme;
	syncVaultTheme: boolean;
	inboxFolder: string;
	dailyFolder: string;
	tasksPath: string; // 系统焦点任务
	talosTasksPath: string; // TALOS 产品发布作战室
	pendingApprovalsPath: string;
	candidatesPath: string;
	healthLogPath: string;
	reportsFolder: string;
	freezeStartDate: string; // 重估期启动日，算冻结天数
	agentCommand: string;
	openOnStartup: boolean;
	// 屈原语音助手
	voiceAgentCommand: string; // 语音大脑命令，如 claude -p
	voicePermission: string; // 工具权限：readonly | acceptEdits | all | off
	voicePersona: string; // 人格前缀，留空用默认
	voiceLang: string; // TTS 语言，如 zh-CN
	ttsVoice: string; // 指定 speechSynthesis 嗓音名，留空自动
	ttsRate: number; // 朗读语速 0.5–2
	ttsPitch: number; // 朗读音调 0–2
	ttsEngine: string; // realtime；旧串行 TTS 值仅用于迁移兼容
	elevenLabsApiKey: string;
	elevenLabsVoiceId: string; // 默认 Daniel（英音男声，屈原气质）
	elevenLabsModel: string; // eleven_turbo_v2_5 | eleven_multilingual_v2
	aliyunApiKey: string; // DashScope/百炼 API Key
	aliyunVoice: string; // qwen-tts 音色，默认 Andre（磁性沉稳男声）
	edgeTtsVoice: string; // Edge 朗读音色，默认 zh-CN-XiaoxiaoNeural（晓晓·女声）
	aliyunModel: string; // qwen3-tts-flash 等
	live2dModelPath: string; // 库内 *.model3.json 路径，留空用 SVG 角色
	// 屈原 agentic（B 方案 · claude-agent-sdk 流式）
	jarvisClaudeBin: string; // 遗留字段：旧语音引擎已随 C-3b 移除，仅保留以兼容既有 data.json
	jarvisModel: string; // 模型，留空用默认（直连通道与语音页共用）
	engineProvider: string; // 执行通道：codex-cli（Codex harness 唯一内核）| claude-api | codex（OpenAI-compatible 直连）
	anthropicApiKey: string; // 仅用于旧版一次性迁移，运行时读取 SecretStorage
	anthropicBaseUrl: string; // 留空用官方 api.anthropic.com；自建网关填此
	openaiApiKey: string; // 仅用于旧版一次性迁移，运行时读取 SecretStorage
	openaiBaseUrl: string; // 留空用官方 api.openai.com；自建 OpenAI 兼容网关填此（DeepSeek/智谱/Kimi 直连通道）
	openaiModel: string; // OpenAI-compatible 直连模型，留空用 gpt-4o
	codexApiKey: string; // 仅用于旧版一次性迁移，运行时读取 SecretStorage
	codexBaseUrl: string; // Codex harness 的 OpenAI Responses 端点，留空用官方
	codexModel: string; // Codex harness 模型，留空用 harness 默认（gpt-5.5）
	agentWorkbenchClaudeModels: string; // TALOS 工作台 Claude API 模型目录，每行一个
	agentWorkbenchCodexModels: string; // TALOS 工作台 Codex API 模型目录，每行一个
	// D-TLP-014：AI 对话页内嵌 DeepSeek Harness 桌面界面（iframe + loopback dsh web）
	harnessExecutable: string; // dsh CLI 路径，留空自动探测 PATH
	harnessPort: number; // dsh web 仅监听 127.0.0.1，默认 3180
	harnessSurface: string; // D-TLP-015 对话页通道：dsh（默认）| codex，由切换块写入
	jarvisPermissionMode: string; // default | acceptEdits | plan | bypassPermissions
	jarvisSttEngine: string; // 固定 off；旧 WebSpeech 入口失败关闭
	jarvisSttApiKey: string; // STT API key（阿里云 Paraformer 等）
	jarvisSttLang: string; // 识别语言，如 zh-CN
	quyuanAsrEngine: string; // qwen-realtime；旧本地/云端 ASR 值仅用于迁移兼容
	quyuanLocalAsrNetworkConsent: boolean; // 首次获取固定、校验后 ASR 模型的明确联网同意
	quyuanLocalAsrModel: string; // 遗留字段：自定义模型已禁用，仅兼容旧 data.json
	quyuanLocalAsrCdn: string; // 遗留字段：远程 JavaScript 已禁用，仅兼容旧 data.json
	quyuanVadEnabled: boolean; // 用 Silero VAD 判断人声；关闭或加载失败则回退响度阈值
	quyuanVadNetworkConsent: boolean; // 首次获取固定、校验后 VAD 模型的明确联网同意
	quyuanVadCdn: string; // 遗留字段：远程 JavaScript 已禁用，仅兼容旧 data.json
	quyuanVadModel: string; // 遗留字段：自定义模型已禁用，仅兼容旧 data.json
	quyuanVoiceModel: string; // Claude 语音通道独立模型，不影响文字工作台
	quyuanVoiceEffort: string; // Claude 语音通道独立思考强度
	quyuanRealtimeWorkspaceId: string; // 百炼业务空间 ID；用于可信侧 WebRTC SDP 交换
	quyuanRealtimeRegion: string; // cn-beijing | ap-southeast-1
	quyuanRealtimeModel: string; // Qwen Omni Realtime 模型
	quyuanRealtimeVoice: string; // Qwen Omni Realtime 音色
	quyuanBackground: QuyuanBackgroundType; // 屈原舞台背景效果：letter-glitch | grid-scan
	quyuanVoiceRecognitionEnabled: boolean; // 屈原语音识别模式：false 时释放麦克风且不监听唤醒词
	quyuanVoiceInputMode: "continuous" | "push-to-talk"; // 默认持续监听；失败时降级为点击说话
	quyuanVoiceSessionJson: string; // 独立 voice namespace 会话，不与 TALOS 文字对话会话混用
	jarvisVoiceEnabled: boolean; // 语音总开关：同时控制麦克风与自动朗读
	jarvisThinkingLevel: string; // 思考档：off | low | medium | high
	jarvisTabsJson: string; // 多标签会话持久化（SessionStore 序列化），勿手改
	providerSecretRefs: Partial<
		Record<
			| "elevenLabsApiKey"
			| "aliyunApiKey"
			| "anthropicApiKey"
			| "openaiApiKey"
			| "codexApiKey"
			| "jarvisSttApiKey",
			string
		>
	>;
	providerVaultAccess: boolean;
	providerManualReview: boolean;
	providerModuleAccess: Record<
		string,
		Partial<Record<TalosSchemaKey, boolean>>
	>;
	/** 首次运行是否已自动识别过库结构（避免重复打扰；重新检测请用设置页按钮） */
	schemaAutoDetected: boolean;
	/** 库目录映射：客户库命名与默认不同时在此覆盖（设置 → 目录映射，支持自动检测） */
	vaultSchema: Partial<TalosVaultSchema>;
}

export const DEFAULT_SETTINGS: TalosSettings = {
	settingsSchemaVersion: TALOS_SETTINGS_SCHEMA_VERSION,
	eyebrow: "超级大脑 · CONTEXT OS",
	mainTitle: "TALOS 系统控制台",
	visualTheme: "aurora",
	syncVaultTheme: true,
	inboxFolder: "00-收件箱",
	dailyFolder: "01-日志",
	tasksPath: "System/working-memory/tasks.md",
	talosTasksPath: "04-项目/TALOS系统/tasks.md",
	pendingApprovalsPath: "System/pending-approvals.md",
	candidatesPath: "System/working-memory/candidates.md",
	healthLogPath: "System/working-memory/health-log.md",
	reportsFolder: "System/reports",
	freezeStartDate: "2026-06-19",
	agentCommand: "",
	openOnStartup: true,
	voiceAgentCommand: "",
	voicePermission: "off",
	voicePersona: "",
	voiceLang: "zh-CN",
	ttsVoice: "",
	ttsRate: 1.02,
	ttsPitch: 1,
	ttsEngine: "system",
	elevenLabsApiKey: "",
	elevenLabsVoiceId: "onwK4e9ZLuTAKqWW03F9", // Daniel · 英音男声
	elevenLabsModel: "eleven_turbo_v2_5",
	aliyunApiKey: "",
	aliyunVoice: "Andre",
	edgeTtsVoice: "zh-CN-XiaoxiaoNeural",
	aliyunModel: "qwen3-tts-flash",
	live2dModelPath: "",
	jarvisClaudeBin: "",
	jarvisModel: "",
	engineProvider: "codex-cli",
	anthropicApiKey: "",
	anthropicBaseUrl: "",
	openaiApiKey: "",
	openaiBaseUrl: "",
	openaiModel: "",
	codexApiKey: "",
	codexBaseUrl: "",
	codexModel: "",
	agentWorkbenchClaudeModels: "",
	agentWorkbenchCodexModels: "",
	harnessExecutable: "",
	harnessPort: DEFAULT_DSH_PORT,
	harnessSurface: "dsh",
	jarvisPermissionMode: "default",
	jarvisSttEngine: "off",
	jarvisSttApiKey: "",
	jarvisSttLang: "zh-CN",
	quyuanAsrEngine: "local",
	quyuanLocalAsrNetworkConsent: false,
	quyuanLocalAsrModel: "",
	quyuanLocalAsrCdn: "",
	quyuanVadEnabled: false,
	quyuanVadNetworkConsent: false,
	quyuanVadCdn: "",
	quyuanVadModel: "",
	quyuanVoiceModel: "haiku",
	quyuanVoiceEffort: "low",
	quyuanRealtimeWorkspaceId: "",
	quyuanRealtimeRegion: "cn-beijing",
	quyuanRealtimeModel: "qwen3.5-omni-flash-realtime",
	quyuanRealtimeVoice: "Tina",
	quyuanBackground: "letter-glitch",
	quyuanVoiceRecognitionEnabled: true,
	quyuanVoiceInputMode: "continuous",
	quyuanVoiceSessionJson: "",
	jarvisVoiceEnabled: false,
	jarvisThinkingLevel: "off",
	jarvisTabsJson: "",
	providerSecretRefs: {},
	providerVaultAccess: true,
	providerManualReview: true,
	providerModuleAccess: {},
	schemaAutoDetected: false,
	vaultSchema: {},
};

type TextSettingKey = {
	[K in keyof TalosSettings]: TalosSettings[K] extends string ? K : never;
}[keyof TalosSettings];
type FreeTextSettingKey = Exclude<
	TextSettingKey,
	| "visualTheme"
	| "quyuanBackground"
	| "quyuanVoiceInputMode"
	| "quyuanVoiceSessionJson"
>;

type TabId = "ui" | "schema" | "data" | "channel" | "voice";

interface TalosSettingTabDefinition {
	id: TabId;
	label: string;
	description: string;
	icon: string;
}

const TALOS_SETTING_TABS: readonly TalosSettingTabDefinition[] = [
	{
		id: "ui",
		label: "界面",
		description: "主题、标题与启动行为",
		icon: "palette",
	},
	{
		id: "schema",
		label: "目录映射",
		description: "自动检测、预设与校验",
		icon: "folder-tree",
	},
	{
		id: "data",
		label: "数据源",
		description: "统计、审批与写入路径",
		icon: "database",
	},
	{
		id: "channel",
		label: "智能体与模型",
		description: "认证、API 与模型目录",
		icon: "bot",
	},
	{
		id: "voice",
		label: "屈原 · 语音",
		description: "模型、朗读、识别与 VAD",
		icon: "audio-lines",
	},
];

export class TalosSettingTab extends PluginSettingTab {
	plugin: TalosPlugin;
	private activeTab: TabId = "ui";
	private renderTarget: HTMLElement | null = null;
	/** 最近一次识别结果（用于在设置页展示检测报告，供客户核对） */
	private lastDetection: SchemaDetectionResult | null = null;

	constructor(app: App, plugin: TalosPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.renderInto(this.containerEl);
	}

	/**
	 * 使用同一套设置渲染器挂载到 TALOS 控制台。
	 * PluginSettingTab.display() 与内嵌页共享此入口，避免两套设置状态与保存逻辑。
	 */
	renderInto(containerEl: HTMLElement): void {
		this.renderTarget = containerEl;
		containerEl.empty();
		containerEl.addClass("talos-settings");

		const bar = containerEl.createDiv({
			cls: "talos-settabs",
			attr: { role: "tablist", "aria-label": "TALOS 设置分类" },
		});
		const content = containerEl.createDiv({
			cls: "talos-setcontent",
			attr: { role: "tabpanel", tabindex: "0" },
		});

		const renderActive = (): void => {
			const active =
				TALOS_SETTING_TABS.find((tab) => tab.id === this.activeTab) ??
				TALOS_SETTING_TABS[0];
			if (!active) return;
			content.empty();
			content.dataset.settingsTab = active.id;
			content.setAttribute("aria-label", `${active.label}设置`);
			this.renderTabIntro(content, active);
			if (active.id === "ui") this.renderUi(content);
			else if (active.id === "schema") this.renderSchema(content);
			else if (active.id === "data") this.renderData(content);
			else if (active.id === "channel") this.renderChannel(content);
			else this.renderVoice(content);
		};

		const buttons: HTMLButtonElement[] = [];
		const activate = (id: TabId): void => {
			this.activeTab = id;
			buttons.forEach((button, index) => {
				const active = TALOS_SETTING_TABS[index]?.id === id;
				button.toggleClass("is-active", active);
				button.setAttribute("aria-selected", String(active));
				button.tabIndex = active ? 0 : -1;
			});
			renderActive();
		};

		TALOS_SETTING_TABS.forEach((tab, index) => {
			const button = bar.createEl("button", {
				cls: `talos-settab${tab.id === this.activeTab ? " is-active" : ""}`,
				attr: {
					type: "button",
					role: "tab",
					"aria-selected": String(tab.id === this.activeTab),
					tabindex: tab.id === this.activeTab ? "0" : "-1",
				},
			});
			button.dataset.settingsTab = tab.id;
			const icon = button.createSpan({ cls: "talos-settab-icon" });
			setIcon(icon, tab.icon);
			const copy = button.createSpan({ cls: "talos-settab-copy" });
			copy.createEl("strong", { text: tab.label });
			copy.createEl("small", { text: tab.description });
			button.addEventListener("click", () => activate(tab.id));
			button.addEventListener("keydown", (event) => {
				let targetIndex = index;
				if (event.key === "ArrowDown" || event.key === "ArrowRight") {
					targetIndex = (index + 1) % TALOS_SETTING_TABS.length;
				} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
					targetIndex =
						(index - 1 + TALOS_SETTING_TABS.length) %
						TALOS_SETTING_TABS.length;
				} else if (event.key === "Home") {
					targetIndex = 0;
				} else if (event.key === "End") {
					targetIndex = TALOS_SETTING_TABS.length - 1;
				} else {
					return;
				}
				event.preventDefault();
				const target = buttons[targetIndex];
				target?.click();
				target?.focus();
			});
			buttons.push(button);
		});

		renderActive();
	}

	private renderTabIntro(
		container: HTMLElement,
		tab: TalosSettingTabDefinition
	): void {
		const intro = container.createEl("header", {
			cls: "talos-settings-section-intro",
		});
		intro.dataset.settingsSection = tab.id;
		const mark = intro.createSpan({ cls: "talos-settings-section-intro__mark" });
		setIcon(mark, tab.icon);
		const copy = intro.createDiv({ cls: "talos-settings-section-intro__copy" });
		copy.createEl("small", { text: "CONFIGURATION WORKSPACE" });
		copy.createEl("strong", {
			cls: "talos-settings-section-intro__title",
			text: tab.label,
		});
		copy.createEl("p", { text: tab.description });
	}

	private rerender(): void {
		const target = this.renderTarget;
		if (target?.isConnected) {
			this.renderInto(target);
			return;
		}
		this.display();
	}


	private describeHarnessState(): string {
		const manager = this.plugin.getHarnessManager();
		const state = manager.getState();
		const label =
			state === "ready"
				? "运行中"
				: state === "starting"
					? "正在启动"
					: state === "error"
						? "启动失败"
						: "未启动";
		const detail =
			state === "error" ? `：${manager.getLastError()}` : "";
		return `当前状态：${label}${detail}（${manager.getBaseUrl()}，仅回环监听）`;
	}

	// 通用文本设置项
	private textIn(c: HTMLElement, name: string, desc: string, key: FreeTextSettingKey, ph = ""): void {
		new Setting(c)
			.setName(name)
			.setDesc(desc)
			.addText((t) =>
				t
					.setPlaceholder(ph)
					.setValue(this.plugin.talosSettings[key])
					.onChange(async (v) => {
						this.plugin.talosSettings[key] = v.trim();
						await this.plugin.saveTalosSettings();
					})
			);
	}

	private modelCatalogIn(
		c: HTMLElement,
		name: string,
		desc: string,
		key: "agentWorkbenchClaudeModels" | "agentWorkbenchCodexModels",
		placeholder: string
	): void {
		new Setting(c)
			.setName(name)
			.setDesc(desc)
			.addTextArea((text) => {
				text
					.setPlaceholder(placeholder)
					.setValue(this.plugin.talosSettings[key])
					.onChange(async (value) => {
						this.plugin.talosSettings[key] = value
							.split(/\r?\n/)
							.map((model) => model.trim())
							.filter(Boolean)
							.join("\n");
						await this.plugin.saveTalosSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private secretIn(
		c: HTMLElement,
		name: string,
		desc: string,
		field: LegacySecretField
	): void {
		const store = providerSecretStoreFromApp(this.app);
		const reference = this.plugin.talosSettings.providerSecretRefs[field];
		const setting = new Setting(c)
			.setName(name)
			.setDesc(
				`${desc} ${
					reference && store?.has(reference)
						? "当前状态：已安全保存。"
						: "当前状态：未配置。"
				}`
			);
		if (!store) {
			setting.setDesc(
				"当前 Obsidian 不支持 SecretStorage。请升级到 1.11.4 或更高版本；不会回退为明文保存。"
			);
			return;
		}

		let pending = "";
		const secret = new SecretComponent(this.app, setting.controlEl)
			.setValue("")
			.onChange((value) => {
				pending = value;
			});
		setting.addButton((button) =>
			button
				.setButtonText("安全保存")
				.setCta()
				.onClick(async () => {
					if (!pending.trim()) {
						new Notice("请输入密钥后再保存");
						return;
					}
					saveProviderSecret(
						this.plugin.talosSettings,
						field,
						pending,
						store
					);
					await this.plugin.saveTalosSettings();
					pending = "";
					secret.setValue("");
					new Notice(`${name} 已写入 Obsidian SecretStorage`);
					this.rerender();
				})
		);
	}


	// ---------- Tab：界面 ----------
	private renderUi(c: HTMLElement): void {
		this.textIn(c, "Eyebrow 小标题", "Header 左上角小字", "eyebrow");
		this.textIn(c, "主标题", "Header 主标题", "mainTitle");
		new Setting(c)
			.setName("视觉风格")
			.setDesc("十套 TALOS 视觉风格；开启全库同步后也会驱动 Obsidian 主界面。")
			.addDropdown((d) =>
				d
					.addOption("aurora", "Aurora 原版（默认）")
					.addOption("cosmos-dark", "Nebula 深色宇宙稿")
					.addOption("animal-island", "Animal Island 小岛主题")
					.addOption("system-classic", "Macintosh 知识工作站")
					.addOption("data-stream", "数据流 · 动态终端")
					.addOption("soft-relief", "柔光浮雕 · Neumorphism")
					.addOption("geometric-modern", "几何现代主义 · Bauhaus")
					.addOption("executive-brief", "Executive Brief 商务简约（浅色）")
					.addOption("paper-ink", "Paper 纸感墨水（浅色）")
					.addOption("swiss-modern", "Swiss Modernism 瑞士现代主义（浅色）")
					.setValue(this.plugin.talosSettings.visualTheme)
					.onChange(async (v) => {
						this.plugin.talosSettings.visualTheme = normalizeVisualTheme(v);
						await this.plugin.saveTalosSettings();
						this.plugin.applyViewSettings();
					})
			);
		new Setting(c)
			.setName("同步到整个库")
			.setDesc("让侧栏、标签页、编辑器、阅读区、菜单与弹窗跟随 TALOS 主题；关闭即恢复 Obsidian 原主题。")
			.addToggle((t) =>
				t.setValue(this.plugin.talosSettings.syncVaultTheme).onChange(async (v) => {
					this.plugin.talosSettings.syncVaultTheme = v;
					await this.plugin.saveTalosSettings();
					this.plugin.applyViewSettings();
				})
			);
		new Setting(c)
			.setName("启动时作为首页打开")
			.setDesc("Obsidian 启动并完成布局恢复后，自动打开 TALOS 控制台。")
			.addToggle((t) =>
				t.setValue(this.plugin.talosSettings.openOnStartup).onChange(async (v) => {
					this.plugin.talosSettings.openOnStartup = v;
					await this.plugin.saveTalosSettings();
				})
			);
	}

	// ---------- Tab：目录映射 ----------
	// 客户库的目录命名与默认不同时，在这里改一次，整个控制台随之适配。
	private renderSchema(c: HTMLElement): void {
		new Setting(c).setDesc(
			"TALOS 控制台按下面这份映射去库里读数据。如果你的目录叫别的名字（例如英文 00-Inbox），"
			+ "在这里改成实际名称即可，无需改动任何代码。改完点页面底部「保存并刷新」。"
		);

		new Setting(c)
			.setName("自动检测")
			.setDesc(
				"扫描当前库的真实目录，按名称智能匹配（支持任意命名，如「笔记」「资料」「Projects」）。"
				+ "同时自动定位 tasks / 待审批 / 候选池 / 健康日志等统计来源文件。"
			)
			.addButton((b) =>
				b.setButtonText("扫描当前库").setCta().onClick(async () => {
					const result = detectSchemaDetailed(this.app);
					this.plugin.talosSettings.vaultSchema = { ...result.schema };
					const sourceKeys: DataSourceKey[] = [
						"tasksPath",
						"pendingApprovalsPath",
						"candidatesPath",
						"healthLogPath",
					];
					for (const key of sourceKeys) {
						const found = result.dataSources[key];
						if (found) this.plugin.talosSettings[key] = found;
					}
					this.plugin.talosSettings.inboxFolder = result.schema.inbox;
					this.plugin.talosSettings.dailyFolder = result.schema.logs;
					await this.plugin.saveTalosSettings();
					this.plugin.applyViewSettings();
					this.plugin.refreshAllViews();
					this.lastDetection = result;
					new Notice(
						`识别完成：匹配 ${result.matchedCount}/${result.entries.length} 个模块`
						+ `，定位 ${Object.keys(result.dataSources).length} 个数据源文件`
					);
					this.rerender();
				})
			);

		// 检测报告：让客户看清「哪个目录被认成了哪个模块」，可核对可纠正
		if (this.lastDetection) {
			const report = c.createDiv({ cls: "talos-schema-report" });
			report.createEl("b", { text: "上次识别结果" });
			const list = report.createEl("ul");
			for (const entry of this.lastDetection.entries) {
				const li = list.createEl("li");
				const label = SCHEMA_LABELS[entry.key];
				if (entry.how === "none") {
					li.setText(`⚠️ ${label} —— 库内未找到，保留默认「${SCHEMA_PRESET_CN[entry.key]}」`);
				} else {
					li.setText(
						`${entry.how === "exact" ? "✅" : "🔎"} ${label} → ${entry.matched}`
						+ (entry.how === "alias" ? "（按你的命名智能匹配）" : "")
					);
				}
			}
			const sources = Object.entries(this.lastDetection.dataSources);
			if (sources.length > 0) {
				report.createEl("b", { text: "统计来源文件" });
				const slist = report.createEl("ul");
				for (const [key, path] of sources) slist.createEl("li", { text: `${key} → ${path}` });
			}
		}

		new Setting(c)
			.setName("套用预设")
			.setDesc("中文＝超级大脑默认结构；英文＝TALOS Starter Kit 交付包结构。")
			.addDropdown((d) => {
				d.addOption("", "（选择预设）");
				d.addOption("cn", "中文目录（00-收件箱 …）");
				d.addOption("en", "英文目录（00-Inbox …）");
				d.setValue("");
				d.onChange(async (v) => {
					const preset = SCHEMA_PRESETS[v];
					if (!preset) return;
					this.plugin.talosSettings.vaultSchema = { ...preset };
					await this.plugin.saveTalosSettings();
					this.plugin.applyViewSettings();
					new Notice(`已套用${v === "en" ? "英文" : "中文"}目录预设`);
					this.rerender();
				});
			});

		new Setting(c).setName("逐项映射").setHeading();

		const current = resolveSchema(this.plugin.talosSettings.vaultSchema);
		for (const key of MODULE_KEYS) {
			const exists = this.app.vault.getAbstractFileByPath(current[key]) !== null;
			new Setting(c)
				.setName(SCHEMA_LABELS[key])
				.setDesc(
					(exists ? "✅ 库内存在" : "⚠️ 库内未找到此目录")
					+ ` · 默认：${SCHEMA_PRESET_CN[key]}`
				)
				.addText((t) =>
					t
						.setPlaceholder(SCHEMA_PRESET_CN[key])
						.setValue(current[key])
						.onChange(async (v) => {
							const next = { ...this.plugin.talosSettings.vaultSchema };
							const trimmed = v.trim().replace(/^\/+|\/+$/g, "");
							if (trimmed) next[key] = trimmed;
							else delete next[key];
							this.plugin.talosSettings.vaultSchema = next;
							await this.plugin.saveTalosSettings();
						})
				);
		}

		new Setting(c)
			.setName("保存并刷新控制台")
			.setDesc("改完目录名后点这里，控制台按新映射重新统计。")
			.addButton((b) =>
				b.setButtonText("刷新").setCta().onClick(() => {
					this.plugin.applyViewSettings();
					this.plugin.refreshAllViews();
					new Notice("控制台已按新的目录映射刷新");
					this.rerender();
				})
			);

		new Setting(c)
			.setName("恢复默认")
			.setDesc("清空全部自定义映射，回到中文默认结构。")
			.addButton((b) =>
				b.setButtonText("恢复默认").setWarning().onClick(async () => {
					this.plugin.talosSettings.vaultSchema = {};
					await this.plugin.saveTalosSettings();
					this.plugin.applyViewSettings();
					this.plugin.refreshAllViews();
					new Notice("已恢复默认目录映射");
					this.rerender();
				})
			);
	}

	// ---------- Tab：数据源 ----------
	private renderData(c: HTMLElement): void {
		this.textIn(c, "系统焦点任务", "今日焦点解析源", "tasksPath");
		this.textIn(c, "TALOS 发布任务", "发布作战室解析源", "talosTasksPath");
		this.textIn(c, "待审批", "pending-approvals.md", "pendingApprovalsPath");
		this.textIn(c, "偏好候选", "candidates.md", "candidatesPath");
		this.textIn(c, "健康分日志", "health-log.md（EVAL_HISTORY）", "healthLogPath");
		this.textIn(c, "收件箱目录", "Inbox 计数 + 写入", "inboxFolder");
		this.textIn(c, "日记目录", "New Diary 写入", "dailyFolder");
		this.textIn(c, "报告目录", "Lint / 周报输出", "reportsFolder");
		this.textIn(c, "重估期启动日", "算冻结天数，YYYY-MM-DD", "freezeStartDate");
	}

	// ---------- Tab：智能体与模型 ----------
	private renderChannel(c: HTMLElement): void {
		new Setting(c).setDesc(
			"工作台先选智能体，再选认证/API，最后选模型。本机登录与 API 配置互不覆盖；密钥只保存在 Obsidian SecretStorage。"
		);

		new Setting(c).setName("DeepSeek Harness").setHeading();
		new Setting(c).setDesc(
			"DSH 保留独立对话面。它的 API 与模型继续在 DSH 内的「Settings → Models」配置，这里只显示运行状态，避免重复设置。"
		);
		new Setting(c)
			.setName("Harness 运行状态")
			.setDesc(this.describeHarnessState())
			.addButton((button) =>
				button.setButtonText("重启 Harness").onClick(() => {
					button.setButtonText("正在重启…");
					void this.plugin
						.getHarnessManager()
						.restart()
						.catch(() => {})
						.finally(() => this.rerender());
				})
			);
		if (this.plugin.getHarnessManager().getState() === "error") {
			this.textIn(
				c,
				"DSH 可执行路径（故障恢复）",
				"仅在自动探测失败时填写；留空继续使用 PATH 自动探测。",
				"harnessExecutable",
				"(自动探测)"
			);
			new Setting(c)
				.setName("Harness 端口（故障恢复）")
				.setDesc("仅在端口冲突时修改；默认 3180，只监听 127.0.0.1。")
				.addText((text) =>
					text
						.setPlaceholder(String(DEFAULT_DSH_PORT))
						.setValue(String(this.plugin.talosSettings.harnessPort || DEFAULT_DSH_PORT))
						.onChange(async (value) => {
							this.plugin.talosSettings.harnessPort = normalizeDshPort(value);
							await this.plugin.saveTalosSettings();
						})
				);
		}

		new Setting(c).setName("Claude").setHeading();
		new Setting(c).setDesc(
			"默认使用 Claude 本机登录。保存 API Key 后，工作台顶部会新增“Anthropic API”；Base URL 和模型目录只作用于这个 API 选项。"
		);
		this.secretIn(
			c,
			"Anthropic API Key",
			"保存后启用 Anthropic API 认证，不进入 data.json、Vault、日志或发行物。",
			"anthropicApiKey"
		);
		this.textIn(
			c,
			"Anthropic Base URL",
			"留空使用官方端点；自建 Anthropic 兼容网关填完整 HTTPS 地址。",
			"anthropicBaseUrl",
			"https://api.anthropic.com"
		);
		this.modelCatalogIn(
			c,
			"Claude API 模型",
			"每行一个模型 ID；留空时由运行时使用默认模型。",
			"agentWorkbenchClaudeModels",
			"claude-sonnet-…\nclaude-opus-…"
		);

		new Setting(c).setName("Codex").setHeading();
		new Setting(c).setDesc(
			"默认使用 Codex 本机登录。保存 API Key 后，工作台顶部会新增“OpenAI Responses API”；自建端点必须兼容 Responses API。"
		);
		this.secretIn(
			c,
			"OpenAI API Key",
			"保存后只注入所选 Codex 子进程，不进入 data.json、Vault、日志或发行物。",
			"codexApiKey"
		);
		this.textIn(
			c,
			"Responses Base URL",
			"留空使用 OpenAI 官方端点；自建网关填完整 HTTPS 地址。",
			"codexBaseUrl",
			"https://api.openai.com"
		);
		this.modelCatalogIn(
			c,
			"Codex API 模型",
			"每行一个 Responses 模型 ID；留空时由 Codex 使用默认模型。",
			"agentWorkbenchCodexModels",
			"gpt-…\ngpt-…-codex"
		);

		new Setting(c).setName("OhMyPi").setHeading();
		new Setting(c).setDesc(
			"OhMyPi 继续使用它自己的 Provider 与模型目录；TALOS 工作台会直接读取，不再复制一套无效配置。"
		);

		new Setting(c).setName("权限").setHeading();
		new Setting(c).setDesc(
			"Plan / Execute 和 Ask / Scoped / Vault Full 都在工作台顶部切换。设置页不再重复展示不会改变新工作台权限的旧开关。"
		);
	}

	// ---------- Tab：屈原 · 语音 ----------
	private renderVoice(c: HTMLElement): void {
		new Setting(c).setName("千问原生实时语音").setHeading();
		new Setting(c).setDesc(
			"语音页使用百炼 Qwen Omni Realtime 的端到端 WebRTC：持续监听、语义断句、实时字幕和随时打断均由同一云端会话完成，不下载或运行本地语音模型。"
		);
		this.secretIn(
			c,
			"百炼 API Key",
			"仅由插件可信侧用于 WebRTC SDP 交换及明确口令触发的 Qwen 联网检索，保存到 Obsidian SecretStorage；语音页面和 data.json 均拿不到长期密钥。",
			"aliyunApiKey"
		);
		this.textIn(
			c,
			"百炼业务空间 ID",
			"WebRTC 必填。请填写业务空间的 Workspace ID，不要填写名称或完整 URL。",
			"quyuanRealtimeWorkspaceId",
			"ws-..."
		);
		new Setting(c)
			.setName("接入地域")
			.setDesc("中国大陆使用华北 2（北京）；Key 与业务空间必须属于同一地域。")
			.addDropdown((d) =>
				d
					.addOption("cn-beijing", "华北 2（北京·推荐）")
					.addOption("ap-southeast-1", "新加坡")
					.setValue(this.plugin.talosSettings.quyuanRealtimeRegion || "cn-beijing")
					.onChange(async (value) => {
						this.plugin.talosSettings.quyuanRealtimeRegion = value;
						await this.plugin.saveTalosSettings();
					})
			);
		new Setting(c)
			.setName("实时语音模型")
			.setDesc("Flash 延迟与成本更低；Plus 理解和指令遵循更强。均为原生端到端语音模型。")
			.addDropdown((d) =>
				d
					.addOption("qwen3.5-omni-flash-realtime", "Qwen3.5 Omni Flash Realtime（推荐）")
					.addOption("qwen3.5-omni-plus-realtime", "Qwen3.5 Omni Plus Realtime（质量档）")
					.setValue(
						this.plugin.talosSettings.quyuanRealtimeModel
						|| "qwen3.5-omni-flash-realtime"
					)
					.onChange(async (value) => {
						this.plugin.talosSettings.quyuanRealtimeModel = value;
						await this.plugin.saveTalosSettings();
					})
			);
		new Setting(c)
			.setName("实时音色")
			.setDesc("Tina 为 Qwen3.5 Omni 默认中文音色；修改后重开语音会话生效。")
			.addDropdown((d) =>
				d
					.addOption("Tina", "Tina（中文·推荐）")
					.addOption("Ethan", "Ethan")
					.addOption("Raymond", "Raymond")
					.addOption("Cindy", "Cindy")
					.addOption("Liora Mira", "Liora Mira")
					.addOption("Sunnybobi", "Sunnybobi")
					.setValue(this.plugin.talosSettings.quyuanRealtimeVoice || "Tina")
					.onChange(async (value) => {
						this.plugin.talosSettings.quyuanRealtimeVoice = value;
						await this.plugin.saveTalosSettings();
					})
			);
		new Setting(c).setDesc(
			"隐私与计费：点击开启语音后，麦克风音频会持续发送到所选百炼地域，直至点击退出语音或离开页面；费用由百炼按实际输入/输出 Token 计收。只有当前轮明确说“联网搜索”或“上网查”才会把该轮问题发送给同地域 qwen-flash；不发送 Vault 片段，每轮最多一次，搜索策略与模型 Token 另计。"
		);

		new Setting(c).setName("文字查询后备模型").setHeading();
		new Setting(c)
			.setName("文字查询模型")
			.setDesc("只用于语音页底部的文字只读查询；麦克风对话不经过此串行模型。")
			.addDropdown((d) =>
				d
					.addOption("haiku", "Haiku（最快·推荐）")
					.addOption("sonnet", "Sonnet（平衡）")
					.addOption("opus", "Opus（最强但较慢）")
					.setValue(this.plugin.talosSettings.quyuanVoiceModel || "haiku")
					.onChange(async (v) => {
						this.plugin.talosSettings.quyuanVoiceModel = v;
						await this.plugin.saveTalosSettings();
					})
			);
		new Setting(c)
			.setName("语音思考强度")
			.setDesc("实时对话优先低延迟；复杂任务可转到完整工作台。")
			.addDropdown((d) =>
				d
					.addOption("low", "Low（最快·推荐）")
					.addOption("medium", "Medium（平衡）")
					.addOption("high", "High（较慢）")
					.setValue(this.plugin.talosSettings.quyuanVoiceEffort || "low")
					.onChange(async (v) => {
						this.plugin.talosSettings.quyuanVoiceEffort = v;
						await this.plugin.saveTalosSettings();
					})
			);

		new Setting(c).setName("人格与语言").setHeading();
		new Setting(c)
			.setName("人格前缀")
			.setDesc("注入到每次提问前的角色设定。留空用内置屈原人格（简洁、口语、便于朗读）。")
			.addTextArea((t) => {
				t
					.setPlaceholder("你是屈原，Haaper 的语音助手……")
					.setValue(this.plugin.talosSettings.voicePersona)
					.onChange(async (v) => {
						this.plugin.talosSettings.voicePersona = v;
						await this.plugin.saveTalosSettings();
					});
				t.inputEl.rows = 3;
			});
		this.textIn(c, "TTS 语言", "朗读语言，如 zh-CN / en-US。", "voiceLang", "zh-CN");

		const voiceSetting = new Setting(c)
			.setName("TTS 嗓音")
			.setDesc("朗读用的系统语音；「(自动)」按语言挑。列表来自你系统已装的语音。");
		voiceSetting.addDropdown((d) => {
			this.populateVoices(d);
			d.setValue(this.plugin.talosSettings.ttsVoice || "");
			d.onChange(async (v) => {
				this.plugin.talosSettings.ttsVoice = v;
				await this.plugin.saveTalosSettings();
			});
			const synth = window.speechSynthesis;
			if (synth && synth.getVoices().length === 0) {
				synth.addEventListener(
					"voiceschanged",
					() => {
						const cur = this.plugin.talosSettings.ttsVoice || "";
						this.populateVoices(d);
						d.setValue(cur);
					},
					{ once: true }
				);
			}
		});

		new Setting(c)
			.setName("语速")
			.setDesc("朗读速度，1 为正常。")
			.addSlider((s) =>
				s
					.setLimits(0.5, 2, 0.02)
					.setValue(this.plugin.talosSettings.ttsRate)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.talosSettings.ttsRate = v;
						await this.plugin.saveTalosSettings();
					})
			);
		new Setting(c)
			.setName("音调")
			.setDesc("音高，1 为正常，越高越尖。")
			.addSlider((s) =>
				s
					.setLimits(0, 2, 0.05)
					.setValue(this.plugin.talosSettings.ttsPitch)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.talosSettings.ttsPitch = v;
						await this.plugin.saveTalosSettings();
					})
			);
	}

	private populateVoices(d: DropdownComponent): void {
		d.selectEl.empty();
		d.addOption("", "(自动)");
		const voices = window.speechSynthesis?.getVoices() ?? [];
		const sorted = [...voices].sort((a, b) => a.lang.localeCompare(b.lang));
		for (const v of sorted) d.addOption(v.name, `${v.name} · ${v.lang}`);
	}
}
