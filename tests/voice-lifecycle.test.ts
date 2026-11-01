import { readFileSync } from "node:fs";
import {
	clearInterval as nodeClearInterval,
	setInterval as nodeSetInterval,
} from "node:timers";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	Notice: class {},
	requestUrl: vi.fn(),
}));

import type { TalosSettings } from "../src/settings";
import { StreamTts } from "../src/jarvis/voiceio";
import { QuyuanVoiceDriver } from "../src/quyuan/native-voice-driver";
import { evaluateVoiceTurnAdmission } from "../src/quyuan/voice-turn-admission";
import { createAgentEvent } from "../src/agent-workbench/contracts/agent-events";
import type { AgentRuntimeAdapter } from "../src/agent-workbench/contracts/runtime-adapter";
import { unavailableCapabilities } from "../src/agent-workbench/contracts/runtime-capabilities";
import { createObsidianHost } from "./helpers/obsidian-dom";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

class Deferred<T> {
	readonly promise: Promise<T>;
	resolve!: (value: T) => void;
	reject!: (error: unknown) => void;

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("voice reply display", () => {
	it("retains a complete long reply through streaming and status changes", async () => {
		const { QuyuanVoicePanel } = await import("../src/quyuan/voice-panel");
		const reply = createObsidianHost().element;
		const hint = createObsidianHost().element;
		Object.assign(reply, { scrollHeight: 1000, scrollTop: 0, clientHeight: 200 });
		const initial = Array.from({ length: 12 }, (_, i) => `第${i + 1}句。 \n  缩进 and spaces  `).join("\n\n");
		const panel = Object.assign(Object.create(QuyuanVoicePanel.prototype) as object, {
			overlayReply: reply, overlayHint: hint, activeReplySource: "driver", replyBuffer: initial,
		}) as unknown as { replyBuffer: string; feedOverlayLine(delta: string): void; setOverlayMessage(text: string): void };
		panel.feedOverlayLine("");
		expect(reply.textContent).toBe(initial);
		panel.replyBuffer += "追加的完整回答。";
		panel.feedOverlayLine("");
		expect(reply.textContent).toBe(initial + "追加的完整回答。");
		expect((reply as unknown as { scrollTop: number }).scrollTop).toBe(0);
		panel.setOverlayMessage("语音已休眠");
		expect(hint.textContent).toBe("语音已休眠");
		expect(reply.textContent).toBe(initial + "追加的完整回答。");
	});

	it("combines multiple realtime segments without duplicating streamed prefixes", async () => {
		const { QuyuanVoicePanel } = await import("../src/quyuan/voice-panel");
		const reply = createObsidianHost().element;
		Object.assign(reply, { scrollHeight: 100, scrollTop: 0, clientHeight: 200 });
		const segments = new Map<string, string>();
		const panel = Object.assign(Object.create(QuyuanVoicePanel.prototype) as object, {
			overlayReply: reply, realtimeReplySegments: segments, activeReplySource: "realtime", replyBuffer: "",
		}) as unknown as { updateRealtimeReply(text: string, key: string): void };
		panel.updateRealtimeReply("第一", "item-a:0:0");
		panel.updateRealtimeReply("第二段", "item-b:1:0");
		panel.updateRealtimeReply("内容十", "item-a:0:10");
		panel.updateRealtimeReply("内容二", "item-a:0:2");
		panel.updateRealtimeReply("第一段。", "item-a:0:0");
		expect(reply.textContent).toBe("第一段。内容二内容十第二段");
		(panel as unknown as { activeReplySource: string }).activeReplySource = "driver";
		reply.setText("文字查询回复");
		panel.updateRealtimeReply("迟到的语音", "item-c:2:0");
		expect(reply.textContent).toBe("文字查询回复");
		segments.clear();
		(panel as unknown as { activeReplySource: string }).activeReplySource = "realtime";
		panel.updateRealtimeReply("新一轮", "item-c:0:0");
		expect(reply.textContent).toBe("新一轮");
	});

	it("shows the complete final voice response even when streamed text differs", async () => {
		const { QuyuanVoicePanel } = await import("../src/quyuan/voice-panel");
		const reply = createObsidianHost().element;
		Object.assign(reply, { scrollHeight: 0, scrollTop: 0, clientHeight: 200 });
		const driver = {
			isBusy: () => false,
			send: async (_input: unknown, callbacks: { onText(text: string): void; onDone(text: string): void }) => {
				callbacks.onText("部分");
				callbacks.onDone("最终完整语音回答");
			},
		};
		const panel = Object.assign(Object.create(QuyuanVoicePanel.prototype) as object, {
			driver, mounted: true, navigatingToChat: false, lifecycleGeneration: 1, responseGeneration: 0,
			activeReplySource: "driver", overlayReply: reply, replyBuffer: "",
			voiceMode: { setReplyText: vi.fn() }, voiceSessionStore: null, markdownComponent: null,
			ttsEnabled: false, ttsPending: false, controlStatusEl: null,
			setState: vi.fn(), setTalosBallState: vi.fn(), restingState: () => "idle",
		}) as unknown as { respond(text: string, channel: "voice"): Promise<void> };
		await panel.respond("问题", "voice");
		expect(reply.textContent).toBe("最终完整语音回答");
	});

	it("preserves long output without sentence punctuation", async () => {
		const { QuyuanVoicePanel } = await import("../src/quyuan/voice-panel");
		const reply = createObsidianHost().element;
		Object.assign(reply, { scrollHeight: 1000, scrollTop: 800, clientHeight: 200 });
		const full = "长内容".repeat(1800);
		const panel = Object.assign(Object.create(QuyuanVoicePanel.prototype) as object, {
			overlayReply: reply, activeReplySource: "driver", replyBuffer: full,
		}) as unknown as { feedOverlayLine(delta: string): void };
		panel.feedOverlayLine("");
		expect(reply.textContent).toBe(full);
	});
});

describe("voice microphone lifecycle", () => {
	it("never starts the microphone on mount, even if permission was already granted", () => {
		const source = readFileSync(
			`${projectRoot}src/quyuan/voice-panel.ts`,
			"utf8"
		);
		const mount = source.slice(
			source.indexOf("mount(container"),
			source.indexOf("private modelLabel")
		);
		expect(mount).not.toContain("setVoiceRecognitionEnabled(true");
		expect(mount).not.toContain(".asr?.start()");
		expect(mount).toContain("renderMicActivationRequired");
		expect(mount).not.toContain("autoStartRealtimeIfPermitted");
		expect(mount).not.toContain(".start()");
		expect(source).toContain(
			'this.micBtn.addEventListener("click", () => void this.toggleVoiceRecognitionMode())'
		);
	});

	it("switching the input mode stays idle; the microphone button starts the session", async () => {
		const { QuyuanVoicePanel } = await import("../src/quyuan/voice-panel");
		let connected = false;
		const start = vi.fn(async () => { connected = true; });
		const realtime = { start, isConnected: () => connected, setAwake: vi.fn(), setInputEnabled: vi.fn() };
		const panel = Object.assign(Object.create(QuyuanVoicePanel.prototype) as object, {
			settings: { quyuanVoiceRecognitionEnabled: true },
			voiceMode: { setInputMode: vi.fn(), snapshot: () => ({ inputMode: "continuous" }) },
			realtime, rootEl: null, mounted: true, lifecycleGeneration: 1,
			renderVoiceModeBtn: vi.fn(), renderMicActivationRequired: vi.fn(), renderMicBtn: vi.fn(), setState: vi.fn(),
			wakeStatusEl: null, controlStatusEl: null, save: vi.fn(async () => undefined),
		}) as unknown as { setVoiceInputMode(mode: "continuous"): Promise<void>; toggleVoiceRecognitionMode(): Promise<void> };
		await panel.setVoiceInputMode("continuous");
		expect(start).not.toHaveBeenCalled();
		await panel.toggleVoiceRecognitionMode();
		expect(start).toHaveBeenCalledOnce();
	});

	it("keeps a realtime wake session active until explicit sleep, exit, or unmount", () => {
		const panel = readFileSync(
			`${projectRoot}src/quyuan/voice-panel.ts`,
			"utf8"
		);
		const realtime = readFileSync(
			`${projectRoot}src/quyuan/qwen-realtime-voice.ts`,
			"utf8"
		);
		expect(panel).not.toContain("wakeWindowMs");
		expect(panel).not.toContain("wakeTimer");
		expect(panel).toContain("QwenRealtimeVoiceSession");
		expect(realtime).toContain("this.setAwake(false)");
		expect(realtime).not.toContain("wakeWindowMs");
	});

});

type VoiceTestChunk =
	| { type: "text"; content: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; id: string; content: string; isError: boolean }
	| { type: "error"; content: string }
	| { type: "done" };

function runtimeWithChunks(chunks: VoiceTestChunk[]): AgentRuntimeAdapter {
	return {
		id: "codex",
		probe: async () => ({ runtimeId: "codex", status: "ready" }),
		listModels: async () => [],
		createSession: async () => ({ runtimeId: "codex", sessionId: "voice-session" }),
		resumeSession: async () => undefined,
		send: async function* (turn) {
			for (const [index, chunk] of chunks.entries()) {
				const common = { eventId: `event-${index}`, conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex" as const, timestamp: new Date().toISOString() };
				if (chunk.type === "text") yield createAgentEvent({ ...common, type: "assistant.delta", payload: { text: chunk.content } });
				else if (chunk.type === "tool_use") yield createAgentEvent({ ...common, type: "tool.started", payload: { id: chunk.id, name: chunk.name, input: chunk.input } });
				else if (chunk.type === "tool_result") yield createAgentEvent({ ...common, type: "tool.finished", payload: { id: chunk.id, output: chunk.content, isError: chunk.isError } });
				else if (chunk.type === "error") yield createAgentEvent({ ...common, type: "error", payload: { message: chunk.content } });
				else yield createAgentEvent({ ...common, type: "turn.finished", payload: { status: "completed" } });
			}
		},
		cancel: vi.fn(async () => undefined),
		dispose: vi.fn(async () => undefined),
		capabilities: unavailableCapabilities,
	};
}

function voiceDriver(runtime: AgentRuntimeAdapter): QuyuanVoiceDriver {
	const service = {
		getSelectedRuntimeId: () => "codex",
		getVaultRoot: () => "/synthetic/vault",
		getWorkflowMode: () => "plan",
		createRuntime: async () => runtime,
	};
	const plugin = {
		getAgentWorkbenchService: () => service,
		auditQuyuanProviderEgress: async () => ({ allowed: true }),
	} as never;
	return new QuyuanVoiceDriver(plugin);
}

describe("voice driver terminal correctness", () => {
	it("reports a denied or failed tool and never emits a fake success", async () => {
		const driver = voiceDriver(runtimeWithChunks([
			{ type: "tool_use", id: "tool-1", name: "Write", input: {} },
			{ type: "tool_result", id: "tool-1", content: "denied", isError: true },
			{ type: "done" },
		]));
		const onText = vi.fn();
		const onDone = vi.fn();
		const onError = vi.fn();

		await driver.send(
			{ text: "请修改文件", channel: "voice" },
			{ onText, onDone, onError }
		);

		expect(onError).toHaveBeenCalledWith(
			"只读工具调用被拒绝或失败，未生成回答"
		);
		expect(onText).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
	});

	it("does not mark partial text as successful when the stream ends without done", async () => {
		const driver = voiceDriver(runtimeWithChunks([
			{ type: "text", content: "尚未确认完成" },
		]));
		const onText = vi.fn();
		const onDone = vi.fn();
		const onError = vi.fn();

		await driver.send(
			{ text: "查询", channel: "voice" },
			{ onText, onDone, onError }
		);

		expect(onText).toHaveBeenCalledWith("尚未确认完成");
		expect(onError).toHaveBeenCalledWith("引擎流在确认完成前中断");
		expect(onDone).not.toHaveBeenCalled();
	});

	it("treats an error chunk as terminal even if the iterator could yield later text", async () => {
		const driver = voiceDriver(runtimeWithChunks([
			{ type: "error", content: "provider failed" },
			{ type: "text", content: "must be ignored" },
		]));
		const onText = vi.fn();
		const onDone = vi.fn();
		const onError = vi.fn();

		await driver.send(
			{ text: "查询", channel: "voice" },
			{ onText, onDone, onError }
		);

		expect(onError).toHaveBeenCalledTimes(1);
		expect(onText).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
	});

	it("drops Provider output that arrives after cancel", async () => {
		const release = new Deferred<void>();
		const runtime = runtimeWithChunks([]);
		runtime.send = async function* (turn) {
			await release.promise;
			yield createAgentEvent({ eventId: "late", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "assistant.delta", timestamp: new Date().toISOString(), payload: { text: "stale" } });
		};
		const driver = voiceDriver(runtime);
		const onText = vi.fn();
		const onDone = vi.fn();
		const onError = vi.fn();
		const sending = driver.send(
			{ text: "查询", channel: "voice" },
			{ onText, onDone, onError }
		);
		await Promise.resolve();
		driver.cancel();
		release.resolve();
		await sending;

		expect(onText).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it("drops Provider output that arrives after driver dispose", async () => {
		const release = new Deferred<void>();
		const runtime = runtimeWithChunks([]);
		runtime.send = async function* (turn) {
			await release.promise;
			yield createAgentEvent({ eventId: "late", conversationId: turn.conversationId, turnId: turn.turnId, runtimeId: "codex", type: "assistant.delta", timestamp: new Date().toISOString(), payload: { text: "stale-after-dispose" } });
		};
		const driver = voiceDriver(runtime);
		const onText = vi.fn();
		const onDone = vi.fn();
		const onError = vi.fn();
		const sending = driver.send(
			{ text: "查询", channel: "voice" },
			{ onText, onDone, onError }
		);
		await Promise.resolve();
		driver.dispose();
		release.resolve();
		await sending;

		expect(onText).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});
});

describe("TTS generation callbacks", () => {
	it("routes legacy online TTS settings through system speech without network", () => {
		const speak = vi.fn();
		const webSocket = vi.fn();
		class FakeUtterance {
			onstart: (() => void) | null = null;
			onend: (() => void) | null = null;
			onerror: ((event: { error: string }) => void) | null = null;
			lang = "";
			rate = 1;
			pitch = 1;
			voice = null;
		}
		vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
		vi.stubGlobal("WebSocket", webSocket);
		vi.stubGlobal("window", {
			speechSynthesis: {
				speaking: false,
				getVoices: () => [],
				speak,
				cancel: vi.fn(),
				resume: vi.fn(),
			},
			setInterval: nodeSetInterval,
			clearInterval: nodeClearInterval,
		});
		const tts = new StreamTts({
			ttsEngine: "edgetts",
			ttsVoice: "",
			voiceLang: "zh-CN",
			ttsRate: 1,
			ttsPitch: 1,
		} as TalosSettings, vi.fn());

		tts.feed("安全播报。");

		expect(speak).toHaveBeenCalledTimes(1);
		expect(webSocket).not.toHaveBeenCalled();
		tts.stop();
	});

	it("ignores system-speech callbacks from a stopped generation", () => {
		const utterances: Array<{
			onstart: (() => void) | null;
			onend: (() => void) | null;
			onerror: ((event: { error: string }) => void) | null;
		}> = [];
		class FakeUtterance {
			onstart: (() => void) | null = null;
			onend: (() => void) | null = null;
			onerror: ((event: { error: string }) => void) | null = null;
			lang = "";
			rate = 1;
			pitch = 1;
			voice = null;
			constructor(readonly text: string) {
				utterances.push(this);
			}
		}
		const states: string[] = [];
		vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
		vi.stubGlobal("window", {
			speechSynthesis: {
				speaking: false,
				getVoices: () => [],
				speak: vi.fn(),
				cancel: vi.fn(),
				resume: vi.fn(),
			},
			setInterval: nodeSetInterval,
			clearInterval: nodeClearInterval,
		});
		const tts = new StreamTts(
			{
				ttsEngine: "system",
				ttsVoice: "",
				voiceLang: "zh-CN",
				ttsRate: 1,
				ttsPitch: 1,
			} as TalosSettings,
			(state) => states.push(state)
		);

		tts.feed("旧回复。");
		const stale = utterances[0];
		tts.stop();
		const afterStop = [...states];
		tts.feed("新回复。");
		stale.onstart?.();
		stale.onend?.();
		stale.onerror?.({ error: "stale" });
		expect(states).toEqual(afterStop);

		utterances[1]?.onstart?.();
		expect(states.at(-1)).toBe("speaking");
		tts.stop();
	});
});

describe("voice panel turn admission", () => {
	it("does not persist a message while the driver is busy", () => {
		expect(evaluateVoiceTurnAdmission({
			text: "不应持久化",
			mounted: true,
			navigatingToChat: false,
			driverBusy: true,
		})).toEqual({ accepted: false, reason: "busy" });
		const panelSource = readFileSync(
			`${projectRoot}src/quyuan/voice-panel.ts`,
			"utf8"
		);
		const admission = panelSource.indexOf("evaluateVoiceTurnAdmission({");
		const persistence = panelSource.indexOf(
			"voiceSessionStore?.appendMessage",
			admission
		);
		expect(admission).toBeGreaterThan(-1);
		expect(persistence).toBeGreaterThan(admission);
	});
});
