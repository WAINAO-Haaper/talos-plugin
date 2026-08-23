import { App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { TalosSettings } from "../settings";
import { StreamTts } from "../jarvis/voiceio";
import type { VadMic, VadMicHandlers } from "./vad-mic";
import { CloudAsr } from "./cloud-asr";
import { LocalAsr } from "./local-asr";
import type ClaudianPlugin from "./claudian/main";
import { QuyuanVoiceDriver } from "./voice-driver";
import type { InteractionChannel } from "./voice-driver";
import { buildTalosDataMap } from "./voice-data-map";
import { QuyuanBackgroundField } from "./background-field";
import type { QuyuanBackgroundType } from "./background-field";
import { QuyuanVoiceCharacterStage } from "./voice-character-stage";
import type { VaultPaths } from "../data/schema";
import {
	VoiceSessionStore,
	type VoiceSessionMessage,
} from "./voice-session-store";
import {
	VoiceModeController,
	type VoiceInputMode,
} from "./voice-mode-controller";
import {
	providerSecretStoreFromApp,
	readProviderSecret,
} from "../ai/provider/secret-storage-runtime";

interface TalosQuyuanPlugin extends ClaudianPlugin {
	activateQuyuanV2View(): Promise<void>;
	/** 库目录映射（唯一真源，见 data/schema.ts） */
	readonly paths: VaultPaths;
}

// ============================================================
// 屈原 · 语音对话面板（主页屈原模块）
//   独立于右侧栏 JarvisAgentPanel——专为主页模块的语音交互重做。
//   STT：CloudAsr（千问云端，WebSpeech 在 Electron 不可用故弃用）。
//   引擎：QuyuanVoiceDriver 复用 v2 运行时。TTS：StreamTts（现有）。
//   状态机：idle / listen / reco / think / speak，经 setState 解耦。
//   不修改、不引用右侧栏任何状态。
// ============================================================

type VoiceState = "sleep" | "idle" | "listen" | "reco" | "think" | "speak";

interface StateMeta {
	color: string;
	speed: string;
	icon: string;
	caption: string;
	sub: string;
}

const STATES: Record<VoiceState, StateMeta> = {
	sleep: { color: "#475569", speed: "4.8s", icon: "moon", caption: "等待唤醒", sub: "说「屈原」开始对话" },
	idle: { color: "#64748b", speed: "3.6s", icon: "mic-off", caption: "麦克风已关闭", sub: "点击下方按钮恢复监听" },
	listen: { color: "#38bdf8", speed: "2s", icon: "ear", caption: "我在听", sub: "说完，我会接住。" },
	reco: { color: "#7dd3fc", speed: "0.9s", icon: "audio-lines", caption: "正在识别", sub: "把你的声音变成清晰意图" },
	think: { color: "#a78bfa", speed: "1.4s", icon: "loader", caption: "正在想透", sub: "按超级大脑规则理解意图" },
	speak: { color: "#5eead4", speed: "1s", icon: "volume-2", caption: "屈原在回答", sub: "开口即可打断" },
};

// 样式见 styles.quyuan-shell.css（.tq- 作用域），由 build-styles.mjs 合入 styles.css。

export class QuyuanVoicePanel {
	private app: App;
	private plugin: TalosQuyuanPlugin;
	private settings: TalosSettings;
	private save?: () => Promise<void>;

	private tts: StreamTts | null = null;
	private asr: VadMic | null = null;
	private driver: QuyuanVoiceDriver | null = null;
	private voiceSessionStore: VoiceSessionStore | null = null;
	private voiceMode = new VoiceModeController();
	private replyEl: HTMLElement | null = null;
	private engBtn: HTMLButtonElement | null = null;
	private voiceModeBtn: HTMLButtonElement | null = null;

	private rootEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private capEl: HTMLElement | null = null;
	private subEl: HTMLElement | null = null;
	private liveEl: HTMLElement | null = null;
	private convoEl: HTMLElement | null = null;
	private sessionEmptyEl: HTMLElement | null = null;
	private sessionInputEl: HTMLTextAreaElement | null = null;
	private wakeStatusEl: HTMLElement | null = null;
	private dotEl: HTMLElement | null = null;
	private micBtn: HTMLButtonElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private sideToggleBtn: HTMLButtonElement | null = null;
	private characterStage: QuyuanVoiceCharacterStage | null = null;
	private bgField: QuyuanBackgroundField | null = null;
	private bgResizeObs: ResizeObserver | null = null;
	private bgBtn: HTMLButtonElement | null = null;
	private fabEl: HTMLElement | null = null;
	private markdownComponent: Component | null = null;
	private activateSideTab: ((key: "session" | "context" | "ability") => void) | null = null;
	private replyBuffer = "";
	// 沉浸式 overlay 文字层（舞台半透明覆盖）
	private overlayTranscriptEl: HTMLElement | null = null;
	private overlayUser: HTMLTextAreaElement | null = null;
	private overlayTranscriptLinesEl: HTMLElement | null = null;
	private overlayReply: HTMLElement | null = null;
	// 字幕式滚动：overlay 可见行管理
	private overlayLines: HTMLElement[] = [];
	// fab 圆环状态文字
	private fabStatusEl: HTMLElement | null = null;
	// 舞台左上角统一工作台状态文字
	private workspaceStatusEl: HTMLElement | null = null;
	// overlay 回复的 markdown 渲染容器（用于 text 通道完成后重渲染）
	private overlayReplyMd: HTMLElement | null = null;
	private sideCollapsed = false;
	private wakeActive = false;
	private wakeTimer: number | null = null;
	private responseActive = false;
	private ttsPending = false;
	private ttsSpeaking = false;
	private fabLabelSeq = 0;

	private state: VoiceState = "sleep";
	private mounted = false;
	private readonly sideWidthKey = "talos-quyuan-side-width";
	private readonly wakeWord = "屈原";
	// 本地 Whisper 对中文专有名词识别不稳，"屈原"常被听成近音字或拼音；
	// 唤醒用这组别名做模糊匹配，命中任一即唤醒（云端千问准，一般直接命中"屈原"）。
	private readonly wakeAliases = [
		"屈原", "曲原", "去原", "屈源", "渠原", "趋原", "区原", "取原",
		"屈园", "曲园", "驱原", "瞿原", "屈元", "曲元", "居原", "取源",
		"quyuan", "qu yuan", "chuyuan", "chu yuan", "qvyuan",
	];
	private readonly sleepWord = "退下";
	private readonly wakeWindowMs = 30_000;

	constructor(app: App, plugin: TalosQuyuanPlugin, settings: TalosSettings, save?: () => Promise<void>) {
		this.app = app;
		this.plugin = plugin;
		this.settings = settings;
		this.save = save;
	}

	// ---------- 挂载 ----------
	mount(container: HTMLElement): void {
		container.empty();
		this.mounted = true;
		this.markdownComponent = new Component();
		this.markdownComponent.load();
		this.driver = new QuyuanVoiceDriver(this.plugin, {
			model: this.settings.quyuanVoiceModel || "haiku",
			effortLevel: this.settings.quyuanVoiceEffort || "low",
			getDataContext: () => buildTalosDataMap(this.settings),
		});
		this.driver.setConfirmHandler((tool, desc) => this.askConfirm(tool, desc));
		this.voiceMode = new VoiceModeController();
		this.voiceMode.setInputMode(
			this.settings.quyuanVoiceInputMode === "push-to-talk"
				? "push-to-talk"
				: "continuous"
		);
		this.voiceSessionStore = new VoiceSessionStore({
			read: () => this.settings.quyuanVoiceSessionJson,
			// jarvisTabsJson 仅作一次保守迁移源；store 会拒绝 chat/无 namespace 数据。
			readLegacy: () => this.settings.jarvisTabsJson,
			write: async (value) => {
				this.settings.quyuanVoiceSessionJson = value;
				await this.save?.();
			},
		});
		const secretStore = providerSecretStoreFromApp(this.app);
		this.tts = new StreamTts(this.settings, (s) => {
			if (s === "speaking") {
				this.voiceMode.setTtsSpeaking();
				this.ttsPending = true;
				this.ttsSpeaking = true;
				this.syncAsrBusy();
				this.setState("speak");
			} else if (s === "idle") {
				this.ttsPending = false;
				this.ttsSpeaking = false;
				this.characterStage?.setOutputLevel(0);
				this.syncAsrBusy();
				this.setState(this.restingState());
			} else if (s === "error") {
				this.voiceMode.onTtsFailure("朗读服务不可用，文字回复已保留");
				this.ttsPending = false;
				this.ttsSpeaking = false;
				this.characterStage?.setOutputLevel(0);
				this.syncAsrBusy();
				this.setState(this.responseActive ? "speak" : this.restingState());
			}
		}, (level) => {
			// TTS 输出音量直接驱动人物回答态的呼吸、位移与光晕。
			this.characterStage?.setOutputLevel(level);
		}, (field) =>
			readProviderSecret(this.settings, field, secretStore)
		);
		this.asr = this.buildAsr();

		const root = container.createDiv({ cls: "tq-voice" });
		this.rootEl = root;
		root.dataset.talosComponent = "voice-workspace";
		root.setAttribute("aria-label", "屈原语音工作台");
		root.setAttribute("data-wake-state", "sleep");
		root.setAttribute("data-session-namespace", "voice");
		root.setAttribute("data-input-mode", this.voiceMode.snapshot().inputMode);
		root.setAttribute(
			"data-voice-recognition",
			this.settings.quyuanVoiceRecognitionEnabled === false ? "off" : "on"
		);

		const body = root.createDiv({ cls: "tq-body" });
		this.bodyEl = body;
		this.setSideWidth(this.savedSideWidth(), false);

		// 中央动态语音舞台（沉浸式全屏）
		const stage = body.createDiv({
			cls: "tq-stage",
			attr: {
				role: "region",
				"aria-label": "动态语音舞台",
				"data-workspace-section": "voice-stage",
			},
		});
		const workspaceBar = stage.createDiv({
			cls: "tq-workspace-bar",
			attr: { role: "group", "aria-label": "屈原语音工作台状态" },
		});
		const workspaceIdentity = workspaceBar.createDiv({ cls: "tq-workspace-identity" });
		const workspaceMark = workspaceIdentity.createSpan({ cls: "tq-workspace-mark" });
		setIcon(workspaceMark, "audio-lines");
		const workspaceCopy = workspaceIdentity.createSpan({ cls: "tq-workspace-copy" });
		workspaceCopy.createEl("small", { text: "VOICE WORKSPACE" });
		workspaceCopy.createEl("strong", { text: "屈原语音" });
		const workspaceMeta = workspaceBar.createDiv({ cls: "tq-workspace-meta" });
		const boundary = workspaceMeta.createSpan({ cls: "tq-workspace-boundary" });
		setIcon(boundary.createSpan(), "shield-check");
		boundary.createSpan({ text: "语音只读" });
		const workspaceState = workspaceMeta.createSpan({
			cls: "tq-workspace-state",
			attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
		});
		workspaceState.createSpan({
			cls: "tq-workspace-state__dot",
			attr: { "aria-hidden": "true" },
		});
		this.workspaceStatusEl = workspaceState.createSpan({ text: STATES.sleep.caption });
		// 背景效果层（最底层 z-index:0）——LetterGlitch 字符故障 / GridScan 3D 网格扫描
		const bgCanvas = stage.createEl("canvas", {
			cls: "tq-bg",
			attr: { "aria-hidden": "true" },
		});
		try {
			this.bgField = new QuyuanBackgroundField(bgCanvas);
			this.bgField.start(this.settings.quyuanBackground);
			this.bgResizeObs = new ResizeObserver(() => this.bgField?.onResize());
			this.bgResizeObs.observe(stage);
		} catch (error) {
			console.error("TALOS Quyuan background layer failed to start", error);
			this.bgField = null;
		}
		// 程序化像素粒子头像接管人物主视觉；不再读取或移动静态人物图片。
		this.characterStage = new QuyuanVoiceCharacterStage(stage);

		// 半透明 AI 回复层：流式字幕自动滚动，不与右侧语音转写编辑卡混排。
		const overlay = stage.createDiv({ cls: "tq-overlay-text", attr: { "aria-live": "polite" } });
		this.overlayReply = overlay.createDiv({ cls: "tq-overlay-reply" });
		// 识别文字卡并入回复字幕所在容器：作为 order:1 成员叠在回复正上方，
		// 与输出端同一左对齐阅读栏，共享顶部 mask 滚动渐隐。
		this.overlayTranscriptEl = overlay.createDiv({
			cls: "tq-transcript-editor",
			attr: { "aria-hidden": "true" },
		});
		const transcriptHead = this.overlayTranscriptEl.createDiv({ cls: "tq-transcript-head" });
		transcriptHead.createSpan({ text: "识别文字" });
		transcriptHead.createEl("small", { text: "可编辑 · Esc 收起" });
		// 字幕行容器：每次最终识别追加一行，最新最亮、向上渐淡（样式见 .tq-transcript-lines）
		this.overlayTranscriptLinesEl = this.overlayTranscriptEl.createDiv({ cls: "tq-transcript-lines" });
		this.overlayUser = this.overlayTranscriptEl.createEl("textarea", {
			cls: "tq-overlay-user",
			attr: {
				rows: "3",
				maxlength: "1200",
				spellcheck: "false",
				"aria-label": "语音识别文字，可编辑",
			},
		});
		this.overlayUser.tabIndex = -1;
		this.overlayUser.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			this.hideTranscriptEditor();
		});

		// 右下角悬浮圆环 + 扇形展开控制菜单
		const fab = stage.createDiv({ cls: "tq-fab" });
		const fabMenu = fab.createDiv({ cls: "tq-fab-menu" });
		// 扇形弧线参数：7 个按钮围绕圆环上方展开（160° 弧）
		const FAN_ITEMS = 7;
		const FAN_RADIUS = 92;
		const FAN_SPREAD = 160;
		const FAN_START = -80;
		const pillBtn = (idx: number, cls: string, label: string): HTMLButtonElement => {
			const btn = fabMenu.createEl("button", {
				cls: `tq-fab-btn ${cls}`,
				attr: { type: "button" },
			});
			// 均匀分布在弧线上
			const t = FAN_ITEMS <= 1 ? 0.5 : idx / (FAN_ITEMS - 1);
			const angleDeg = FAN_START + t * FAN_SPREAD;
			const rad = (angleDeg * Math.PI) / 180;
			const tx = -Math.sin(rad) * FAN_RADIUS;
			const ty = -Math.cos(rad) * FAN_RADIUS;
			btn.style.setProperty("--tx", `${tx}px`);
			btn.style.setProperty("--ty", `${ty}px`);
			btn.style.setProperty("--idx", String(idx));
			this.setFabButtonLabel(btn, label);
			return btn;
		};
		// 1. 退出/开启语音识别（退出时会释放麦克风并停止唤醒词监听）
		this.micBtn = pillBtn(0, "", "退出或开启语音识别");
		this.renderMicBtn(false);
		this.micBtn.addEventListener("click", () => void this.toggleVoiceRecognitionMode());
		// 2. 打断
		const stopBtn = pillBtn(1, "tq-fab-btn--danger", "立即打断");
		setIcon(stopBtn.createSpan(), "zap");
		stopBtn.createSpan({ text: "打断" });
		stopBtn.addEventListener("click", () => {
			this.onBargeIn();
			this.setState(this.restingState());
		});
		// 3. 文字输入
		const textBtn = pillBtn(2, "", "文字输入");
		setIcon(textBtn.createSpan(), "keyboard");
		textBtn.createSpan({ text: "文字输入" });
		textBtn.addEventListener("click", () => this.openSessionComposer());
		// 4. 引擎切换
		this.engBtn = pillBtn(3, "", "切换识别引擎");
		this.renderEngineBtn();
		this.engBtn.addEventListener("click", () => void this.switchEngine());
		// 5. 背景效果切换
		this.bgBtn = pillBtn(4, "", "切换背景效果");
		this.renderBgBtn();
		this.bgBtn.addEventListener("click", () => this.toggleBackground());
		// 6. 侧栏切换
		this.sideToggleBtn = pillBtn(5, "", "展开/收起交互面板");
		setIcon(this.sideToggleBtn.createSpan(), "panel-right");
		this.sideToggleBtn.createSpan({ text: "交互面板" });
		this.sideToggleBtn.addEventListener("click", () => this.toggleSide());
		// 7. 设置
		const setBtn = pillBtn(6, "", "设置");
		setIcon(setBtn.createSpan(), "settings");
		setBtn.createSpan({ text: "设置" });
		setBtn.addEventListener("click", () => this.openSettings());
		// 音量条 + 状态文字（圆环下方）
		const fabExtra = fab.createDiv({ cls: "tq-fab-extra" });
		const meter = fabExtra.createDiv({ cls: "tq-fab-meter", attr: { "aria-label": "麦克风音量" } });
		for (let i = 0; i < 10; i++) {
			meter.createEl("i").style.setProperty("--bar", `${4 + ((i * 7) % 8)}px`);
		}
		this.fabStatusEl = fabExtra.createDiv({ cls: "tq-fab-status", text: "就绪" });
		// 中心大圆（BubbleMenu toggle）——点击展开/收起 pill 菜单
		const fabRing = fab.createDiv({ cls: "tq-fab-ring" });
		const fabCore = fabRing.createDiv({ cls: "tq-fab-core" });
		fabCore.createDiv({ cls: "tq-fab-line" });
		fabCore.createDiv({ cls: "tq-fab-line" });
		// 点击 backdrop（舞台空白区）关闭菜单
		const fabBackdrop = stage.createDiv({ cls: "tq-fab-backdrop" });
		fabBackdrop.addEventListener("click", () => this.toggleFab(false));
		this.fabEl = fab;
		fabRing.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleFab();
		});
		// 所有 pill 按钮点击后自动收起
		fabMenu.addEventListener("click", () => this.toggleFab(false));

		// 右侧 TALOS 交互面板：可拖拽调宽、折叠，与动态舞台职责分离
		const resizer = body.createDiv({
			cls: "tq-side-resizer",
			attr: {
				role: "separator",
				tabindex: "0",
				"aria-orientation": "vertical",
				"aria-label": "调整 TALOS 交互面板宽度",
			},
		});
		this.installSideResizer(resizer);
		const side = body.createEl("aside", {
			cls: "tq-side",
			attr: {
				"aria-label": "会话、上下文与能力",
				"data-workspace-section": "session-context",
			},
		});
		this.buildFunctionalSidebar(side);
		void this.restoreVoiceSession().finally(() => {
			void this.driver?.warmup("voice");
		});

		const recognitionEnabled = this.settings.quyuanVoiceRecognitionEnabled !== false;
		const continuous =
			this.voiceMode.snapshot().inputMode === "continuous";
		this.setState(recognitionEnabled && continuous ? "sleep" : "idle");
		if (recognitionEnabled && continuous) {
			void this.setVoiceRecognitionEnabled(true, false);
		} else if (recognitionEnabled) {
			this.renderPushToTalkReady();
		} else {
			this.renderVoiceRecognitionOff();
		}
	}

	private modelLabel(): string {
		const model = this.settings.jarvisModel?.trim() || this.settings.openaiModel?.trim();
		if (model) return model;
		if (this.settings.engineProvider === "codex-cli") return "Codex CLI · 自动模型";
		if (this.settings.engineProvider === "codex") return "Codex · 自动模型";
		if (this.settings.engineProvider === "claude-api") return "Claude API · 自动模型";
		return "Claude · 自动模型";
	}

	private permissionLabel(): string {
		switch (this.settings.jarvisPermissionMode) {
			case "acceptEdits": return "接受编辑";
			case "plan": return "计划模式";
			case "bypassPermissions": return "全权限";
			default: return "每次询问";
		}
	}

	private openSettings(): void {
		const app = this.app as unknown as {
			setting?: { open(): void; openTabById(id: string): void };
		};
		app.setting?.open();
		app.setting?.openTabById(this.plugin.manifest.id);
	}

	private openPath(path: string): void {
		void this.app.workspace.openLinkText(path, "", false);
	}

	private buildFunctionalSidebar(side: HTMLElement): void {
		const topbar = side.createDiv({ cls: "tq-side-topbar" });
		const identity = topbar.createDiv({ cls: "tq-side-identity" });
		const identityIcon = identity.createSpan({ cls: "tq-side-identity-icon" });
		setIcon(identityIcon, "panel-right");
		const identityCopy = identity.createSpan();
		identityCopy.createEl("b", { text: "TALOS 交互面板" });
		identityCopy.createEl("small", { text: "语音、上下文与能力" });
		const topActions = topbar.createDiv({ cls: "tq-side-actions" });
		const workbenchBtn = topActions.createEl("button", {
			cls: "tq-btn tq-btn--ghost tq-btn--icon tq-btn--sm tq-mini-btn",
			attr: { type: "button", "aria-label": "打开完整屈原工作台" },
		});
		setIcon(workbenchBtn.createSpan(), "maximize-2");
		workbenchBtn.addEventListener("click", () => void this.plugin.activateQuyuanV2View());
		const collapseBtn = topActions.createEl("button", {
			cls: "tq-btn tq-btn--ghost tq-btn--icon tq-btn--sm tq-mini-btn",
			attr: { type: "button", "aria-label": "收起 TALOS 交互面板" },
		});
		setIcon(collapseBtn.createSpan(), "chevron-right");
		collapseBtn.addEventListener("click", () => this.toggleSide(true));

		const tabs = side.createDiv({ cls: "tq-side-tabs", attr: { role: "tablist" } });
		const panels = side.createDiv({ cls: "tq-side-panels" });
		const entries: Array<{
			key: "session" | "context" | "ability";
			label: string;
			panel: HTMLElement;
			button: HTMLButtonElement;
		}> = [];
		const addTab = (
			key: "session" | "context" | "ability",
			label: string,
			icon: string
		): HTMLElement => {
			const button = tabs.createEl("button", {
				cls: "tq-btn tq-btn--tab tq-side-tab",
				attr: { type: "button", role: "tab", "aria-selected": "false" },
			});
			setIcon(button.createSpan(), icon);
			button.createSpan({ text: label });
			const panel = panels.createDiv({
				cls: `tq-side-panel tq-side-panel-${key}`,
				attr: { role: "tabpanel" },
			});
			entries.push({ key, label, panel, button });
			return panel;
		};

		const sessionPanel = addTab("session", "会话", "message-circle");
		const sessionHead = sessionPanel.createDiv({ cls: "tq-session-head" });
		const sessionTitle = sessionHead.createDiv();
		sessionTitle.createEl("b", { text: "当前语音会话" });
		this.wakeStatusEl = sessionTitle.createEl("small", {
			text: this.settings.quyuanVoiceRecognitionEnabled === false
				? "语音已退出 · 点击开启语音"
				: "待唤醒 · 说「屈原」",
		});
		const sessionActions = sessionHead.createDiv({ cls: "tq-session-actions" });
		this.voiceModeBtn = sessionActions.createEl("button", {
			cls: "tq-btn tq-btn--ghost tq-btn--sm tq-voice-mode-btn",
			attr: { type: "button" },
		});
		this.voiceModeBtn.addEventListener("click", () => {
			const next =
				this.voiceMode.snapshot().inputMode === "continuous"
					? "push-to-talk"
					: "continuous";
			void this.setVoiceInputMode(next);
		});
		this.renderVoiceModeBtn();
		const clear = sessionActions.createEl("button", {
			cls: "tq-btn tq-btn--ghost tq-btn--icon tq-btn--sm tq-mini-btn",
			attr: { type: "button", "aria-label": "清空当前会话" },
		});
		setIcon(clear.createSpan(), "trash-2");
		this.convoEl = sessionPanel.createDiv({ cls: "tq-convo" });
		this.sessionEmptyEl = this.convoEl.createDiv({ cls: "tq-session-empty" });
		const emptyIcon = this.sessionEmptyEl.createSpan({ cls: "tq-session-empty-icon" });
		setIcon(emptyIcon, "message-circle-more");
		this.sessionEmptyEl.createEl("b", { text: "从这里开始对话" });
		this.sessionEmptyEl.createEl("small", {
			text: "本页使用独立语音历史，不读取文字工作台会话",
		});
		this.sessionEmptyEl.createEl("small", {
			text: "语音只读：可查状态、读统计、报进度；写、改、删请到文字对话确认执行",
		});
		const prompts = this.sessionEmptyEl.createDiv({ cls: "tq-quick-prompts" });
		for (const prompt of ["梳理今日焦点", "检查系统状态", "打开完整工作台"]) {
			const button = prompts.createEl("button", {
				cls: "tq-btn tq-btn--ghost tq-btn--xs tq-quick-prompt",
				attr: { type: "button" },
			});
			button.createSpan({ text: prompt });
			button.addEventListener("click", () => {
				if (prompt === "打开完整工作台") void this.plugin.activateQuyuanV2View();
				else this.commitUser(prompt, "text");
			});
		}
		const composer = sessionPanel.createDiv({ cls: "tq-side-composer" });
		this.sessionInputEl = composer.createEl("textarea", {
			attr: {
				rows: "2",
				placeholder: "输入消息，Enter 发送，Shift+Enter 换行",
				"aria-label": "给屈原发送文字消息",
			},
		});
		const composerTools = composer.createDiv({ cls: "tq-side-composer-tools" });
		const inputHint = composerTools.createSpan({ text: "TALOS · 屈原" });
		inputHint.addClass("tq-composer-hint");
		const send = composerTools.createEl("button", {
			cls: "tq-btn tq-btn--primary tq-btn--icon tq-btn--sm tq-send-btn",
			attr: { type: "button", "aria-label": "发送消息" },
		});
		this.sendBtn = send;
		send.disabled = true;
		setIcon(send.createSpan(), "arrow-up");
		const submit = (): void => {
			const text = this.sessionInputEl?.value.trim() ?? "";
			if (!text) return;
			if (this.sessionInputEl) this.sessionInputEl.value = "";
			this.updateSendState();
			this.commitUser(text, "text");
		};
		send.addEventListener("click", submit);
		this.sessionInputEl.addEventListener("input", () => this.updateSendState());
		this.sessionInputEl.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || event.shiftKey) return;
			event.preventDefault();
			submit();
		});
		clear.addEventListener("click", () => {
			this.convoEl?.empty();
			if (this.convoEl && this.sessionEmptyEl) this.convoEl.appendChild(this.sessionEmptyEl);
			this.sessionEmptyEl?.removeClass("is-hidden");
			this.clearTranscriptEditor();
			this.driver?.clearVoiceHistory();
			void this.voiceSessionStore?.clear();
			if (this.overlayReply) this.setOverlayMessage("开口，说出你现在最想推进的事。");
		});

		const contextPanel = addTab("context", "上下文", "layers-3");
		this.addSideSection(contextPanel, "当前上下文", "4 个核心");
		for (const item of [
			{ icon: "fingerprint", label: "PERSONA", meta: "屈原 · 人格契约", path: this.plugin.paths.personaFile },
			{ icon: "brain", label: "自我记忆", meta: "persona-memory", path: this.plugin.paths.personaMemoryFile },
			{ icon: "compass", label: "当前状态", meta: "Identity / CONTEXT", path: this.plugin.paths.contextFile },
			{ icon: "list-checks", label: "今日焦点", meta: "tasks.md", path: this.settings.tasksPath },
		]) this.addSideRow(contextPanel, item.icon, item.label, item.meta, () => this.openPath(item.path));
		this.addSideSection(contextPanel, "运行状态", "实时");
		for (const item of [
			{ icon: "network", label: "Skills / MCP", meta: "工作台能力已连接" },
			{ icon: "shield-check", label: "权限模式", meta: this.permissionLabel() },
			{ icon: "audio-lines", label: "语音引擎", meta: this.settings.quyuanAsrEngine === "local" ? "本地 Whisper" : "千问 ASR" },
		]) this.addSideRow(contextPanel, item.icon, item.label, item.meta, () => void this.plugin.activateQuyuanV2View());

		const abilityPanel = addTab("ability", "能力", "sparkles");
		this.addSideSection(abilityPanel, "已启用能力", "v2 工作台");
		for (const item of [
			{ icon: "sparkles", label: "Skills", meta: "命令与工作流" },
			{ icon: "network", label: "MCP", meta: "外部工具连接" },
			{ icon: "bot", label: "Subagents", meta: "可调度" },
			{ icon: "file-text", label: "文件读取", meta: "库内上下文" },
		]) this.addSideRow(abilityPanel, item.icon, item.label, item.meta, () => void this.plugin.activateQuyuanV2View());

		const sideFooter = side.createDiv({ cls: "tq-side-footer" });
		const perm = sideFooter.createDiv({ cls: "tq-side-footrow" });
		setIcon(perm.createSpan(), "shield-check");
		perm.createSpan({ text: `权限 · ${this.permissionLabel()}` });
		const provider = sideFooter.createDiv({ cls: "tq-side-footrow" });
		setIcon(provider.createSpan(), "cloud");
		provider.createSpan({
			text: this.settings.quyuanAsrEngine === "local" ? "本地 Whisper" : "千问 ASR",
		});

		const activate = (key: "session" | "context" | "ability"): void => {
			for (const entry of entries) {
				const active = entry.key === key;
				entry.button.toggleClass("is-active", active);
				entry.button.setAttribute("aria-selected", String(active));
				entry.panel.toggleClass("is-active", active);
			}
			if (key === "session") window.setTimeout(() => this.sessionInputEl?.focus(), 0);
		};
		this.activateSideTab = activate;
		for (const entry of entries) {
			entry.button.addEventListener("click", () => activate(entry.key));
		}
		activate("session");
	}

	private async restoreVoiceSession(): Promise<void> {
		const store = this.voiceSessionStore;
		if (!store) return;
		const snapshot = await store.load();
		if (!this.mounted) return;
		this.driver?.restoreVoiceHistory(store.contextMessages());
		for (const message of snapshot.messages) {
			this.renderVoiceSessionMessage(message);
		}
		if (snapshot.messages.length > 0) {
			this.sessionEmptyEl?.addClass("is-hidden");
			this.scrollConvo();
		}
		if (
			snapshot.transcriptDraft &&
			this.overlayUser &&
			this.overlayTranscriptEl
		) {
			this.overlayUser.value = snapshot.transcriptDraft;
			this.pushTranscriptLine(snapshot.transcriptDraft);
			this.overlayTranscriptEl.setAttribute("aria-hidden", "false");
			this.overlayTranscriptEl.addClass("is-visible");
		}
	}

	private renderVoiceSessionMessage(message: VoiceSessionMessage): void {
		if (!this.convoEl) return;
		const isUser = message.role === "user";
		const bubble = this.convoEl.createDiv({
			cls: `tq-bub ${isUser ? "tq-me" : "tq-qy"} tq-restored tq-channel-${message.modality === "speech" ? "voice" : "text"}`,
			attr: {
				"data-channel":
					message.modality === "speech" ? "voice" : "text",
			},
		});
		bubble.createSpan({
			cls: "tq-bub-role",
			text: isUser
				? message.modality === "speech"
					? "你 · 语音"
					: "你 · 文字"
				: "屈原 · 语音页",
		});
		bubble.createDiv({ text: message.text });
	}

	private renderVoiceModeBtn(): void {
		if (!this.voiceModeBtn) return;
		const continuous =
			this.voiceMode.snapshot().inputMode === "continuous";
		this.voiceModeBtn.empty();
		setIcon(
			this.voiceModeBtn.createSpan(),
			continuous ? "radio" : "mouse-pointer-click"
		);
		this.voiceModeBtn.createSpan({
			text: continuous ? "持续监听" : "点击说话",
		});
		this.voiceModeBtn.setAttribute("aria-pressed", String(!continuous));
		this.voiceModeBtn.setAttribute(
			"aria-label",
			continuous
				? "当前持续监听，点击切换为点击说话"
				: "当前点击说话，点击切换为持续监听"
		);
	}

	private async setVoiceInputMode(
		inputMode: VoiceInputMode,
		persist = true
	): Promise<void> {
		this.voiceMode.setInputMode(inputMode);
		this.settings.quyuanVoiceInputMode = inputMode;
		this.rootEl?.setAttribute("data-input-mode", inputMode);
		this.renderVoiceModeBtn();
		if (persist) await this.save?.();
		if (inputMode === "push-to-talk") {
			this.asr?.stop();
			this.renderPushToTalkReady();
			return;
		}
		this.settings.quyuanVoiceRecognitionEnabled = true;
		await this.setVoiceRecognitionEnabled(true, false);
	}

	private renderPushToTalkReady(): void {
		this.wakeActive = false;
		if (this.wakeTimer != null) window.clearTimeout(this.wakeTimer);
		this.wakeTimer = null;
		this.rootEl?.setAttribute("data-wake-state", "awake");
		this.rootEl?.setAttribute("data-input-mode", "push-to-talk");
		this.renderMicBtn(this.asr?.isOn() ?? false);
		this.wakeStatusEl?.setText("点击说话 · 一次发送一段");
		if (this.fabStatusEl) this.fabStatusEl.setText("点击麦克风开始说话");
		if (this.overlayReply) {
			this.setOverlayMessage("已切换点击说话，点击麦克风后直接说内容。");
		}
		if (this.mounted) this.setState(this.asr?.isOn() ? "listen" : "idle");
	}

	private fallbackToPushToTalk(reason: string): void {
		this.voiceMode.onAsrFailure(reason);
		this.settings.quyuanVoiceInputMode = "push-to-talk";
		this.asr?.stop();
		this.rootEl?.setAttribute("data-input-mode", "push-to-talk");
		this.renderVoiceModeBtn();
		this.renderPushToTalkReady();
		if (this.fabStatusEl) {
			this.fabStatusEl.setText(`已切换点击说话 · ${reason}`);
		}
		void this.save?.();
	}

	private savedSideWidth(): number {
		const fallback = 360;
		try {
			// 无存储时 getItem 返回 null，Number(null)=0 会被钳到 280 —— 必须先判空再转数
			const raw = window.localStorage.getItem(this.sideWidthKey);
			if (raw == null || raw.trim() === "") return fallback;
			const saved = Number(raw);
			return Number.isFinite(saved) ? Math.min(560, Math.max(280, saved)) : fallback;
		} catch {
			return fallback;
		}
	}

	private setSideWidth(width: number, persist = true): void {
		const next = Math.min(560, Math.max(280, Math.round(width)));
		this.bodyEl?.style.setProperty("--tq-side-size", `${next}px`);
		if (!persist) return;
		try {
			window.localStorage.setItem(this.sideWidthKey, String(next));
		} catch {
			// localStorage 不可用时仅保留本次视图宽度。
		}
	}

	private installSideResizer(resizer: HTMLElement): void {
		resizer.addEventListener("pointerdown", (event) => {
			if (!this.bodyEl || this.sideCollapsed) return;
			event.preventDefault();
			const startX = event.clientX;
			const current = getComputedStyle(this.bodyEl)
				.getPropertyValue("--tq-side-size")
				.trim();
			const startWidth = Number.parseFloat(current) || 360;
			resizer.addClass("is-dragging");
			const move = (moveEvent: PointerEvent): void => {
				if (!this.bodyEl) return;
				const max = Math.max(280, Math.min(560, this.bodyEl.clientWidth - 460));
				this.setSideWidth(Math.min(max, startWidth - (moveEvent.clientX - startX)), false);
			};
			const stop = (): void => {
				resizer.removeClass("is-dragging");
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", stop);
				const width = this.bodyEl
					? Number.parseFloat(getComputedStyle(this.bodyEl).getPropertyValue("--tq-side-size"))
					: 360;
				this.setSideWidth(width);
			};
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", stop, { once: true });
		});
		resizer.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			const current = this.bodyEl
				? Number.parseFloat(getComputedStyle(this.bodyEl).getPropertyValue("--tq-side-size"))
				: 360;
			this.setSideWidth(current + (event.key === "ArrowLeft" ? 20 : -20));
		});
		resizer.addEventListener("dblclick", () => this.setSideWidth(360));
	}

	private toggleSide(forceCollapsed?: boolean): void {
		this.sideCollapsed = forceCollapsed ?? !this.sideCollapsed;
		this.bodyEl?.toggleClass("is-side-collapsed", this.sideCollapsed);
		if (!this.sideToggleBtn) return;
		this.sideToggleBtn.empty();
		setIcon(
			this.sideToggleBtn.createSpan(),
			this.sideCollapsed ? "panel-right-open" : "panel-right-close"
		);
		this.sideToggleBtn.setAttribute("aria-expanded", String(!this.sideCollapsed));
		this.setFabButtonLabel(
			this.sideToggleBtn,
			this.sideCollapsed ? "展开面板" : "收起面板",
			this.sideCollapsed ? "展开 TALOS 交互面板" : "收起 TALOS 交互面板"
		);
	}

	private openSessionComposer(): void {
		if (this.sideCollapsed) this.toggleSide(false);
		this.activateSideTab?.("session");
		window.setTimeout(() => this.sessionInputEl?.focus(), 0);
	}

	private addSideSection(parent: HTMLElement, title: string, meta: string): void {
		const head = parent.createDiv({ cls: "tq-side-section" });
		head.createEl("b", { text: title });
		head.createSpan({ text: meta });
	}

	private addSideRow(
		parent: HTMLElement,
		icon: string,
		label: string,
		meta: string,
		action: () => void
	): void {
		const row = parent.createEl("button", {
			cls: "tq-btn tq-btn--row tq-side-row",
			attr: { type: "button" },
		});
		const iconEl = row.createSpan({ cls: "tq-side-row-icon" });
		setIcon(iconEl, icon);
		const copy = row.createSpan({ cls: "tq-side-row-copy" });
		copy.createEl("b", { text: label });
		copy.createEl("small", { text: meta });
		const arrow = row.createSpan({ cls: "tq-side-row-arrow" });
		setIcon(arrow, "chevron-right");
		row.addEventListener("click", action);
	}

	private ttsLabel(): string {
		switch (this.settings.ttsEngine) {
			case "edgetts": return "Edge TTS";
			case "aliyun": return "千问 TTS";
			case "elevenlabs": return "ElevenLabs";
			default: return "系统语音";
		}
	}

	private renderEngineBtn(): void {
		if (!this.engBtn) return;
		const local = this.settings.quyuanAsrEngine === "local";
		this.engBtn.empty();
		setIcon(this.engBtn.createSpan(), local ? "cpu" : "cloud");
		// empty() 会删掉 sr-label span；经 setFabButtonLabel 重建，保持 aria-labelledby 有效
		this.setFabButtonLabel(
			this.engBtn,
			local ? "本地引擎" : "千问引擎",
			local ? "当前本地 Whisper，点击切换识别引擎" : "当前千问云端，点击切换识别引擎"
		);
		this.engBtn.setAttribute("aria-pressed", String(local));
	}

	// 背景效果按钮渲染
	private renderBgBtn(): void {
		if (!this.bgBtn) return;
		const isGlitch = this.settings.quyuanBackground === "letter-glitch";
		this.bgBtn.empty();
		setIcon(this.bgBtn.createSpan(), isGlitch ? "type" : "grid-3x3");
		// 同 renderEngineBtn：经 setFabButtonLabel 重建 sr-label，保持 aria-labelledby 有效
		this.setFabButtonLabel(
			this.bgBtn,
			isGlitch ? "字符流背景" : "网格扫描背景",
			"切换背景效果"
		);
	}

	// 切换背景效果：LetterGlitch ⇄ GridScan，持久化 + 即时切换
	private toggleBackground(): void {
		const next: QuyuanBackgroundType =
			this.settings.quyuanBackground === "letter-glitch" ? "grid-scan" : "letter-glitch";
		this.settings.quyuanBackground = next;
		void this.save?.();
		this.bgField?.switchTo(next, this.state === "sleep" ? "idle" : this.state);
		this.renderBgBtn();
		this.toggleFab(false);
	}

	/** 切换 fab 扇形菜单展开/收起 */
	private toggleFab(force?: boolean): void {
		if (!this.fabEl) return;
		const open = force ?? !this.fabEl.hasClass("is-open");
		this.fabEl.toggleClass("is-open", open);
	}

	// 识别引擎回调（云端/本地共用）
	private asrHandlers(): VadMicHandlers {
		return {
			onListeningChange: (on) => {
				if (this.voiceMode.snapshot().inputMode === "push-to-talk") {
					this.renderMicBtn(on);
					this.setState(on ? "listen" : "idle");
					this.wakeStatusEl?.setText(
						on ? "正在听 · 说完自动发送" : "点击说话 · 一次发送一段"
					);
					return;
				}
				if (!on) this.deactivateWake();
				this.renderMicBtn(on);
				this.setState(on ? this.restingState() : "idle");
				if (!on && this.settings.quyuanVoiceRecognitionEnabled === false) {
					this.renderVoiceRecognitionOff();
				}
			},
			onLevel: (level) => {
				const visualLevel = this.wakeActive ? level : level * 0.24;
				this.characterStage?.setInputLevel(visualLevel);
				this.rootEl?.style.setProperty("--tq-level", visualLevel.toFixed(3));
			},
			onState: (s) => {
				if (this.settings.quyuanVoiceRecognitionEnabled === false) return;
				if (!this.wakeActive) this.setState("sleep");
				else if (s === "transcribing") this.setState("reco");
				else if (s === "capturing") this.setState("listen");
				else if (this.state !== "think" && this.state !== "speak") {
					this.setState("listen");
				}
			},
			onSpeechStart: () => {
				if (this.wakeActive) this.onBargeIn();
			},
			onText: (text) => {
				this.handleVoiceTranscript(text);
				if (this.voiceMode.snapshot().inputMode === "push-to-talk") {
					this.asr?.stop();
					this.renderPushToTalkReady();
				}
			},
			onPartial: (text) => this.showPartialTranscript(text),
			onError: (msg) => {
				const line = `语音输入：${msg}`;
				if (this.fabStatusEl) this.fabStatusEl.setText(line);
				this.fallbackToPushToTalk(msg);
				// 本地引擎的加载/转写错误此前只写进不显眼的状态文本，sleep 态根本看不到；
				// 改用 Notice 弹出并打日志，故障一眼可见。
				new Notice(line, 10000);
				console.error("[TALOS 屈原] 语音识别错误", msg);
			},
		};
	}

	private buildAsr(): VadMic {
		const h = this.asrHandlers();
		const secretStore = providerSecretStoreFromApp(this.app);
		return this.settings.quyuanAsrEngine === "local"
			? new LocalAsr(this.settings, h)
			: new CloudAsr(
				this.settings,
				h,
				() =>
					readProviderSecret(
						this.settings,
						"aliyunApiKey",
						secretStore
					)
			);
	}

	// 切换识别引擎（千问云端 ⇄ 本地 Whisper）：持久化 + 重建 + 续听
	private async switchEngine(): Promise<void> {
		this.settings.quyuanAsrEngine =
			this.settings.quyuanAsrEngine === "local" ? "cloud" : "local";
		await this.save?.();
		this.renderEngineBtn();
		const wasOn = this.asr?.isOn() ?? false;
		this.asr?.dispose();
		this.asr = this.buildAsr();
		if (this.fabStatusEl) {
			this.fabStatusEl.setText(
				this.settings.quyuanAsrEngine === "local" ? "已切到本地 Whisper（首次需下模型）" : "已切到千问云端"
			);
		}
		if (wasOn) void this.asr.start();
	}

	private renderMicBtn(listening: boolean): void {
		if (!this.micBtn) return;
		this.micBtn.empty();
		setIcon(
			this.micBtn.createSpan(),
			listening ? (this.wakeActive ? "mic" : "ear") : "mic-off"
		);
		const label = listening ? "退出语音" : "开启语音";
		this.setFabButtonLabel(
			this.micBtn,
			label,
			listening ? "退出语音识别并释放麦克风" : "开启语音识别"
		);
		this.micBtn.setAttribute("aria-pressed", String(listening));
		this.micBtn.toggleClass("is-active", listening);
	}

	private setFabButtonLabel(
		button: HTMLButtonElement,
		visualLabel: string,
		accessibleLabel = visualLabel
	): void {
		button.setAttribute("data-label", visualLabel);
		// Obsidian 会把 aria-label 再渲染成箭头提示；改用 aria-labelledby
		// 保留无障碍名称，只显示本组件自己的圆角气泡。
		button.removeAttribute("aria-label");
		let labelId = button.dataset.fabLabelId;
		if (!labelId) {
			labelId = `tq-fab-a11y-${this.fabLabelSeq++}`;
			button.dataset.fabLabelId = labelId;
		}
		let labelEl = button.querySelector<HTMLElement>(".tq-fab-sr-label");
		if (!labelEl) labelEl = button.createSpan({ cls: "tq-fab-sr-label" });
		labelEl.id = labelId;
		labelEl.setText(accessibleLabel);
		button.setAttribute("aria-labelledby", labelId);
	}

	private updateSendState(): void {
		if (!this.sendBtn) return;
		this.sendBtn.disabled = !(this.sessionInputEl?.value.trim());
	}

	private restingState(): VoiceState {
		if (!this.asr?.isOn()) return "idle";
		return this.wakeActive ? "listen" : "sleep";
	}

	private activateWake(): void {
		this.wakeActive = true;
		this.rootEl?.setAttribute("data-wake-state", "awake");
		this.refreshWakeWindow();
		this.renderMicBtn(this.asr?.isOn() ?? false);
		this.wakeStatusEl?.setText("已唤醒 · 30 秒连续对话");
		this.setState("listen");
		void this.driver?.warmup("voice");
		if (this.overlayReply) this.setOverlayMessage("已唤醒，直接说就好。");
	}

	private deactivateWake(): void {
		this.wakeActive = false;
		if (this.wakeTimer != null) {
			window.clearTimeout(this.wakeTimer);
			this.wakeTimer = null;
		}
		const recognitionOn = this.settings.quyuanVoiceRecognitionEnabled !== false
			&& (this.asr?.isOn() ?? false);
		this.rootEl?.setAttribute("data-wake-state", "sleep");
		this.renderMicBtn(this.asr?.isOn() ?? false);
		this.wakeStatusEl?.setText(
			recognitionOn ? "待唤醒 · 说「屈原」" : "语音已退出 · 点击开启语音"
		);
		if (this.overlayReply) {
			this.setOverlayMessage(
				recognitionOn
					? "已休眠，说「屈原」可以再次唤醒。"
					: "语音识别已退出，文字输入仍可使用。"
			);
		}
		if (this.mounted) this.setState(recognitionOn ? "sleep" : "idle");
	}

	private renderVoiceRecognitionOff(): void {
		this.rootEl?.setAttribute("data-voice-recognition", "off");
		this.characterStage?.setInputLevel(0);
		this.rootEl?.setCssProps({ "--tq-level": "0" });
		this.renderMicBtn(false);
		this.wakeStatusEl?.setText("语音已退出 · 点击开启语音");
		if (this.fabStatusEl) this.fabStatusEl.setText("语音识别已退出");
		if (this.overlayReply) this.setOverlayMessage("语音识别已退出，文字输入仍可使用。");
	}

	private async setVoiceRecognitionEnabled(enabled: boolean, persist = true): Promise<void> {
		this.settings.quyuanVoiceRecognitionEnabled = enabled;
		this.rootEl?.setAttribute("data-voice-recognition", enabled ? "on" : "off");
		if (persist) await this.save?.();

		if (!enabled) {
			this.deactivateWake();
			this.asr?.stop();
			this.setState("idle");
			this.renderVoiceRecognitionOff();
			return;
		}

		this.wakeStatusEl?.setText("正在开启语音识别…");
		if (this.fabStatusEl) this.fabStatusEl.setText("正在申请麦克风…");
		try {
			await this.asr?.start();
			if (!(this.asr?.isOn() ?? false)) {
				this.fallbackToPushToTalk("持续监听未能启动");
			}
		} catch (error) {
			console.error("TALOS Quyuan ASR failed to start", error);
			this.fallbackToPushToTalk(
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	private refreshWakeWindow(): void {
		if (!this.wakeActive) return;
		if (this.wakeTimer != null) window.clearTimeout(this.wakeTimer);
		this.wakeTimer = window.setTimeout(() => {
			this.deactivateWake();
			if (this.overlayReply) this.setOverlayMessage("已休眠，说「屈原」可以再次唤醒。");
		}, this.wakeWindowMs);
	}

	// 冻结唤醒倒计时（回答/朗读期间调用）：只停表，不改变唤醒状态
	private pauseWakeWindow(): void {
		if (this.wakeTimer != null) {
			window.clearTimeout(this.wakeTimer);
			this.wakeTimer = null;
		}
	}

	private normalizeForWake(text: string): string {
		return text.toLowerCase().replace(/[\s，。！？、,.:：；;!?~·]/g, "");
	}

	// 模糊匹配唤醒词：命中返回对应别名，未命中返回 null
	private matchWake(text: string): string | null {
		const norm = this.normalizeForWake(text);
		for (const alias of this.wakeAliases) {
			if (norm.includes(this.normalizeForWake(alias))) return alias;
		}
		return null;
	}

	private stripWakeWord(text: string, hit: string = this.wakeWord): string {
		return text
			.split(hit)
			.join("")
			.replace(/^[\s，。！？、,:：；;]+/, "")
			.trim();
	}

	private handleVoiceTranscript(rawText: string): void {
		const text = rawText.trim();
		if (!text) return;
		this.voiceMode.setTranscript(text);
		void this.voiceSessionStore?.setTranscriptDraft(text);
		// 记录识别原文：便于核对本地引擎把唤醒词听成了什么，据此补充 wakeAliases。
		// eslint-disable-next-line obsidianmd/rule-custom-message -- 诊断日志：核对本地引擎听写原文以补充唤醒词别名，保留
		console.info("[TALOS 屈原] 语音识别原文：", JSON.stringify(rawText));

		if (this.voiceMode.snapshot().inputMode === "push-to-talk") {
			this.commitUser(text, "voice");
			return;
		}

		if (this.wakeActive && text.includes(this.sleepWord)) {
			this.deactivateWake();
			this.tts?.feed("好，我先退下。");
			this.tts?.flush();
			if (this.overlayReply) this.setOverlayMessage("已休眠，说「屈原」可以再次唤醒。");
			return;
		}

		if (!this.wakeActive) {
			const hit = this.matchWake(text);
			if (!hit) {
				this.setState("sleep");
				if (this.fabStatusEl) this.fabStatusEl.setText("待唤醒 · 说「屈原」");
				if (this.overlayReply) this.setOverlayMessage("等待唤醒词「屈原」。");
				return;
			}
			this.activateWake();
			const command = this.stripWakeWord(text, hit);
			if (!command) {
				this.tts?.feed("我在，你说。");
				this.tts?.flush();
				return;
			}
			this.commitUser(command, "voice");
			return;
		}

		this.refreshWakeWindow();
		const command = this.stripWakeWord(text);
		if (command) this.commitUser(command, "voice");
	}

	// 打断（barge-in）：用户在屈原思考/朗读时开口 → 取消在途回复并停朗读
	private onBargeIn(): void {
		if (this.state === "think" || this.state === "speak" || this.driver?.isBusy()) {
			this.voiceMode.bargeIn();
			this.responseActive = false;
			this.driver?.cancel();
			this.tts?.stop();
			this.syncAsrBusy();
		}
	}

	private syncAsrBusy(): void {
		const busy = this.responseActive || this.ttsPending || this.ttsSpeaking;
		// 声控打断覆盖整个忙碌期：思考/排队阶段没有外放声音不会误触发；
		// 朗读阶段靠 VAD 阈值 + AEC 防自触发，正常音量即可打断。
		this.asr?.setBusy(busy, busy);
		// 回答/朗读期间冻结唤醒倒计时，避免长回答把 30 秒连续对话窗耗尽；
		// 等回复生成完且朗读也结束后，才重新计 30 秒。
		if (busy) this.pauseWakeWindow();
		else this.refreshWakeWindow();
	}

	// ---------- 状态机 ----------
	private setState(state: VoiceState): void {
		if (!this.mounted) return;
		this.state = state;
		const meta = STATES[state];
		this.rootEl?.setAttribute("data-voice-state", state);
		this.rootEl?.style.setProperty("--tq-state", meta.color);
		this.rootEl?.style.setProperty("--tq-spd", meta.speed);
		this.characterStage?.setState(state, this.wakeActive);
		this.bgField?.setState(state);
		// 圆环颜色和呼吸频率由 CSS 变量驱动（--tq-state / --tq-spd）
		// fab-status 显示状态文字
		if (this.fabStatusEl) this.fabStatusEl.setText(meta.caption);
		this.workspaceStatusEl?.setText(meta.caption);
	}

	// ---------- 语音识别模式：关闭时停止 ASR、唤醒词监听并释放麦克风 ----------
	private async toggleVoiceRecognitionMode(): Promise<void> {
		if (this.voiceMode.snapshot().inputMode === "push-to-talk") {
			if (this.asr?.isOn()) {
				this.asr.stop();
				this.renderPushToTalkReady();
				return;
			}
			try {
				await this.asr?.start();
				if (!(this.asr?.isOn() ?? false)) {
					this.fallbackToPushToTalk("点击说话未能启动");
				}
			} catch (error) {
				this.fallbackToPushToTalk(
					error instanceof Error ? error.message : String(error)
				);
			}
			return;
		}
		await this.setVoiceRecognitionEnabled(!(this.asr?.isOn() ?? false));
	}

	private commitUser(text: string, channel: InteractionChannel): void {
		const trimmed = text.trim();
		if (!trimmed || !this.convoEl) return;
		this.sessionEmptyEl?.addClass("is-hidden");
		const bub = this.convoEl.createDiv({
			cls: `tq-bub tq-me tq-channel-${channel}`,
			attr: { "data-channel": channel },
		});
		bub.createSpan({
			cls: "tq-bub-role",
			text: channel === "voice" ? "你 · 语音" : "你 · 文字",
		});
		bub.createDiv({ text: trimmed });
		void this.voiceSessionStore?.appendMessage({
			id: `voice-user-${Date.now()}`,
			role: "user",
			text: trimmed,
			modality: channel === "voice" ? "speech" : "text",
			createdAt: Date.now(),
		});
		// 只有语音识别结果进入右侧可编辑卡；文字通道继续留在会话区。
		if (channel === "voice") this.showTranscriptEditor(trimmed);
		// 清空 overlay 回复区，准备接收新回复
		if (this.overlayReply) this.overlayReply.empty();
		this.overlayLines = [];
		this.scrollConvo();
		void this.respond(trimmed, channel);
	}

	/**
	 * 流式转写的中途结果：只滚动更新识别卡，说话过程中就能看见。
	 * 绝不走 matchWake / commitUser——半截文本既不该唤醒也不该发送，
	 * 唤醒词匹配与发送一律只在最终结果（handleVoiceTranscript）上做。
	 */
	private showPartialTranscript(text: string): void {
		if (this.settings.quyuanVoiceRecognitionEnabled === false) return;
		// 待机期不显示：没唤醒时的环境语音不该被打到屏幕上
		if (!this.wakeActive) return;
		const trimmed = text.trim();
		if (!trimmed || !this.overlayTranscriptEl || !this.overlayUser) return;
		this.setState("reco");
		this.overlayUser.value = trimmed;
		this.overlayUser.tabIndex = 0;
		this.overlayTranscriptEl.setAttribute("aria-hidden", "false");
		this.overlayTranscriptEl.addClass("is-visible");
	}

	private showTranscriptEditor(text: string): void {
		if (!this.overlayTranscriptEl || !this.overlayUser) return;
		this.overlayUser.value = text;
		this.pushTranscriptLine(text);
		this.overlayUser.tabIndex = 0;
		this.overlayTranscriptEl.setAttribute("aria-hidden", "false");
		this.overlayTranscriptEl.removeClass("is-visible");
		window.requestAnimationFrame(() => {
			if (!this.mounted) return;
			this.overlayTranscriptEl?.addClass("is-visible");
		});
	}

	/** 字幕行追加：最新行最亮，超过 5 行移除最旧并滚到底部（纯展示追加，不影响发送流程） */
	private pushTranscriptLine(text: string): void {
		const lines = this.overlayTranscriptLinesEl;
		if (!lines) return;
		lines.createDiv({ cls: "tq-transcript-line", text });
		while (lines.childElementCount > 5) {
			lines.firstElementChild?.remove();
		}
		lines.scrollTop = lines.scrollHeight;
	}

	private hideTranscriptEditor(): void {
		this.overlayTranscriptEl?.removeClass("is-visible");
		this.overlayTranscriptEl?.setAttribute("aria-hidden", "true");
		if (this.overlayUser) this.overlayUser.tabIndex = -1;
	}

	private clearTranscriptEditor(): void {
		if (this.overlayUser) this.overlayUser.value = "";
		this.overlayTranscriptLinesEl?.empty();
		this.hideTranscriptEditor();
	}

	/**
	 * 字幕式逐行追加：把流式 delta 累积到 replyBuffer，按句末标点切行。
	 * 每次重建 overlay 显示——保留最后 N 行，避免内容重复或残留。
	 */
	private feedOverlayLine(_delta: string): void {
		if (!this.overlayReply) return;
		// replyBuffer 已在 onText 里累积完整内容，这里按句切分
		const allLines = this.replyBuffer
			.split(/(?<=[。！？!?\n])/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		// 只保留最后 5 行显示（旧行已滚出视野）
		const visible = allLines.slice(-5);
		// 仅当窗口未滑动（除最后一行外内容逐行一致）时，只更新最后一行避免闪烁；
		// 超过 5 行后每来一句窗口整体滑动一位，行数不变但前几行内容已换，必须重建，
		// 否则前 4 行会永远停留在过期内容上。
		if (this.overlayLines.length === visible.length && visible.length > 0) {
			const stable = visible
				.slice(0, -1)
				.every((text, i) => this.overlayLines[i]?.textContent === text);
			if (stable) {
				this.overlayLines[visible.length - 1]?.setText(visible[visible.length - 1] ?? "");
				return;
			}
		}
		// 行数变了或窗口滑动了：重建可见行
		this.overlayReply.empty();
		this.overlayLines = [];
		for (const text of visible) {
			const el = this.overlayReply.createDiv({ cls: "tq-overlay-line", text });
			this.overlayLines.push(el);
		}
	}

	private pushOverlayLine(text: string): void {
		if (!this.overlayReply) return;
		const el = this.overlayReply.createDiv({ cls: "tq-overlay-line", text });
		this.overlayLines.push(el);
		// 超过 5 行：移除最旧的（CSS 会处理淡出，这里直接移除保持 DOM 干净）
		while (this.overlayLines.length > 5) {
			const oldest = this.overlayLines.shift();
			oldest?.remove();
		}
	}

	/** 单条提示文字（唤醒/休眠/错误等）：清空 overlay + 显示一行 */
	private setOverlayMessage(text: string): void {
		if (!this.overlayReply) return;
		this.overlayReply.empty();
		this.overlayLines = [];
		this.pushOverlayLine(text);
	}

	// 双通道驱动：语音回复为纯口语并自动朗读；文字回复保留 Markdown 且静默。
	private async respond(
		userText: string,
		channel: InteractionChannel
	): Promise<void> {
		if (!this.mounted || !this.convoEl || !this.driver) return;
		if (this.driver.isBusy()) return; // 上一轮未结束则丢弃（barge-in 已先 cancel，极少触发）
		this.setState("think");
		this.responseActive = true;
		this.syncAsrBusy();
		this.replyEl = null;
		this.replyBuffer = "";
		let started = false;
		await this.driver.send({ text: userText, channel }, {
			onText: (delta) => {
				if (!this.mounted || !this.convoEl) return;
				if (!started) {
					started = true;
					this.setState("speak");
					const reply = this.convoEl.createDiv({
						cls: `tq-bub tq-qy tq-channel-${channel}`,
						attr: { "data-channel": channel },
					});
					reply.createSpan({
						cls: "tq-bub-role",
						text: channel === "voice" ? "屈原 · 语音" : "屈原 · 文字",
					});
					this.replyEl = reply.createDiv();
				}
				if (this.replyEl) {
					this.replyBuffer += delta;
					this.replyEl.setText(this.replyBuffer);
					// overlay 文字层：字幕式逐行追加滚动
					this.feedOverlayLine(delta);
				}
				if (channel === "voice") {
					const wasPending = this.ttsPending;
					this.ttsPending = true;
					if (!wasPending) this.syncAsrBusy();
					this.tts?.feed(delta);
				}
				this.scrollConvo();
			},
			onTool: (event) => {
				if (event.status === "running" && this.mounted && this.replyEl) {
					const exec = this.replyEl.parentElement?.createSpan({ cls: "tq-exec" });
					if (exec) {
						setIcon(exec.createSpan(), "tool");
						exec.createSpan({ text: ` 执行 · ${event.name}` });
						this.scrollConvo();
					}
				}
				if (event.status !== "running") {
					this.voiceMode.recordCompletedTool({
						taskId: event.taskId,
						toolName: event.name,
						auditEvidence: event.auditEvidence,
					});
					void this.voiceSessionStore?.recordTaskEvidence({
						taskId: event.taskId,
						state: event.status,
						auditEvidence: event.auditEvidence,
					});
				}
			},
			onDone: (fullText) => {
				const replyEl = this.replyEl;
				const reply = this.replyBuffer;
				this.voiceMode.setReplyText(fullText);
				void this.voiceSessionStore?.appendMessage({
					id: `voice-assistant-${Date.now()}`,
					role: "assistant",
					text: fullText,
					modality: channel === "voice" ? "speech" : "text",
					createdAt: Date.now(),
				});
				if (
					channel === "text"
					&& replyEl
					&& reply
					&& this.markdownComponent
				) {
					replyEl.empty();
					void MarkdownRenderer.render(
						this.app,
						reply,
						replyEl,
						"",
						this.markdownComponent
					);
				}
				if (channel === "voice") this.tts?.flush();
				this.replyEl = null;
				this.replyBuffer = "";
				this.responseActive = false;
				// 唤醒倒计时由 syncAsrBusy 统一接管：朗读未结束时保持冻结，朗读结束后重新计 30 秒
				this.syncAsrBusy();
				if (this.mounted && !this.ttsPending) this.setState(this.restingState());
			},
			onError: (message) => {
				if (!this.mounted || !this.convoEl) return;
				const err = this.convoEl.createDiv({ cls: "tq-bub tq-qy" });
				err.setText(`出错了：${message}`);
				this.replyEl = null;
				this.responseActive = false;
				this.tts?.stop();
				this.syncAsrBusy();
				this.setState(this.restingState());
				if (this.fabStatusEl) this.fabStatusEl.setText("引擎错误");
				if (this.overlayReply) this.setOverlayMessage(`出错了：${message}`);
			},
		});
	}

	// 破坏性操作二次确认：弹确认卡 + 朗读问句，确认/取消或 30s 超时自动取消
	private askConfirm(toolName: string, description: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			if (!this.mounted || !this.convoEl) {
				resolve(false);
				return;
			}
			const ask = `需要确认：屈原想执行「${description}」。确认吗？`;
			const card = this.convoEl.createDiv({ cls: "tq-bub tq-qy" });
			card.createDiv({ text: ask });
			const row = card.createDiv({ cls: "tq-confirm" });
			const yes = row.createEl("button", {
				cls: "tq-btn tq-btn--danger tq-btn--sm",
				attr: { type: "button" },
			});
			yes.createSpan({ text: "确认执行" });
			const no = row.createEl("button", {
				cls: "tq-btn tq-btn--secondary tq-btn--sm",
				attr: { type: "button" },
			});
			no.createSpan({ text: "取消" });
			this.scrollConvo();
			this.tts?.feed(`${ask}请点确认或取消。`);
			this.tts?.flush();
			let done = false;
			let timer: number | null = null;
			const finish = (v: boolean): void => {
				if (done) return;
				done = true;
				if (timer != null) {
					window.clearTimeout(timer);
					timer = null;
				}
				yes.disabled = true;
				no.disabled = true;
				resolve(v);
			};
			yes.addEventListener("click", () => finish(true));
			no.addEventListener("click", () => finish(false));
			timer = window.setTimeout(() => finish(false), 30000);
		});
	}

	private scrollConvo(): void {
		if (this.convoEl) this.convoEl.scrollTop = this.convoEl.scrollHeight;
	}

	// ---------- 卸载 ----------
	unmount(): void {
		this.mounted = false;
		if (this.wakeTimer != null) window.clearTimeout(this.wakeTimer);
		this.wakeTimer = null;
		this.wakeActive = false;
		this.responseActive = false;
		this.ttsPending = false;
		this.ttsSpeaking = false;
		try {
			this.asr?.dispose();
		} catch (error) {
			console.error("TALOS Quyuan ASR dispose failed", error);
		}
		this.asr = null;
		try {
			this.tts?.stop();
		} catch (error) {
			console.error("TALOS Quyuan TTS stop failed", error);
		}
		this.tts = null;
		// driver.dispose 会走 SDK 的子进程关闭链路（曾因 setTimeout(...).unref
		// 在渲染进程不存在而抛错，导致 unmount 中断、屈原页永久白屏）。兜底隔离。
		try {
			this.driver?.dispose();
		} catch (error) {
			console.error("TALOS Quyuan driver dispose failed", error);
		}
		this.driver = null;
		this.voiceSessionStore = null;
		this.characterStage?.destroy();
		this.characterStage = null;
		try {
			this.bgResizeObs?.disconnect();
		} catch (error) {
			console.error("TALOS Quyuan background resize observer disconnect failed", error);
		}
		this.bgResizeObs = null;
		this.bgField?.destroy();
		this.bgField = null;
		this.markdownComponent?.unload();
		this.markdownComponent = null;
		this.replyEl = null;
		this.rootEl = null;
		this.bodyEl = null;
		this.capEl = null;
		this.subEl = null;
		this.liveEl = null;
		this.convoEl = null;
		this.sessionEmptyEl = null;
		this.sessionInputEl = null;
		this.wakeStatusEl = null;
		this.dotEl = null;
		this.micBtn = null;
		this.sendBtn = null;
		this.engBtn = null;
		this.voiceModeBtn = null;
		this.bgBtn = null;
		this.fabEl = null;
		this.sideToggleBtn = null;
		this.activateSideTab = null;
		this.overlayTranscriptEl = null;
		this.overlayTranscriptLinesEl = null;
		this.overlayUser = null;
		this.overlayReply = null;
		this.overlayLines = [];
		this.fabStatusEl = null;
		this.workspaceStatusEl = null;
		this.overlayReplyMd = null;
		this.replyBuffer = "";
	}
}
