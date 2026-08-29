import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string =>
	readFileSync(`${projectRoot}${rel}`, "utf8");

// D-TLP-016 · C-3b：旧 jarvis 引擎栈移除契约。
// 钉死：① 旧引擎/面板/会话/右侧栏视图文件不存在；② 直连运行时保留
// （ai/provider 模型客户端 + jarvis/agent 工具循环 + voiceio TTS/STT）；
// ③ main.ts 不再注册旧视图与回滚命令；④ 语音单引擎 = QuyuanVoiceDriver。
describe("voice engine C-3b removal contract (D-TLP-016)", () => {
	it("removes the legacy jarvis engine stack files", () => {
		for (const gone of [
			"src/jarvis-view.ts",
			"src/voice.ts",
			"src/jarvis/panel.ts",
			"src/jarvis/engine.ts",
			"src/jarvis/engine-factory.ts",
			"src/jarvis/context/mentions.ts",
			"src/jarvis/providers/openai-engine.ts",
			"src/jarvis/session/store.ts",
		]) {
			expect(existsSync(`${projectRoot}${gone}`), gone).toBe(false);
		}
	});

	it("keeps the live direct-API runtime and voice I/O modules", () => {
		for (const kept of [
			"src/jarvis/voiceio.ts",
			"src/jarvis/engine-types.ts",
			"src/jarvis/agent/loop.ts",
			"src/jarvis/agent/vault-tools.ts",
			"src/ai/provider/api-agent-runtime.ts",
			"src/ai/provider/openai-model-client.ts",
			"src/ai/provider/anthropic-model-client.ts",
		]) {
			expect(existsSync(`${projectRoot}${kept}`), kept).toBe(true);
		}
	});

	it("leaves no legacy view registration or rollback command in main.ts", () => {
		const main = readSrc("src/main.ts");
		expect(main).not.toContain("jarvis-view");
		expect(main).not.toContain("VIEW_TYPE_JARVIS");
		expect(main).not.toContain('id: "open-jarvis"');
		expect(main).not.toContain("activateJarvisView");
		// 现存注册入口不受影响
		expect(main).toContain('id: "open-quyuan-v2"');
	});

	it("keeps the voice page on the single QuyuanVoiceDriver engine", () => {
		const panel = readSrc("src/quyuan/voice-panel.ts");
		expect(panel).toContain('from "./native-voice-driver"');
		expect(panel).toContain('from "../jarvis/voiceio"');
		expect(panel).not.toContain("jarvis/panel");
		expect(panel).not.toContain("engine-factory");
		// 死设置项不再出现在设置 UI
		const settings = readSrc("src/settings.ts");
		expect(settings).not.toContain("旧语音引擎（过渡");
	});
});
