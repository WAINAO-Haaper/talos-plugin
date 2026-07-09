import { App, Component, MarkdownRenderer, setIcon } from "obsidian";
import type { TalosSettings } from "../settings";
import { StreamTts } from "../jarvis/voiceio";
import type { VadMic, VadMicHandlers } from "./vad-mic";
import { CloudAsr } from "./cloud-asr";
import { LocalAsr } from "./local-asr";
import type ClaudianPlugin from "./claudian/main";
import { QuyuanVoiceDriver } from "./voice-driver";
import type { InteractionChannel } from "./voice-driver";
import { QuyuanVoiceParticleField } from "./voice-particle-field";

interface TalosQuyuanPlugin extends ClaudianPlugin {
	activateQuyuanV2View(): Promise<void>;
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
	private replyEl: HTMLElement | null = null;
	private engBtn: HTMLButtonElement | null = null;

	private rootEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private orbEl: HTMLElement | null = null;
	private coreIconEl: HTMLElement | null = null;
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
	private particleField: QuyuanVoiceParticleField | null = null;
	private markdownComponent: Component | null = null;
	private activateSideTab: ((key: "session" | "context" | "ability") => void) | null = null;
	private replyBuffer = "";
	// 沉浸式 overlay 文字层（舞台半透明覆盖）
	private overlayUser: HTMLElement | null = null;
	private overlayReply: HTMLElement | null = null;
	// fab 圆环状态文字
	private fabStatusEl: HTMLElement | null = null;
	// overlay 回复的 markdown 渲染容器（用于 text 通道完成后重渲染）
	private overlayReplyMd: HTMLElement | null = null;
	private sideCollapsed = false;
	private wakeActive = false;
	private wakeTimer: number | null = null;
	private responseActive = false;
	private ttsPending = false;
	private ttsSpeaking = false;

	private state: VoiceState = "sleep";
	private mounted = false;
	private readonly sideWidthKey = "talos-quyuan-side-width";
	private readonly wakeWord = "屈原";
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
		});
		this.driver.setConfirmHandler((tool, desc) => this.askConfirm(tool, desc));
		this.tts = new StreamTts(this.settings, (s) => {
			if (s === "speaking") {
				this.ttsPending = true;
				this.ttsSpeaking = true;
				this.syncAsrBusy();
				this.setState("speak");
			} else if (s === "idle") {
				this.ttsPending = false;
				this.ttsSpeaking = false;
				this.syncAsrBusy();
				this.setState(this.restingState());
			} else if (s === "error") {
				this.ttsPending = false;
				this.ttsSpeaking = false;
				this.syncAsrBusy();
			}
		}, (level) => {
			// TTS 输出音量驱动粒子（speak 态粒子跟随屈原声音起伏）
			this.particleField?.setOutputLevel(level);
		});
		this.asr = this.buildAsr();
		void this.driver.warmup("voice");

		const root = container.createDiv({ cls: "tq-voice" });
		this.rootEl = root;
		root.setAttribute("data-wake-state", "sleep");

		const body = root.createDiv({ cls: "tq-body" });
		this.bodyEl = body;
		this.setSideWidth(this.savedSideWidth(), false);

		// 中央动态语音舞台（沉浸式全屏）
		const stage = body.createDiv({ cls: "tq-stage" });
		const backCanvas = stage.createEl("canvas", {
			cls: "tq-particles tq-particles-back",
			attr: { "aria-hidden": "true" },
		});
		this.orbEl = stage.createDiv({ cls: "tq-orb" });
		const core = this.orbEl.createDiv({ cls: "tq-core" });
		this.coreIconEl = core.createSpan();
		const frontCanvas = stage.createEl("canvas", {
			cls: "tq-particles tq-particles-front",
			attr: { "aria-hidden": "true" },
		});
		try {
			this.particleField = new QuyuanVoiceParticleField(stage, backCanvas, frontCanvas);
		} catch (error) {
			console.error("TALOS Quyuan particle layer failed to start", error);
			stage.addClass("is-particle-fallback");
			this.particleField = null;
		}

		// 半透明文字覆盖层：用户消息 + AI 流式回复，自动滚动
		const overlay = stage.createDiv({ cls: "tq-overlay-text", attr: { "aria-live": "polite" } });
		this.overlayReply = overlay.createDiv({ cls: "tq-overlay-reply" });
		this.overlayUser = overlay.createDiv({ cls: "tq-overlay-user" });

		// 右下角悬浮圆环 + 展开控制菜单
		const fab = stage.createDiv({ cls: "tq-fab" });
		const fabMenu = fab.createDiv({ cls: "tq-fab-menu" });
		// 聆听/暂停
		this.micBtn = fabMenu.createEl("button", {
			cls: "tq-fab-btn",
			attr: { type: "button", "aria-label": "暂停或恢复聆听" },
		});
		this.renderMicBtn(false);
		this.micBtn.addEventListener("click", () => this.toggleMic());
		// 打断
		const stopBtn = fabMenu.createEl("button", {
			cls: "tq-fab-btn tq-fab-btn--danger",
			attr: { type: "button", "aria-label": "立即打断" },
		});
		setIcon(stopBtn.createSpan(), "zap");
		stopBtn.createSpan({ text: "打断" });
		stopBtn.addEventListener("click", () => {
			this.onBargeIn();
			this.setState(this.restingState());
		});
		// 文字输入
		const textBtn = fabMenu.createEl("button", {
			cls: "tq-fab-btn",
			attr: { type: "button", "aria-label": "文字输入" },
		});
		setIcon(textBtn.createSpan(), "keyboard");
		textBtn.createSpan({ text: "文字" });
		textBtn.addEventListener("click", () => this.openSessionComposer());
		// 引擎切换
		this.engBtn = fabMenu.createEl("button", {
			cls: "tq-fab-btn",
			attr: { type: "button", "aria-label": "切换识别引擎" },
		});
		this.renderEngineBtn();
		this.engBtn.addEventListener("click", () => void this.switchEngine());
		// 侧栏切换
		this.sideToggleBtn = fabMenu.createEl("button", {
			cls: "tq-fab-btn",
			attr: { type: "button", "aria-label": "展开/收起交互面板" },
		});
		setIcon(this.sideToggleBtn.createSpan(), "panel-right");
		this.sideToggleBtn.addEventListener("click", () => this.toggleSide());
		// 设置
		const setBtn = fabMenu.createEl("button", {
			cls: "tq-fab-btn",
			attr: { type: "button", "aria-label": "设置" },
		});
		setIcon(setBtn.createSpan(), "settings");
		setBtn.createSpan({ text: "设置" });
		setBtn.addEventListener("click", () => this.openSettings());
		// 迷你音量条
		const meter = fabMenu.createDiv({ cls: "tq-fab-meter", attr: { "aria-label": "麦克风音量" } });
		for (let i = 0; i < 12; i++) {
			meter.createEl("i").style.setProperty("--bar", `${4 + ((i * 7) % 9)}px`);
		}
		// 状态文字
		this.fabStatusEl = fabMenu.createDiv({ cls: "tq-fab-status", text: "就绪" });
		// 圆环本体（最后创建，浮在最上层）
		const fabRing = fab.createDiv({ cls: "tq-fab-ring" });
		fabRing.createDiv({ cls: "tq-fab-core" });

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
		const side = body.createEl("aside", { cls: "tq-side" });
		this.buildFunctionalSidebar(side);

		this.setState("sleep");
		// 进入模块自动开启持续监听（免按键）；无 key/无权限时回调里给提示
		try {
			void this.asr?.start();
		} catch (error) {
			console.error("TALOS Quyuan ASR failed to start", error);
			if (this.fabStatusEl) this.fabStatusEl.setText("语音输入未启动");
		}
	}

	private modelLabel(): string {
		const model = this.settings.jarvisModel?.trim() || this.settings.openaiModel?.trim();
		if (model) return model;
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
			text: "待唤醒 · 说「屈原」",
		});
		const sessionActions = sessionHead.createDiv({ cls: "tq-session-actions" });
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
		this.sessionEmptyEl.createEl("small", { text: "语音和文字会进入同一条会话流" });
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
			if (this.overlayUser) this.overlayUser.setText("");
			if (this.overlayReply) this.overlayReply.setText("开口，说出你现在最想推进的事。");
		});

		const contextPanel = addTab("context", "上下文", "layers-3");
		this.addSideSection(contextPanel, "当前上下文", "4 个核心");
		for (const item of [
			{ icon: "fingerprint", label: "PERSONA", meta: "屈原 · 人格契约", path: "灵魂/PERSONA.md" },
			{ icon: "brain", label: "自我记忆", meta: "persona-memory", path: "灵魂/persona-memory.md" },
			{ icon: "compass", label: "当前状态", meta: "Identity / CONTEXT", path: "Identity/CONTEXT.md" },
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

	private savedSideWidth(): number {
		const fallback = 360;
		try {
			const saved = Number(window.localStorage.getItem(this.sideWidthKey));
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
		this.sideToggleBtn.setAttribute(
			"aria-label",
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
		this.engBtn.createSpan({ text: local ? " 本地" : " 千问" });
		this.engBtn.setAttribute("aria-pressed", String(local));
		this.engBtn.setAttribute("title", local ? "当前：本地 Whisper" : "当前：千问云端");
	}

	// 识别引擎回调（云端/本地共用）
	private asrHandlers(): VadMicHandlers {
		return {
			onListeningChange: (on) => {
				if (!on) this.deactivateWake();
				this.renderMicBtn(on);
				this.setState(on ? this.restingState() : "idle");
			},
			onLevel: (level) => {
				const visualLevel = this.wakeActive ? level : level * 0.24;
				this.particleField?.setAudioLevel(visualLevel);
				this.rootEl?.style.setProperty("--tq-level", visualLevel.toFixed(3));
			},
			onState: (s) => {
				if (s === "transcribing") this.setState("reco");
				else if (!this.wakeActive) this.setState("sleep");
				else if (s === "capturing") this.setState("listen");
				else if (this.state !== "think" && this.state !== "speak") {
					this.setState("listen");
				}
			},
			onSpeechStart: () => {
				if (this.wakeActive) this.onBargeIn();
			},
			onText: (text) => this.handleVoiceTranscript(text),
			onError: (msg) => {
				if (this.fabStatusEl) this.fabStatusEl.setText(`语音输入：${msg}`);
			},
		};
	}

	private buildAsr(): VadMic {
		const h = this.asrHandlers();
		return this.settings.quyuanAsrEngine === "local"
			? new LocalAsr(this.settings, h)
			: new CloudAsr(this.settings, h);
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
		this.micBtn.createSpan({
			text: listening ? (this.wakeActive ? " 聆听中" : " 待唤醒") : " 已暂停",
		});
		this.micBtn.setAttribute("aria-pressed", String(listening));
		this.micBtn.toggleClass("is-active", listening);
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
		if (this.overlayReply) this.overlayReply.setText("已唤醒，直接说就好。");
	}

	private deactivateWake(): void {
		this.wakeActive = false;
		if (this.wakeTimer != null) {
			window.clearTimeout(this.wakeTimer);
			this.wakeTimer = null;
		}
		this.rootEl?.setAttribute("data-wake-state", "sleep");
		this.renderMicBtn(this.asr?.isOn() ?? false);
		this.wakeStatusEl?.setText("待唤醒 · 说「屈原」");
		if (this.overlayReply) {
			this.overlayReply.setText(
				this.asr?.isOn()
					? "已休眠，说「屈原」可以再次唤醒。"
					: "麦克风已暂停，恢复监听后说「屈原」唤醒。"
			);
		}
		if (this.mounted) this.setState(this.asr?.isOn() ? "sleep" : "idle");
	}

	private refreshWakeWindow(): void {
		if (!this.wakeActive) return;
		if (this.wakeTimer != null) window.clearTimeout(this.wakeTimer);
		this.wakeTimer = window.setTimeout(() => {
			this.deactivateWake();
			if (this.overlayReply) this.overlayReply.setText("已休眠，说「屈原」可以再次唤醒。");
		}, this.wakeWindowMs);
	}

	private stripWakeWord(text: string): string {
		return text
			.split(this.wakeWord)
			.join("")
			.replace(/^[\s，。！？、,:：；;]+/, "")
			.trim();
	}

	private handleVoiceTranscript(rawText: string): void {
		const text = rawText.trim();
		if (!text) return;

		if (this.wakeActive && text.includes(this.sleepWord)) {
			this.deactivateWake();
			this.tts?.feed("好，我先退下。");
			this.tts?.flush();
			if (this.overlayReply) this.overlayReply.setText("已休眠，说「屈原」可以再次唤醒。");
			return;
		}

		if (!this.wakeActive) {
			if (!text.includes(this.wakeWord)) {
				this.setState("sleep");
				if (this.fabStatusEl) this.fabStatusEl.setText("待唤醒 · 说「屈原」");
				if (this.overlayReply) this.overlayReply.setText("等待唤醒词「屈原」。");
				return;
			}
			this.activateWake();
			const command = this.stripWakeWord(text);
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
			this.responseActive = false;
			this.driver?.cancel();
			this.tts?.stop();
			this.syncAsrBusy();
		}
	}

	private syncAsrBusy(): void {
		const busy = this.responseActive || this.ttsPending || this.ttsSpeaking;
		// 自动声控打断只在真正播放声音时开启；思考和 TTS 网络排队阶段用按钮打断。
		this.asr?.setBusy(busy, this.ttsSpeaking);
	}

	// ---------- 状态机 ----------
	private setState(state: VoiceState): void {
		if (!this.mounted) return;
		this.state = state;
		const meta = STATES[state];
		this.rootEl?.setAttribute("data-voice-state", state);
		this.rootEl?.style.setProperty("--tq-state", meta.color);
		this.rootEl?.style.setProperty("--tq-spd", meta.speed);
		this.particleField?.setState(state === "sleep" ? "idle" : state);
		// 圆环颜色和呼吸频率由 CSS 变量驱动（--tq-state / --tq-spd）
		// fab-status 显示状态文字
		if (this.fabStatusEl) this.fabStatusEl.setText(meta.caption);
	}

	// ---------- 麦克风（接云端 CloudAsr：按一下录、再按一下识别） ----------
	private toggleMic(): void {
		void this.asr?.toggle();
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
		// overlay 文字层：显示最新用户消息
		if (this.overlayUser) this.overlayUser.setText(trimmed);
		// 清空 overlay 回复区，准备接收新回复
		if (this.overlayReply) this.overlayReply.empty();
		this.scrollConvo();
		void this.respond(trimmed, channel);
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
					// overlay 文字层：同步流式回复
					if (this.overlayReply) {
						this.overlayReply.setText(this.replyBuffer);
						this.overlayReply.scrollTop = this.overlayReply.scrollHeight;
					}
				}
				if (channel === "voice") {
					const wasPending = this.ttsPending;
					this.ttsPending = true;
					if (!wasPending) this.syncAsrBusy();
					this.tts?.feed(delta);
				}
				this.scrollConvo();
			},
			onTool: (name) => {
				if (!this.mounted || !this.replyEl) return;
				const exec = this.replyEl.parentElement?.createSpan({ cls: "tq-exec" });
				if (!exec) return;
				setIcon(exec.createSpan(), "tool");
				exec.createSpan({ text: ` 执行 · ${name}` });
				this.scrollConvo();
			},
			onDone: () => {
				const replyEl = this.replyEl;
				const reply = this.replyBuffer;
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
				this.syncAsrBusy();
				if (channel === "voice") this.refreshWakeWindow();
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
				if (this.overlayReply) this.overlayReply.setText(`出错了：${message}`);
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
			const finish = (v: boolean): void => {
				if (done) return;
				done = true;
				yes.disabled = true;
				no.disabled = true;
				resolve(v);
			};
			yes.addEventListener("click", () => finish(true));
			no.addEventListener("click", () => finish(false));
			window.setTimeout(() => finish(false), 30000);
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
		this.particleField?.destroy();
		this.particleField = null;
		this.markdownComponent?.unload();
		this.markdownComponent = null;
		this.replyEl = null;
		this.rootEl = null;
		this.bodyEl = null;
		this.orbEl = null;
		this.coreIconEl = null;
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
		this.sideToggleBtn = null;
		this.activateSideTab = null;
		this.overlayUser = null;
		this.overlayReply = null;
		this.fabStatusEl = null;
		this.overlayReplyMd = null;
		this.replyBuffer = "";
	}
}
