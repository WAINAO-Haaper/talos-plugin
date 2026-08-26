import { describe, expect, it } from "vitest";
import {
	buildQwenWebSearchRequest,
	explicitVoiceWebSearchQuery,
	parseQwenWebSearchResponse,
	qwenWebSearchEndpoint,
} from "../src/quyuan/qwen-web-search";

describe("Qwen voice web search boundary", () => {
	it("requires a positive explicit command in the current user text", () => {
		expect(explicitVoiceWebSearchQuery("屈原，联网搜索今天的新闻")).toBe(
			"屈原，联网搜索今天的新闻"
		);
		expect(explicitVoiceWebSearchQuery("帮我上网查一下杭州天气")).toBe(
			"帮我上网查一下杭州天气"
		);
		expect(explicitVoiceWebSearchQuery("今天有什么新闻")).toBeNull();
		expect(explicitVoiceWebSearchQuery("不要联网搜索，按你已有知识回答")).toBeNull();
		expect(explicitVoiceWebSearchQuery("不要帮我联网搜索这个问题")).toBeNull();
		expect(explicitVoiceWebSearchQuery("我不想联网搜索这个问题")).toBeNull();
		expect(explicitVoiceWebSearchQuery("别上网查这个问题")).toBeNull();
		expect(explicitVoiceWebSearchQuery("不要猜，联网搜索杭州天气")).toBe(
			"不要猜，联网搜索杭州天气"
		);
	});

	it("builds a forced-source Qwen Flash request on the selected workspace region", () => {
		expect(qwenWebSearchEndpoint("ws-example", "cn-beijing")).toBe(
			"https://ws-example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
		);
		expect(buildQwenWebSearchRequest("联网搜索杭州天气")).toMatchObject({
			model: "qwen-flash",
			input: {
				messages: [{ role: "user", content: "联网搜索杭州天气" }],
			},
			parameters: {
				enable_search: true,
				search_options: {
					search_strategy: "turbo",
					enable_source: true,
					forced_search: true,
				},
			},
		});
		expect(() => buildQwenWebSearchRequest("杭州天气")).toThrow(
			"未明确授权联网搜索"
		);
		expect(() => buildQwenWebSearchRequest("不要帮我联网搜索杭州天气")).toThrow(
			"未明确授权联网搜索"
		);
	});

	it("returns at most five safe sources, bounded output, and usage metadata", () => {
		const result = parseQwenWebSearchResponse({
			output: {
				choices: [{ message: { content: "这是联网摘要。".repeat(1000) } }],
				search_info: {
					search_results: Array.from({ length: 8 }, (_, index) => ({
						title: `来源 ${index + 1}`,
						url: `https://example.com/${index + 1}`,
						site_name: "example.com",
					})),
				},
			},
			usage: {
				input_tokens: 120,
				output_tokens: 80,
				total_tokens: 200,
				plugins: { search: { count: 1 } },
			},
		});
		const output = JSON.parse(result.output) as {
			sources: Array<{ url: string }>;
			instruction: string;
		};
		expect(result.output.length).toBeLessThanOrEqual(6000);
		expect(output.sources).toHaveLength(5);
		expect(output.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
		expect(output.instruction).toContain("不可信外部资料");
		expect(result.usage).toEqual({
			inputTextTokens: 120,
			outputTextTokens: 80,
			totalTokens: 200,
			searchRequests: 1,
			sourceCount: 5,
		});
	});

	it("drops unsafe source URLs before returning results", () => {
		const result = parseQwenWebSearchResponse({
			output: {
				choices: [{ message: { content: "安全来源摘要" } }],
				search_info: {
					search_results: [
						{ title: "脚本", url: "javascript:alert(1)" },
						{ title: "凭据", url: "https://user:pass@example.com/private" },
						{ title: "安全", url: "https://example.com/safe" },
					],
				},
			},
		});
		const output = JSON.parse(result.output) as {
			sources: Array<{ title: string; url: string; siteName: string }>;
		};
		expect(output.sources).toEqual([{
			title: "安全",
			url: "https://example.com/safe",
			siteName: "example.com",
		}]);
	});

	it("fails closed without verifiable web sources", () => {
		expect(() => parseQwenWebSearchResponse({
			output: { choices: [{ message: { content: "模型自有知识" } }] },
		})).toThrow("未返回可核验来源");
	});
});
