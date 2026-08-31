import {
	isVoiceVaultToolName,
	type VoiceVaultToolName,
} from "./voice-vault-tools";
import type { ProviderUsageMetrics } from "../ai/privacy/provider-usage-audit-store";
import {
	explicitVoiceWebSearchQuery,
	isVoiceWebSearchToolName,
	VOICE_WEB_SEARCH_TOOL_NAME,
} from "./qwen-web-search";

export type RealtimeVoiceState =
	| "idle"
	| "connecting"
	| "sleeping"
	| "listening"
	| "user-speaking"
	| "thinking"
	| "assistant-speaking"
	| "tool-running"
	| "recovering"
	| "error"
	| "disconnected";

export interface QwenRealtimeAuditEvent { type: string; reasonCode: string; generation: number; callId?: string; }

export interface QwenRealtimeHandlers {
	onConnectionChange?(connected: boolean): void;
	onWakeChange?(awake: boolean): void;
	onState?(state: RealtimeVoiceState): void;
	onInputTranscript?(text: string, final: boolean): void;
	onOutputTranscript?(text: string, final: boolean): void;
	onUsage?(usage: ProviderUsageMetrics): void;
	onBargeIn?(): void;
	onError?(message: string): void;
	onAudit?(event: QwenRealtimeAuditEvent): void;
}

export interface QwenRealtimeConfig {
	model: string;
	voice: string;
	language: string;
	instructions: string;
	wakeAliases: readonly string[];
	sleepWord: string;
	timeouts?: Partial<{
		connectMs: number;
		toolMs: number;
		firstResponseMs: number;
		turnMs: number;
	}>;
	exchangeSdp(input: {
		model: string;
		instructions: string;
		offerSdp: string;
	}): Promise<{ answerSdp: string }>;
	executeVaultTool?(
		name: VoiceVaultToolName,
		args: Record<string, unknown>,
		callId: string
	): Promise<string>;
	executeWebSearch?(query: string, callId: string): Promise<string>;
}

export interface RealtimeTrackPort {
	enabled: boolean;
	stop(): void;
}

export interface RealtimeMediaStreamPort {
	getTracks(): RealtimeTrackPort[];
	getAudioTracks(): RealtimeTrackPort[];
}

export interface RealtimeDataChannelPort {
	readonly readyState: string;
	readonly label?: string;
	send(data: string): void;
	close(): void;
	addEventListener(
		type: "open" | "message" | "close" | "error",
		listener: (event: { data?: unknown }) => void
	): void;
	removeEventListener?(
		type: "open" | "message" | "close" | "error",
		listener: (event: { data?: unknown }) => void
	): void;
}

export interface RealtimePeerConnectionPort {
	localDescription: RTCSessionDescription | null;
	iceGatheringState: RTCIceGatheringState;
	connectionState?: RTCPeerConnectionState;
	ontrack: ((event: { streams: unknown[] }) => void) | null;
	ondatachannel: ((event: { channel: RealtimeDataChannelPort }) => void) | null;
	createDataChannel(label: string): RealtimeDataChannelPort;
	addTrack(track: RealtimeTrackPort, stream: RealtimeMediaStreamPort): unknown;
	createOffer(): Promise<RTCSessionDescriptionInit>;
	setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
	setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
	addEventListener?(
		type: "icegatheringstatechange" | "connectionstatechange",
		listener: () => void
	): void;
	removeEventListener?(
		type: "icegatheringstatechange" | "connectionstatechange",
		listener: () => void
	): void;
	close(): void;
}

export interface RealtimeAudioPort {
	autoplay: boolean;
	muted: boolean;
	srcObject: unknown;
	play(): Promise<void> | void;
}

export interface QwenRealtimeEnvironment {
	createPeerConnection(): RealtimePeerConnectionPort;
	getUserMedia(): Promise<RealtimeMediaStreamPort>;
	createAudioElement(): RealtimeAudioPort;
}

function defaultEnvironment(): QwenRealtimeEnvironment {
	return {
		createPeerConnection: () =>
			new RTCPeerConnection({ iceServers: [] }) as unknown as RealtimePeerConnectionPort,
		getUserMedia: async () =>
			await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			}),
		createAudioElement: () =>
			activeDocument.createElement("audio"),
	};
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function safeInteger(value: unknown): number | undefined {
	return typeof value === "number"
		&& Number.isSafeInteger(value)
		&& value >= 0
		? value
		: undefined;
}

export function parseQwenRealtimeUsage(
	value: unknown
): ProviderUsageMetrics | null {
	const usage = record(value);
	if (!usage) return null;
	const inputDetails =
		record(usage.input_token_details) ?? record(usage.input_tokens_details);
	const outputDetails =
		record(usage.output_token_details) ?? record(usage.output_tokens_details);
	const inputTextTokens = safeInteger(inputDetails?.text_tokens);
	const inputAudioTokens = safeInteger(inputDetails?.audio_tokens);
	const outputTextTokens = safeInteger(outputDetails?.text_tokens);
	const outputAudioTokens = safeInteger(outputDetails?.audio_tokens);
	const totalTokens = safeInteger(usage.total_tokens);
	const metrics: ProviderUsageMetrics = {
		...(inputTextTokens === undefined ? {} : { inputTextTokens }),
		...(inputAudioTokens === undefined ? {} : { inputAudioTokens }),
		...(outputTextTokens === undefined ? {} : { outputTextTokens }),
		...(outputAudioTokens === undefined ? {} : { outputAudioTokens }),
		...(totalTokens === undefined ? {} : { totalTokens }),
	};
	return Object.keys(metrics).length > 0 ? metrics : null;
}

const VAULT_MODULES = [
	"all",
	"inbox",
	"logs",
	"insights",
	"assets",
	"projects",
	"archive",
	"identity",
	"soul",
	"output",
	"system",
	"templates",
	"automation",
	"config",
] as const;

function moduleParameter(): Record<string, unknown> {
	return {
		type: "string",
		enum: VAULT_MODULES,
		description: "限定 TALOS 模块；用户说收件箱时选 inbox。不确定或跨模块时选 all。",
	};
}

function readOnlyVaultTools(): Array<Record<string, unknown>> {
	return [
		{
			type: "function",
			function: {
				name: "glob_vault",
				description: "只读列举或精确统计库内 Markdown 文件。回答文件/笔记数量、目录里有哪些内容时使用；不会读取正文。",
				parameters: {
					type: "object",
					properties: {
						module: moduleParameter(),
						pattern: {
							type: "string",
							description: "相对所选模块的 Glob 模式；默认 **/*.md。",
						},
						count_only: {
							type: "boolean",
							description: "只问数量时设为 true，避免发送文件名。",
						},
						include_readme: {
							type: "boolean",
							description: "是否把 _README.md 计入；默认 false。",
						},
						max_results: {
							type: "integer",
							description: "需要返回路径时的上限，1 到 100。",
						},
					},
					required: ["module"],
					additionalProperties: false,
				},
			},
		},
		{
			type: "function",
			function: {
				name: "read_vault",
				description: "只读打开一个已知或唯一命名的库内 Markdown 文件，可按行分段读取。需要具体文件内容时使用；优先使用 glob_vault、grep_vault 或 search_vault 返回的规范 path。",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "优先传其他工具返回的完整 Vault 相对 path；也可传唯一笔记名，可省略 .md。",
						},
						start_line: {
							type: "integer",
							description: "起始行，1 开始；默认 1。",
						},
						line_count: {
							type: "integer",
							description: "读取行数，最多 200；默认 80。",
						},
					},
					required: ["path"],
					additionalProperties: false,
				},
			},
		},
		{
			type: "function",
			function: {
				name: "grep_vault",
				description: "只读全文逐行匹配库内 Markdown。查某个原词、编号、姓名出现在哪些文件或多少处时使用。",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "要逐字匹配的文本。",
						},
						module: moduleParameter(),
						pattern: {
							type: "string",
							description: "可选的相对 Glob 模式；默认 **/*.md。",
						},
						max_hits: {
							type: "integer",
							description: "返回匹配行上限，1 到 40。",
						},
					},
					required: ["query", "module"],
					additionalProperties: false,
				},
			},
		},
		{
			type: "function",
			function: {
				name: "search_vault",
				description: "只读相关度搜索库内 Markdown，返回最相关的安全片段。查询主题、项目状态、人物、材料或不确定文件位置时使用。",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "保留专名和主题的简短检索词，不包含客套话。",
						},
						module: moduleParameter(),
					},
					required: ["query", "module"],
					additionalProperties: false,
				},
			},
		},
	];
}

function webSearchTool(): Record<string, unknown> {
	return {
		type: "function",
		function: {
			name: VOICE_WEB_SEARCH_TOOL_NAME,
			description: "仅当用户当前轮明确说出“联网搜索”或“上网查”时，联网检索公开网页并返回带来源的结果。每轮最多一次，不能与 Vault 工具混用。",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "当前用户明确要求联网查询的问题；可信侧会以当前转写为准，不接受其他上下文。",
					},
				},
				required: ["query"],
				additionalProperties: false,
			},
		},
	};
}

function eventKey(event: Record<string, unknown>): string {
	const outputIndex = typeof event.output_index === "number"
		|| typeof event.output_index === "string"
		? String(event.output_index)
		: "0";
	const contentIndex = typeof event.content_index === "number"
		|| typeof event.content_index === "string"
		? String(event.content_index)
		: "0";
	return (
		stringValue(event.item_id)
		|| stringValue(event.response_id)
		|| `${outputIndex}:${contentIndex}`
	);
}

function normalizeWakeText(value: string): string {
	return value.toLowerCase().replace(/[\s，。！？、,.:：；;!?~·]/g, "");
}

function normalizeAnswerSdp(value: string): string {
	return value.replace(/\r?\n/g, "\r\n").replace(/(?:\r\n)*$/, "\r\n");
}

class CancelledRealtimeStart extends Error {}

const DEFAULT_TIMEOUTS = {
	connectMs: 12_000,
	toolMs: 20_000,
	firstResponseMs: 30_000,
	turnMs: 60_000,
} as const;

export class QwenRealtimeVoiceSession {
	private readonly env: QwenRealtimeEnvironment;
	private readonly channels = new Set<RealtimeDataChannelPort>();
	private readonly channelHandlers = new Map<RealtimeDataChannelPort, {
		message: (event: { data?: unknown }) => void;
		close: () => void;
		error: () => void;
	}>();
	private readonly inputTranscripts = new Map<string, string>();
	private readonly outputTranscripts = new Map<string, string>();
	private peer: RealtimePeerConnectionPort | null = null;
	private channel: RealtimeDataChannelPort | null = null;
	private stream: RealtimeMediaStreamPort | null = null;
	private audio: RealtimeAudioPort | null = null;
	private startPromise: Promise<void> | null = null;
	private readyResolve: (() => void) | null = null;
	private readyReject: ((error: Error) => void) | null = null;
	private lifecycle = 0;
	private connected = false;
	private awake = false;
	private responseActive = false;
	private turnGeneration = 0;
	private authorizedWebSearch: {
		generation: number;
		query: string;
		used: boolean;
	} | null = null;
	private vaultToolGeneration = -1;
	private webSearchToolGeneration = -1;
	private readonly pendingToolCalls = new Set<string>();
	private readonly handledToolCalls = new Set<string>();
	private inputEnabled = true;
	private outputEnabled = true;
	private state: RealtimeVoiceState = "idle";
	private firstResponseTimer: number | null = null;
	private turnTimer: number | null = null;
	private peerStateHandler: (() => void) | null = null;

	constructor(
		private readonly config: QwenRealtimeConfig,
		private readonly handlers: QwenRealtimeHandlers = {},
		environment?: QwenRealtimeEnvironment
	) {
		this.env = environment ?? defaultEnvironment();
	}

	isConnected(): boolean {
		return this.connected;
	}

	isAwake(): boolean {
		return this.awake;
	}

	debugSnapshot(): { state: RealtimeVoiceState; lifecycle: number; turnGeneration: number; pendingToolCalls: number; handledToolCalls: number; inputTranscripts: number; outputTranscripts: number } {
		return {
			state: this.state,
			lifecycle: this.lifecycle,
			turnGeneration: this.turnGeneration,
			pendingToolCalls: this.pendingToolCalls.size,
			handledToolCalls: this.handledToolCalls.size,
			inputTranscripts: this.inputTranscripts.size,
			outputTranscripts: this.outputTranscripts.size,
		};
	}

	async start(): Promise<void> {
		if (this.connected) return;
		if (this.startPromise) return this.startPromise;
		const generation = ++this.lifecycle;
		this.emitState(this.state === "error" || this.state === "disconnected" ? "recovering" : "connecting");
		this.startPromise = this.startInternal(generation)
			.catch((error: unknown) => {
				if (error instanceof CancelledRealtimeStart || generation !== this.lifecycle) return;
				this.cleanup(false, "error");
				const message = error instanceof Error ? error.message : String(error);
				this.handlers.onError?.(message);
				throw error;
			})
			.finally(() => {
				if (generation === this.lifecycle) this.startPromise = null;
			});
		return this.startPromise;
	}

	stop(): void {
		++this.lifecycle;
		this.startPromise = null;
		this.cleanup(true, "idle");
	}

	setInputEnabled(enabled: boolean): void {
		this.inputEnabled = enabled;
		if (!this.connected) return;
		for (const track of this.stream?.getAudioTracks() ?? []) {
			track.enabled = enabled;
		}
	}

	setOutputEnabled(enabled: boolean): void {
		this.outputEnabled = enabled;
		if (this.audio) this.audio.muted = !enabled;
	}

	setAwake(awake: boolean): void {
		if (this.awake === awake) return;
		if (!awake) {
			if (this.responseActive) this.send({ type: "response.cancel" });
			this.turnGeneration += 1;
			this.responseActive = false;
			this.pendingToolCalls.clear();
			this.handledToolCalls.clear();
			this.inputTranscripts.clear();
			this.outputTranscripts.clear();
			this.authorizedWebSearch = null;
			this.vaultToolGeneration = -1;
			this.webSearchToolGeneration = -1;
			this.clearTimers();
		}
		this.awake = awake;
		this.handlers.onWakeChange?.(awake);
		this.emitState(awake ? "listening" : "sleeping");
	}

	cancelResponse(): void {
		this.beginUserTurn();
		this.pendingToolCalls.clear();
		if (this.responseActive) {
			this.send({ type: "response.cancel" });
		}
		this.responseActive = false;
		this.clearTimers();
		this.emitState(this.awake ? "listening" : "sleeping");
	}

	sendText(text: string): void {
		const value = text.trim();
		if (!value) return;
		if (!this.connected) throw new Error("Qwen Realtime voice is not connected");
		this.beginUserTurn(value);
		this.send({
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: value }],
			},
		});
		this.requestResponse();
	}

	private async startInternal(generation: number): Promise<void> {
		const stream = await this.env.getUserMedia();
		if (generation !== this.lifecycle) {
			for (const track of stream.getTracks()) track.stop();
			throw new CancelledRealtimeStart();
		}
		this.stream = stream;
		// Qwen discards media sent before session.created/session.updated. Advertise
		// the track in SDP but keep it gated until the server accepts our config.
		for (const track of stream.getAudioTracks()) track.enabled = false;

		const peer = this.env.createPeerConnection();
		this.peer = peer;
		const audio = this.env.createAudioElement();
		audio.autoplay = true;
		audio.muted = !this.outputEnabled;
		this.audio = audio;
		peer.ontrack = (event) => {
			if (generation !== this.lifecycle) return;
			audio.srcObject = event.streams[0] ?? null;
			void Promise.resolve(audio.play()).catch(() => {
				this.handlers.onError?.("浏览器阻止了语音自动播放，请再次点击语音按钮");
			});
		};
		peer.ondatachannel = (event) => {
			if (generation === this.lifecycle) this.registerChannel(event.channel, generation);
		};
		this.peerStateHandler = () => this.handlePeerStateChange(peer, generation);
		peer.addEventListener?.("connectionstatechange", this.peerStateHandler);
		for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
		this.registerChannel(peer.createDataChannel("oai-events"), generation);

		const ready = new Promise<void>((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
		});
		// start() may fail before awaiting readiness; attach a handler immediately
		// so cleanup rejection never becomes an unhandled promise.
		void ready.catch(() => {});
		const offer = await peer.createOffer();
		await peer.setLocalDescription(offer);
		await this.waitForIce(peer, generation);
		this.assertCurrent(generation);
		const offerSdp = peer.localDescription?.sdp ?? offer.sdp ?? "";
		if (!offerSdp) throw new Error("Qwen Realtime WebRTC offer is empty");
		const result = await this.withTimeout(
			this.config.exchangeSdp({
				model: this.config.model,
				instructions: this.config.instructions,
				offerSdp,
			}),
			this.timeout("connectMs"),
			"Qwen Realtime SDP exchange timed out"
		);
		this.assertCurrent(generation);
		if (!result.answerSdp.trim()) {
			throw new Error("Qwen Realtime WebRTC answer is empty");
		}
		await peer.setRemoteDescription({
			type: "answer",
			sdp: normalizeAnswerSdp(result.answerSdp),
		});
		await this.withTimeout(
			ready,
			this.timeout("connectMs"),
			"Qwen Realtime session configuration timed out"
		);
		this.assertCurrent(generation);
	}

	private async waitForIce(
		peer: RealtimePeerConnectionPort,
		generation: number
	): Promise<void> {
		if (peer.iceGatheringState === "complete") return;
		await this.withTimeout(new Promise<void>((resolve) => {
			const listener = (): void => {
				if (generation !== this.lifecycle || peer.iceGatheringState === "complete") {
					peer.removeEventListener?.("icegatheringstatechange", listener);
					resolve();
				}
			};
			peer.addEventListener?.("icegatheringstatechange", listener);
		}), Math.min(8_000, this.timeout("connectMs")), "Qwen Realtime ICE gathering timed out");
		this.assertCurrent(generation);
	}

	private timeout(name: keyof typeof DEFAULT_TIMEOUTS): number {
		const configured = this.config.timeouts?.[name];
		return typeof configured === "number" && Number.isFinite(configured) && configured > 0
			? configured
			: DEFAULT_TIMEOUTS[name];
	}

	private withTimeout<T>(
		promise: Promise<T>,
		milliseconds: number,
		message: string
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = window.setTimeout(
				() => reject(new Error(message)),
				milliseconds
			);
			promise.then(
				(value) => {
					window.clearTimeout(timer);
					resolve(value);
				},
				(error: unknown) => {
					window.clearTimeout(timer);
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			);
		});
	}

	private assertCurrent(generation: number): void {
		if (generation !== this.lifecycle) throw new CancelledRealtimeStart();
	}

	private registerChannel(channel: RealtimeDataChannelPort, generation: number): void {
		if (this.channels.has(channel)) return;
		this.channels.add(channel);
		const handlers = {
			message: (event: { data?: unknown }) => this.handleChannelMessage(event, channel, generation),
			close: () => this.handleChannelClose(generation),
			error: () => this.handleChannelError(generation),
		};
		this.channelHandlers.set(channel, handlers);
		channel.addEventListener("message", handlers.message);
		channel.addEventListener("close", handlers.close);
		channel.addEventListener("error", handlers.error);
	}

	private handleChannelMessage(event: { data?: unknown }, channel: RealtimeDataChannelPort, generation: number): void {
		if (generation !== this.lifecycle) return;
		if (typeof event.data !== "string") return;
		try {
			const payload = record(JSON.parse(event.data));
			if (!payload) return;
			if (channel.readyState === "open") this.channel = channel;
			this.handleServerEvent(payload);
		} catch {
			if (this.connected) {
				this.failTurn("千问 Realtime 返回了无法解析的事件", "protocol-event-invalid");
			} else {
				this.handlers.onError?.("千问 Realtime 返回了无法解析的事件");
			}
		}
	}

	private handleChannelClose(generation: number): void {
		if (generation !== this.lifecycle) return;
		const error = new Error("Qwen Realtime data channel closed");
		this.readyReject?.(error);
		if (!this.connected) return;
		this.disconnect("千问 Realtime 连接已关闭，请重新开启语音", "data-channel-closed");
	}

	private handleChannelError(generation: number): void {
		if (generation !== this.lifecycle) return;
		const error = new Error("Qwen Realtime data channel failed");
		this.readyReject?.(error);
		if (!this.connected) return;
		this.disconnect("千问 Realtime 数据通道异常，请重新开启语音", "data-channel-error");
	}

	private handlePeerStateChange(peer: RealtimePeerConnectionPort, generation: number): void {
		if (generation !== this.lifecycle) return;
		const state = peer.connectionState;
		if (!state || !["failed", "disconnected", "closed"].includes(state)) return;
		const error = new Error(`Qwen Realtime WebRTC connection ${state}`);
		this.readyReject?.(error);
		if (!this.connected) return;
		this.disconnect(`千问 Realtime WebRTC 已断开（${state}），请重新开启语音`, `peer-${state}`);
	}

	private disconnect(message: string, reasonCode: string): void {
		this.handlers.onAudit?.({ type: "connection", reasonCode, generation: this.turnGeneration });
		this.handlers.onError?.(message);
		++this.lifecycle;
		this.startPromise = null;
		this.cleanup(true, "disconnected");
	}

	private handleServerEvent(event: Record<string, unknown>): void {
		const type = stringValue(event.type);
		if (type === "session.created") {
			const openChannel = [...this.channels].find((item) => item.readyState === "open");
			if (!openChannel) {
				this.readyReject?.(new Error("Qwen Realtime control channel is not open"));
				return;
			}
			this.channel = openChannel;
			this.sendSessionUpdate();
			return;
		}
		if (type === "session.updated") {
			for (const track of this.stream?.getAudioTracks() ?? []) {
				track.enabled = this.inputEnabled;
			}
			this.connected = true;
			this.handlers.onConnectionChange?.(true);
			this.handlers.onWakeChange?.(this.awake);
			this.emitState(this.awake ? "listening" : "sleeping");
			this.readyResolve?.();
			this.readyResolve = null;
			this.readyReject = null;
			return;
		}
		if (type === "input_audio_buffer.speech_started") {
			if (!this.awake) {
				this.emitState("sleeping");
				return;
			}
			this.beginUserTurn();
			if (this.responseActive) this.handlers.onBargeIn?.();
			this.emitState("user-speaking");
			return;
		}
		if (type === "input_audio_buffer.speech_stopped") {
			if (this.awake) this.emitState("thinking");
			return;
		}
		if (type === "conversation.item.input_audio_transcription.delta") {
			const key = eventKey(event);
			const value = (
				stringValue(event.text) + stringValue(event.stash)
				|| stringValue(event.delta)
			);
			this.inputTranscripts.set(key, value);
			if (this.awake) this.handlers.onInputTranscript?.(value, false);
			return;
		}
		if (type === "conversation.item.input_audio_transcription.completed") {
			const key = eventKey(event);
			const value = (
				stringValue(event.transcript) || this.inputTranscripts.get(key) || ""
			).trim();
			this.inputTranscripts.delete(key);
			this.handleCompletedInput(value);
			return;
		}
		if (type === "conversation.item.input_audio_transcription.failed") {
			this.inputTranscripts.delete(eventKey(event));
			this.failTurn("千问 Realtime 语音转写失败，请再说一次", "transcription-failed");
			return;
		}
		if (type === "response.created") {
			this.clearFirstResponseTimer();
			this.responseActive = true;
			if (this.awake) this.emitState("thinking");
			return;
		}
		if (type === "response.function_call_arguments.done") {
			void this.handleFunctionCall(event);
			return;
		}
		if (type === "response.audio_transcript.delta") {
			this.clearFirstResponseTimer();
			const key = eventKey(event);
			const value = (this.outputTranscripts.get(key) ?? "") + stringValue(event.delta);
			this.outputTranscripts.set(key, value);
			this.emitState("assistant-speaking");
			this.handlers.onOutputTranscript?.(value, false);
			return;
		}
		if (type === "response.audio_transcript.done") {
			const key = eventKey(event);
			const value = (
				stringValue(event.transcript)
				|| this.outputTranscripts.get(key)
				|| ""
			).trim();
			this.outputTranscripts.delete(key);
			if (value) this.handlers.onOutputTranscript?.(value, true);
			return;
		}
		if (type === "response.done") {
			this.responseActive = false;
			this.clearFirstResponseTimer();
			const response = record(event.response);
			const status = stringValue(response?.status);
			const usage = parseQwenRealtimeUsage(response?.usage);
			if (usage) this.handlers.onUsage?.(usage);
			if (status === "failed" || status === "incomplete" || status === "cancelled") {
				this.failTurn(
					status === "failed" ? "千问 Realtime 回复失败" : "千问 Realtime 回复未完整结束，请重试",
					`response-${status}`
				);
				return;
			}
			if (this.pendingToolCalls.size === 0) {
				this.clearTimers();
				this.handledToolCalls.clear();
				this.inputTranscripts.clear();
				this.outputTranscripts.clear();
			}
			this.emitState(
				this.pendingToolCalls.size > 0
					? "tool-running"
					: this.awake ? "listening" : "sleeping"
			);
			return;
		}
		if (type === "error") {
			const error = record(event.error);
			const code = stringValue(error?.code);
			const message = stringValue(error?.message) || "Qwen Realtime session error";
			if (/cancel|not_active/i.test(code)) {
				this.turnGeneration += 1;
				this.responseActive = false;
				this.pendingToolCalls.clear();
				this.handledToolCalls.clear();
				this.inputTranscripts.clear();
				this.outputTranscripts.clear();
				this.authorizedWebSearch = null;
				this.vaultToolGeneration = -1;
				this.webSearchToolGeneration = -1;
				this.clearTimers();
				this.emitState(this.awake ? "listening" : "sleeping");
				return;
			}
			if (!this.connected) this.readyReject?.(new Error(message));
			else this.failTurn(message, code ? `server-${code}` : "server-error");
			return;
		}
	}

	private async handleFunctionCall(event: Record<string, unknown>): Promise<void> {
		const callId = stringValue(event.call_id).trim();
		const name = stringValue(event.name).trim();
		if (!callId || this.handledToolCalls.has(callId)) return;
		this.handledToolCalls.add(callId);
		const generation = this.turnGeneration;
		this.pendingToolCalls.add(callId);
		this.emitState("tool-running");
		let output: string;
		try {
			if (!this.awake) throw new Error("语音尚未唤醒");
			if (isVoiceVaultToolName(name)) {
				const parsed = record(JSON.parse(stringValue(event.arguments) || "{}"));
				if (!parsed) throw new Error("语音工具参数无效");
				if (!this.config.executeVaultTool) throw new Error("库内只读工具未获授权");
				if (this.webSearchToolGeneration === generation) {
					throw new Error("同一轮不能混用库内工具与联网搜索");
				}
				this.vaultToolGeneration = generation;
				output = await this.withTimeout(
					this.config.executeVaultTool(name, parsed, callId),
					this.timeout("toolMs"),
					"语音库内工具执行超时"
				);
			} else if (isVoiceWebSearchToolName(name)) {
				if (!this.config.executeWebSearch) throw new Error("联网搜索未获授权");
				const authorization = this.authorizedWebSearch;
				if (
					!authorization
					|| authorization.generation !== generation
					|| authorization.used
				) {
					throw new Error("请在当前问题中明确说“联网搜索”或“上网查”");
				}
				if (this.vaultToolGeneration === generation) {
					throw new Error("同一轮不能混用库内工具与联网搜索");
				}
				authorization.used = true;
				this.webSearchToolGeneration = generation;
				output = await this.withTimeout(
					this.config.executeWebSearch(authorization.query, callId),
					this.timeout("toolMs"),
					"语音联网工具执行超时"
				);
			} else {
				throw new Error("该语音工具未获授权");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/超时|timed out/i.test(message)) {
				this.handlers.onAudit?.({ type: "tool-timeout", reasonCode: "tool-timeout", generation, callId });
			}
			output = JSON.stringify({
				ok: false,
				error: message.slice(0, 240),
				instruction: isVoiceWebSearchToolName(name)
					? "向用户简短说明联网搜索未执行或暂不可用，不要用模型旧知识冒充搜索结果。"
					: "向用户简短说明库内只读工具暂时不可用，不要猜测答案。",
			});
		}
		this.pendingToolCalls.delete(callId);
		if (
			generation !== this.turnGeneration
			|| !this.connected
			|| !this.awake
		) {
			this.handlers.onAudit?.({ type: "tool-result", reasonCode: "stale-tool-result", generation, callId });
			return;
		}
		this.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: callId,
				output,
			},
		});
		this.requestResponse();
		this.emitState("thinking");
	}

	private handleCompletedInput(text: string): void {
		if (!text) {
			if (this.responseActive) this.send({ type: "response.cancel" });
			this.responseActive = false;
			this.pendingToolCalls.clear();
			this.handledToolCalls.clear();
			this.inputTranscripts.clear();
			this.outputTranscripts.clear();
			this.authorizedWebSearch = null;
			this.clearTimers();
			this.handlers.onAudit?.({ type: "transcription", reasonCode: "empty-transcript", generation: this.turnGeneration });
			this.emitState(this.awake ? "listening" : "sleeping");
			return;
		}
		this.beginUserTurn(text);
		if (!this.awake) {
			if (!this.matchesWake(text)) {
				this.authorizedWebSearch = null;
				this.clearTimers();
				this.emitState("sleeping");
				return;
			}
			this.setAwake(true);
			this.handlers.onInputTranscript?.(text, true);
			this.requestResponse();
			return;
		}

		this.handlers.onInputTranscript?.(text, true);
		if (normalizeWakeText(text).includes(normalizeWakeText(this.config.sleepWord))) {
			this.cancelResponse();
			this.setAwake(false);
			return;
		}
		this.requestResponse();
	}

	private matchesWake(text: string): boolean {
		const normalized = normalizeWakeText(text);
		return this.config.wakeAliases.some((alias) =>
			normalized.includes(normalizeWakeText(alias))
		);
	}

	private beginUserTurn(text = ""): void {
		this.turnGeneration += 1;
		this.clearTimers();
		this.pendingToolCalls.clear();
		this.handledToolCalls.clear();
		this.inputTranscripts.clear();
		this.outputTranscripts.clear();
		this.authorizedWebSearch = null;
		this.vaultToolGeneration = -1;
		this.webSearchToolGeneration = -1;
		const query = explicitVoiceWebSearchQuery(text);
		if (query) {
			this.authorizedWebSearch = {
				generation: this.turnGeneration,
				query,
				used: false,
			};
		}
		const generation = this.turnGeneration;
		this.turnTimer = window.setTimeout(() => {
			if (generation === this.turnGeneration) this.failTurn("千问 Realtime 本轮处理超时，请重试", "turn-timeout");
		}, this.timeout("turnMs"));
	}

	private requestResponse(): void {
		this.send({ type: "response.create" });
		if (this.firstResponseTimer !== null) window.clearTimeout(this.firstResponseTimer);
		const generation = this.turnGeneration;
		this.firstResponseTimer = window.setTimeout(() => {
			if (generation === this.turnGeneration && !this.responseActive) {
				this.failTurn("千问 Realtime 首次回复超时，请重试", "first-response-timeout");
			}
		}, this.timeout("firstResponseMs"));
	}

	private clearFirstResponseTimer(): void {
		if (this.firstResponseTimer !== null) window.clearTimeout(this.firstResponseTimer);
		this.firstResponseTimer = null;
	}

	private clearTimers(): void {
		this.clearFirstResponseTimer();
		if (this.turnTimer !== null) window.clearTimeout(this.turnTimer);
		this.turnTimer = null;
	}

	private failTurn(message: string, reasonCode: string): void {
		this.handlers.onAudit?.({ type: "turn-recovery", reasonCode, generation: this.turnGeneration });
		this.handlers.onError?.(message);
		this.emitState("error");
		this.turnGeneration += 1;
		this.responseActive = false;
		this.pendingToolCalls.clear();
		this.handledToolCalls.clear();
		this.inputTranscripts.clear();
		this.outputTranscripts.clear();
		this.authorizedWebSearch = null;
		this.clearTimers();
		if (this.connected) {
			this.emitState("recovering");
			this.emitState(this.awake ? "listening" : "sleeping");
		}
	}

	private sendSessionUpdate(): void {
		const tools = [
			...(this.config.executeVaultTool ? readOnlyVaultTools() : []),
			...(this.config.executeWebSearch ? [webSearchTool()] : []),
		];
		this.send({
			event_id: `event_${Date.now()}_${Math.random().toString(36).slice(2)}`,
			type: "session.update",
			session: {
				modalities: ["text", "audio"],
				model: this.config.model,
				voice: this.config.voice,
				input_audio_format: "pcm",
				output_audio_format: "pcm",
				input_audio_transcription: {
					model: "qwen3-asr-flash-realtime",
				},
				instructions: this.config.instructions,
				turn_detection: {
					type: "semantic_vad",
					create_response: false,
					interrupt_response: true,
				},
				max_tokens: 1024,
				tools,
			},
		});
	}

	private send(payload: Record<string, unknown>): void {
		if (this.channel?.readyState !== "open") return;
		this.channel.send(JSON.stringify(payload));
	}

	private emitState(state: RealtimeVoiceState): void {
		if (this.state === state) return;
		this.state = state;
		this.handlers.onState?.(state);
	}

	private cleanup(notify: boolean, finalState: "idle" | "error" | "disconnected"): void {
		const wasConnected = this.connected;
		this.clearTimers();
		this.connected = false;
		this.awake = false;
		this.responseActive = false;
		this.turnGeneration += 1;
		this.authorizedWebSearch = null;
		this.vaultToolGeneration = -1;
		this.webSearchToolGeneration = -1;
		this.pendingToolCalls.clear();
		this.handledToolCalls.clear();
		this.readyReject?.(new CancelledRealtimeStart());
		this.readyResolve = null;
		this.readyReject = null;
		this.inputTranscripts.clear();
		this.outputTranscripts.clear();
		for (const channel of this.channels) {
			const handlers = this.channelHandlers.get(channel);
			if (handlers) {
				channel.removeEventListener?.("message", handlers.message);
				channel.removeEventListener?.("close", handlers.close);
				channel.removeEventListener?.("error", handlers.error);
			}
			try {
				channel.close();
			} catch {
				// Best-effort WebRTC teardown.
			}
		}
		this.channels.clear();
		this.channelHandlers.clear();
		this.channel = null;
		if (this.peer) {
			if (this.peerStateHandler) this.peer.removeEventListener?.("connectionstatechange", this.peerStateHandler);
			try {
				this.peer.close();
			} catch {
				// Best-effort WebRTC teardown.
			}
		}
		this.peerStateHandler = null;
		this.peer = null;
		for (const track of this.stream?.getTracks() ?? []) {
			try {
				track.stop();
			} catch {
				// Best-effort microphone teardown.
			}
		}
		this.stream = null;
		if (this.audio) this.audio.srcObject = null;
		this.audio = null;
		if (notify || wasConnected) {
			this.handlers.onConnectionChange?.(false);
			this.handlers.onWakeChange?.(false);
		}
		this.emitState(finalState);
	}
}
