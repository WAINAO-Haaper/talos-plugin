import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	QwenRealtimeVoiceSession,
	type QwenRealtimeEnvironment,
	type RealtimeAudioPort,
	type RealtimeDataChannelPort,
	type RealtimeMediaStreamPort,
	type RealtimePeerConnectionPort,
	type RealtimeTrackPort,
} from "../src/quyuan/qwen-realtime-voice";
import type { VoiceVaultToolName } from "../src/quyuan/voice-vault-tools";

class FakeTrack implements RealtimeTrackPort {
	enabled = true;
	stopped = false;

	stop(): void {
		this.stopped = true;
	}
}

class FakeStream implements RealtimeMediaStreamPort {
	readonly track = new FakeTrack();

	getTracks(): RealtimeTrackPort[] {
		return [this.track];
	}

	getAudioTracks(): RealtimeTrackPort[] {
		return [this.track];
	}
}

type ChannelEvent = "open" | "message" | "close" | "error";

class FakeChannel implements RealtimeDataChannelPort {
	readyState = "connecting";
	readonly sent: Array<Record<string, unknown>> = [];
	private readonly listeners = new Map<
		ChannelEvent,
		Set<(event: { data?: unknown }) => void>
	>();

	constructor(readonly label = "oai-events") {}

	send(data: string): void {
		const payload = JSON.parse(data) as Record<string, unknown>;
		this.sent.push(payload);
		if (payload.type === "session.update") {
			queueMicrotask(() => this.message({ type: "session.updated" }));
		}
	}

	close(): void {
		this.readyState = "closed";
		this.emit("close", {});
	}

	addEventListener(
		type: ChannelEvent,
		listener: (event: { data?: unknown }) => void
	): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(
		type: ChannelEvent,
		listener: (event: { data?: unknown }) => void
	): void {
		this.listeners.get(type)?.delete(listener);
	}

	open(): void {
		this.readyState = "open";
		this.emit("open", {});
	}

	message(payload: Record<string, unknown>): void {
		this.emit("message", { data: JSON.stringify(payload) });
	}

	private emit(type: ChannelEvent, event: { data?: unknown }): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

class FakePeer implements RealtimePeerConnectionPort {
	localDescription: RTCSessionDescription | null = null;
	iceGatheringState: RTCIceGatheringState = "new";
	connectionState: RTCPeerConnectionState = "new";
	ontrack: ((event: { streams: unknown[] }) => void) | null = null;
	ondatachannel: ((event: { channel: RealtimeDataChannelPort }) => void) | null = null;
	readonly channel = new FakeChannel();
	closed = false;
	private readonly listeners = new Map<string, Set<() => void>>();

	createDataChannel(): RealtimeDataChannelPort {
		return this.channel;
	}

	addTrack(): unknown {
		return {};
	}

	async createOffer(): Promise<RTCSessionDescriptionInit> {
		return { type: "offer", sdp: "v=0\no=fake\n" };
	}

	async setLocalDescription(
		description: RTCSessionDescriptionInit
	): Promise<void> {
		this.localDescription = description as RTCSessionDescription;
		this.iceGatheringState = "complete";
		this.emit("icegatheringstatechange");
	}

	async setRemoteDescription(): Promise<void> {
		this.connectionState = "connected";
		this.channel.open();
		this.channel.message({ type: "session.created" });
	}

	addEventListener(type: string, listener: () => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: () => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	close(): void {
		this.closed = true;
		this.connectionState = "closed";
	}

	private emit(type: string): void {
		for (const listener of this.listeners.get(type) ?? []) listener();
	}
}

function createHarness() {
	const stream = new FakeStream();
	const peer = new FakePeer();
	const audio: RealtimeAudioPort = {
		autoplay: false,
		muted: false,
		srcObject: null,
		play: vi.fn(),
	};
	const env: QwenRealtimeEnvironment = {
		createPeerConnection: () => peer,
		getUserMedia: vi.fn(async () => stream),
		createAudioElement: () => audio,
	};
	const exchangeSdp = vi.fn(async (_input: {
		model: string;
		instructions: string;
		offerSdp: string;
	}) => ({ answerSdp: "v=0\r\no=qwen\r\n" }));
	const executeVaultTool = vi.fn(async (
		name: VoiceVaultToolName,
		args: Record<string, unknown>,
		callId: string
	) =>
		JSON.stringify({ found: true, name, args, callId, sources: [] })
	);
	const executeWebSearch = vi.fn(async (query: string, callId: string) =>
		JSON.stringify({ ok: true, query, callId, sources: [] })
	);
	const input = vi.fn();
	const output = vi.fn();
	const usage = vi.fn();
	const wake = vi.fn();
	const barge = vi.fn();
	const connection = vi.fn();
	const session = new QwenRealtimeVoiceSession({
		model: "qwen3.5-omni-flash-realtime",
		voice: "Tina",
		language: "zh-CN",
		instructions: "You are Quyuan.",
		wakeAliases: ["屈原", "曲原"],
		sleepWord: "退下",
		exchangeSdp,
		executeVaultTool,
		executeWebSearch,
	}, {
		onInputTranscript: input,
		onOutputTranscript: output,
		onUsage: usage,
		onWakeChange: wake,
		onBargeIn: barge,
		onConnectionChange: connection,
	}, env);
	return {
		session,
		stream,
		peer,
		audio,
		exchangeSdp,
		executeVaultTool,
		executeWebSearch,
		input,
		output,
		usage,
		wake,
		barge,
		connection,
	};
}

function sentTypes(channel: FakeChannel): string[] {
	return channel.sent.map((event) => String(event.type));
}

beforeEach(() => {
	vi.stubGlobal("window", {
		setTimeout: nodeSetTimeout,
		clearTimeout: nodeClearTimeout,
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Qwen Omni Realtime WebRTC session", () => {
	it("gates microphone media until session.updated and configures native interruption", async () => {
		const h = createHarness();
		let enabledDuringExchange = true;
		h.exchangeSdp.mockImplementationOnce(async () => {
			enabledDuringExchange = h.stream.track.enabled;
			return { answerSdp: "v=0\r\no=qwen\r\n" };
		});

		await h.session.start();

		expect(enabledDuringExchange).toBe(false);
		expect(h.stream.track.enabled).toBe(true);
		expect(h.session.isConnected()).toBe(true);
		expect(h.exchangeSdp).toHaveBeenCalledOnce();
		const exchange = h.exchangeSdp.mock.calls[0]?.[0];
		expect(exchange?.model).toBe("qwen3.5-omni-flash-realtime");
		expect(exchange?.offerSdp).toContain("v=0");
		const update = h.peer.channel.sent.find((event) =>
			event.type === "session.update"
		);
		expect(update).toMatchObject({
			session: {
				max_tokens: 1024,
				turn_detection: {
					type: "semantic_vad",
					create_response: false,
					interrupt_response: true,
				},
			},
		});
		const tools = (update?.session as {
			tools: Array<{ function: { name: string } }>;
		}).tools;
		expect(tools.map((tool) => tool.function.name)).toEqual([
			"glob_vault",
			"read_vault",
			"grep_vault",
			"search_vault",
			"web_search",
		]);
	});

	it("uses only the explicit current transcript for one web search per turn", async () => {
		const h = createHarness();
		await h.session.start();
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "wake",
			transcript: "屈原",
		});
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "search-turn",
			transcript: "联网搜索今天的杭州天气",
		});
		h.peer.channel.sent.length = 0;

		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "web_search",
			call_id: "call-web-1",
			arguments: "{malformed-model-arguments",
		});

		await vi.waitFor(() => {
			expect(h.executeWebSearch).toHaveBeenCalledWith(
				"联网搜索今天的杭州天气",
				"call-web-1"
			);
		});
		expect(sentTypes(h.peer.channel)).toEqual([
			"conversation.item.create",
			"response.create",
		]);

		h.peer.channel.sent.length = 0;
		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "web_search",
			call_id: "call-web-duplicate",
			arguments: JSON.stringify({ query: "再查一次" }),
		});
		await vi.waitFor(() => {
			expect(sentTypes(h.peer.channel)).toEqual([
				"conversation.item.create",
				"response.create",
			]);
		});
		expect(h.executeWebSearch).toHaveBeenCalledTimes(1);
		const duplicateOutput = h.peer.channel.sent.find((event) =>
			event.type === "conversation.item.create"
		) as { item?: { output?: string } } | undefined;
		expect(duplicateOutput?.item?.output).toContain("当前问题中明确说");
	});

	it("denies web search while asleep, without the phrase, and after a Vault tool", async () => {
		const h = createHarness();
		await h.session.start();
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "ambient-search",
			transcript: "联网搜索杭州天气",
		});
		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "web_search",
			call_id: "call-web-asleep",
			arguments: "{}",
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(h.executeWebSearch).not.toHaveBeenCalled();

		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "wake",
			transcript: "屈原",
		});
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "plain-turn",
			transcript: "今天杭州天气如何",
		});
		h.peer.channel.sent.length = 0;
		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "web_search",
			call_id: "call-web-denied",
			arguments: JSON.stringify({ query: "今天杭州天气如何" }),
		});
		await vi.waitFor(() => {
			expect(sentTypes(h.peer.channel)).toContain("conversation.item.create");
		});
		expect(h.executeWebSearch).not.toHaveBeenCalled();

		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "mixed-turn",
			transcript: "联网搜索 TPI-119 的公开信息",
		});
		h.peer.channel.sent.length = 0;
		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "grep_vault",
			call_id: "call-vault-mixed",
			arguments: JSON.stringify({ query: "TPI-119", module: "projects" }),
		});
		await vi.waitFor(() => {
			expect(h.executeVaultTool).toHaveBeenCalledWith(
				"grep_vault",
				{ query: "TPI-119", module: "projects" },
				"call-vault-mixed"
			);
		});
		h.peer.channel.sent.length = 0;
		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "web_search",
			call_id: "call-web-mixed",
			arguments: JSON.stringify({ query: "TPI-119" }),
		});
		await vi.waitFor(() => {
			expect(sentTypes(h.peer.channel)).toContain("conversation.item.create");
		});
		expect(h.executeWebSearch).not.toHaveBeenCalled();
		const mixedOutput = h.peer.channel.sent.find((event) =>
			event.type === "conversation.item.create"
		) as { item?: { output?: string } } | undefined;
		expect(mixedOutput?.item?.output).toContain("不能混用");
	});

	it("reports realtime text and audio token usage without transcript content", async () => {
		const h = createHarness();
		await h.session.start();
		h.peer.channel.message({
			type: "response.done",
			response: {
				status: "completed",
				usage: {
					input_tokens_details: { text_tokens: 12, audio_tokens: 34 },
					output_tokens_details: { text_tokens: 5, audio_tokens: 21 },
					total_tokens: 72,
				},
			},
		});
		expect(h.usage).toHaveBeenCalledWith({
			inputTextTokens: 12,
			inputAudioTokens: 34,
			outputTextTokens: 5,
			outputAudioTokens: 21,
			totalTokens: 72,
		});
	});

	it("routes an authorized read-only Vault tool and returns its output before continuing", async () => {
		const h = createHarness();
		await h.session.start();
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "wake",
			transcript: "屈原",
		});
		h.peer.channel.sent.length = 0;

		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "grep_vault",
			call_id: "call-vault-1",
			arguments: JSON.stringify({
				query: "TPI-111",
				module: "projects",
			}),
		});

		await vi.waitFor(() => {
			expect(h.executeVaultTool).toHaveBeenCalledWith(
				"grep_vault",
				{ query: "TPI-111", module: "projects" },
				"call-vault-1"
			);
		});
		const toolOutput = h.peer.channel.sent.find((event) =>
			event.type === "conversation.item.create"
		);
		expect(toolOutput).toMatchObject({
			item: {
				type: "function_call_output",
				call_id: "call-vault-1",
			},
		});
		expect(sentTypes(h.peer.channel)).toEqual([
			"conversation.item.create",
			"response.create",
		]);
	});

	it("drops a pending Vault result when the user starts a newer turn", async () => {
		const h = createHarness();
		let resolveSearch: ((value: string) => void) | undefined;
		h.executeVaultTool.mockImplementationOnce(() => new Promise<string>((resolve) => {
			resolveSearch = resolve;
		}));
		await h.session.start();
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "wake",
			transcript: "屈原",
		});
		h.peer.channel.sent.length = 0;
		h.peer.channel.message({
			type: "response.function_call_arguments.done",
			name: "search_vault",
			call_id: "stale-call",
			arguments: JSON.stringify({ query: "旧问题" }),
		});
		await vi.waitFor(() => expect(h.executeVaultTool).toHaveBeenCalledOnce());
		h.peer.channel.message({ type: "input_audio_buffer.speech_started" });
		resolveSearch?.("旧结果");
		await Promise.resolve();
		await Promise.resolve();

		expect(sentTypes(h.peer.channel)).not.toContain("conversation.item.create");
		expect(sentTypes(h.peer.channel)).not.toContain("response.create");
	});

	it("ignores ambient turns, wakes by alias, and manually creates each awake response", async () => {
		const h = createHarness();
		await h.session.start();
		h.peer.channel.sent.length = 0;

		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "ambient",
			transcript: "今天天气不错",
		});
		expect(h.session.isAwake()).toBe(false);
		expect(sentTypes(h.peer.channel)).not.toContain("response.create");

		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "wake",
			transcript: "曲原，请听我说",
		});
		expect(h.session.isAwake()).toBe(true);
		expect(sentTypes(h.peer.channel)).toContain("response.create");
		expect(h.input).toHaveBeenLastCalledWith("曲原，请听我说", true);

		h.peer.channel.sent.length = 0;
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "next",
			transcript: "继续这个话题",
		});
		expect(sentTypes(h.peer.channel)).toEqual(["response.create"]);
	});

	it("streams transcripts, reports barge-in, and sleeps without creating another response", async () => {
		const h = createHarness();
		await h.session.start();
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "wake",
			transcript: "屈原",
		});
		h.peer.channel.message({ type: "response.created" });
		h.peer.channel.message({ type: "input_audio_buffer.speech_started" });
		expect(h.barge).toHaveBeenCalledOnce();

		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.delta",
			item_id: "turn",
			text: "先别",
			stash: "回答",
		});
		expect(h.input).toHaveBeenCalledWith("先别回答", false);
		h.peer.channel.message({
			type: "response.audio_transcript.delta",
			response_id: "response",
			delta: "好的",
		});
		h.peer.channel.message({
			type: "response.audio_transcript.done",
			response_id: "response",
			transcript: "好的，我在听。",
		});
		expect(h.output).toHaveBeenCalledWith("好的", false);
		expect(h.output).toHaveBeenCalledWith("好的，我在听。", true);

		h.peer.channel.sent.length = 0;
		h.peer.channel.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "sleep",
			transcript: "先退下吧",
		});
		expect(h.session.isAwake()).toBe(false);
		expect(sentTypes(h.peer.channel)).toContain("response.cancel");
		expect(sentTypes(h.peer.channel)).not.toContain("response.create");
	});

	it("mutes output independently and releases peer, channel, and microphone on stop", async () => {
		const h = createHarness();
		await h.session.start();
		h.session.setOutputEnabled(false);
		expect(h.audio.muted).toBe(true);

		h.session.stop();

		expect(h.stream.track.stopped).toBe(true);
		expect(h.peer.closed).toBe(true);
		expect(h.peer.channel.readyState).toBe("closed");
		expect(h.session.isConnected()).toBe(false);
		expect(h.connection).toHaveBeenLastCalledWith(false);
	});

	it("releases microphone and peer when the realtime data channel closes", async () => {
		const h = createHarness();
		await h.session.start();

		h.peer.channel.close();

		expect(h.stream.track.stopped).toBe(true);
		expect(h.peer.closed).toBe(true);
		expect(h.session.isConnected()).toBe(false);
		expect(h.connection).toHaveBeenLastCalledWith(false);
	});
});
