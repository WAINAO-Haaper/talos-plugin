import { App, FileSystemAdapter } from "obsidian";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { Engine, JarvisEvents, UserTurn, SeedTurn } from "../engine-types";
import type { TalosSettings } from "../../settings";
import { AgentLoop, ModelClient, StreamHandlers } from "../agent/loop";
import { VaultToolHost, ToolResult } from "../agent/vault-tools";
import { ANTHROPIC_TOOLS } from "../agent/tool-schema";
import { buildSystemPrompt, hasChildProcess } from "./persona";
import { contextWindowFor } from "../engine-types";

// 思考档 → budget_tokens（0=关）
function thinkingBudget(level: string): number {
	switch (level) {
		case "low": return 2048;
		case "medium": return 8192;
		case "high": return 16384;
		default: return 0;
	}
}

// ============================================================
// AnthropicApiEngine · 直连 /v1/messages（免本机 CLI）
//   自管 messages[] + SSE 流式解析 + AgentLoop 工具循环。
//   人格不再由 settingSources 白送——start() 经 buildSystemPrompt
//   把库的 灵魂/PERSONA + .claude/CLAUDE.md 读进 system prompt。
// ============================================================

export class AnthropicApiEngine implements Engine {
	private loop: AgentLoop | null = null;
	private client: AnthropicModelClient | null = null;
	private sessionId: string | null = null;
	private busy = false;
	private pendingSeed: SeedTurn[] | null = null;

	constructor(private app: App, private settings: TalosSettings, private ev: JarvisEvents) {}

	async start(): Promise<void> {
		if (this.loop) return;
		const model = this.settings.jarvisModel.trim() || "claude-sonnet-4-6";
		const system = await buildSystemPrompt(this.app, this.settings);
		this.client = new AnthropicModelClient(this.settings, model, system);
		if (this.pendingSeed) {
			this.client.seed(this.pendingSeed);
			this.pendingSeed = null;
		}

		// 包一层事件：截获 busy 维护 isBusy()，其余原样透传（语音/人格/权限不动）
		const tapped: JarvisEvents = {
			...this.ev,
			onBusyChange: (b) => {
				this.busy = b;
				this.ev.onBusyChange?.(b);
			},
		};
		const tools = new VaultToolHost(this.app, tapped, {
			permissionMode: () => this.settings.jarvisPermissionMode,
			supportsBash: hasChildProcess() && this.app.vault.adapter instanceof FileSystemAdapter,
		});
		this.loop = new AgentLoop(this.client, tools, tapped);
		this.sessionId = `api-${Date.now()}`;
		this.ev.onSystemInit?.({
			sessionId: this.sessionId,
			model,
			tools: ANTHROPIC_TOOLS.map((t) => t.name),
			cwd: this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : "",
			permissionMode: this.settings.jarvisPermissionMode,
		});
	}

	send(turn: UserTurn): void {
		if (!turn.text.trim() && !(turn.images && turn.images.length)) return;
		void this.ensure().then((loop) => loop.turn(turn));
	}

	async interrupt(): Promise<void> {
		this.loop?.abort();
		this.busy = false;
	}

	// 会话恢复：客户端就绪则即时灌入，否则挂起到 start()
	seed(turns: SeedTurn[]): void {
		if (turns.length === 0) return;
		if (this.client) this.client.seed(turns);
		else this.pendingSeed = turns;
	}

	// 直连通道无状态切换，模式每次执行时从 settings 现读
	async setPermissionMode(_mode: PermissionMode): Promise<void> {
		void _mode;
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	isBusy(): boolean {
		return this.busy;
	}

	dispose(): void {
		this.loop?.abort();
		this.loop = null;
		this.client = null;
	}

	private async ensure(): Promise<AgentLoop> {
		if (!this.loop) await this.start();
		return this.loop as AgentLoop;
	}
}

// ============================================================
// AnthropicModelClient · 维护 messages[] + 调 /v1/messages 解析 SSE
//   messages[] 即 resume 的回放基础（P3 由 SessionStore 接管持久化）。
// ============================================================
interface Msg {
	role: "user" | "assistant";
	content: unknown[];
}

interface SseEvent {
	type?: string;
	index?: number;
	delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
	content_block?: { type?: string; id?: string; name?: string };
	message?: { usage?: { input_tokens?: number } };
	usage?: { output_tokens?: number };
}

interface BlockAcc {
	type: string;
	text: string;
	id?: string;
	name?: string;
	json: string;
}

class AnthropicModelClient implements ModelClient {
	private messages: Msg[] = [];
	private controller: AbortController | null = null;

	constructor(private settings: TalosSettings, private model: string, private system: string) {}

	// 恢复：把历史转写作为既有轮次灌入 messages[]，模型据此续接上下文。
	// Anthropic API 要求 user/assistant 交替，连续同角色的转写合并进同一条消息。
	seed(turns: SeedTurn[]): void {
		for (const t of turns) {
			const last = this.messages[this.messages.length - 1];
			if (last && last.role === t.role) {
				last.content.push({ type: "text", text: t.text });
			} else {
				this.messages.push({ role: t.role, content: [{ type: "text", text: t.text }] });
			}
		}
	}

	pushUser(turn: UserTurn): void {
		const content: unknown[] = [{ type: "text", text: turn.text }];
		for (const img of turn.images ?? []) {
			content.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.dataB64 } });
		}
		this.messages.push({ role: "user", content });
	}

	pushToolResults(results: ToolResult[]): void {
		this.messages.push({
			role: "user",
			content: results.map((r) => ({
				type: "tool_result",
				tool_use_id: r.id,
				content: r.content,
				is_error: r.isError,
			})),
		});
	}

	async stream(h: StreamHandlers): Promise<void> {
		const apiKey = this.settings.anthropicApiKey.trim();
		if (!apiKey) {
			h.onError(new Error("未配置 Anthropic API Key（设置 → 屈原 Agentic）"));
			return;
		}
		const base = this.settings.anthropicBaseUrl.trim() || "https://api.anthropic.com";
		this.controller = new AbortController();

		const assistant: unknown[] = [];
		const cur: Record<number, BlockAcc> = {};
		let stopReason = "end_turn";
		let inTok = 0;
		let outTok = 0;
		const ctxWin = contextWindowFor(this.model);

		const budget = thinkingBudget(this.settings.jarvisThinkingLevel);
		const payload: Record<string, unknown> = {
			model: this.model,
			max_tokens: budget > 0 ? budget + 8192 : 8192,
			system: this.system,
			messages: this.messages,
			tools: ANTHROPIC_TOOLS,
			stream: true,
		};
		if (budget > 0) payload.thinking = { type: "enabled", budget_tokens: budget };

		try {
			const res = await fetch(`${base}/v1/messages`, {
				method: "POST",
				signal: this.controller.signal,
				headers: {
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
					"content-type": "application/json",
					// 允许 Electron 渲染进程直连（绕过浏览器 CORS 拦截）
					"anthropic-dangerous-direct-browser-access": "true",
				},
				body: JSON.stringify(payload),
			});
			if (!res.ok || !res.body) {
				const errText = await res.text().catch(() => "");
				h.onError(new Error(`Anthropic ${res.status}：${errText.slice(0, 300)}`));
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let sep: number;
				while ((sep = buf.indexOf("\n\n")) >= 0) {
					const chunk = buf.slice(0, sep);
					buf = buf.slice(sep + 2);
					const data = chunk
						.split("\n")
						.filter((l) => l.startsWith("data:"))
						.map((l) => l.slice(5).trim())
						.join("\n");
					if (!data || data === "[DONE]") continue;
					let evt: SseEvent;
					try { evt = JSON.parse(data) as SseEvent; } catch { continue; }
					if (evt.type === "message_start" && evt.message?.usage?.input_tokens != null) inTok = evt.message.usage.input_tokens;
					if (evt.type === "message_delta" && evt.usage?.output_tokens != null) {
						outTok = evt.usage.output_tokens;
						h.onUsage({ inputTokens: inTok, outputTokens: outTok, contextWindow: ctxWin });
					}
					this.handle(evt, h, assistant, cur, (r) => (stopReason = r));
				}
			}
			// content 为空数组的 assistant 消息对 API 非法（下一轮请求会 400），只在有内容时入列
			if (assistant.length > 0) this.messages.push({ role: "assistant", content: assistant });
			h.onDone(stopReason === "tool_use" ? "tool_use" : "end");
		} catch (e) {
			if (this.controller?.signal.aborted) {
				// 打断收尾只保留文本块：带 tool_use 却无 tool_result 的 assistant 消息会毒化会话
				const textOnly = assistant.filter(
					(b) => (b as { type?: string }).type === "text"
				);
				if (textOnly.length > 0) this.messages.push({ role: "assistant", content: textOnly });
				h.onDone("end"); // 用户打断：干净收尾，不当错误
				return;
			}
			h.onError(e instanceof Error ? e : new Error(String(e)));
		}
	}

	abort(): void {
		this.controller?.abort();
	}

	private handle(
		evt: SseEvent,
		h: StreamHandlers,
		assistant: unknown[],
		cur: Record<number, BlockAcc>,
		setStop: (r: string) => void
	): void {
		const i = evt.index ?? 0;
		switch (evt.type) {
			case "content_block_start": {
				const b = evt.content_block ?? {};
				if (b.type === "tool_use") cur[i] = { type: "tool_use", text: "", id: b.id, name: b.name, json: "" };
				else cur[i] = { type: b.type ?? "text", text: "", json: "" };
				break;
			}
			case "content_block_delta": {
				const c = cur[i];
				const d = evt.delta ?? {};
				if (!c) break;
				if (d.type === "text_delta" && d.text) { c.text += d.text; h.onTextDelta(d.text); }
				else if (d.type === "thinking_delta" && d.thinking) { c.text += d.thinking; h.onThinkingDelta(d.thinking); }
				else if (d.type === "input_json_delta" && d.partial_json) { c.json += d.partial_json; }
				break;
			}
			case "content_block_stop": {
				const c = cur[i];
				if (!c) break;
				if (c.type === "text") {
					assistant.push({ type: "text", text: c.text });
				} else if (c.type === "tool_use") {
					let input: Record<string, unknown> = {};
					try { input = JSON.parse(c.json || "{}") as Record<string, unknown>; } catch { /* 容错空入参 */ }
					assistant.push({ type: "tool_use", id: c.id, name: c.name, input });
					h.onToolCall({ id: String(c.id ?? ""), name: String(c.name ?? ""), input });
				}
				delete cur[i];
				break;
			}
			case "message_delta": {
				if (evt.delta?.stop_reason) setStop(evt.delta.stop_reason);
				break;
			}
			default:
				break;
		}
	}
}
