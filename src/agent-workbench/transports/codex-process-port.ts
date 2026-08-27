import type { RuntimeProbe } from "../contracts/runtime-adapter";
import type { CodexAppServerPort } from "../adapters/codex/codex-app-server-adapter";
import type { ProtocolFrame } from "../adapters/shared/protocol-frame";
import type { JsonRpcConnection } from "./json-line-rpc-connection";

const MAX_CONSECUTIVE_RETRY_ERRORS = 6;

export class CodexProcessPort implements CodexAppServerPort {
	constructor(private readonly connection: JsonRpcConnection, private readonly probeRuntime: (signal?: AbortSignal) => Promise<RuntimeProbe>) {}
	probe(signal?: AbortSignal) { return this.probeRuntime(signal); }
	request<T>(method: string, params: Record<string, unknown>) { return this.connection.request<T>(method, params); }
	async *turn(params: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<ProtocolFrame> {
		const frames = this.connection.subscribe();
		const result = await this.connection.request<{ turn?: { id?: string } }>("turn/start", params);
		const turnId = result.turn?.id;
		let consecutiveRetryErrors = 0;
		for await (const frame of frames) {
			if (signal?.aborted) break;
			const nativeTurnId = typeof frame.params.turnId === "string" ? frame.params.turnId : typeof (frame.params.turn as Record<string, unknown> | undefined)?.id === "string" ? String((frame.params.turn as Record<string, unknown>).id) : undefined;
			if (turnId && nativeTurnId && nativeTurnId !== turnId) continue;
			const retryableError = frame.method === "error" && frame.params.willRetry === true;
			if (retryableError) {
				consecutiveRetryErrors += 1;
				if (consecutiveRetryErrors >= MAX_CONSECUTIVE_RETRY_ERRORS) {
					await this.connection.request("turn/interrupt", { threadId: params.threadId, turnId }).catch(() => undefined);
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
	}
	respond(requestId: string | number, result: unknown) { return this.connection.respond(requestId, result); }
	async cancel(threadId: string, turnId?: string) { await this.connection.request("turn/interrupt", { threadId, turnId }); }
	close() { return this.connection.close(); }
}
