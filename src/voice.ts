import { App, FileSystemAdapter, Notice, requestUrl } from "obsidian";
import type { TalosSettings } from "./settings";

// ============================================================
// 屈原语音助手（一期）
//   形象：SVG 角色（眨眼 / 表情 / 口型），Live2D 接入槽预留
//   大脑：spawn `claude -p`（cwd = 库根，懂全库、可读写）
//   语音：speechSynthesis 朗读 + 说话时口型联动
//   交互：文字提问 / 语音回答（半双工，全双工见二期）
// ============================================================

const SVG_NS = "http://www.w3.org/2000/svg";
const BRAIN_TIMEOUT_MS = 300_000;
const MAX_HISTORY_TURNS = 6;

type AvatarState = "idle" | "thinking" | "speaking" | "listening" | "error";

interface ChatMessage {
	role: "user" | "assistant";
	text: string;
}

interface SpawnLike {
	stdout: { on(ev: "data", cb: (d: Buffer) => void): void } | null;
	stderr: { on(ev: "data", cb: (d: Buffer) => void): void } | null;
	stdin: { write(s: string): void; end(): void; on(ev: "error", cb: (e: Error) => void): void } | null;
	on(ev: "close", cb: (code: number | null) => void): void;
	on(ev: "error", cb: (err: Error) => void): void;
	kill(): void;
}
type SpawnFn = (
	bin: string,
	args: string[],
	opts: { cwd: string; shell: boolean; env?: Record<string, string> }
) => SpawnLike;

// 用登录 shell 捞一次完整环境变量（含 ~/.zshrc 里的 ANTHROPIC_BASE_URL/TOKEN 等）。
// GUI（Dock）启动的 Obsidian 默认拿不到 shell 环境，导致 spawn 的 claude 连不上模型而卡死。
let cachedShellEnv: Record<string, string> | null = null;
function getShellEnv(spawnFn: SpawnFn, cwd: string): Promise<Record<string, string>> {
	const base: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) if (v != null) base[k] = v;
	if (cachedShellEnv) return Promise.resolve(cachedShellEnv);
	// Windows：GUI 进程直接继承用户环境变量，无需（也没有）登录 shell 可捞
	if (process.platform === "win32") {
		cachedShellEnv = base;
		return Promise.resolve(base);
	}
	return new Promise((resolve) => {
		let out = "";
		let settled = false;
		const finish = (env: Record<string, string>): void => {
			if (settled) return;
			settled = true;
			cachedShellEnv = env;
			resolve(env);
		};
		try {
			const shell = base.SHELL || "/bin/zsh";
			const child = spawnFn(shell, ["-lic", "env"], { cwd, shell: false });
			child.stdout?.on("data", (d) => (out += d.toString()));
			child.on("error", () => finish(base));
			child.on("close", () => {
				const env: Record<string, string> = { ...base };
				for (const line of out.split("\n")) {
					const eq = line.indexOf("=");
					if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
				}
				finish(env);
			});
			window.setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish(base); }, 6000);
		} catch {
			finish(base);
		}
	});
}

function svgEl(
	doc: Document,
	tag: string,
	attrs: Record<string, string>
): SVGElement {
	const el = doc.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	return el;
}

// ---------- 角色形象 ----------
class CharacterAvatar {
	private root: HTMLElement;
	private host: HTMLElement;
	private state: AvatarState = "idle";

	constructor(host: HTMLElement, settings: TalosSettings) {
		this.host = host;
		this.root = host.createDiv({ cls: "jv-avatar is-idle" });
		const live2d = settings.live2dModelPath.trim();
		if (live2d) {
			// Live2D 接入槽：运行时（PIXI + Live2DCubismCore）未随插件打包，
			// 检测到全局运行时与模型路径后才切换；否则回退 SVG 角色。
			const w = host.ownerDocument.defaultView as unknown as Record<string, unknown>;
			const ready = Boolean(w?.["PIXI"]) && Boolean(w?.["Live2DCubismCore"]);
			if (!ready) {
				this.buildSvg();
				this.root.createDiv({
					cls: "jv-live2d-hint",
					text: "Live2D 待接入：未检测到 PIXI / Live2DCubismCore 运行时，暂用 SVG 角色",
				});
				return;
			}
			// 运行时就绪时的挂载留待一期 b（见 _README）。
			this.buildSvg();
			return;
		}
		this.buildSvg();
	}

	private buildSvg(): void {
		const doc = this.host.ownerDocument;
		const stage = this.root.createDiv({ cls: "jv-rings" });
		for (const r of ["r1", "r2", "r3"]) stage.createEl("i", { cls: `jv-ring ${r}` });

		const svg = svgEl(doc, "svg", { viewBox: "0 0 200 224", class: "jv-face" });
		// 天线
		svg.appendChild(svgEl(doc, "line", { x1: "100", y1: "30", x2: "100", y2: "52", class: "jv-antenna" }));
		svg.appendChild(svgEl(doc, "circle", { cx: "100", cy: "26", r: "6", class: "jv-antenna-dot" }));
		// 侧传感器
		svg.appendChild(svgEl(doc, "rect", { x: "24", y: "106", width: "12", height: "34", rx: "6", class: "jv-ear" }));
		svg.appendChild(svgEl(doc, "rect", { x: "164", y: "106", width: "12", height: "34", rx: "6", class: "jv-ear" }));
		// 头 + 面罩
		svg.appendChild(svgEl(doc, "rect", { x: "40", y: "54", width: "120", height: "128", rx: "42", class: "jv-head" }));
		svg.appendChild(svgEl(doc, "rect", { x: "54", y: "72", width: "92", height: "94", rx: "34", class: "jv-visor" }));
		// 额心
		svg.appendChild(svgEl(doc, "circle", { cx: "100", cy: "86", r: "5", class: "jv-core" }));
		// 眼（眼球 + 高光，成组眨眼）
		const mkEye = (cx: number, side: string): SVGElement => {
			const g = svgEl(doc, "g", { class: `jv-eye ${side}` });
			g.appendChild(svgEl(doc, "ellipse", { cx: String(cx), cy: "118", rx: "11", ry: "14", class: "jv-eyeball" }));
			g.appendChild(svgEl(doc, "circle", { cx: String(cx + 3), cy: "113", r: "3.4", class: "jv-eyehl" }));
			return g;
		};
		svg.appendChild(mkEye(78, "jv-eye-l"));
		svg.appendChild(mkEye(122, "jv-eye-r"));
		// 嘴：静态微笑 + 说话时张合
		svg.appendChild(svgEl(doc, "path", { d: "M80 144 Q100 158 120 144", class: "jv-smile" }));
		svg.appendChild(svgEl(doc, "ellipse", { cx: "100", cy: "146", rx: "15", ry: "5", class: "jv-talkmouth" }));
		// 思考点
		const dots = svgEl(doc, "g", { class: "jv-think-dots" });
		for (let i = 0; i < 3; i++) {
			dots.appendChild(svgEl(doc, "circle", { cx: String(150 + i * 12), cy: "62", r: "3.5", class: `jv-dot d${i}` }));
		}
		svg.appendChild(dots);
		this.root.appendChild(svg);
	}

	setState(state: AvatarState): void {
		if (this.state === state) return;
		this.root.removeClass(`is-${this.state}`);
		this.root.addClass(`is-${state}`);
		this.state = state;
	}
}

// ---------- 大脑：spawn claude -p ----------
function resolveSpawn(): SpawnFn | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cp = require("child_process") as { spawn: SpawnFn };
		return cp.spawn;
	} catch {
		return null;
	}
}

// 无头模式预授权：标志直接拼进 argv（不走字符串切分，避免引号问题）
const READ_TOOLS = ["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "TodoWrite"];
const WRITE_TOOLS = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"];

function permissionArgs(mode: string): string[] {
	switch (mode) {
		case "readonly":
			// 逗号连成单个值：兼容 --allowedTools 单值/变长两种解析，避免只有首个工具生效
			return ["--allowedTools", READ_TOOLS.join(","), "--disallowedTools", WRITE_TOOLS.join(",")];
		case "acceptEdits":
			return ["--permission-mode", "acceptEdits"];
		case "all":
			return ["--dangerously-skip-permissions"];
		default:
			return [];
	}
}

// ElevenLabs 神经语音：用 Obsidian requestUrl 调接口（避开 CORS），返回 mp3 字节
async function elevenLabsTts(settings: TalosSettings, text: string): Promise<ArrayBuffer> {
	const key = settings.elevenLabsApiKey.trim();
	if (!key) throw new Error("未填 ElevenLabs API Key");
	const voice = settings.elevenLabsVoiceId.trim() || "onwK4e9ZLuTAKqWW03F9";
	const model = settings.elevenLabsModel.trim() || "eleven_turbo_v2_5";
	const res = await requestUrl({
		url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
		method: "POST",
		headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
		body: JSON.stringify({
			text,
			model_id: model,
			voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
		}),
		throw: false,
	});
	if (res.status !== 200) throw new Error(`ElevenLabs ${res.status}: ${(res.text || "").slice(0, 160)}`);
	return res.arrayBuffer;
}

// 阿里云千问 TTS（DashScope/百炼）：POST 拿音频 URL，再交给 Audio 播放
async function aliyunTtsUrl(settings: TalosSettings, text: string): Promise<string> {
	const key = settings.aliyunApiKey.trim();
	if (!key) throw new Error("未填阿里云 API Key");
	const voice = settings.aliyunVoice.trim() || "Andre";
	const model = settings.aliyunModel.trim() || "qwen3-tts-flash";
	const res = await requestUrl({
		url: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model, input: { text, voice, language_type: "Chinese" } }),
		throw: false,
	});
	if (res.status !== 200) throw new Error(`阿里云 ${res.status}: ${(res.text || "").slice(0, 160)}`);
	const url = (res.json as { output?: { audio?: { url?: string } } })?.output?.audio?.url;
	if (!url) throw new Error("阿里云返回无音频 URL");
	return url;
}

function buildPrompt(settings: TalosSettings, history: ChatMessage[], question: string): string {
	const persona = settings.voicePersona.trim() ||
		"你是屈原，外脑玩家 Haaper 的知识伙伴与战略参谋（人格契约见库内 灵魂/PERSONA）。回答简洁、口语化、可直接朗读；不要用 Markdown 标题或列表符号，用自然短句。";
	const recent = history.slice(-MAX_HISTORY_TURNS);
	const transcript = recent
		.map((m) => `${m.role === "user" ? "用户" : "屈原"}：${m.text}`)
		.join("\n");
	const ctx = transcript ? `\n\n最近对话：\n${transcript}` : "";
	return `${persona}${ctx}\n\n用户：${question}\n屈原：`;
}

async function askBrain(
	app: App,
	settings: TalosSettings,
	history: ChatMessage[],
	question: string,
	onSpawn?: (child: SpawnLike) => void
): Promise<string> {
	const cmd = settings.voiceAgentCommand.trim();
	if (!cmd) throw new Error("未配置语音大脑命令（设置 → Agent 命令 / 语音大脑，如 claude -p）");

	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) throw new Error("语音大脑仅桌面端可用");
	const spawnFn = resolveSpawn();
	if (!spawnFn) throw new Error("语音大脑仅桌面端可用（无法加载 child_process）");

	const parts = cmd.split(/\s+/).filter(Boolean);
	const bin = parts[0] ?? "";
	// prompt 作为参数传（经验证可用）；权限交给库自己的 .claude/settings.json（voicePermission=off 时不注入标志）
	const perm = permissionArgs(settings.voicePermission);
	const args = [...perm, ...parts.slice(1), buildPrompt(settings, history, question)];
	const cwd = adapter.getBasePath();
	const env = await getShellEnv(spawnFn, cwd);
	// Windows：npm 安装的 claude 实为 claude.cmd（批处理垫片），不带 shell 直接 spawn
	// 会 ENOENT/EINVAL；经 cmd.exe /d /s /c 中转执行
	const isWin = typeof process !== "undefined" && process.platform === "win32";
	const spawnBin = isWin ? (env.ComSpec || "cmd.exe") : bin;
	const spawnArgs = isWin ? ["/d", "/s", "/c", bin, ...args] : args;

	return new Promise<string>((resolve, reject) => {
		let out = "";
		let err = "";
		let done = false;
		const child = spawnFn(spawnBin, spawnArgs, { cwd, shell: false, env });
		onSpawn?.(child); // 暴露子进程句柄，供控制器在卸载/换页时中止
		const timer = window.setTimeout(() => {
			if (done) return;
			done = true;
			try { child.kill(); } catch { /* noop */ }
			reject(new Error(`超时（>${Math.round(BRAIN_TIMEOUT_MS / 1000)}s）：claude 未返回；可在设置把「工具权限」切到「不加」、或确认终端里 claude -p 能正常应答`));
		}, BRAIN_TIMEOUT_MS);
		// 关闭 stdin 给 EOF——避免 claude 在任何情况下空等输入而卡死
		try {
			child.stdin?.on("error", () => { /* 忽略 EPIPE */ });
			child.stdin?.end();
		} catch { /* noop */ }
		child.stdout?.on("data", (d) => (out += d.toString()));
		child.stderr?.on("data", (d) => (err += d.toString()));
		child.on("error", (e) => {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			reject(new Error(`无法启动「${bin}」：${e.message}`));
		});
		child.on("close", (code) => {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			const text = out.trim();
			if (code === 0 || text) resolve(text || "(空回复)");
			else reject(new Error(err.trim() || `退出码 ${code ?? "?"}`));
		});
	});
}

// ---------- 控制器 ----------
export class JarvisController {
	private app: App;
	private settings: TalosSettings;
	private messages: ChatMessage[] = [];

	private avatar: CharacterAvatar | null = null;
	private logEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private busy = false;
	private gen = 0; // 代际令牌：卸载/换页时自增，作废在途请求的回调
	private currentChild: SpawnLike | null = null; // 在途 claude -p 子进程，卸载时中止
	private utterers: SpeechSynthesisUtterance[] = []; // 持引用防 GC（分句排队）
	private keepAlive: number | null = null;
	private warming = false; // 思考期间静音保活，绕开自动播放拦截
	private audio: HTMLAudioElement | null = null; // ElevenLabs 音频播放

	constructor(app: App, settings: TalosSettings) {
		this.app = app;
		this.settings = settings;
	}

	mount(container: HTMLElement): void {
		container.empty();
		const wrap = container.createDiv({ cls: "panel jv-panel" });
		wrap.setCssProps({ "--ac": "#38E1FF" });

		const head = wrap.createDiv({ cls: "section-title" });
		head.createEl("h2", { text: "屈原 · 语音助手" });
		head.createEl("small", { text: "claude -p 大脑 · 语音朗读 · 半双工" });

		const stageRow = wrap.createDiv({ cls: "jv-stagerow" });
		const stage = stageRow.createDiv({ cls: "jv-stage" });
		this.avatar = new CharacterAvatar(stage, this.settings);
		const sidePanel = stageRow.createDiv({ cls: "jv-side" });
		this.statusEl = sidePanel.createDiv({ cls: "jv-status" });
		const tips = sidePanel.createDiv({ cls: "jv-tips" });
		tips.createEl("b", { text: "怎么用" });
		tips.createEl("span", { text: "打字提问 → 屈原用 claude 读你的库作答并朗读出来。" });
		tips.createEl("span", { text: "语音输入（开口问）为二期，需配置转写 API。" });

		this.logEl = wrap.createDiv({ cls: "jv-log" });
		this.renderLog();

		const bar = wrap.createDiv({ cls: "jv-inputbar" });
		const ta = bar.createEl("textarea", { cls: "jv-input" });
		ta.setAttribute("rows", "2");
		ta.setAttribute("placeholder", "问屈原…（Enter 发送，Shift+Enter 换行）");
		this.inputEl = ta;
		ta.addEventListener("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Enter" && !ev.shiftKey) {
				ev.preventDefault();
				void this.send();
			}
		});
		const btns = bar.createDiv({ cls: "jv-btns" });
		const mic = btns.createEl("button", { cls: "jv-btn jv-mic", text: "🎙 语音" });
		mic.setAttribute("disabled", "true");
		mic.setAttribute("title", "二期功能：需配置语音转写 API");
		const test = btns.createEl("button", { cls: "jv-btn jv-test", text: "🔊 测试声音" });
		test.addEventListener("click", () => this.speak("屈原语音测试，一二三。", true));
		const stop = btns.createEl("button", { cls: "jv-btn jv-stop", text: "⏹ 停止朗读" });
		stop.addEventListener("click", () => this.stopSpeak());
		const reset = btns.createEl("button", { cls: "jv-btn jv-reset", text: "↺ 重置" });
		reset.addEventListener("click", () => {
			this.stopSpeak();
			this.messages = [];
			this.renderLog();
			this.setStatus("会话已重置", "idle");
		});
		this.sendBtn = btns.createEl("button", { cls: "jv-btn jv-send", text: "发送" });
		this.sendBtn.addEventListener("click", () => void this.send());

		const desktop = this.app.vault.adapter instanceof FileSystemAdapter;
		if (!desktop) this.setStatus("⚠ 仅桌面端可用", "error");
		else if (!this.settings.voiceAgentCommand.trim()) this.setStatus("⚠ 未配置大脑命令（设置里填 claude -p）", "error");
		else if (this.busy) { this.sendBtn.setAttribute("disabled", "true"); this.setStatus("思考中…", "thinking"); }
		else this.setStatus("待命", "idle");
	}

	unmount(): void {
		// 换页/关闭即硬复位运行态：作废在途请求、中止子进程、放掉 busy，
		// 保证下次挂载是干净状态（否则 busy 残留会让 send() 静默早退，表现为「无法输入」）。
		this.gen++;
		this.abortBrain();
		this.busy = false;
		this.stopSpeak(); // cancelSpeech：warming=false、停 keepAlive、停音频/合成
		this.avatar = null;
		this.logEl = null;
		this.statusEl = null;
		this.inputEl = null;
		this.sendBtn = null;
	}

	private abortBrain(): void {
		if (this.currentChild) {
			try { this.currentChild.kill(); } catch { /* noop */ }
			this.currentChild = null;
		}
	}

	private setStatus(text: string, state: AvatarState): void {
		this.avatar?.setState(state);
		if (this.statusEl) {
			this.statusEl.setText(text);
			this.statusEl.setAttribute("data-state", state);
		}
	}

	private renderLog(): void {
		const log = this.logEl;
		if (!log) return;
		log.empty();
		if (this.messages.length === 0) {
			log.createDiv({ cls: "empty", text: "还没有对话。问点什么，比如「我库里关于上下文工程的洞察有哪些？」" });
			return;
		}
		for (const m of this.messages) {
			const row = log.createDiv({ cls: `jv-msg jv-${m.role}` });
			const bubble = row.createDiv({ cls: "jv-bubble", text: m.text });
			if (m.role === "assistant" && !m.text.startsWith("（出错）")) {
				bubble.addClass("jv-replayable");
				bubble.setAttribute("title", "点击重念");
				bubble.addEventListener("click", () => this.speak(m.text));
			}
		}
		log.scrollTop = log.scrollHeight;
	}

	private async send(): Promise<void> {
		if (this.busy) return;
		const ta = this.inputEl;
		if (!ta) return;
		const q = ta.value.trim();
		if (!q) return;
		ta.value = "";
		this.busy = true;
		const myGen = this.gen; // 锁定本次请求的代际，回来后比对是否仍有效
		let myChild: SpawnLike | null = null;
		this.sendBtn?.setAttribute("disabled", "true");
		this.messages.push({ role: "user", text: q });
		this.renderLog();
		this.setStatus("思考中…", "thinking");
		this.startWarmup(); // 在用户手势内启动静音保活，等回答接续播放
		try {
			const answer = await askBrain(this.app, this.settings, this.messages, q, (c) => {
				myChild = c;
				this.currentChild = c;
			});
			if (this.currentChild === myChild) this.currentChild = null;
			if (myGen !== this.gen) return; // 期间已换页/卸载：丢弃结果，不朗读、不动 UI
			this.warming = false; // 停止补充静音句，但不打断当前播放
			this.messages.push({ role: "assistant", text: answer });
			this.renderLog();
			this.speak(answer, false, true); // continued：接在保活音后，无缝衔接
		} catch (e) {
			if (this.currentChild === myChild) this.currentChild = null;
			if (myGen !== this.gen) return; // 同上：卸载后的报错不回灌新面板
			this.cancelSpeech();
			const msg = e instanceof Error ? e.message : String(e);
			this.messages.push({ role: "assistant", text: `（出错）${msg}` });
			this.renderLog();
			this.setStatus(`出错：${msg}`, "error");
			new Notice(`屈原：${msg}`);
		} finally {
			if (myGen === this.gen) { // 仅当仍是当前代际才复位，避免冲掉换页后的新请求
				this.busy = false;
				this.sendBtn?.removeAttribute("disabled");
			}
		}
	}

	// ---------- TTS ----------
	private pickVoice(synth: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
		const want = this.settings.ttsVoice.trim();
		const voices = synth.getVoices();
		return (
			(want && voices.find((v) => v.name === want)) ||
			voices.find((v) => v.lang?.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2))) ||
			null
		);
	}

	// 按句切块：绕开 Chromium「长 utterance 不发声 / 15s 截断」
	private chunkText(text: string): string[] {
		const clean = text.replace(/\s+/g, " ").trim();
		const chunks: string[] = [];
		let buf = "";
		for (const ch of clean) {
			buf += ch;
			if ("。！？!?；;\n".includes(ch)) {
				if (buf.trim()) chunks.push(buf.trim());
				buf = "";
			} else if (buf.length >= 120) {
				const cut = Math.max(buf.lastIndexOf("，"), buf.lastIndexOf(","), buf.lastIndexOf(" "));
				if (cut > 40) { chunks.push(buf.slice(0, cut + 1).trim()); buf = buf.slice(cut + 1); }
				else { chunks.push(buf.trim()); buf = ""; }
			}
		}
		if (buf.trim()) chunks.push(buf.trim());
		return chunks.length ? chunks : [clean];
	}

	// continued=true：不打断当前（保活）播放，把真内容接在队列后无缝衔接
	private usingApiEngine(): boolean {
		const s = this.settings;
		return (
			(s.ttsEngine === "elevenlabs" && !!s.elevenLabsApiKey.trim()) ||
			(s.ttsEngine === "aliyun" && !!s.aliyunApiKey.trim())
		);
	}

	private speak(text: string, isTest = false, continued = false): void {
		// 神经语音引擎
		if (this.settings.ttsEngine === "aliyun" && this.settings.aliyunApiKey.trim()) {
			void this.speakAliyun(text);
			return;
		}
		if (this.settings.ttsEngine === "elevenlabs" && this.settings.elevenLabsApiKey.trim()) {
			void this.speakEleven(text);
			return;
		}
		const synth = window.speechSynthesis;
		if (!synth) { this.setStatus("待命（此环境无语音合成）", "idle"); return; }
		const lang = this.settings.voiceLang || "zh-CN";
		const chunks = this.chunkText(text);

		let started = false;
		const startSpeak = (): void => {
			if (started) return;
			started = true;
			const voice = this.pickVoice(synth, lang);
			this.utterers = [];
			chunks.forEach((chunk, i) => {
				const u = new SpeechSynthesisUtterance(chunk);
				u.lang = lang;
				u.rate = this.settings.ttsRate || 1;
				u.pitch = this.settings.ttsPitch || 1;
				if (voice) u.voice = voice;
				if (i === 0) u.onstart = () => { this.setStatus("说话中…", "speaking"); this.startKeepAlive(); };
				if (i === chunks.length - 1) {
					u.onend = () => { this.stopKeepAlive(); this.utterers = []; this.setStatus("待命", "idle"); };
				}
				u.onerror = (e: SpeechSynthesisErrorEvent) => {
					const code = e.error || "unknown";
					if (code === "interrupted" || code === "canceled") return;
					this.stopKeepAlive();
					this.setStatus(`朗读失败：${code}`, "error");
					new Notice(`屈原朗读失败：${code}`);
				};
				this.utterers.push(u);
				synth.speak(u);
			});
			try { synth.resume(); } catch { /* noop */ }
		};

		if (continued) {
			// 保活音仍在播放：直接把真内容排进队列，引擎不曾停 → 不被拦截
			startSpeak();
			return;
		}

		try { synth.cancel(); } catch { /* noop */ }
		this.stopKeepAlive();
		if (synth.getVoices().length === 0) {
			synth.addEventListener("voiceschanged", () => window.setTimeout(startSpeak, 0), { once: true });
			window.setTimeout(() => { if (!synth.speaking && this.utterers.length === 0) startSpeak(); }, 350);
			if (isTest) new Notice("正在加载系统语音…");
			return;
		}
		// cancel→speak 紧挨着会被 Chromium 丢弃，错开一帧
		window.setTimeout(startSpeak, 60);
	}

	// 思考期间持续播放静音占位句，保住「音频会话」直到回答到达
	private startWarmup(): void {
		// API 语音引擎走音频播放，不需要 speechSynthesis 静音保活
		if (this.usingApiEngine()) return;
		const synth = window.speechSynthesis;
		if (!synth) return;
		try { synth.cancel(); } catch { /* noop */ }
		this.warming = true;
		const loop = (): void => {
			if (!this.warming) return;
			const u = new SpeechSynthesisUtterance(" ");
			u.volume = 0;
			u.onend = () => loop();
			u.onerror = () => { this.warming = false; }; // 出错则停止空转
			this.utterers = [u]; // 持引用防 GC
			try { synth.speak(u); } catch { /* noop */ }
		};
		loop();
		this.startKeepAlive();
	}

	// Chromium ~15s 后自动暂停朗读，定时 resume 续上
	private startKeepAlive(): void {
		this.stopKeepAlive();
		this.keepAlive = window.setInterval(() => {
			const s = window.speechSynthesis;
			if (s && s.speaking) { try { s.resume(); } catch { /* noop */ } }
		}, 8000);
	}

	private stopKeepAlive(): void {
		if (this.keepAlive != null) { window.clearInterval(this.keepAlive); this.keepAlive = null; }
	}

	private cancelSpeech(): void {
		this.warming = false;
		this.utterers = [];
		this.stopKeepAlive();
		this.stopAudio();
		try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
	}

	// ---------- ElevenLabs 播放 ----------
	private async speakEleven(text: string): Promise<void> {
		this.setStatus("合成中…", "thinking");
		try {
			const buf = await elevenLabsTts(this.settings, text);
			this.stopAudio();
			const blob = new Blob([buf], { type: "audio/mpeg" });
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			this.audio = audio;
			audio.onplay = () => this.setStatus("说话中…", "speaking");
			audio.onended = () => {
				this.setStatus("待命", "idle");
				URL.revokeObjectURL(url);
				if (this.audio === audio) this.audio = null;
			};
			audio.onerror = () => { this.setStatus("待命", "idle"); URL.revokeObjectURL(url); };
			await audio.play();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.setStatus(`语音失败：${msg}`, "error");
			new Notice(`ElevenLabs 失败：${msg}（可点气泡重念，或检查 key/额度）`);
		}
	}

	private async speakAliyun(text: string): Promise<void> {
		this.setStatus("合成中…", "thinking");
		try {
			const url = await aliyunTtsUrl(this.settings, text);
			this.stopAudio();
			const audio = new Audio(url);
			this.audio = audio;
			audio.onplay = () => this.setStatus("说话中…", "speaking");
			audio.onended = () => { this.setStatus("待命", "idle"); if (this.audio === audio) this.audio = null; };
			audio.onerror = () => this.setStatus("待命", "idle");
			await audio.play();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.setStatus(`语音失败：${msg}`, "error");
			new Notice(`阿里云语音失败：${msg}（可点气泡重念，或检查 key/额度）`);
		}
	}

	private stopAudio(): void {
		if (this.audio) {
			try { this.audio.pause(); } catch { /* noop */ }
			this.audio = null;
		}
	}

	private stopSpeak(): void {
		this.cancelSpeech();
		this.setStatus("待命", "idle");
	}
}
