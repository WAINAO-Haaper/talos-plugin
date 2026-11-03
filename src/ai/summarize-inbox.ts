// 按需生成收件条目的 AI 摘要：只有用户点按钮时才把正文发给已配置的官方 API。
// 密钥只从 SecretStorage 读取，不写入设置、不落盘摘要。
import { requestUrl } from "obsidian";
import type { App } from "obsidian";
import type { TalosSettings } from "../settings";
import { buildProviderConfig } from "./provider/provider-config-runtime";
import { providerSecretStoreFromApp } from "./provider/secret-storage-runtime";

export interface InboxAiSummary {
	summary: string;
	points: string[];
	/** 生成摘要的 provider 名称。 */
	provider: string;
}

const MAX_INPUT = 6000;

function cleanJson(raw: string): string {
	const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
	const start = fenced.indexOf("{");
	const end = fenced.lastIndexOf("}");
	return start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
}

function parseSummary(raw: string, provider: string): InboxAiSummary {
	let parsed: unknown;
	try {
		parsed = JSON.parse(cleanJson(raw));
	} catch {
		throw new Error("模型返回的不是有效 JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型返回格式无效");
	const record = parsed as Record<string, unknown>;
	const summary = typeof record.summary === "string" ? record.summary.trim() : "";
	const points = Array.isArray(record.points)
		? record.points.filter((point): point is string => typeof point === "string" && point.trim().length > 0).slice(0, 6)
		: [];
	if (!summary) throw new Error("模型没有返回摘要");
	return { summary, points, provider };
}

function pickProvider(app: App, settings: TalosSettings) {
	const config = buildProviderConfig(settings);
	const store = providerSecretStoreFromApp(app);
	if (!store) throw new Error("SecretStorage 不可用，无法读取 API Key");
	const usable = config.providers.filter((provider) => {
		try {
			return !!store.get(provider.secretRef);
		} catch {
			return false;
		}
	});
	if (usable.length === 0) throw new Error("未配置可用的 API Key（设置 → AI → Provider）");
	const provider = usable.find((item) => item.isDefault) ?? usable[0];
	const key = store.get(provider.secretRef);
	if (!key) throw new Error("API Key 读取失败");
	return { provider, key };
}

const PROMPT = (text: string): string =>
	`你是资料整理助手。阅读下面的笔记正文，用中文输出 JSON，不要输出任何解释或代码块标记：
{"summary":"120 字以内的摘要，2-3 句","points":["3-5 个关键点，每条不超过 20 字"]}
正文：
${text}`;

async function callAnthropic(endpoint: string, key: string, model: string, prompt: string): Promise<string> {
	const url = `${endpoint.replace(/\/+$/, "")}/v1/messages`;
	const response = await requestUrl({
		url,
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": key,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: "user", content: prompt }] }),
		throw: false,
	});
	if (response.status >= 400) throw new Error(`Anthropic 返回 ${response.status}`);
	const data = JSON.parse(response.text) as { content?: Array<{ text?: string }> };
	return data.content?.map((part) => part.text ?? "").join("") ?? "";
}

async function callOpenAi(endpoint: string, key: string, model: string, prompt: string): Promise<string> {
	const url = `${endpoint.replace(/\/+$/, "")}/v1/chat/completions`;
	const response = await requestUrl({
		url,
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
		body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
		throw: false,
	});
	if (response.status >= 400) throw new Error(`OpenAI 兼容接口返回 ${response.status}`);
	const data = JSON.parse(response.text) as { choices?: Array<{ message?: { content?: string } }> };
	return data.choices?.[0]?.message?.content ?? "";
}

/** 生成 AI 摘要；失败时抛出可展示的错误。 */
export async function summarizeInboxText(app: App, settings: TalosSettings, text: string): Promise<InboxAiSummary> {
	const trimmed = text.trim();
	if (trimmed.length < 40) throw new Error("正文太短，不值得调用模型");
	const { provider, key } = pickProvider(app, settings);
	const prompt = PROMPT(trimmed.slice(0, MAX_INPUT));
	const raw = provider.id === "claude-api"
		? await callAnthropic(provider.endpoint, key, provider.model, prompt)
		: await callOpenAi(provider.endpoint, key, provider.model, prompt);
	return parseSummary(raw, provider.name);
}
