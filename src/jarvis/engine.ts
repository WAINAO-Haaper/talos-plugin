import { App, FileSystemAdapter } from "obsidian";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
	Query,
	SDKMessage,
	SDKUserMessage,
	Options,
	PermissionResult,
	PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type { TalosSettings } from "../settings";
import type { JarvisEvents, SystemInitEvent, Engine, UserTurn } from "./engine-types";
import { contextWindowFor } from "./engine-types";
// 事件 DTO 与 Engine 接口已抽到 ./engine-types；此处 re-export 保持既有 `from "./engine"` 导入不破
export type {
	ToolUseEvent,
	ToolResultEvent,
	PermissionAsk,
	ResultEvent,
	SystemInitEvent,
	JarvisEvents,
} from "./engine-types";

// ============================================================
// 屈原 · agentic 引擎（B 方案核心）
//   把 @anthropic-ai/claude-agent-sdk 的 query() 包成持久流式会话：
//   - 流式输入（AsyncIterable<SDKUserMessage>）→ 单会话多轮 + 可中断/改权限
//   - 事件分发：system/init、流式文本增量、assistant 文本、tool_use、
//     tool_result、permission 请求、result 收尾
//   - 运行态全部内聚在此，UI 只订阅事件
// ============================================================

// —— 事件 DTO / JarvisEvents 已移至 ./engine-types，本文件通过上方 import + re-export 复用 ——

// 解析 claude CLI 可执行路径 + 登录 shell 环境（GUI 启动的 Obsidian 拿不到 ~/.zshrc 的 env）
interface ResolvedRuntime {
	bin: string;
	env: Record<string, string>;
}

let cachedRuntime: ResolvedRuntime | null = null;

function resolveSpawn():
	| ((bin: string, args: string[], opts: { cwd: string; shell: boolean }) => {
			stdout: { on(ev: "data", cb: (d: Buffer) => void): void } | null;
			on(ev: "close" | "error", cb: (a: unknown) => void): void;
			kill(): void;
	  })
	| null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cp = require("child_process");
		return cp.spawn;
	} catch {
		return null;
	}
}

// 用登录 shell 捞 env + which claude，缓存一次。setting 里显式填了 bin 就直接用。
async function resolveRuntime(settings: TalosSettings, cwd: string): Promise<ResolvedRuntime> {
	if (cachedRuntime) return cachedRuntime;
	const base: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) if (v != null) base[k] = v;

	const explicit = (settings.jarvisClaudeBin || "").trim();
	const spawn = resolveSpawn();
	if (!spawn) {
		const rt = { bin: explicit || "claude", env: base };
		cachedRuntime = rt;
		return rt;
	}

	return new Promise<ResolvedRuntime>((resolve) => {
		let out = "";
		let settled = false;
		const finish = (rt: ResolvedRuntime): void => {
			if (settled) return;
			settled = true;
			cachedRuntime = rt;
			resolve(rt);
		};
		try {
			if (process.platform === "win32") {
				// Windows：GUI 进程直接继承用户环境变量，无需登录 shell 捞 env；
				// claude 路径用 where.exe 探测（结果多为 claude.cmd/claude.exe）。
				const child = spawn("where", ["claude"], { cwd, shell: false });
				child.stdout?.on("data", (d) => (out += (d).toString()));
				child.on("error", () => finish({ bin: explicit || "claude", env: base }));
				child.on("close", () => {
					const detected = out
						.split(/\r?\n/)
						.map((line) => line.trim())
						.filter(Boolean)[0] || "";
					finish({ bin: explicit || detected || "claude", env: base });
				});
				window.setTimeout(() => {
					try { child.kill(); } catch { /* noop */ }
					finish({ bin: explicit || "claude", env: base });
				}, 6000);
				return;
			}
			const shell = base.SHELL || "/bin/zsh";
			// 一次性把完整 env 和 claude 路径都捞回来
			const child = spawn(shell, ["-lic", "env; echo __BIN__; command -v claude"], {
				cwd,
				shell: false,
			});
			child.stdout?.on("data", (d) => (out += (d).toString()));
			child.on("error", () => finish({ bin: explicit || "claude", env: base }));
			child.on("close", () => {
				const env: Record<string, string> = { ...base };
				const [envPart, binPart] = out.split("__BIN__");
				for (const line of (envPart || "").split("\n")) {
					const eq = line.indexOf("=");
					if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
				}
				const detected = (binPart || "").trim().split("\n").pop()?.trim() || "";
				finish({ bin: explicit || detected || "claude", env });
			});
			window.setTimeout(() => {
				try { child.kill(); } catch { /* noop */ }
				finish({ bin: explicit || "claude", env: base });
			}, 6000);
		} catch {
			finish({ bin: explicit || "claude", env: base });
		}
	});
}

// UserTurn → SDK 消息 content：纯文字用 string，带图用 Anthropic content blocks
function buildSdkContent(text: string, images?: { mime: string; dataB64: string }[]): string | unknown[] {
	if (images && images.length > 0) {
		return [
			{ type: "text", text },
			...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.dataB64 } })),
		];
	}
	return text;
}

export class SdkCliEngine implements Engine {
	private app: App;
	private settings: TalosSettings;
	private ev: JarvisEvents;

	private q: Query | null = null;
	private sessionId: string | null = null;
	private resumeId: string | null = null;
	private model = "";
	private busy = false;
	private closed = false;

	// 输入队列：实现 AsyncIterable<SDKUserMessage>，让会话常驻、按需续传
	private inbox: SDKUserMessage[] = [];
	private waiter: ((m: IteratorResult<SDKUserMessage>) => void) | null = null;
	private ended = false;

	constructor(app: App, settings: TalosSettings, ev: JarvisEvents) {
		this.app = app;
		this.settings = settings;
		this.ev = ev;
	}

	isBusy(): boolean {
		return this.busy;
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	private setBusy(b: boolean): void {
		if (this.busy === b) return;
		this.busy = b;
		this.ev.onBusyChange?.(b);
	}

	// ---- 输入流 ----
	private nextUserMessage(): Promise<IteratorResult<SDKUserMessage>> {
		if (this.inbox.length > 0) {
			const m = this.inbox.shift() as SDKUserMessage;
			return Promise.resolve({ value: m, done: false });
		}
		if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
		return new Promise((resolve) => (this.waiter = resolve));
	}

	private pushUser(content: string | unknown[]): void {
		const msg = {
			type: "user",
			message: { role: "user", content },
			parent_tool_use_id: null,
			session_id: this.sessionId ?? "",
		} as unknown as SDKUserMessage;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w({ value: msg, done: false });
		} else {
			this.inbox.push(msg);
		}
	}

	// ---- 生命周期 ----
	async start(): Promise<void> {
		if (this.q) return;
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			this.ev.onError?.(new Error("屈原仅桌面端可用"));
			return;
		}
		const cwd = adapter.getBasePath();
		const rt = await resolveRuntime(this.settings, cwd);

		const self = this;
		const inputStream: AsyncIterable<SDKUserMessage> = {
			[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
				return { next: () => self.nextUserMessage() };
			},
		};

		const mode = (this.settings.jarvisPermissionMode || "default") as PermissionMode;
		const options: Options = {
			cwd,
			additionalDirectories: [],
			pathToClaudeCodeExecutable: rt.bin,
			env: rt.env,
			permissionMode: mode,
			includePartialMessages: true,
			settingSources: ["user", "project", "local"],
			stderr: (data: string) => {
				const s = String(data).trim();
				if (s) this.ev.onError?.(new Error(`CLI: ${s.slice(0, 300)}`));
			},
			canUseTool: async (toolName, input, opts) => {
				if (!this.ev.onPermissionRequest) {
					return { behavior: "allow", updatedInput: input };
				}
				return this.ev.onPermissionRequest({
					toolUseID: opts.toolUseID,
					toolName,
					input,
					title: opts.title,
					displayName: opts.displayName,
					description: opts.description,
					blockedPath: opts.blockedPath,
					decisionReason: opts.decisionReason,
					suggestions: opts.suggestions,
				});
			},
		};
		if (this.settings.jarvisModel?.trim()) options.model = this.settings.jarvisModel.trim();
		if (this.resumeId) options.resume = this.resumeId; // 跨重启续接 CLI 会话（P3.1）

		try {
			this.q = query({ prompt: inputStream, options });
			void this.pump();
		} catch (e) {
			this.ev.onError?.(e instanceof Error ? e : new Error(String(e)));
		}
	}

	send(turn: UserTurn): void {
		const text = turn.text.trim();
		const hasImg = !!(turn.images && turn.images.length);
		if ((!text && !hasImg) || this.closed) return;
		const content = buildSdkContent(text, turn.images);
		if (!this.q) {
			// 懒启动：第一次发送时拉起会话
			void this.start().then(() => {
				this.setBusy(true);
				this.pushUser(content);
			});
			return;
		}
		this.setBusy(true);
		this.pushUser(content);
	}

	async interrupt(): Promise<void> {
		try {
			await this.q?.interrupt();
		} catch { /* noop */ }
		this.setBusy(false);
	}

	async setPermissionMode(mode: PermissionMode): Promise<void> {
		try {
			await this.q?.setPermissionMode(mode);
		} catch { /* noop */ }
	}

	// 跨重启恢复：start() 前设好 sessionId，query 以 resume 续接 CLI 会话
	resume(sessionId: string): void {
		if (!this.q) this.resumeId = sessionId;
	}

	dispose(): void {
		this.closed = true;
		this.ended = true;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w({ value: undefined as never, done: true });
		}
		try {
			void this.q?.interrupt();
		} catch { /* noop */ }
		this.q = null;
	}

	// ---- 主循环：消费 SDK 流式消息 ----
	private async pump(): Promise<void> {
		if (!this.q) return;
		try {
			for await (const msg of this.q as AsyncGenerator<SDKMessage>) {
				if (this.closed) break;
				this.dispatch(msg);
			}
		} catch (e) {
			if (!this.closed) this.ev.onError?.(e instanceof Error ? e : new Error(String(e)));
		} finally {
			this.setBusy(false);
		}
	}

	private dispatch(msg: SDKMessage): void {
		switch (msg.type) {
			case "system": {
				if ((msg as { subtype?: string }).subtype === "init") {
					const m = msg as unknown as SystemInitEvent & { session_id: string };
					this.sessionId = (msg as { session_id?: string }).session_id ?? this.sessionId;
					this.model = (m as unknown as { model?: string }).model ?? this.model;
					this.ev.onSystemInit?.({
						sessionId: this.sessionId ?? "",
						model: (m as unknown as { model: string }).model,
						tools: (m as unknown as { tools: string[] }).tools ?? [],
						cwd: (m as unknown as { cwd: string }).cwd ?? "",
						permissionMode: (m as unknown as { permissionMode: string }).permissionMode ?? "default",
					});
				}
				break;
			}
			case "stream_event": {
				const ev = (msg as unknown as { event: { type: string; delta?: { type: string; text?: string; thinking?: string } } }).event;
				if (ev?.type === "content_block_delta" && ev.delta) {
					if (ev.delta.type === "text_delta" && ev.delta.text) this.ev.onTextDelta?.(ev.delta.text);
					else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) this.ev.onThinkingDelta?.(ev.delta.thinking);
				}
				break;
			}
			case "assistant": {
				const content = (msg as unknown as { message: { content: unknown } }).message?.content;
				if (Array.isArray(content)) {
					for (const block of content as Array<Record<string, unknown>>) {
						if (block.type === "text" && typeof block.text === "string") {
							this.ev.onAssistantText?.(block.text);
						} else if (block.type === "tool_use") {
							this.ev.onToolUse?.({
								id: String(block.id ?? ""),
								name: String(block.name ?? ""),
								input: block.input,
							});
						}
					}
				}
				break;
			}
			case "user": {
				// 工具结果以 user 角色的 tool_result block 回流
				const content = (msg as unknown as { message: { content: unknown } }).message?.content;
				if (Array.isArray(content)) {
					for (const block of content as Array<Record<string, unknown>>) {
						if (block.type === "tool_result") {
							this.ev.onToolResult?.({
								id: String(block.tool_use_id ?? ""),
								content: block.content,
								isError: Boolean(block.is_error),
							});
						}
					}
				}
				break;
			}
			case "result": {
				const r = msg as unknown as {
					is_error: boolean;
					result?: string;
					total_cost_usd?: number;
					duration_ms?: number;
					num_turns?: number;
					usage?: { input_tokens?: number; output_tokens?: number };
				};
				this.ev.onResult?.({
					isError: Boolean(r.is_error),
					result: r.result ?? "",
					costUsd: r.total_cost_usd ?? 0,
					durationMs: r.duration_ms ?? 0,
					numTurns: r.num_turns ?? 0,
				});
				if (r.usage) {
					this.ev.onUsage?.({
						inputTokens: r.usage.input_tokens ?? 0,
						outputTokens: r.usage.output_tokens ?? 0,
						contextWindow: contextWindowFor(this.model),
					});
				}
				this.setBusy(false);
				break;
			}
			default:
				break;
		}
	}
}
