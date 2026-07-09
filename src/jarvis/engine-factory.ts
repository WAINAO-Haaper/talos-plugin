import { App } from "obsidian";
import type { Engine, JarvisEvents } from "./engine-types";
import type { TalosSettings } from "../settings";
import { SdkCliEngine } from "./engine";
import { AnthropicApiEngine } from "./providers/anthropic-api-engine";
import { OpenAiEngine } from "./providers/openai-engine";

// ============================================================
// 通道工厂：按 settings.engineProvider 造对应 Engine。
//   P0：SDK/CLI；P1：直连 Anthropic API；P2：Codex/GPT（均已落地）。
//   panel.ts 的事件回调与语音/人格逻辑对所有通道完全不变。
// ============================================================
export function createEngine(app: App, settings: TalosSettings, ev: JarvisEvents): Engine {
	switch (settings.engineProvider) {
		case "claude-api": // 直连 /v1/messages，去 CLI/桌面限制
			return new AnthropicApiEngine(app, settings, ev);
		case "codex": // Codex / GPT，Chat Completions function calling
			return new OpenAiEngine(app, settings, ev);
		case "claude-cli":
		default:
			return new SdkCliEngine(app, settings, ev);
	}
}
