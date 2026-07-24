import { App, setIcon } from "obsidian";
import type { PermissionResult, PermissionMode, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { TalosSettings } from "../settings";
import type { PermissionAsk, ToolUseEvent } from "./engine";
import type { Engine, SeedTurn, UserTurn } from "./engine-types";
import { createEngine } from "./engine-factory";
import { StreamTts, MicStt } from "./voiceio";
import { SessionStore, TabRecord, LogEntry } from "./session/store";
import { MentionPicker, fileToBase64 } from "./context/mentions";
import { CommandRegistry } from "./context/commands";
import { readCapabilities } from "./context/capabilities";
import {
	providerSecretStoreFromApp,
	readProviderSecret,
} from "../ai/provider/secret-storage-runtime";

// ============================================================
// 屈原 · agentic 面板（B 方案 UI · P3 多标签）
//   每标签 = 独立 Engine + 独立日志(LiveTab)；共享输入栏 + 语音 + 状态条。
//   转写持久化到 settings.jarvisTabsJson，重开可视恢复；直连通道续聊时
//   经 engine.seed() 把历史灌回上下文。语音/人格逻辑与通道完全解耦。
// ============================================================

type Speaking = "idle" | "speaking" | "error";

interface LiveTab {
	rec: TabRecord;
	logEl: HTMLElement;
	engine: Engine | null;
	curAssistantEl: HTMLElement | null;
	curAssistantText: string;
	curThinkEl: HTMLElement | null; // 当前思考折叠块的 <pre>
	curThinkText: string;
	toolEls: Map<string, HTMLElement>; // 本会话新工具卡片
	toolEntry: Map<string, LogEntry>; // toolUseID → 持久 entry（回填输出）
	seeded: boolean;
}

interface PendingImage {
	mime: string;
	dataB64: string;
	name: string;
}

export class JarvisAgentPanel {
	private app: App;
	private settings: TalosSettings;
	private save?: () => Promise<void>;

	private store: SessionStore;
	private live = new Map<string, LiveTab>();

	private tts: StreamTts | null = null;
	private stt: MicStt | null = null;

	private mentionPicker: MentionPicker;
	private cmdRegistry: CommandRegistry;
	private pendingImages: PendingImage[] = [];

	private tabsBarEl: HTMLElement | null = null;
	private contentEl: HTMLElement | null = null;
	private mentionEl: HTMLElement | null = null;
	private slashEl: HTMLElement | null = null;
	private capsEl: HTMLElement | null = null;
	private attachBarEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private statusEl: HTMLElement | null = null;
	private modeSel: HTMLSelectElement | null = null;
	private micBtn: HTMLButtonElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private stopBtn: HTMLButtonElement | null = null;
	private modelSel: HTMLSelectElement | null = null;
	private thinkSel: HTMLSelectElement | null = null;
	private ctxEl: HTMLElement | null = null;
	private voiceToggleEl: HTMLInputElement | null = null;
	private yoloEl: HTMLInputElement | null = null;
	private mounted = false;

	constructor(app: App, settings: TalosSettings, save?: () => Promise<void>) {
		this.app = app;
		this.settings = settings;
		this.save = save;
		this.store = SessionStore.fromJson(settings.jarvisTabsJson);
		this.mentionPicker = new MentionPicker(app);
		this.cmdRegistry = new CommandRegistry(app);
	}

	// ---------- 挂载 ----------
	mount(container: HTMLElement): void {
		container.empty();
		this.mounted = true;
		const wrap = container.createDiv({ cls: "panel jv-panel jv-agent" });
		wrap.setCssProps({ "--ac": "#38E1FF" });

		const head = wrap.createDiv({ cls: "section-title" });
		head.createEl("h2", { text: "屈原 · Agentic" });
		head.createEl("small", { text: "多通道 · 多标签 · 流式 · 全库可读写 · 听说双向" });

		// 状态条 + 权限模式
		const bar = wrap.createDiv({ cls: "jv-statusbar" });
		this.statusEl = bar.createDiv({ cls: "jv-status", text: "待命" });
		this.statusEl.setAttribute("data-state", "idle");
		const modeWrap = bar.createDiv({ cls: "jv-modewrap" });
		modeWrap.createEl("span", { cls: "jv-modelabel", text: "权限" });
		const modeSel = modeWrap.createEl("select", { cls: "jv-modesel" });
		for (const [val, label] of [
			["default", "每次询问"],
			["acceptEdits", "自动接受编辑"],
			["plan", "计划模式（只读）"],
			["bypassPermissions", "全放开（危险）"],
		] as const) {
			modeSel.createEl("option", { text: label }).value = val;
		}
		modeSel.value = this.settings.jarvisPermissionMode || "default";
		modeSel.addEventListener("change", () => {
			const m = modeSel.value as PermissionMode;
			this.settings.jarvisPermissionMode = m;
			void this.save?.();
			if (this.yoloEl) this.yoloEl.checked = m === "bypassPermissions";
			void this.activeLive()?.engine?.setPermissionMode(m);
		});
		this.modeSel = modeSel;

		const capsBtn = bar.createDiv({ cls: "jv-capsbtn", text: "🧩 能力" });
		capsBtn.setAttribute("title", "斜杠命令 / 子智能体 / MCP");
		capsBtn.addEventListener("click", () => void this.toggleCaps());

		// 能力面板（默认隐藏）
		this.capsEl = wrap.createDiv({ cls: "jv-caps" });
		this.capsEl.style.display = "none";

		// 标签条 + 内容区
		this.tabsBarEl = wrap.createDiv({ cls: "jv-tabsbar" });
		this.contentEl = wrap.createDiv({ cls: "jv-tabscontent" });

		// 输入栏
		const inbar = wrap.createDiv({ cls: "jv-inputbar" });
		// @提及浮层（默认隐藏）
		this.mentionEl = inbar.createDiv({ cls: "jv-mentions" });
		this.mentionEl.style.display = "none";
		// 斜杠命令浮层（默认隐藏）
		this.slashEl = inbar.createDiv({ cls: "jv-mentions jv-slash" });
		this.slashEl.style.display = "none";
		// 图片附件 chips（默认隐藏）
		this.attachBarEl = inbar.createDiv({ cls: "jv-attachbar" });
		this.attachBarEl.style.display = "none";

		const ta = inbar.createEl("textarea", { cls: "jv-input" });
		ta.setAttribute("rows", "2");
		ta.setAttribute("placeholder", "问屈原，@引用文件、可贴图…（Enter 发送，Shift+Enter 换行）");
		this.inputEl = ta;
		ta.addEventListener("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Escape") {
				this.hideMentions();
				this.hideSlash();
				return;
			}
			if (ev.key === "Enter" && !ev.shiftKey) {
				ev.preventDefault();
				this.submit();
			}
		});
		ta.addEventListener("input", () => this.onInput());
		ta.addEventListener("paste", (ev: ClipboardEvent) => this.onPaste(ev));

		// 隐藏图片文件选择器
		const fileInput = inbar.createEl("input", { cls: "jv-fileinput" });
		fileInput.type = "file";
		fileInput.accept = "image/*";
		fileInput.multiple = true;
		fileInput.style.display = "none";
		fileInput.addEventListener("change", () => {
			if (fileInput.files) void this.addImages(Array.from(fileInput.files));
			fileInput.value = "";
		});

		const btns = inbar.createDiv({ cls: "jv-btns" });
		const attachBtn = btns.createEl("button", { cls: "jv-btn jv-attach", text: "📎 图" });
		attachBtn.addEventListener("click", () => fileInput.click());
		this.micBtn = btns.createEl("button", { cls: "jv-btn jv-mic", text: "🎙 语音" });
		this.micBtn.addEventListener("click", () => this.toggleMic());
		if (this.settings.jarvisSttEngine === "off") {
			this.micBtn.setAttribute("disabled", "true");
			this.micBtn.setAttribute("title", "语音识别已在设置中关闭");
		} else if (!MicStt.available()) {
			this.micBtn.setAttribute("disabled", "true");
			this.micBtn.setAttribute("title", "此环境无 WebSpeech 语音识别");
		}
		this.stopBtn = btns.createEl("button", { cls: "jv-btn jv-stop", text: "⏹ 停" });
		this.stopBtn.addEventListener("click", () => this.stopAll());
		this.sendBtn = btns.createEl("button", { cls: "jv-btn jv-send", text: "发送" });
		this.sendBtn.addEventListener("click", () => this.submit());

		// 底栏：模型切换 / 思考档 / 上下文% / YOLO
		const bottom = wrap.createDiv({ cls: "jv-bottombar" });
		const modelSel = bottom.createEl("select", { cls: "jv-modelsel" });
		this.modelSel = modelSel;
		this.populateModelSel();
		modelSel.addEventListener("change", () => void this.onModelChange());

		const thinkWrap = bottom.createDiv({ cls: "jv-thinkwrap" });
		thinkWrap.createSpan({ cls: "jv-bl", text: "思考" });
		const thinkSel = thinkWrap.createEl("select", { cls: "jv-thinksel" });
		for (const [v, l] of [["off", "关"], ["low", "低"], ["medium", "中"], ["high", "高"]] as const) {
			thinkSel.createEl("option", { text: l }).value = v;
		}
		thinkSel.value = this.settings.jarvisThinkingLevel || "off";
		thinkSel.addEventListener("change", async () => {
			this.settings.jarvisThinkingLevel = thinkSel.value;
			await this.save?.();
		});
		this.thinkSel = thinkSel;

		const voiceWrap = bottom.createDiv({ cls: "jv-voicewrap" });
		voiceWrap.createSpan({ cls: "jv-bl", text: "语音" });
		const voiceToggle = voiceWrap.createEl("input", { cls: "jv-yolo jv-voice-toggle" });
		voiceToggle.type = "checkbox";
		voiceToggle.checked = this.settings.jarvisVoiceEnabled;
		voiceToggle.setAttribute("aria-label", "语音助手开关");
		voiceToggle.setAttribute("title", "同时控制麦克风输入与自动朗读");
		voiceToggle.addEventListener("change", () => void this.setVoiceEnabled(voiceToggle.checked));
		this.voiceToggleEl = voiceToggle;

		this.ctxEl = bottom.createDiv({ cls: "jv-ctx", text: "—" });
		this.ctxEl.setAttribute("title", "上下文用量（估算）");

		const yoloWrap = bottom.createDiv({ cls: "jv-yolowrap" });
		yoloWrap.createSpan({ cls: "jv-bl", text: "YOLO" });
		const yolo = yoloWrap.createEl("input", { cls: "jv-yolo" });
		yolo.type = "checkbox";
		yolo.checked = this.settings.jarvisPermissionMode === "bypassPermissions";
		yolo.addEventListener("change", () => this.onYolo(yolo.checked));
		this.yoloEl = yolo;

		// 还原标签：空则建一个
		if (this.store.tabs.length === 0) this.store.create(this.settings.engineProvider);
		if (!this.store.active()) this.store.activeId = this.store.tabs[0]?.id ?? null;

		this.ensureVoice();
		this.updateVoiceControls();
		void this.cmdRegistry.load(); // 异步扫 .claude/commands
		this.renderTabBar();
		if (this.store.activeId) this.activateTab(this.store.activeId);
	}

	unmount(): void {
		this.mounted = false;
		this.stt?.dispose();
		this.tts?.stop();
		for (const lv of this.live.values()) lv.engine?.dispose();
		this.live.clear();
		this.tts = null;
		this.stt = null;
		this.tabsBarEl = null;
		this.contentEl = null;
		this.mentionEl = null;
		this.slashEl = null;
		this.capsEl = null;
		this.attachBarEl = null;
		this.pendingImages = [];
		this.inputEl = null;
		this.statusEl = null;
		this.modeSel = null;
		this.micBtn = null;
		this.sendBtn = null;
		this.stopBtn = null;
		this.modelSel = null;
		this.thinkSel = null;
		this.ctxEl = null;
		this.voiceToggleEl = null;
		this.yoloEl = null;
	}

	// ---------- 标签管理 ----------
	private renderTabBar(): void {
		const bar = this.tabsBarEl;
		if (!bar) return;
		bar.empty();
		this.store.tabs.forEach((rec, idx) => {
			const t = bar.createDiv({ cls: "jv-tab" + (rec.id === this.store.activeId ? " is-active" : "") });
			t.createSpan({ cls: "jv-tab-num", text: String(idx + 1) });
			t.createSpan({ cls: "jv-tab-title", text: rec.title.length > 12 ? rec.title.slice(0, 12) + "…" : rec.title });
			const x = t.createSpan({ cls: "jv-tab-close", text: "×" });
			x.addEventListener("click", (ev) => {
				ev.stopPropagation();
				this.closeTab(rec.id);
			});
			t.addEventListener("click", () => this.activateTab(rec.id));
		});
		const add = bar.createDiv({ cls: "jv-tab jv-tab-add", text: "＋" });
		add.setAttribute("title", "新对话");
		add.addEventListener("click", () => this.newTab());
	}

	private newTab(): void {
		const rec = this.store.create(this.settings.engineProvider);
		this.createLive(rec);
		this.renderTabBar();
		this.activateTab(rec.id);
	}

	private closeTab(id: string): void {
		const live = this.live.get(id);
		if (live) {
			live.engine?.dispose();
			live.logEl.remove();
			this.live.delete(id);
		}
		this.store.remove(id);
		if (this.store.tabs.length === 0) {
			this.newTab();
			return;
		}
		this.renderTabBar();
		this.activateTab(this.store.activeId ?? this.store.tabs[0].id);
	}

	private activateTab(id: string): void {
		const rec = this.store.get(id);
		if (!rec || !this.contentEl) return;
		this.store.activeId = id;
		if (!this.live.has(id)) this.createLive(rec);
		for (const [tid, lv] of this.live) lv.logEl.style.display = tid === id ? "" : "none";
		const live = this.live.get(id);
		if (live) this.ensureEngineFor(live);
		if (this.modeSel) this.modeSel.value = this.settings.jarvisPermissionMode || "default";
		this.renderTabBar();
		this.setStatus("待命", "idle");
		this.persist();
	}

	private createLive(rec: TabRecord): LiveTab {
		const logEl = this.contentEl!.createDiv({ cls: "jv-log jv-agentlog" });
		const live: LiveTab = {
			rec,
			logEl,
			engine: null,
			curAssistantEl: null,
			curAssistantText: "",
			curThinkEl: null,
			curThinkText: "",
			toolEls: new Map(),
			toolEntry: new Map(),
			seeded: false,
		};
		this.live.set(rec.id, live);
		this.renderEntriesInto(live);
		return live;
	}

	private activeLive(): LiveTab | undefined {
		return this.store.activeId ? this.live.get(this.store.activeId) : undefined;
	}

	private isActive(live: LiveTab): boolean {
		return this.store.activeId === live.rec.id;
	}

	// ---------- 引擎接线（每标签独立，回调闭包到该 tab）----------
	private ensureEngineFor(live: LiveTab): void {
		if (live.engine) return;
		live.engine = createEngine(this.app, this.settings, {
			onSystemInit: (info) => {
				// CLI 通道：记下 sessionId 以便跨重启 resume
				if (this.settings.engineProvider === "claude-cli" && info.sessionId && live.rec.sdkSessionId !== info.sessionId) {
					live.rec.sdkSessionId = info.sessionId;
					this.persist();
				}
				if (this.isActive(live)) this.setStatus(`已连接 · ${info.model}`, "idle");
			},
			onThinkingDelta: (delta) => {
				this.appendThinkingDelta(live, delta);
			},
			onTextDelta: (delta) => {
				this.appendAssistantDelta(live, delta);
				if (this.settings.jarvisVoiceEnabled && this.isActive(live)) this.tts?.feed(delta);
			},
			onAssistantText: (text) => {
				if (!live.curAssistantEl && text.trim()) {
					this.appendAssistantDelta(live, text);
					if (this.settings.jarvisVoiceEnabled && this.isActive(live)) this.tts?.feed(text);
				}
			},
			onToolUse: (t) => this.renderToolUse(live, t),
			onToolResult: (r) => this.renderToolResult(live, r.id, r.content, r.isError),
			onPermissionRequest: (req) => this.askPermission(live, req),
			onResult: (r) => {
				this.finalizeAssistant(live);
				if (this.isActive(live)) {
					if (this.settings.jarvisVoiceEnabled) this.tts?.flush();
					if (r.isError) this.setStatus("出错", "error");
					else this.setStatus(`完成 · ${r.numTurns} 轮${r.costUsd > 0 ? ` · $${r.costUsd.toFixed(4)}` : ""}`, "idle");
				}
				this.persist();
			},
			onBusyChange: (busy) => {
				if (this.isActive(live)) {
					this.sendBtn?.toggleAttribute("disabled", busy);
					if (busy) this.setStatus("思考中…", "thinking");
				}
			},
			onUsage: (u) => {
				if (this.isActive(live) && this.ctxEl) {
					const pct = Math.min(100, Math.round(((u.inputTokens + u.outputTokens) / Math.max(1, u.contextWindow)) * 100));
					this.ctxEl.setText(`${pct}%`);
				}
			},
			onError: (e) => {
				if (this.isActive(live)) this.setStatus(`错误：${e.message}`, "error");
				this.addSystemLine(live, `⚠ ${e.message}`);
			},
		});
		this.maybeSeed(live);
	}

	// 恢复：CLI 通道用 sessionId resume（模型完整记得，含工具）；直连通道把历史转写 seed 回上下文
	private maybeSeed(live: LiveTab): void {
		if (live.seeded) return;
		live.seeded = true;
		if (this.settings.engineProvider === "claude-cli" && live.rec.sdkSessionId) {
			live.engine?.resume?.(live.rec.sdkSessionId);
			return;
		}
		const turns: SeedTurn[] = [];
		for (const e of live.rec.entries) {
			if (e.kind === "user") turns.push({ role: "user", text: e.text });
			else if (e.kind === "assistant") turns.push({ role: "assistant", text: e.text });
		}
		if (turns.length > 0) live.engine?.seed?.(turns);
	}

	private ensureVoice(): void {
		const secretStore = providerSecretStoreFromApp(this.app);
		this.tts = new StreamTts(
			this.settings,
			(s: Speaking, text) => {
				if (s === "speaking") {
					this.setStatus("说话中…", "speaking");
				} else if (s === "error") {
					this.setStatus(`朗读失败：${text ?? ""}`, "error");
				}
			},
			undefined,
			(field) =>
				readProviderSecret(this.settings, field, secretStore)
		);
		this.stt = new MicStt(this.settings, {
			onInterim: (t) => {
				if (this.inputEl) this.inputEl.value = t;
			},
			onFinal: (t) => {
				if (this.inputEl) this.inputEl.value = t;
				this.submit();
			},
			onStateChange: (listening, err) => {
				this.micBtn?.toggleClass("is-on", listening);
				if (this.micBtn) this.micBtn.setText(listening ? "● 聆听" : "🎙 语音");
				if (err) this.setStatus(`麦克风：${err}`, "error");
			},
		});
	}

	// ---------- 交互 ----------
	private submit(): void {
		const ta = this.inputEl;
		if (!ta) return;
		const q = ta.value.trim();
		const imgs = this.pendingImages;
		if (!q && imgs.length === 0) return;
		const live = this.activeLive();
		if (!live) return;
		ta.value = "";
		this.hideMentions();
		this.hideSlash();
		this.stt?.stop();
		this.tts?.stop();
		this.ensureEngineFor(live); // 先建引擎+seed（用历史，不含本次 q）
		this.addUserLine(live, q, imgs.length); // 气泡显示原始输入（含 /命令）
		this.finalizeAssistant(live);
		const sendText = this.expandSlash(q); // 斜杠命令展开为实际 prompt
		const turn: UserTurn = { text: sendText, images: imgs.map((i) => ({ mime: i.mime, dataB64: i.dataB64 })) };
		live.engine?.send(turn);
		this.pendingImages = [];
		this.renderAttachChips();
	}

	private expandSlash(q: string): string {
		if (!q.startsWith("/")) return q;
		const sp = q.indexOf(" ");
		const name = sp >= 0 ? q.slice(1, sp) : q.slice(1);
		const args = sp >= 0 ? q.slice(sp + 1) : "";
		return this.cmdRegistry.expand(name, args) ?? q;
	}

	private toggleMic(): void {
		if (!this.settings.jarvisVoiceEnabled || !this.stt) return;
		this.tts?.stop();
		this.stt.toggle();
	}

	private stopAll(): void {
		this.stt?.stop();
		this.tts?.stop();
		void this.activeLive()?.engine?.interrupt();
		this.setStatus("已停止", "idle");
	}

	private async setVoiceEnabled(on: boolean): Promise<void> {
		this.settings.jarvisVoiceEnabled = on;
		if (!on) {
			this.stt?.stop();
			this.tts?.stop();
		}
		this.updateVoiceControls();
		this.setStatus(on ? "语音已开启" : "语音已关闭", "idle");
		await this.save?.();
	}

	private updateVoiceControls(): void {
		if (this.voiceToggleEl) this.voiceToggleEl.checked = this.settings.jarvisVoiceEnabled;
		if (!this.micBtn) return;
		const enabled = this.settings.jarvisVoiceEnabled;
		const sttConfigured = this.settings.jarvisSttEngine !== "off";
		const sttAvailable = MicStt.available();
		const canListen = enabled && sttConfigured && sttAvailable;
		this.micBtn.toggleAttribute("disabled", !canListen);
		if (!enabled) this.micBtn.setAttribute("title", "先开启底栏「语音」开关");
		else if (!sttConfigured) this.micBtn.setAttribute("title", "语音识别已在设置中关闭");
		else if (!sttAvailable) this.micBtn.setAttribute("title", "此环境无 WebSpeech 语音识别");
		else this.micBtn.removeAttribute("title");
	}

	private persist(): void {
		if (!this.save) return;
		this.settings.jarvisTabsJson = this.store.toJson();
		void this.save();
	}

	// ---------- 权限审批 UI ----------
	private askPermission(live: LiveTab, req: PermissionAsk): Promise<PermissionResult> {
		return new Promise<PermissionResult>((resolve) => {
			const log = live.logEl;
			const card = log.createDiv({ cls: "jv-perm" });
			const title = req.title || `屈原想使用 ${req.displayName || req.toolName}`;
			card.createDiv({ cls: "jv-perm-title", text: `🔐 ${title}` });
			if (req.description) card.createDiv({ cls: "jv-perm-desc", text: req.description });
			card.createEl("pre", { cls: "jv-perm-input" }).setText(this.previewInput(req.toolName, req.input));
			if (req.decisionReason) card.createDiv({ cls: "jv-perm-reason", text: req.decisionReason });

			if (this.settings.jarvisVoiceEnabled && this.isActive(live)) {
				this.tts?.stop();
				this.tts?.feed(`${title}。`);
				this.tts?.flush();
			}

			const row = card.createDiv({ cls: "jv-perm-btns" });
			const done = (result: PermissionResult, label: string, state: string): void => {
				card.addClass("resolved");
				card.setAttribute("data-decision", state);
				row.empty();
				row.createDiv({ cls: "jv-perm-verdict", text: label });
				resolve(result);
			};
			const allow = row.createEl("button", { cls: "jv-btn jv-allow", text: "允许" });
			allow.addEventListener("click", () => done({ behavior: "allow", updatedInput: req.input }, "✓ 已允许", "allow"));
			if (req.suggestions && req.suggestions.length > 0) {
				const remember = row.createEl("button", { cls: "jv-btn jv-remember", text: "允许并记住" });
				remember.addEventListener("click", () =>
					done(
						{ behavior: "allow", updatedInput: req.input, updatedPermissions: req.suggestions as PermissionUpdate[] },
						"✓ 已允许（本会话记住）",
						"allow"
					)
				);
			}
			const deny = row.createEl("button", { cls: "jv-btn jv-deny", text: "拒绝" });
			deny.addEventListener("click", () => done({ behavior: "deny", message: "用户拒绝了此操作" }, "✕ 已拒绝", "deny"));
			log.scrollTop = log.scrollHeight;
		});
	}

	private previewInput(tool: string, input: unknown): string {
		try {
			if (input && typeof input === "object") {
				const o = input as Record<string, unknown>;
				if (typeof o.command === "string") return `$ ${o.command}`;
				if (typeof o.file_path === "string") {
					const head = `${tool}: ${o.file_path}`;
					if (typeof o.content === "string") return `${head}\n${o.content.slice(0, 400)}`;
					return head;
				}
			}
			const s = JSON.stringify(input, null, 2);
			return s.length > 600 ? s.slice(0, 600) + "…" : s;
		} catch {
			return String(input);
		}
	}

	// ---------- 渲染 ----------
	private renderEntriesInto(live: LiveTab): void {
		live.logEl.empty();
		if (live.rec.entries.length === 0) {
			this.renderEmpty(live.logEl);
			return;
		}
		for (const e of live.rec.entries) this.renderEntry(live, e);
	}

	private renderEntry(live: LiveTab, e: LogEntry): void {
		if (e.kind === "user") {
			live.logEl.createDiv({ cls: "jv-msg jv-user" }).createDiv({ cls: "jv-bubble", text: e.text });
		} else if (e.kind === "assistant") {
			live.logEl.createDiv({ cls: "jv-msg jv-assistant" }).createDiv({ cls: "jv-bubble", text: e.text });
		} else if (e.kind === "system") {
			live.logEl.createDiv({ cls: "jv-sysline", text: e.text });
		} else if (e.kind === "tool") {
			const card = live.logEl.createDiv({ cls: "jv-tool" });
			const headEl = card.createDiv({ cls: "jv-tool-head" });
			setIcon(headEl.createSpan({ cls: "jv-tool-icon" }), this.toolIcon(e.text));
			headEl.createSpan({ cls: "jv-tool-name", text: e.text });
			if (e.toolInput) card.createEl("pre", { cls: "jv-tool-input", text: e.toolInput });
			if (e.toolOutput !== undefined) {
				card.addClass(e.toolError ? "tool-error" : "tool-ok");
				card.createEl("pre", { cls: "jv-tool-out" }).setText(e.toolOutput);
			}
		}
	}

	private renderEmpty(logEl: HTMLElement): void {
		logEl.empty();
		const welcome = logEl.createDiv({ cls: "empty jv-welcome" });
		const card = welcome.createDiv({ cls: "jv-welcome-card" });
		card.createDiv({ cls: "jv-welcome-eyebrow", text: "屈原 · 新对话" });
		card.createEl("strong", { cls: "jv-welcome-title", text: "来，落一笔。" });
		card.createDiv({ cls: "jv-welcome-subtitle", text: "剩下的，我们一起想透。" });
	}

	private clearEmpty(live: LiveTab): void {
		const e = live.logEl.querySelector(".empty");
		if (e) e.remove();
	}

	private addUserLine(live: LiveTab, text: string, imageCount = 0): void {
		this.clearEmpty(live);
		const shown = imageCount > 0 ? `${text}${text ? "\n" : ""}📎 ${imageCount} 张图` : text;
		live.logEl.createDiv({ cls: "jv-msg jv-user" }).createDiv({ cls: "jv-bubble", text: shown });
		live.logEl.scrollTop = live.logEl.scrollHeight;
		this.store.appendEntry(live.rec.id, { kind: "user", text: shown });
		// 首条用户输入作标题
		const titleSrc = text || "图片对话";
		if (live.rec.title === "新对话") {
			this.store.rename(live.rec.id, titleSrc.length > 16 ? titleSrc.slice(0, 16) + "…" : titleSrc);
			this.renderTabBar();
			this.persist();
		}
	}

	private addSystemLine(live: LiveTab, text: string): void {
		this.clearEmpty(live);
		live.logEl.createDiv({ cls: "jv-sysline", text });
		live.logEl.scrollTop = live.logEl.scrollHeight;
		this.store.appendEntry(live.rec.id, { kind: "system", text });
	}

	private appendAssistantDelta(live: LiveTab, delta: string): void {
		this.clearEmpty(live);
		this.finalizeThinking(live); // 思考结束、正文开始 → 折叠思考块
		if (!live.curAssistantEl) {
			const row = live.logEl.createDiv({ cls: "jv-msg jv-assistant" });
			live.curAssistantEl = row.createDiv({ cls: "jv-bubble jv-streaming" });
			live.curAssistantText = "";
		}
		live.curAssistantText += delta;
		live.curAssistantEl.setText(live.curAssistantText);
		live.logEl.scrollTop = live.logEl.scrollHeight;
	}

	private finalizeAssistant(live: LiveTab): void {
		if (live.curAssistantEl) {
			live.curAssistantEl.removeClass("jv-streaming");
			if (live.curAssistantText.trim()) this.store.appendEntry(live.rec.id, { kind: "assistant", text: live.curAssistantText });
		}
		live.curAssistantEl = null;
		live.curAssistantText = "";
	}

	private renderToolUse(live: LiveTab, t: ToolUseEvent): void {
		this.finalizeAssistant(live);
		this.finalizeThinking(live);
		this.clearEmpty(live);
		const card = live.logEl.createDiv({ cls: "jv-tool" });
		const headEl = card.createDiv({ cls: "jv-tool-head" });
		setIcon(headEl.createSpan({ cls: "jv-tool-icon" }), this.toolIcon(t.name));
		headEl.createSpan({ cls: "jv-tool-name", text: t.name });
		const inputPreview = this.previewInput(t.name, t.input);
		card.createEl("pre", { cls: "jv-tool-input", text: inputPreview });
		live.toolEls.set(t.id, card);
		const entry = this.store.appendEntry(live.rec.id, { kind: "tool", text: t.name, toolInput: inputPreview });
		if (entry) live.toolEntry.set(t.id, entry);
		live.logEl.scrollTop = live.logEl.scrollHeight;
	}

	private renderToolResult(live: LiveTab, id: string, content: unknown, isError: boolean): void {
		const card = live.toolEls.get(id);
		let txt = "";
		if (typeof content === "string") txt = content;
		else if (Array.isArray(content)) {
			txt = content
				.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
				.join("");
		} else txt = JSON.stringify(content);
		const shown = txt.length > 800 ? txt.slice(0, 800) + "…" : txt;
		if (card) {
			card.addClass(isError ? "tool-error" : "tool-ok");
			card.createEl("pre", { cls: "jv-tool-out" }).setText(shown);
		}
		const entry = live.toolEntry.get(id);
		if (entry) {
			entry.toolOutput = shown;
			entry.toolError = isError;
		}
	}

	private toolIcon(name: string): string {
		const n = name.toLowerCase();
		if (n.includes("bash")) return "terminal";
		if (n.includes("read")) return "file-text";
		if (n.includes("write") || n.includes("edit")) return "pencil";
		if (n.includes("grep") || n.includes("glob") || n.includes("search")) return "search";
		if (n.includes("web")) return "globe";
		return "wrench";
	}

	// ---------- 思考折叠块 ----------
	private appendThinkingDelta(live: LiveTab, delta: string): void {
		this.clearEmpty(live);
		if (!live.curThinkEl) {
			const det = live.logEl.createEl("details", { cls: "jv-think" });
			det.setAttribute("open", "");
			det.createEl("summary", { text: "💭 思考" });
			live.curThinkEl = det.createEl("pre", { cls: "jv-think-pre" });
			live.curThinkText = "";
		}
		live.curThinkText += delta;
		live.curThinkEl.setText(live.curThinkText);
		live.logEl.scrollTop = live.logEl.scrollHeight;
	}

	private finalizeThinking(live: LiveTab): void {
		if (live.curThinkEl) {
			const det = live.curThinkEl.closest("details");
			if (det) det.removeAttribute("open"); // 正文开始即折叠
		}
		live.curThinkEl = null;
		live.curThinkText = "";
	}

	// ---------- @提及文件 ----------
	private onInput(): void {
		const ta = this.inputEl;
		if (!ta) return;
		// 斜杠命令：整个输入以 / 开头且尚无空格
		const slash = ta.value.match(/^\/(\S*)$/);
		if (slash) {
			this.hideMentions();
			this.showSlash(slash[1] ?? "");
			return;
		}
		this.hideSlash();
		const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
		const m = before.match(/@([^\s@[\]]*)$/);
		if (m) this.showMentions(m[1] ?? "");
		else this.hideMentions();
	}

	private showMentions(query: string): void {
		const box = this.mentionEl;
		if (!box) return;
		const files = this.mentionPicker.suggest(query);
		box.empty();
		if (files.length === 0) {
			this.hideMentions();
			return;
		}
		for (const f of files) {
			const item = box.createDiv({ cls: "jv-mention-item" });
			item.createSpan({ cls: "jv-mention-name", text: f.basename });
			item.createSpan({ cls: "jv-mention-path", text: f.path });
			item.addEventListener("mousedown", (ev) => {
				ev.preventDefault(); // 防 textarea 失焦
				this.applyMention(f.path);
			});
		}
		box.style.display = "block";
	}

	private hideMentions(): void {
		if (this.mentionEl) {
			this.mentionEl.empty();
			this.mentionEl.style.display = "none";
		}
	}

	private applyMention(path: string): void {
		const ta = this.inputEl;
		if (!ta) return;
		const pos = ta.selectionStart ?? ta.value.length;
		const before = ta.value.slice(0, pos).replace(/@([^\s@[\]]*)$/, `[[${path}]] `);
		const after = ta.value.slice(pos);
		ta.value = before + after;
		ta.focus();
		ta.setSelectionRange(before.length, before.length);
		this.hideMentions();
	}

	// ---------- 斜杠命令 ----------
	private showSlash(query: string): void {
		const box = this.slashEl;
		if (!box) return;
		const cmds = this.cmdRegistry.suggest(query);
		box.empty();
		if (cmds.length === 0) {
			this.hideSlash();
			return;
		}
		for (const c of cmds) {
			const item = box.createDiv({ cls: "jv-mention-item" });
			item.createSpan({ cls: "jv-mention-name", text: `/${c.name}` });
			item.createSpan({ cls: "jv-mention-path", text: c.description });
			item.addEventListener("mousedown", (ev) => {
				ev.preventDefault();
				this.applySlash(c.name);
			});
		}
		box.style.display = "block";
	}

	private hideSlash(): void {
		if (this.slashEl) {
			this.slashEl.empty();
			this.slashEl.style.display = "none";
		}
	}

	private applySlash(name: string): void {
		const ta = this.inputEl;
		if (!ta) return;
		ta.value = `/${name} `;
		ta.focus();
		ta.setSelectionRange(ta.value.length, ta.value.length);
		this.hideSlash();
	}

	// ---------- 能力透出（斜杠 / 子智能体 / MCP）----------
	private async toggleCaps(): Promise<void> {
		const box = this.capsEl;
		if (!box) return;
		if (box.style.display !== "none") {
			box.style.display = "none";
			return;
		}
		box.empty();
		const caps = await readCapabilities(this.app, this.cmdRegistry.list().map((c) => c.name));
		this.renderCapsGroup(box, "斜杠命令", caps.commands, true);
		this.renderCapsGroup(box, "子智能体", caps.agents, false);
		this.renderCapsGroup(box, "MCP 服务", caps.mcp, false);
		if (caps.commands.length + caps.agents.length + caps.mcp.length === 0) {
			box.createDiv({ cls: "jv-caps-note", text: "库内未发现 .claude/commands、.claude/agents 或 .mcp.json。" });
		} else if (this.settings.engineProvider !== "claude-cli") {
			box.createDiv({ cls: "jv-caps-note", text: "直连通道下斜杠命令可用；子智能体编排与 MCP 执行当前为 CLI 通道专属。" });
		}
		box.style.display = "block";
	}

	private renderCapsGroup(box: HTMLElement, label: string, items: string[], clickable: boolean): void {
		const sec = box.createDiv({ cls: "jv-caps-group" });
		sec.createDiv({ cls: "jv-caps-label", text: `${label}（${items.length}）` });
		if (items.length === 0) return;
		const row = sec.createDiv({ cls: "jv-caps-items" });
		for (const it of items) {
			const chip = row.createSpan({ cls: "jv-caps-chip" + (clickable ? " is-click" : ""), text: clickable ? `/${it}` : it });
			if (clickable) {
				chip.addEventListener("click", () => {
					this.applySlash(it);
					if (this.capsEl) this.capsEl.style.display = "none";
				});
			}
		}
	}

	// ---------- 图片附件 ----------
	private onPaste(ev: ClipboardEvent): void {
		const items = ev.clipboardData?.items;
		if (!items) return;
		const imgs: File[] = [];
		for (const it of Array.from(items)) {
			if (it.type.startsWith("image/")) {
				const f = it.getAsFile();
				if (f) imgs.push(f);
			}
		}
		if (imgs.length > 0) {
			ev.preventDefault();
			void this.addImages(imgs);
		}
	}

	private async addImages(files: File[]): Promise<void> {
		for (const f of files) {
			if (!f.type.startsWith("image/")) continue;
			try {
				const dataB64 = await fileToBase64(f);
				this.pendingImages.push({ mime: f.type, dataB64, name: f.name || "image" });
			} catch {
				/* 跳过坏图 */
			}
		}
		this.renderAttachChips();
	}

	private renderAttachChips(): void {
		const bar = this.attachBarEl;
		if (!bar) return;
		bar.empty();
		if (this.pendingImages.length === 0) {
			bar.style.display = "none";
			return;
		}
		bar.style.display = "flex";
		this.pendingImages.forEach((img, idx) => {
			const chip = bar.createDiv({ cls: "jv-attach-chip" });
			chip.createSpan({ cls: "jv-attach-name", text: `🖼 ${img.name}` });
			const x = chip.createSpan({ cls: "jv-attach-close", text: "×" });
			x.addEventListener("click", () => {
				this.pendingImages.splice(idx, 1);
				this.renderAttachChips();
			});
		});
	}

	// ---------- 底栏：模型 / YOLO ----------
	private modelListFor(provider: string): { value: string; label: string }[] {
		if (provider === "codex") {
			return [
				{ value: "gpt-4o", label: "gpt-4o" },
				{ value: "gpt-5-codex", label: "gpt-5-codex" },
				{ value: "gpt-5", label: "gpt-5" },
				{ value: "gpt-4.1", label: "gpt-4.1" },
			];
		}
		if (provider === "claude-api") {
			return [
				{ value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
				{ value: "claude-opus-4-8", label: "Opus 4.8" },
				{ value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
			];
		}
		return [
			{ value: "", label: "CLI 默认" },
			{ value: "sonnet", label: "sonnet" },
			{ value: "opus", label: "opus" },
			{ value: "haiku", label: "haiku" },
		];
	}

	private populateModelSel(): void {
		const sel = this.modelSel;
		if (!sel) return;
		sel.empty();
		const provider = this.settings.engineProvider;
		const cur = provider === "codex" ? this.settings.openaiModel : this.settings.jarvisModel;
		const models = this.modelListFor(provider);
		if (cur && !models.some((m) => m.value === cur)) models.unshift({ value: cur, label: cur });
		for (const m of models) sel.createEl("option", { text: m.label }).value = m.value;
		sel.value = cur;
	}

	private async onModelChange(): Promise<void> {
		const v = this.modelSel?.value ?? "";
		if (this.settings.engineProvider === "codex") this.settings.openaiModel = v;
		else this.settings.jarvisModel = v;
		await this.save?.();
		// 重建当前标签引擎以应用新模型（转写保留，下次发送按历史 seed/resume）
		const live = this.activeLive();
		if (live) {
			live.engine?.dispose();
			live.engine = null;
			live.seeded = false;
		}
		this.setStatus(`模型已切换：${v || "默认"}`, "idle");
	}

	private onYolo(on: boolean): void {
		const mode = on ? "bypassPermissions" : "default";
		this.settings.jarvisPermissionMode = mode;
		void this.save?.();
		if (this.modeSel) this.modeSel.value = mode;
		void this.activeLive()?.engine?.setPermissionMode(mode);
	}

	private setStatus(text: string, state: string): void {
		if (!this.statusEl) return;
		this.statusEl.setText(text);
		this.statusEl.setAttribute("data-state", state);
	}
}
