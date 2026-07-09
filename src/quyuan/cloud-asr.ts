import { requestUrl } from "obsidian";
import { VadMic, encodeWavBase64 } from "./vad-mic";

// ============================================================
// 屈原 · 云端语音识别（千问 DashScope qwen3-asr-flash · 同步 HTTP）
//   继承 VadMic（麦克风+VAD+打断），仅实现转写：编码 WAV → base64 内联 →
//   requestUrl(bearer，复用 settings.aliyunApiKey) POST multimodal-generation。
// ============================================================

const DASHSCOPE_ASR_URL =
	"https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

interface DashScopeAsrResponse {
	output?: {
		choices?: Array<{ message?: { content?: Array<{ text?: string }> } }>;
	};
}

export class CloudAsr extends VadMic {
	protected preflight(): string | null {
		return this.settings.aliyunApiKey?.trim()
			? null
			: "未配置阿里云 DashScope API Key（设置 → 语音 → 阿里云）";
	}

	protected async transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
		const wavB64 = encodeWavBase64(samples, sampleRate);
		if (!wavB64) return "";
		const key = this.settings.aliyunApiKey.trim();
		const asrOptions: Record<string, unknown> = { enable_itn: true };
		if ((this.settings.jarvisSttLang || "zh-CN").toLowerCase().startsWith("zh")) {
			asrOptions.language = "zh";
		}
		const res = await requestUrl({
			url: DASHSCOPE_ASR_URL,
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "qwen3-asr-flash",
				input: {
					messages: [
						{ role: "system", content: [{ text: "" }] },
						{ role: "user", content: [{ audio: `data:audio/wav;base64,${wavB64}` }] },
					],
				},
				parameters: { asr_options: asrOptions },
			}),
			throw: false,
		});
		if (res.status !== 200) {
			throw new Error(`千问 ASR ${res.status}：${String(res.text).slice(0, 200)}`);
		}
		const data = res.json as DashScopeAsrResponse;
		return data?.output?.choices?.[0]?.message?.content?.[0]?.text?.trim() ?? "";
	}
}
