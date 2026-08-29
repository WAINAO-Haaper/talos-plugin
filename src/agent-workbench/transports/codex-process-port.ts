import type { RuntimeProbe } from "../contracts/runtime-adapter";
import type { CodexAppServerPort } from "../adapters/codex/codex-app-server-adapter";
import type { ProtocolFrame } from "../adapters/shared/protocol-frame";
import type { JsonRpcConnection } from "./json-line-rpc-connection";

const MAX_CONSECUTIVE_RETRY_ERRORS = 6;

export class CodexProcessPort implements CodexAppServerPort {
	private activeThreadId: string | undefined;
	private activeTurnId: string | undefined;

	constructor(private readonly connection: JsonRpcConnection, private readonly probeRuntime: (signal?: AbortSignal) => Promise<RuntimeProbe>) {}
	probe(signal?: AbortSignal) { return this.probeRuntime(signal); }
	request<T>(method: string, params: Record<string, unknown>) { return this.connection.request<T>(method, params); }
	async *turn(params: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<ProtocolFrame> {
		const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
		if (!threadId) throw new Error("Codex turn/start 缺少 threadId");
		const frames = this.connection.subscribe();
		const result = await this.connection.request<{ turn?: { id?: string } }>("turn/start", params);
		const turnId = result.turn?.id;
		if (!turnId) throw new Error("Codex turn/start 未返回原生 turnId");
		this.activeThreadId = threadId;
		this.activeTurnId = turnId;
		let consecutiveRetryErrors = 0;
		try {
			for await (const frame of frames) {
				if (signal?.aborted) break;
				const nativeThreadId = typeof frame.params.threadId === "string" ? frame.params.threadId : undefined;
				const nativeTurnId = typeof frame.params.turnId === "string"
					? frame.params.turnId
					: typeof (frame.params.turn as Record<string, unknown> | undefined)?.id === "string"
						? String((frame.params.turn as Record<string, unknown>).id)
						: undefined;
				if (nativeThreadId && nativeThreadId !== threadId) continue;
				if (nativeTurnId && nativeTurnId !== turnId) continue;
				const retryableError = frame.method === "error" && frame.params.willRetry === true;
				if (retryableError) {
					consecutiveRetryErrors += 1;
					if (consecutiveRetryErrors >= MAX_CONSECUTIVE_RETRY_ERRORS) {
						await this.connection.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
						const nativeError = frame.params.error && typeof frame.params.error === "object" && !Array.isArray(frame.params.error)
							? frame.params.error as Record<string, unknown>
							: {};
						const previousMessage = typeof nativeError.message === "string" ? nativeError.message : "运行时持续返回可重试错误";
						yield {
							...frame,
							params: {
								...frame.params,
								willRetry: false,
								error: {
									...nativeError,
									message: `连接重试已达到 ${MAX_CONSECUTIVE_RETRY_ERRORS} 次`,
									additionalDetails: previousMessage,
								},
							},
						};
						break;
					}
				} else {
					consecutiveRetryErrors = 0;
				}
				yield frame;
				if (frame.method === "turn/completed") break;
				if (frame.method === "error" && frame.params.willRetry !== true) break;
			}
		} finally {
			if (this.activeThreadId === threadId && this.activeTurnId === turnId) {
				this.activeThreadId = undefined;
				this.activeTurnId = undefined;
			}
		}
	}
	respond(requestId: string | number, result: unknown) { return this.connection.respond(requestId, result); }
	async steer(threadId: string, text: string) {
		const turnId = this.requireActiveTurn(threadId);
		await this.connection.request("turn/steer", {
			threadId,
			expectedTurnId: turnId,
			input: [{ type: "text", text }],
		});
	}
	async cancel(threadId: string, _reason?: string) {
		const turnId = this.activeThreadId === threadId ? this.activeTurnId : undefined;
		if (!turnId) return;
		await this.connection.request("turn/interrupt", { threadId, turnId });
	}
	async close() {
		this.activeThreadId = undefined;
		this.activeTurnId = undefined;
		await this.connection.close();
	}

	private requireActiveTurn(threadId: string): string {
		if (this.activeThreadId !== threadId || !this.activeTurnId) {
			throw new Error("Codex 当前没有可转向的原生 turn");
		}
		return this.activeTurnId;
	}
}
