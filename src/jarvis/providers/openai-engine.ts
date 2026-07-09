import { App, FileSystemAdapter } from "obsidian";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { Engine, JarvisEvents, UserTurn, SeedTurn } from "../engine-types";
import type { TalosSettings } from "../../settings";
import { AgentLoop, ModelClient, StreamHandlers } from "../agent/loop";
import { VaultToolHost, ToolResult } from "../agent/vault-tools";
import { OPENAI_TOOLS } from "../agent/tool-schema";
import { buildSystemPrompt, hasChildProcess } from "./persona";
import { contextWindowFor } from "../engine-types";

// 思考档 → OpenAI reasoning_effort（仅推理类模型生效）
function reasoningEffort(level: string, model: string): string | null {
	if (level === "off") return null;
	const m = model.toLowerCase();
	const isReasoning = m.includes("gpt-5") || m.includes("o1") || m.includes("o3") || m.includes("codex");
	if (!isReasoning) return null;
	return level === "low" ? "low" : level === "high" ? "high" : "medium";
}

// ============================================================
// OpenAiEngine · 直连 Codex / GPT（Chat Completions function calling）
//   与 AnthropicApiEngine 同构：复用 AgentLoop + VaultToolHost + 人格注入，
//   只把「模型对话协议」换成 OpenAI 格式（messages[] 与 SSE 解析不同）。
//   Chat Completions 兼容性最广（OpenAI 官方 + 各类自建网关）。
// ============================================================

export class OpenAiEngine implements Engine {
	private loop: AgentLoop | null = null;
	private client: OpenAiModelClient | null = null;
	private sessionId: string | null = null;
	private busy = false;
	private pendingSeed: SeedTurn[] | null = null;

	constructor(private app: App, private settings: TalosSettings, private ev: JarvisEvents) {}

	async start(): Promise<void> {
		if (this.loop) return;
		const model = this.settings.openaiModel.trim() || "gpt-4o";
		const system = await buildSystemPrompt(this.app, this.settings);
		this.client = new OpenAiModelClient(this.settings, model, system);
		if (this.pendingSeed) {
			this.client.seed(this.pendingSeed);
			this.pendingSeed = null;
		}

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
		this.sessionId = `openai-${Date.now()}`;
		this.ev.onSystemInit?.({
			sessionId: this.sessionId,
			model,
			tools: OPENAI_TOOLS.map((t) => t.function.name),
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

	seed(turns: SeedTurn[]): void {
		if (turns.length === 0) return;
		if (this.client) this.client.seed(turns);
		else this.pendingSeed = turns;
	}

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
// OpenAiModelClient · 维护 OpenAI 格式 messages[] + 解析 Chat Completions SSE
// ============================================================
interface OAToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OAMsg {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | unknown[] | null;
	tool_calls?: OAToolCall[];
	tool_call_id?: string;
}

interface OAChunk {
	choices?: {
		delta?: {
			content?: string;
			tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
		};
		finish_reason?: string | null;
	}[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface CallAcc {
	id: string;
	name: string;
	args: string;
}

class OpenAiModelClient implements ModelClient {
	private messages: OAMsg[];
	private controller: AbortController | null = null;

	constructor(private settings: TalosSettings, private model: string, system: string) {
		this.messages = [{ role: "system", content: system }];
	}

	seed(turns: SeedTurn[]): void {
		for (const t of turns) this.messages.push({ role: t.role, content: t.text });
	}

	pushUser(turn: UserTurn): void {
		if (turn.images && turn.images.length > 0) {
			const content: unknown[] = [{ type: "text", text: turn.text }];
			for (const img of turn.images) {
				content.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.dataB64}` } });
			}
			this.messages.push({ role: "user", content });
		} else {
			this.messages.push({ role: "user", content: turn.text });
		}
	}

	pushToolResults(results: ToolResult[]): void {
		for (const r of results) {
			this.messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
		}
	}

	async stream(h: StreamHandlers): Promise<void> {
		const apiKey = this.settings.openaiApiKey.trim();
		if (!apiKey) {
			h.onError(new Error("未配置 OpenAI API Key（设置 → 屈原 Agentic）"));
			return;
		}
		const base = this.settings.openaiBaseUrl.trim() || "https://api.openai.com";
		this.controller = new AbortController();

		let assistantText = "";
		const calls: Record<number, CallAcc> = {};
		let finish = "stop";
		const ctxWin = contextWindowFor(this.model);

		const payload: Record<string, unknown> = {
			model: this.model,
			messages: this.messages,
			tools: OPENAI_TOOLS,
			stream: true,
			stream_options: { include_usage: true },
		};
		const effort = reasoningEffort(this.settings.jarvisThinkingLevel, this.model);
		if (effort) payload.reasoning_effort = effort;

		try {
			const res = await fetch(`${base}/v1/chat/completions`, {
				method: "POST",
				signal: this.controller.signal,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(payload),
			});
			if (!res.ok || !res.body) {
				const errText = await res.text().catch(() => "");
				h.onError(new Error(`OpenAI ${res.status}：${errText.slice(0, 300)}`));
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
						.join("");
					if (!data || data === "[DONE]") continue;
					let evt: OAChunk;
					try { evt = JSON.parse(data) as OAChunk; } catch { continue; }
					if (evt.usage) {
						h.onUsage({
							inputTokens: evt.usage.prompt_tokens ?? 0,
							outputTokens: evt.usage.completion_tokens ?? 0,
							contextWindow: ctxWin,
						});
					}
					const choice = evt.choices?.[0];
					if (!choice) continue;
					if (choice.delta?.content) { assistantText += choice.delta.content; h.onTextDelta(choice.delta.content); }
					for (const tc of choice.delta?.tool_calls ?? []) {
						const idx = tc.index ?? 0;
						const acc = (calls[idx] ??= { id: "", name: "", args: "" });
						if (tc.id) acc.id = tc.id;
						if (tc.function?.name) acc.name = tc.function.name;
						if (tc.function?.arguments) acc.args += tc.function.arguments;
					}
					if (choice.finish_reason) finish = choice.finish_reason;
				}
			}
			this.finalize(h, assistantText, calls, finish);
		} catch (e) {
			if (this.controller?.signal.aborted) {
				this.finalize(h, assistantText, calls, "stop");
				return;
			}
			h.onError(e instanceof Error ? e : new Error(String(e)));
		}
	}

	abort(): void {
		this.controller?.abort();
	}

	private finalize(h: StreamHandlers, text: string, calls: Record<number, CallAcc>, finish: string): void {
		const accs = Object.keys(calls)
			.map((k) => Number(k))
			.sort((a, b) => a - b)
			.map((k) => calls[k] as CallAcc);
		if (finish === "tool_calls" && accs.length > 0) {
			const toolCalls: OAToolCall[] = accs.map((c) => ({
				id: c.id,
				type: "function",
				function: { name: c.name, arguments: c.args || "{}" },
			}));
			this.messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
			for (const c of accs) {
				let input: Record<string, unknown> = {};
				try { input = JSON.parse(c.args || "{}") as Record<string, unknown>; } catch { /* 容错空入参 */ }
				h.onToolCall({ id: c.id, name: c.name, input });
			}
			h.onDone("tool_use");
		} else {
			this.messages.push({ role: "assistant", content: text });
			h.onDone("end");
		}
	}
}
