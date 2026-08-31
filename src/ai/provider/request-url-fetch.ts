export interface RequestUrlLikeResponse {
	arrayBuffer: ArrayBuffer;
	headers: Record<string, string>;
	status: number;
}

export interface RequestUrlLikeInput {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	throw?: boolean;
}

export type RequestUrlLike = (
	input: RequestUrlLikeInput,
) => Promise<RequestUrlLikeResponse>;

export const MAX_BUFFERED_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;

function abortError(reason?: unknown): Error {
	if (reason instanceof Error && reason.name === "AbortError") return reason;
	const error = reason instanceof Error
		? new Error(reason.message)
		: new Error("请求已取消");
	error.name = "AbortError";
	return error;
}

function inputUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

function headerRecord(value?: HeadersInit): Record<string, string> {
	if (!value) return {};
	const headers: Record<string, string> = {};
	new Headers(value).forEach((headerValue, key) => {
		headers[key] = headerValue;
	});
	return headers;
}

/**
 * Adapts Obsidian requestUrl to the fetch contract used by API model clients.
 * requestUrl bypasses renderer CORS, but returns a buffered response; callers
 * still parse SSE framing while accepting that deltas arrive after buffering.
 */
export function createRequestUrlFetch(
	request: RequestUrlLike,
	maxResponseBytes = MAX_BUFFERED_PROVIDER_RESPONSE_BYTES,
): typeof fetch {
	if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
		throw new Error("requestUrl 响应缓冲上限无效");
	}
	return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
		if (init.signal?.aborted) throw abortError(init.signal.reason);
		if (init.body !== undefined && typeof init.body !== "string") {
			throw new Error("requestUrl transport 只接受字符串请求体");
		}
		const result = await request({
			url: inputUrl(input),
			method: init.method ?? "GET",
			headers: headerRecord(init.headers),
			...(typeof init.body === "string" ? { body: init.body } : {}),
			throw: false,
		});
		if (init.signal?.aborted) throw abortError(init.signal.reason);
		if (result.arrayBuffer.byteLength > maxResponseBytes) {
			throw new Error(`Provider 响应超过 ${maxResponseBytes} bytes 缓冲上限`);
		}
		return new Response(result.arrayBuffer, {
			status: result.status,
			headers: result.headers,
		});
	};
}
