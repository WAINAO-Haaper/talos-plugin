import { readFileSync } from "node:fs";
import {
	clearInterval as nodeClearInterval,
	clearTimeout as nodeClearTimeout,
	setInterval as nodeSetInterval,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	Notice: class {},
	requestUrl: vi.fn(),
}));

import type { TalosSettings } from "../src/settings";
import { StreamTts } from "../src/jarvis/voiceio";
import { SerializedInferenceQueue } from "../src/quyuan/local-asr";
import { QuyuanVoiceDriver } from "../src/quyuan/voice-driver";
import { evaluateVoiceTurnAdmission } from "../src/quyuan/voice-turn-admission";
import {
	VadMic,
	type VadMicHandlers,
} from "../src/quyuan/vad-mic";
import type { ChatRuntime } from "../src/quyuan/claudian/core/runtime/ChatRuntime";
import type {
	ChatTurnRequest,
	PreparedChatTurn,
} from "../src/quyuan/claudian/core/runtime/types";
import type { StreamChunk } from "../src/quyuan/claudian/core/types";

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

class TestVadMic extends VadMic {
	readonly transcriptions: Array<Deferred<string>> = [];

	protected preflight(): string | null {
		return null;
	}

	protected transcribe(): Promise<string> {
		const deferred = new Deferred<string>();
		this.transcriptions.push(deferred);
		return deferred.promise;
	}

	commitForTest(): void {
		(
			this as unknown as {
				commitUtterance(frames: Float32Array[], turnId: number): void;
			}
		).commitUtterance([new Float32Array([0.2, 0.2])], 1);
	}
}

class DeferredPreflightVadMic extends VadMic {
	readonly preflightGate = new Deferred<string | null>();

	protected preflight(): Promise<string | null> {
		return this.preflightGate.promise;
	}

	protected transcribe(): Promise<string> {
		return Promise.resolve("");
	}
}

function installAudioMocks(): {
	getUserMedia: ReturnType<typeof vi.fn>;
	tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
} {
	const tracks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
	const getUserMedia = vi.fn(async () => {
		const track = { stop: vi.fn() };
		tracks.push(track);
		return {
			getTracks: () => [track],
		} as unknown as MediaStream;
	});
	class FakeAudioContext {
		sampleRate = 16000;
		destination = {};
		audioWorklet = { addModule: vi.fn(async () => {}) };
		createMediaStreamSource(): MediaStreamAudioSourceNode {
			return {
				connect: vi.fn(),
				disconnect: vi.fn(),
			} as unknown as MediaStreamAudioSourceNode;
		}
		async close(): Promise<void> {}
	}
	class FakeAudioWorkletNode {
		port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
		connect = vi.fn();
		disconnect = vi.fn();
	}
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	vi.stubGlobal("window", {
		AudioContext: FakeAudioContext,
		setTimeout: nodeSetTimeout,
		clearTimeout: nodeClearTimeout,
	});
	vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
	return { getUserMedia, tracks };
}

function handlers() {
	return {
		onListeningChange: vi.fn(),
		onState: vi.fn(),
		onSpeechStart: vi.fn(),
		onText: vi.fn(),
		onPartial: vi.fn(),
		onError: vi.fn(),
	} satisfies VadMicHandlers;
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("voice microphone lifecycle", () => {
	it("only auto-starts on mount when microphone permission was already granted", () => {
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
		expect(mount).toContain("autoStartRealtimeIfPermitted");
		expect(source).toContain('result?.state === "granted"');
		expect(source).toContain(
			'this.micBtn.addEventListener("click", () => void this.toggleVoiceRecognitionMode())'
		);
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
		expect(panel).toContain("There is intentionally no legacy 30-second timer");
		expect(realtime).toContain("this.setAwake(false)");
		expect(realtime).not.toContain("wakeWindowMs");
	});

	it("never acquires media after stop cancels an asynchronous preflight", async () => {
		const { getUserMedia } = installAudioMocks();
		const mic = new DeferredPreflightVadMic(
			{ quyuanVadEnabled: false } as TalosSettings,
			handlers()
		);

		const starting = mic.start();
		const stopping = mic.stop();
		mic.preflightGate.resolve(null);
		await Promise.all([starting, stopping]);

		expect(getUserMedia).not.toHaveBeenCalled();
		expect(mic.getLifecycleState()).toBe("idle");
	});

	it("deduplicates double start into one media stream", async () => {
		const { getUserMedia, tracks } = installAudioMocks();
		const h = handlers();
		const mic = new TestVadMic(
			{ quyuanVadEnabled: false } as TalosSettings,
			h
		);

		await Promise.all([mic.start(), mic.start()]);

		expect(getUserMedia).toHaveBeenCalledTimes(1);
		expect(mic.getLifecycleState()).toBe("listening");
		await mic.stop();
		expect(mic.getLifecycleState()).toBe("idle");
		expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
	});

	it("drops an old transcription after stop and rapid restart", async () => {
		installAudioMocks();
		const h = handlers();
		const mic = new TestVadMic(
			{ quyuanVadEnabled: false } as TalosSettings,
			h
		);
		await mic.start();
		mic.commitForTest();
		expect(mic.transcriptions).toHaveLength(1);
		await mic.stop();
		await mic.start();

		mic.transcriptions[0]?.resolve("旧轮次文本");
		await Promise.resolve();
		await Promise.resolve();

		expect(h.onText).not.toHaveBeenCalled();
		await mic.stop();
	});

	it("serializes a restart behind a canceled in-flight media acquisition", async () => {
		const firstMedia = new Deferred<MediaStream>();
		const firstTrack = { stop: vi.fn() };
		const secondTrack = { stop: vi.fn() };
		const getUserMedia = vi
			.fn()
			.mockImplementationOnce(() => firstMedia.promise)
			.mockResolvedValueOnce({
				getTracks: () => [secondTrack],
			});
		installAudioMocks();
		Object.defineProperty(
			navigator.mediaDevices,
			"getUserMedia",
			{ value: getUserMedia }
		);
		const mic = new TestVadMic(
			{ quyuanVadEnabled: false } as TalosSettings,
			handlers()
		);

		const firstStart = mic.start();
		await Promise.resolve();
		const stop = mic.stop();
		const restart = mic.start();
		await Promise.resolve();
		expect(getUserMedia).toHaveBeenCalledTimes(1);

		firstMedia.resolve({
			getTracks: () => [firstTrack],
		} as unknown as MediaStream);
		await Promise.all([firstStart, stop, restart]);

		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(firstTrack.stop).toHaveBeenCalled();
		expect(mic.getLifecycleState()).toBe("listening");
		await mic.stop();
	});
});

describe("local ASR serialization", () => {
	it("does not start the next session when the previous caller has timed out", async () => {
		vi.stubGlobal("window", {
			setTimeout: nodeSetTimeout,
			clearTimeout: nodeClearTimeout,
		});
		const queue = new SerializedInferenceQueue();
		const firstUnderlying = new Deferred<string>();
		let active = 0;
		let maxActive = 0;
		let secondStarted = false;
		const first = queue.run(async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			try {
				return await firstUnderlying.promise;
			} finally {
				active -= 1;
			}
		}, 5, "first");
		const firstResult = expect(first).rejects.toThrow("first");
		await firstResult;

		const second = queue.run(async () => {
			secondStarted = true;
			active += 1;
			maxActive = Math.max(maxActive, active);
			active -= 1;
			return "second";
		}, 1000, "second");
		await Promise.resolve();
		expect(secondStarted).toBe(false);
		expect(maxActive).toBe(1);

		firstUnderlying.resolve("late");
		await expect(second).resolves.toBe("second");
		expect(maxActive).toBe(1);
	});
});

function runtimeWithChunks(chunks: StreamChunk[]): ChatRuntime {
	return {
		providerId: "codex",
		prepareTurn: (request: ChatTurnRequest): PreparedChatTurn => ({
			request,
			persistedContent: request.text,
			prompt: request.text,
			isCompact: false,
			mcpMentions: new Set(),
		}),
		query: async function* () {
			for (const chunk of chunks) yield chunk;
		},
		getSessionId: () => "voice-session",
		cancel: vi.fn(),
	} as unknown as ChatRuntime;
}

function voiceDriver(runtime: ChatRuntime): QuyuanVoiceDriver {
	const plugin = {
		settings: {},
		auditQuyuanProviderEgress: async () => ({ allowed: true }),
	} as never;
	const driver = new QuyuanVoiceDriver(plugin);
	(
		driver as unknown as {
			runtimes: Partial<Record<"voice" | "text", ChatRuntime>>;
		}
	).runtimes.voice = runtime;
	return driver;
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
		runtime.query = async function* () {
			await release.promise;
			yield { type: "text", content: "stale" };
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
		runtime.query = async function* () {
			await release.promise;
			yield { type: "text", content: "stale-after-dispose" };
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
