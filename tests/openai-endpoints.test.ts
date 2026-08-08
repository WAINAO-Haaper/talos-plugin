import { describe, expect, it } from "vitest";
import {
	openAiChatCompletionsEndpoint,
	openAiModelsEndpoint,
} from "../src/ai/provider/openai-endpoints";

describe("OpenAI-compatible endpoint normalization", () => {
	it("uses OpenAI v1 endpoints for an empty or host-only base", () => {
		expect(openAiChatCompletionsEndpoint("")).toBe(
			"https://api.openai.com/v1/chat/completions"
		);
		expect(openAiModelsEndpoint("https://gateway.test/")).toBe(
			"https://gateway.test/v1/models"
		);
	});

	it("preserves an explicit Chat Completions endpoint", () => {
		const endpoint =
			"https://gateway.test/custom/v2/chat/completions";
		expect(openAiChatCompletionsEndpoint(endpoint)).toBe(endpoint);
		expect(openAiModelsEndpoint(endpoint)).toBe(
			"https://gateway.test/custom/v2/models"
		);
	});

	it("supports the versioned Zhipu GLM Coding Plan base", () => {
		const base = "https://open.bigmodel.cn/api/coding/paas/v4/";
		expect(openAiChatCompletionsEndpoint(base)).toBe(
			"https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
		);
		expect(openAiModelsEndpoint(base)).toBe(
			"https://open.bigmodel.cn/api/coding/paas/v4/models"
		);
	});
});
