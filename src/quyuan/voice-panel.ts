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
import { QuyuanVoiceCharacterStage } from "./voice-character-stage";
import {
	EmotionBallView,
	type EmotionBallState,
	type EmotionBallTheme,
} from "./emotion-ball-view";
import { createPinnedEmotionBall } from "./emotion-ball-runtime";
import type { VaultPaths } from "../data/schema";
import { VoiceSessionStore } from "./voice-session-store";
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
//   主页语音工作区；与文字对话保持独立会话命名空间。
//   STT：CloudAsr（千问云端，WebSpeech 在 Electron 不可用故弃用）。
//   引擎：QuyuanVoiceDriver 复用 v2 运行时。TTS：StreamTts（现有）。
//   状态机：idle / listen / reco / think / speak，经 setState 解耦。
//   不修改、不引用文字对话会话状态。
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
	private engBtn: HTMLButtonElement | null = null;
	private voiceModeBtn: HTMLButtonElement | null = null;
	private ttsBtn: HTMLButtonElement | null = null;

	private rootEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private sessionInputEl: HTMLTextAreaElement | null = null;
	private wakeStatusEl: HTMLElement | null = null;
	private micBtn: HTMLButtonElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private characterStage: QuyuanVoiceCharacterStage | null = null;
	private emotionBall: EmotionBallView | null = null;
	private emotionThemeObserver: MutationObserver | null = null;
	private ballStateTimer: number | null = null;
	private markdownComponent: Component | null = null;
	private replyBuffer = "";
	private overlayTranscriptEl: HTMLElement | null = null;
	private overlayUser: HTMLTextAreaElement | null = null;
	private overlayTranscriptLinesEl: HTMLElement | null = null;
	private overlayReply: HTMLElement | null = null;
	private overlayLines: HTMLElement[] = [];
	private controlStatusEl: HTMLElement | null = null;
	private workspaceStatusEl: HTMLElement | null = null;
	private confirmHostEl: HTMLElement | null = null;
	private wakeActive = false;
	private wakeTimer: number | null = null;
	private responseActive = false;
	private ttsPending = false;
	private ttsSpeaking = false;
	private ttsEnabled = true;
	private navigatingToChat = false;

	private state: VoiceState = "sleep";
	private mounted = false;
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

	constructor(
		app: App,
		plugin: TalosQuyuanPlugin,
		settings: TalosSettings,
		save?: () => Promise<void>,
		private readonly navigateToPage?: (pageKey: string) => void
	) {
		this.app = app;
		this.plugin = plugin;
		this.settings = settings;
		this.save = save;
	}

	// ---------- 挂载 ----------
	mount(container: HTMLElement): void {
		container.empty();
		this.mounted = true;
		this.navigatingToChat = false;
		this.ttsEnabled = true;
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
				if (!this.ttsEnabled) {
					this.tts?.stop();
					return;
				}
				this.voiceMode.setTtsSpeaking();
				this.ttsPending = true;
				this.ttsSpeaking = true;
				this.syncAsrBusy();
				this.setState("speak");
			} else if (s === "idle") {
				const completedPlayback = this.ttsSpeaking && !this.responseActive;
				this.ttsPending = false;
				this.ttsSpeaking = false;
				this.characterStage?.setOutputLevel(0);
				this.syncAsrBusy();
				this.setState(this.responseActive ? "speak" : this.restingState());
				if (completedPlayback) this.setEmotionBallState("done", 1800);
			} else if (s === "error") {
				this.voiceMode.onTtsFailure("朗读服务不可用，文字回复已保留");
				this.ttsPending = false;
				this.ttsSpeaking = false;
				this.characterStage?.setOutputLevel(0);
				this.syncAsrBusy();
				this.setState(this.responseActive ? "speak" : this.restingState());
				this.setEmotionBallState("error", 2400);
				this.controlStatusEl?.setText("播报服务错误 · 文字回复仍可用");
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

		const stage = body.createDiv({
			cls: "tq-stage",
			attr: {
				role: "region",
				"aria-label": "Emotion Ball 语音舞台",
				"data-workspace-section": "voice-stage",
			},
		});
		const workspaceBar = stage.createDiv({
			cls: "tq-workspace-bar",
			attr: { role: "group", "aria-label": "屈原语音工作台状态与导航" },
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
		boundary.createSpan({ text: "语音硬只读" });
		const workspaceState = workspaceMeta.createSpan({
			cls: "tq-workspace-state",
			attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
		});
		workspaceState.createSpan({
			cls: "tq-workspace-state__dot",
			attr: { "aria-hidden": "true" },
		});
		this.workspaceStatusEl = workspaceState.createSpan({ text: STATES.sleep.caption });
		const chatButton = workspaceMeta.createEl("button", {
			cls: "tq-btn tq-btn--secondary tq-btn--sm tq-go-chat",
			attr: { type: "button", "aria-label": "转到 AI 对话" },
		});
		setIcon(chatButton.createSpan(), "message-square");
		chatButton.createSpan({ text: "转到 AI 对话" });
		chatButton.addEventListener("click", () => this.goToChat());

		// 既有粒子人物保留为弱氛围层；Emotion Ball 是唯一中心主视觉。
		this.characterStage = new QuyuanVoiceCharacterStage(stage);
		const visual = stage.createDiv({
			cls: "tq-emotion-stage",
			attr: { "aria-label": "Emotion Ball 状态视觉" },
		});
		const ballHost = visual.createDiv({ cls: "tq-emotion-ball-host" });
		this.mountEmotionBall(ballHost);

		const overlay = stage.createDiv({
			cls: "tq-overlay-text",
			attr: { "aria-live": "polite", "aria-label": "屈原回复" },
		});
		this.overlayReply = overlay.createDiv({ cls: "tq-overlay-reply" });
		this.setOverlayMessage("说「屈原」唤醒，或在下方输入只读查询。");

		const dock = body.createDiv({
			cls: "tq-voice-dock",
			attr: {
				role: "region",
				"aria-label": "语音转写与控制",
				"data-workspace-section": "voice-controls",
			},
		});
		const statusRow = dock.createDiv({ cls: "tq-dock-status" });
		const liveStatus = statusRow.createDiv({ cls: "tq-dock-live" });
		this.wakeStatusEl = liveStatus.createSpan({
			text: this.settings.quyuanVoiceRecognitionEnabled === false
				? "语音已退出 · 点击开启"
				: "待唤醒 · 说「屈原」",
			attr: { role: "status", "aria-live": "polite" },
		});
		this.controlStatusEl = liveStatus.createEl("small", {
			text: "就绪",
			attr: { role: "status", "aria-live": "polite" },
		});
		const badges = statusRow.createDiv({ cls: "tq-dock-badges" });
		badges.createSpan({ text: `文字审批 · ${this.permissionLabel()}` });
		badges.createSpan({
			text: this.settings.quyuanAsrEngine === "local" ? "本地 Whisper" : "千问 ASR",
		});
		badges.createSpan({ text: `模型 · ${this.modelLabel()}` });

		this.overlayTranscriptEl = dock.createDiv({
			cls: "tq-transcript-editor is-visible",
			attr: { "aria-label": "实时语音转写" },
		});
		const transcriptHead = this.overlayTranscriptEl.createDiv({ cls: "tq-transcript-head" });
		transcriptHead.createSpan({ text: "实时转写" });
		transcriptHead.createEl("small", { text: "最终文本可编辑 · 不自动注入 AI 对话" });
		this.overlayTranscriptLinesEl = this.overlayTranscriptEl.createDiv({
			cls: "tq-transcript-lines",
			attr: { "aria-live": "polite" },
		});
		this.overlayUser = this.overlayTranscriptEl.createEl("textarea", {
			cls: "tq-overlay-user",
			attr: {
				rows: "2",
				maxlength: "1200",
				spellcheck: "false",
				placeholder: "实时转写会显示在这里",
				"aria-label": "语音识别文字，可编辑",
			},
		});

		const controls = dock.createDiv({
			cls: "tq-voice-controls",
			attr: { role: "group", "aria-label": "语音控制" },
		});
		const controlButton = (
			className: string,
			icon: string,
			label: string
		): HTMLButtonElement => {
			const button = controls.createEl("button", {
				cls: `tq-btn tq-btn--ghost tq-control-btn ${className}`,
				attr: { type: "button", "aria-label": label },
			});
			setIcon(button.createSpan(), icon);
			button.createSpan({ cls: "tq-control-label", text: label });
			return button;
		};

		this.micBtn = controlButton("tq-control-btn--mic", "mic-off", "开启语音");
		this.renderMicBtn(false);
		this.micBtn.addEventListener("click", () => void this.toggleVoiceRecognitionMode());

		const stopBtn = controlButton("tq-control-btn--danger", "square", "停止");
		stopBtn.addEventListener("click", () => this.stopCurrentWork());

		this.ttsBtn = controlButton("", "volume-2", "播报已开");
		this.ttsBtn.addEventListener("click", () => this.toggleTts());
		this.renderTtsBtn();

		this.voiceModeBtn = controlButton("", "radio", "持续监听");
		this.voiceModeBtn.addEventListener("click", () => {
			const next =
				this.voiceMode.snapshot().inputMode === "continuous"
					? "push-to-talk"
					: "continuous";
			void this.setVoiceInputMode(next);
		});
		this.renderVoiceModeBtn();

		this.engBtn = controlButton("", "cloud", "千问引擎");
		this.engBtn.addEventListener("click", () => void this.switchEngine());
		this.renderEngineBtn();

		const settingsButton = controlButton("", "settings", "设置");
		settingsButton.addEventListener("click", () => this.openSettings());

		const query = dock.createDiv({
			cls: "tq-readonly-query",
			attr: { role: "search", "aria-label": "文本只读查询" },
		});
		const queryCopy = query.createDiv({ cls: "tq-readonly-query__copy" });
		queryCopy.createEl("b", { text: "文本只读查询" });
		queryCopy.createEl("small", { text: "独立语音会话 · 遵循 A/B/C 审批" });
		this.sessionInputEl = query.createEl("textarea", {
			attr: {
				rows: "1",
				maxlength: "1200",
				placeholder: "输入要查询的状态、统计或进度",
				"aria-label": "给屈原发送文本查询",
			},
		});
		this.sendBtn = query.createEl("button", {
			cls: "tq-btn tq-btn--primary tq-btn--icon tq-send-btn",
			attr: { type: "button", "aria-label": "发送文本查询" },
		});
		setIcon(this.sendBtn.createSpan(), "arrow-up");
		this.sendBtn.disabled = true;
		const submit = (): void => {
			const text = this.sessionInputEl?.value.trim() ?? "";
			if (!text) return;
			if (this.sessionInputEl) this.sessionInputEl.value = "";
			this.updateSendState();
			this.commitUser(text, "text");
		};
		this.sendBtn.addEventListener("click", submit);
		this.sessionInputEl.addEventListener("input", () => this.updateSendState());
		this.sessionInputEl.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || event.shiftKey) return;
			event.preventDefault();
			submit();
		});

		const safety = dock.createDiv({ cls: "tq-voice-safety" });
		setIcon(safety.createSpan(), "shield-check");
		safety.createSpan({
			text: "语音只读：可查状态、读统计、报进度；写改删转到 AI 对话 · SecretStorage 隔离 · A/B/C 审批与永久禁区保持生效",
		});
		this.confirmHostEl = dock.createDiv({
			cls: "tq-confirm-host",
			attr: { "aria-live": "assertive" },
		});

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

	private mountEmotionBall(host: HTMLElement): void {
		this.emotionBall?.destroy();
		this.emotionBall = new EmotionBallView(createPinnedEmotionBall);
		this.emotionBall.mount(host, this.readEmotionBallTheme());
		this.emotionBall.updateState(this.voiceStateToEmotionState(this.state));

		const document = host.ownerDocument;
		const Observer = document.defaultView?.MutationObserver;
		if (!Observer) return;
		this.emotionThemeObserver?.disconnect();
		this.emotionThemeObserver = new Observer(() => {
			this.emotionBall?.updateTheme(this.readEmotionBallTheme());
		});
		this.emotionThemeObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});
		const consoleShell = this.rootEl?.closest(".talos-console");
		if (consoleShell && consoleShell !== document.body) {
			this.emotionThemeObserver.observe(consoleShell, {
				attributes: true,
				attributeFilter: ["class"],
			});
		}
	}

	private readEmotionBallTheme(): EmotionBallTheme {
		const root = this.rootEl;
		const document = root?.ownerDocument;
		const computed = root && document?.defaultView
			? document.defaultView.getComputedStyle(root)
			: null;
		const key = computed?.getPropertyValue("--tq-theme-key").trim() || "aurora";
		const mode = document?.body.classList.contains("theme-light") ? "light" : "dark";
		return {
			id: `${key}:${mode}`,
			sketch: key.includes("geometric-modern"),
		};
	}

	private voiceStateToEmotionState(state: VoiceState): EmotionBallState {
		switch (state) {
			case "listen": return "receiving";
			case "reco": return "busy";
			case "think": return "thinking";
			case "speak": return "replying";
			default: return "waiting";
		}
	}

	private setEmotionBallState(state: EmotionBallState, resetAfterMs = 0): void {
		if (this.ballStateTimer != null) window.clearTimeout(this.ballStateTimer);
		this.ballStateTimer = null;
		this.emotionBall?.updateState(state);
		if (resetAfterMs <= 0) return;
		this.ballStateTimer = window.setTimeout(() => {
			this.ballStateTimer = null;
			if (!this.mounted) return;
			this.emotionBall?.updateState(this.voiceStateToEmotionState(this.state));
		}, resetAfterMs);
	}

	private goToChat(): void {
		if (!this.navigateToPage) {
			new Notice("AI 对话路由暂不可用");
			return;
		}
		// 先封住可能由 stop() 产生的最终转写，绝不把缓冲自动发送或注入文字会话。
		this.navigatingToChat = true;
		this.asr?.stop();
		this.driver?.cancel();
		this.responseActive = false;
		this.tts?.stop();
		this.ttsPending = false;
		this.ttsSpeaking = false;
		this.syncAsrBusy();
		this.setEmotionBallState("stop");
		this.navigateToPage("chat");
	}

	private stopCurrentWork(): void {
		this.voiceMode.bargeIn();
		this.driver?.cancel();
		this.responseActive = false;
		this.tts?.stop();
		this.ttsPending = false;
		this.ttsSpeaking = false;
		this.characterStage?.setOutputLevel(0);
		this.syncAsrBusy();
		this.setState(this.restingState());
		this.setEmotionBallState("stop", 1200);
		this.controlStatusEl?.setText("已停止当前处理与播报");
	}

	private toggleTts(): void {
		this.ttsEnabled = !this.ttsEnabled;
		if (!this.ttsEnabled) {
			this.tts?.stop();
			this.ttsPending = false;
			this.ttsSpeaking = false;
			this.characterStage?.setOutputLevel(0);
			this.syncAsrBusy();
		}
		this.renderTtsBtn();
		this.controlStatusEl?.setText(
			this.ttsEnabled ? `播报已开启 · ${this.ttsLabel()}` : "播报已关闭 · 回复仍显示文字"
		);
	}

	private renderTtsBtn(): void {
		if (!this.ttsBtn) return;
		this.ttsBtn.empty();
		setIcon(this.ttsBtn.createSpan(), this.ttsEnabled ? "volume-2" : "volume-x");
		this.ttsBtn.createSpan({
			cls: "tq-control-label",
			text: this.ttsEnabled ? "播报已开" : "播报已关",
		});
		this.ttsBtn.setAttribute("aria-label", this.ttsEnabled ? "关闭语音播报" : "开启语音播报");
		this.ttsBtn.setAttribute("aria-pressed", String(this.ttsEnabled));
		this.ttsBtn.toggleClass("is-active", this.ttsEnabled);
	}

	private async restoreVoiceSession(): Promise<void> {
		const store = this.voiceSessionStore;
		if (!store) return;
		const snapshot = await store.load();
		if (!this.mounted) return;
		// 历史仅恢复给 voice namespace 的 driver；界面不再创建任何历史 DOM，
		// 更不会把语音历史注入文字对话。
		this.driver?.restoreVoiceHistory(store.contextMessages());
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
			cls: "tq-control-label",
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
		this.controlStatusEl?.setText("点击麦克风开始说话");
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
		this.controlStatusEl?.setText(`已切换点击说话 · ${reason}`);
		void this.save?.();
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
		this.setControlButtonLabel(
			this.engBtn,
			local ? "本地引擎" : "千问引擎",
			local ? "当前本地 Whisper，点击切换识别引擎" : "当前千问云端，点击切换识别引擎"
		);
		this.engBtn.setAttribute("aria-pressed", String(local));
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
				if (this.voiceMode.snapshot().inputMode === "push-to-talk") {
					if (s === "transcribing") this.setState("reco");
					else if (s === "capturing") this.setState("listen");
					return;
				}
				if (!this.wakeActive) this.setState("sleep");
				else if (s === "transcribing") this.setState("reco");
				else if (s === "capturing") this.setState("listen");
				else if (this.state !== "think" && this.state !== "speak") {
					this.setState("listen");
				}
			},
			onSpeechStart: () => {
				if (
					this.wakeActive
					|| this.voiceMode.snapshot().inputMode === "push-to-talk"
				) this.onBargeIn();
			},
			onText: (text) => {
				if (this.navigatingToChat) return;
				this.handleVoiceTranscript(text);
				if (this.voiceMode.snapshot().inputMode === "push-to-talk") {
					this.asr?.stop();
					this.renderPushToTalkReady();
				}
			},
			onPartial: (text) => this.showPartialTranscript(text),
			onError: (msg) => {
				const line = `语音输入：${msg}`;
				this.controlStatusEl?.setText(line);
				this.setEmotionBallState("error", 2400);
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
		this.controlStatusEl?.setText(
			this.settings.quyuanAsrEngine === "local" ? "已切到本地 Whisper（首次需下模型）" : "已切到千问云端"
		);
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
		this.setControlButtonLabel(
			this.micBtn,
			label,
			listening ? "退出语音识别并释放麦克风" : "开启语音识别"
		);
		this.micBtn.setAttribute("aria-pressed", String(listening));
		this.micBtn.toggleClass("is-active", listening);
	}

	private setControlButtonLabel(
		button: HTMLButtonElement,
		visualLabel: string,
		accessibleLabel = visualLabel
	): void {
		button.setAttribute("data-label", visualLabel);
		button.setAttribute("aria-label", accessibleLabel);
		button.createSpan({ cls: "tq-control-label", text: visualLabel });
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
		this.controlStatusEl?.setText("语音识别已退出");
		this.setEmotionBallState("restricted");
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
		this.controlStatusEl?.setText("正在申请麦克风权限…");
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
		if (this.navigatingToChat) return;
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
			if (this.ttsEnabled) {
				this.tts?.feed("好，我先退下。");
				this.tts?.flush();
			}
			if (this.overlayReply) this.setOverlayMessage("已休眠，说「屈原」可以再次唤醒。");
			return;
		}

		if (!this.wakeActive) {
			const hit = this.matchWake(text);
			if (!hit) {
				this.setState("sleep");
				this.controlStatusEl?.setText("待唤醒 · 说「屈原」");
				if (this.overlayReply) this.setOverlayMessage("等待唤醒词「屈原」。");
				return;
			}
			this.activateWake();
			const command = this.stripWakeWord(text, hit);
			if (!command) {
				if (this.ttsEnabled) {
					this.tts?.feed("我在，你说。");
					this.tts?.flush();
				}
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
			this.ttsPending = false;
			this.ttsSpeaking = false;
			this.syncAsrBusy();
			this.setEmotionBallState("stop", 900);
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
		this.setEmotionBallState(this.voiceStateToEmotionState(state));
		this.controlStatusEl?.setText(meta.caption);
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
		if (!trimmed || !this.mounted || this.navigatingToChat) return;
		void this.voiceSessionStore?.appendMessage({
			id: `voice-user-${Date.now()}`,
			role: "user",
			text: trimmed,
			modality: channel === "voice" ? "speech" : "text",
			createdAt: Date.now(),
		});
		if (channel === "voice") {
			this.showTranscriptEditor(trimmed);
		} else {
			this.controlStatusEl?.setText("文本查询已提交 · 遵循审批合同");
		}
		if (this.overlayReply) this.overlayReply.empty();
		this.overlayLines = [];
		void this.respond(trimmed, channel);
	}

	/**
	 * 流式转写的中途结果：只滚动更新识别卡，说话过程中就能看见。
	 * 绝不走 matchWake / commitUser——半截文本既不该唤醒也不该发送，
	 * 唤醒词匹配与发送一律只在最终结果（handleVoiceTranscript）上做。
	 */
	private showPartialTranscript(text: string): void {
		if (this.settings.quyuanVoiceRecognitionEnabled === false || this.navigatingToChat) return;
		// 待机期不显示：没唤醒时的环境语音不该被打到屏幕上
		if (
			!this.wakeActive
			&& this.voiceMode.snapshot().inputMode !== "push-to-talk"
		) return;
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
		if (!this.mounted || !this.driver || this.navigatingToChat) return;
		if (this.driver.isBusy()) {
			this.controlStatusEl?.setText("上一轮仍在处理，可先点击停止");
			return;
		}
		this.setState("think");
		this.responseActive = true;
		this.syncAsrBusy();
		this.replyBuffer = "";
		let started = false;
		await this.driver.send({ text: userText, channel }, {
			onText: (delta) => {
				if (!this.mounted || this.navigatingToChat) return;
				if (!started) {
					started = true;
					this.setState("speak");
				}
				this.replyBuffer += delta;
				this.feedOverlayLine(delta);
				if (channel === "voice" && this.ttsEnabled) {
					const wasPending = this.ttsPending;
					this.ttsPending = true;
					if (!wasPending) this.syncAsrBusy();
					this.tts?.feed(delta);
				}
			},
			onTool: (event) => {
				if (event.status === "running" && this.mounted) {
					this.setEmotionBallState("searching");
					this.controlStatusEl?.setText(`只读检索 · ${event.name}`);
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
					if (this.responseActive) {
						this.setEmotionBallState(this.voiceStateToEmotionState(this.state));
					}
				}
			},
			onDone: (fullText) => {
				this.voiceMode.setReplyText(fullText);
				void this.voiceSessionStore?.appendMessage({
					id: `voice-assistant-${Date.now()}`,
					role: "assistant",
					text: fullText,
					modality: channel === "voice" ? "speech" : "text",
					createdAt: Date.now(),
				});
				if (channel === "text" && this.overlayReply && this.markdownComponent) {
					this.overlayReply.empty();
					this.overlayLines = [];
					void MarkdownRenderer.render(
						this.app,
						fullText,
						this.overlayReply,
						"",
						this.markdownComponent
					);
				}
				if (channel === "voice" && this.ttsEnabled) this.tts?.flush();
				this.replyBuffer = "";
				this.responseActive = false;
				// 唤醒倒计时由 syncAsrBusy 统一接管：朗读未结束时保持冻结，朗读结束后重新计 30 秒
				this.syncAsrBusy();
				if (this.mounted && !this.ttsPending) {
					this.setState(this.restingState());
					this.setEmotionBallState("done", 1800);
				}
				this.controlStatusEl?.setText("查询已完成");
			},
			onError: (message) => {
				if (!this.mounted || this.navigatingToChat) return;
				this.responseActive = false;
				this.tts?.stop();
				this.ttsPending = false;
				this.ttsSpeaking = false;
				this.syncAsrBusy();
				this.setState(this.restingState());
				const restricted = /只读|拒绝|禁止|权限/.test(message);
				this.setEmotionBallState(restricted ? "restricted" : "error", 2600);
				this.controlStatusEl?.setText(restricted ? "请求被安全边界拒绝" : "引擎错误");
				if (this.overlayReply) this.setOverlayMessage(`出错了：${message}`);
			},
		});
	}

	// 破坏性操作二次确认：弹确认卡 + 朗读问句，确认/取消或 30s 超时自动取消
	private askConfirm(toolName: string, description: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			if (!this.mounted || !this.confirmHostEl) {
				resolve(false);
				return;
			}
			const ask = `需要确认：屈原想执行「${description}」。确认吗？`;
			this.confirmHostEl.empty();
			const card = this.confirmHostEl.createDiv({
				cls: "tq-approval-card",
				attr: { "data-tool": toolName },
			});
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
			this.setEmotionBallState("restricted");
			if (this.ttsEnabled) {
				this.tts?.feed(`${ask}请点确认或取消。`);
				this.tts?.flush();
			}
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
				card.toggleClass("is-resolved", true);
				this.setEmotionBallState(v ? "done" : "stop", 1200);
				resolve(v);
			};
			yes.addEventListener("click", () => finish(true));
			no.addEventListener("click", () => finish(false));
			timer = window.setTimeout(() => finish(false), 30000);
		});
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
		if (this.ballStateTimer != null) window.clearTimeout(this.ballStateTimer);
		this.ballStateTimer = null;
		this.emotionThemeObserver?.disconnect();
		this.emotionThemeObserver = null;
		this.emotionBall?.destroy();
		this.emotionBall = null;
		this.markdownComponent?.unload();
		this.markdownComponent = null;
		this.rootEl = null;
		this.bodyEl = null;
		this.sessionInputEl = null;
		this.wakeStatusEl = null;
		this.micBtn = null;
		this.sendBtn = null;
		this.engBtn = null;
		this.voiceModeBtn = null;
		this.ttsBtn = null;
		this.overlayTranscriptEl = null;
		this.overlayTranscriptLinesEl = null;
		this.overlayUser = null;
		this.overlayReply = null;
		this.overlayLines = [];
		this.controlStatusEl = null;
		this.workspaceStatusEl = null;
		this.confirmHostEl = null;
		this.replyBuffer = "";
		this.navigatingToChat = false;
	}
}
