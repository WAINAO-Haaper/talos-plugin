import { App, DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import type TalosPlugin from "./main";

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
	claudianCommandId: string;
	// 屈原语音助手
	voiceAgentCommand: string; // 语音大脑命令，如 claude -p
	voicePermission: string; // 工具权限：readonly | acceptEdits | all | off
	voicePersona: string; // 人格前缀，留空用默认
	voiceLang: string; // TTS 语言，如 zh-CN
	ttsVoice: string; // 指定 speechSynthesis 嗓音名，留空自动
	ttsRate: number; // 朗读语速 0.5–2
	ttsPitch: number; // 朗读音调 0–2
	ttsEngine: string; // system | elevenlabs
	elevenLabsApiKey: string;
	elevenLabsVoiceId: string; // 默认 Daniel（英音男声，屈原气质）
	elevenLabsModel: string; // eleven_turbo_v2_5 | eleven_multilingual_v2
	aliyunApiKey: string; // DashScope/百炼 API Key
	aliyunVoice: string; // qwen-tts 音色，默认 Andre（磁性沉稳男声）
	edgeTtsVoice: string; // Edge 朗读音色，默认 zh-CN-XiaoxiaoNeural（晓晓·女声）
	aliyunModel: string; // qwen3-tts-flash 等
	live2dModelPath: string; // 库内 *.model3.json 路径，留空用 SVG 角色
	// 屈原 agentic（B 方案 · claude-agent-sdk 流式）
	jarvisClaudeBin: string; // claude CLI 路径，留空自动 which claude
	jarvisModel: string; // 模型，留空用 CLI 默认
	engineProvider: string; // 执行通道：claude-cli（现行）| claude-api（P1）| codex（P2）
	anthropicApiKey: string; // 直连 Anthropic API 通道用，明文存本地
	anthropicBaseUrl: string; // 留空用官方 api.anthropic.com；自建网关填此
	openaiApiKey: string; // Codex/GPT 通道用，明文存本地
	openaiBaseUrl: string; // 留空用官方 api.openai.com；自建 OpenAI 兼容网关填此
	openaiModel: string; // Codex/GPT 模型，留空用 gpt-4o
	jarvisPermissionMode: string; // default | acceptEdits | plan | bypassPermissions
	jarvisSttEngine: string; // webspeech | aliyun | off（语音转写）
	jarvisSttApiKey: string; // STT API key（阿里云 Paraformer 等）
	jarvisSttLang: string; // 识别语言，如 zh-CN
	quyuanAsrEngine: string; // 屈原语音页识别引擎：cloud（千问）| local（本地 Whisper）
	quyuanLocalAsrModel: string; // 本地 Whisper 模型（transformers.js），留空用默认
	quyuanLocalAsrCdn: string; // transformers.js CDN ESM 地址，留空用默认
	quyuanVoiceModel: string; // Claude 语音通道独立模型，不影响文字工作台
	quyuanVoiceEffort: string; // Claude 语音通道独立思考强度
	quyuanBackground: QuyuanBackgroundType; // 屈原舞台背景效果：letter-glitch | grid-scan
	quyuanVoiceRecognitionEnabled: boolean; // 屈原语音识别模式：false 时释放麦克风且不监听唤醒词
	jarvisVoiceEnabled: boolean; // 语音总开关：同时控制麦克风与自动朗读
	jarvisThinkingLevel: string; // 思考档：off | low | medium | high
	jarvisTabsJson: string; // 多标签会话持久化（SessionStore 序列化），勿手改
}

export const DEFAULT_SETTINGS: TalosSettings = {
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
	claudianCommandId: "claudian:open-view",
	voiceAgentCommand: "claude -p",
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
	engineProvider: "claude-cli",
	anthropicApiKey: "",
	anthropicBaseUrl: "",
	openaiApiKey: "",
	openaiBaseUrl: "",
	openaiModel: "",
	jarvisPermissionMode: "default",
	jarvisSttEngine: "webspeech",
	jarvisSttApiKey: "",
	jarvisSttLang: "zh-CN",
	quyuanAsrEngine: "cloud",
	quyuanLocalAsrModel: "",
	quyuanLocalAsrCdn: "",
	quyuanVoiceModel: "haiku",
	quyuanVoiceEffort: "low",
	quyuanBackground: "letter-glitch",
	quyuanVoiceRecognitionEnabled: true,
	jarvisVoiceEnabled: false,
	jarvisThinkingLevel: "off",
	jarvisTabsJson: "",
};

type TextSettingKey = {
	[K in keyof TalosSettings]: TalosSettings[K] extends string ? K : never;
}[keyof TalosSettings];
type FreeTextSettingKey = Exclude<TextSettingKey, "visualTheme" | "quyuanBackground">;

type TabId = "ui" | "data" | "channel" | "voice" | "workbench";

export class TalosSettingTab extends PluginSettingTab {
	plugin: TalosPlugin;
	private activeTab: TabId = "ui";
	private workbenchSettingsTab: { display(): void; containerEl: HTMLElement } | null = null;

	constructor(app: App, plugin: TalosPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("talos-settings");

		const tabs: { id: TabId; label: string }[] = [
			{ id: "ui", label: "界面" },
			{ id: "data", label: "数据源" },
			{ id: "channel", label: "屈原 · 通道" },
			{ id: "voice", label: "屈原 · 语音" },
			{ id: "workbench", label: "屈原 · 高级" },
		];

		const bar = containerEl.createDiv({ cls: "talos-settabs" });
		const content = containerEl.createDiv({ cls: "talos-setcontent" });

		const renderActive = (): void => {
			content.empty();
			if (this.activeTab === "ui") this.renderUi(content);
			else if (this.activeTab === "data") this.renderData(content);
			else if (this.activeTab === "channel") this.renderChannel(content);
			else if (this.activeTab === "voice") this.renderVoice(content);
			else void this.renderWorkbench(content);
		};

		const btns: HTMLElement[] = [];
		tabs.forEach((t) => {
			const b = bar.createDiv({
				cls: "talos-settab" + (t.id === this.activeTab ? " is-active" : ""),
				text: t.label,
			});
			b.addEventListener("click", () => {
				this.activeTab = t.id;
				btns.forEach((x, i) => x.toggleClass("is-active", tabs[i]?.id === this.activeTab));
				renderActive();
			});
			btns.push(b);
		});

		renderActive();
	}

	private async renderWorkbench(c: HTMLElement): Promise<void> {
		new Setting(c)
			.setName("屈原完整工作台")
			.setDesc("模型、Provider、权限、环境变量、上下文、快捷键与多标签等高级配置。原第二个 TALOS 设置页已融合到这里。");
		try {
			const { ClaudianSettingTab } = await import("./quyuan/claudian/features/settings/ClaudianSettings");
			this.workbenchSettingsTab ??= new ClaudianSettingTab(this.app, this.plugin);
			this.workbenchSettingsTab.display();
			this.workbenchSettingsTab.containerEl.addClass("talos-embedded-workbench-settings");
			c.appendChild(this.workbenchSettingsTab.containerEl);
		} catch (error) {
			new Setting(c)
				.setName("高级设置暂不可用")
				.setDesc(error instanceof Error ? error.message : String(error));
		}
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

	// ---------- Tab：屈原 · 通道 ----------
	private renderChannel(c: HTMLElement): void {
		new Setting(c).setDesc(
			"屈原 Agentic：全库可读写、跑命令、多步任务、流式朗读、语音输入。三通道一处切换，语音与库内人格自动保留。"
		);
		new Setting(c)
			.setName("执行通道")
			.setDesc(
				"claude-cli=本机 CLI 满血（需装 claude、仅桌面）；claude-api=直连 Anthropic API（免 CLI、可移动端）；codex=直连 Codex/GPT。后两者人格自动注入库内 灵魂/PERSONA。切换后重开屈原页生效。"
			)
			.addDropdown((d) =>
				d
					.addOption("claude-cli", "Claude · 本机 CLI（满血）")
					.addOption("claude-api", "Claude · 直连 API（免 CLI）")
					.addOption("codex", "Codex / GPT · 直连 OpenAI")
					.setValue(this.plugin.talosSettings.engineProvider)
					.onChange(async (v) => {
						this.plugin.talosSettings.engineProvider = v;
						await this.plugin.saveTalosSettings();
					})
			);

		new Setting(c).setName("Claude 直连（claude-api）").setHeading();
		this.textIn(c, "Anthropic API Key", "console.anthropic.com 取。明文存本地 data.json。", "anthropicApiKey");
		this.textIn(c, "Anthropic Base URL", "留空用官方 api.anthropic.com；自建网关/代理填这里。", "anthropicBaseUrl", "(官方)");

		new Setting(c).setName("Codex / GPT（codex）").setHeading();
		this.textIn(c, "OpenAI API Key", "platform.openai.com 取。明文存本地 data.json。", "openaiApiKey");
		this.textIn(c, "OpenAI Base URL", "留空用官方 api.openai.com；自建 OpenAI 兼容网关填这里（填到 host 根，插件自动补 /v1/chat/completions）。", "openaiBaseUrl", "(官方)");
		this.textIn(c, "OpenAI 模型", "留空用 gpt-4o。可填 gpt-5-codex / gpt-4.1 等。", "openaiModel", "(gpt-4o)");

		new Setting(c).setName("本机 CLI（claude-cli）").setHeading();
		this.textIn(c, "claude CLI 路径", "留空自动探测（which claude）。也可填绝对路径，如 /opt/homebrew/bin/claude。", "jarvisClaudeBin", "(自动探测)");
		this.textIn(c, "模型", "留空用 CLI 默认模型。可填 sonnet / opus 或完整模型串。", "jarvisModel", "(CLI 默认)");

		new Setting(c).setName("通用").setHeading();
		new Setting(c)
			.setName("默认权限模式")
			.setDesc("default=每次工具调用都弹卡片审批（最稳）；acceptEdits=自动接受文件编辑；plan=只读规划不落地；bypass=全放开（危险）。面板内可随时切换。")
			.addDropdown((d) =>
				d
					.addOption("default", "每次询问（推荐）")
					.addOption("acceptEdits", "自动接受编辑")
					.addOption("plan", "计划模式（只读）")
					.addOption("bypassPermissions", "全放开（危险）")
					.setValue(this.plugin.talosSettings.jarvisPermissionMode)
					.onChange(async (v) => {
						this.plugin.talosSettings.jarvisPermissionMode = v;
						await this.plugin.saveTalosSettings();
					})
			);
		new Setting(c)
			.setName("Deep Research 命令")
			.setDesc("Deep Research 调用的命令前缀，如 claude -p 或 codex exec。留空只写占位报告。")
			.addText((t) =>
				t
					.setPlaceholder("claude -p")
					.setValue(this.plugin.talosSettings.agentCommand)
					.onChange(async (v) => {
						this.plugin.talosSettings.agentCommand = v.trim();
						await this.plugin.saveTalosSettings();
					})
			);
	}

	// ---------- Tab：屈原 · 语音 ----------
	private renderVoice(c: HTMLElement): void {
		new Setting(c).setName("实时对话模型").setHeading();
		new Setting(c)
			.setName("Claude 语音模型")
			.setDesc("只影响屈原语音通道，不改变完整文字工作台。Haiku 首字最快。")
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

		new Setting(c).setName("人格与朗读").setHeading();
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

		new Setting(c).setName("TTS 引擎").setHeading();
		new Setting(c)
			.setName("语音引擎")
			.setDesc("系统语音离线免费；Edge 微软为免费中文神经语音（晓晓等，需联网、无 key）；阿里云千问中文最佳（需 key·有免费额度）；ElevenLabs 英音需付费。")
			.addDropdown((d) =>
				d
					.addOption("system", "系统语音（免费·离线）")
					.addOption("edgetts", "Edge 微软·中文免费（联网·无 key）")
					.addOption("aliyun", "阿里云千问·中文最佳（需 key·有免费额度）")
					.addOption("elevenlabs", "ElevenLabs（英音·需付费）")
					.setValue(this.plugin.talosSettings.ttsEngine)
					.onChange(async (v) => {
						this.plugin.talosSettings.ttsEngine = v;
						await this.plugin.saveTalosSettings();
					})
			);
		this.textIn(c, "Edge 朗读音色", "免费中文音色，默认 zh-CN-XiaoxiaoNeural（晓晓·女声）。可填 zh-CN-YunxiNeural（云希·男声）、zh-CN-YunyangNeural（云扬·播报）、zh-HK-HiuMaanNeural（粤语）等。", "edgeTtsVoice");
		this.textIn(c, "ElevenLabs API Key", "elevenlabs.io 注册后在 Profile 取，免费额度约每月 1 万字符。", "elevenLabsApiKey");
		this.textIn(c, "ElevenLabs 嗓音 ID", "默认 Daniel（英音男声）。换音色去 ElevenLabs Voices 复制 Voice ID。", "elevenLabsVoiceId");
		new Setting(c)
			.setName("ElevenLabs 模型")
			.setDesc("turbo 更快更省额度；multilingual 质量更高。两者都支持中英文。")
			.addDropdown((d) =>
				d
					.addOption("eleven_turbo_v2_5", "Turbo v2.5（快·省）")
					.addOption("eleven_multilingual_v2", "Multilingual v2（质量高）")
					.setValue(this.plugin.talosSettings.elevenLabsModel)
					.onChange(async (v) => {
						this.plugin.talosSettings.elevenLabsModel = v;
						await this.plugin.saveTalosSettings();
					})
			);
		this.textIn(c, "阿里云 API Key", "阿里云百炼(DashScope) API Key，bailian.console.aliyun.com 开通，有免费额度。", "aliyunApiKey");
		this.textIn(c, "阿里云音色", "默认 Andre（磁性沉稳男声·屈原感）。备选：Neil(新闻主播)、Eldric Sage(睿智老者)、Cherry(女)。", "aliyunVoice");
		this.textIn(c, "阿里云模型", "默认 qwen3-tts-flash（快·省·支持中英）。", "aliyunModel");
		this.textIn(c, "Live2D 模型路径", "库内 *.model3.json 路径，留空用 SVG 角色（详见插件 _README）。", "live2dModelPath");

		new Setting(c).setName("语音识别（STT）").setHeading();
		new Setting(c)
			.setName("语音识别引擎")
			.setDesc("WebSpeech 为 Obsidian 内置 Chromium 原生识别，免 key（联网走 Google）。关闭则只打字。")
			.addDropdown((d) =>
				d
					.addOption("webspeech", "WebSpeech（免费·推荐）")
					.addOption("off", "关闭（只打字）")
					.setValue(this.plugin.talosSettings.jarvisSttEngine)
					.onChange(async (v) => {
						this.plugin.talosSettings.jarvisSttEngine = v;
						await this.plugin.saveTalosSettings();
					})
			);
		this.textIn(c, "识别语言", "麦克风识别语言，如 zh-CN / en-US。", "jarvisSttLang", "zh-CN");

		new Setting(c).setName("旧·语音助手（存档）").setHeading();
		this.textIn(c, "语音大脑命令", "旧 voice.ts 用，已被 Agentic 取代。对话调用的 CLI，cwd 为库根。", "voiceAgentCommand", "claude -p");
		new Setting(c)
			.setName("工具权限（旧）")
			.setDesc("旧 voice.ts 用。默认「不加」：用你库自己的 .claude/settings.json 权限。")
			.addDropdown((d) =>
				d
					.addOption("off", "不加·用库自己的配置（推荐）")
					.addOption("readonly", "只读+搜索（注入标志）")
					.addOption("acceptEdits", "接受编辑（可改文件）")
					.addOption("all", "完全放开（含 bash，危险）")
					.setValue(this.plugin.talosSettings.voicePermission)
					.onChange(async (v) => {
						this.plugin.talosSettings.voicePermission = v;
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
