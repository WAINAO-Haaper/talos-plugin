const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

function normalizedBase(configured: string): string {
	return (configured.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
}

function endsWithVersionSegment(value: string): boolean {
	return /\/v\d+(?:\.\d+)?$/i.test(value);
}

export function openAiChatCompletionsEndpoint(configured: string): string {
	const base = normalizedBase(configured);
	if (/\/chat\/completions$/i.test(base)) return base;
	if (endsWithVersionSegment(base)) return `${base}/chat/completions`;
	return `${base}/v1/chat/completions`;
}

export function openAiModelsEndpoint(configured: string): string {
	const base = normalizedBase(configured);
	if (/\/chat\/completions$/i.test(base)) {
		return base.replace(/\/chat\/completions$/i, "/models");
	}
	if (endsWithVersionSegment(base)) return `${base}/models`;
	return `${base}/v1/models`;
}
