export type ProviderResponseFormat = "sse" | "json" | "unsupported";

export function providerResponseFormat(response: Response): ProviderResponseFormat {
	const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
	if (!contentType || contentType.includes("text/event-stream")) return "sse";
	if (contentType.includes("application/json") || contentType.includes("+json")) return "json";
	return "unsupported";
}

function eventBlocks(buffer: string): { blocks: string[]; remainder: string } {
	const normalized = buffer.replace(/\r\n/g, "\n");
	const blocks = normalized.split("\n\n");
	const remainder = blocks.pop() ?? "";
	return { blocks, remainder };
}

function eventData(block: string): string {
	return block
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trimStart())
		.join("\n")
		.trim();
}

export async function readSseJson<T>(
	response: Response,
	onEvent: (event: T) => void,
): Promise<number> {
	if (!response.body) throw new Error("Provider SSE 响应缺少 body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let parsed = 0;
	const consume = (block: string): void => {
		const data = eventData(block);
		if (!data || data === "[DONE]") return;
		try {
			onEvent(JSON.parse(data) as T);
			parsed += 1;
		} catch {
			throw new Error("Provider SSE 事件 JSON 损坏");
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const split = eventBlocks(buffer);
		buffer = split.remainder;
		for (const block of split.blocks) consume(block);
	}
	buffer += decoder.decode();
	if (buffer.trim()) consume(buffer);
	return parsed;
}
