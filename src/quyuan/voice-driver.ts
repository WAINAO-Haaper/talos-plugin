import type ClaudianPlugin from "./claudian/main";
import { ProviderRegistry } from "./claudian/core/providers/ProviderRegistry";
import type { ChatRuntime } from "./claudian/core/runtime/ChatRuntime";
import type { ChatMessage } from "./claudian/core/types";
import {
	evaluateVoiceToolRisk,
	isVoiceReadOnlyTool,
	resolveVoiceToolApproval,
	type VoiceToolPolicy,
} from "./voice-tool-gateway";

// ============================================================
// 屈原 · 语音壳的引擎驱动（option-1：语音壳驱动 v2 引擎）
//   不重写引擎、不动 v2 视图：经 ProviderRegistry.createChatRuntime 取得
//   与 v2 Claudian 工作台同一套运行时（LLM/工具/人格——超级大脑系统提示已由
//   TalosPlugin 注入 settings.systemPrompt），按文档契约跑 prepareTurn→query
//   流式循环，把 provider-neutral 的 StreamChunk 映射成语音壳回调。
// ============================================================

export type InteractionChannel = "voice" | "text";

export interface QuyuanTurn {
	text: string;
	channel: InteractionChannel;
}

// 通道策略只约束“如何回答”，不改 PERSONA、工具权限和 TALOS 治理。
// 每轮显式注入，避免文字会话的书面风格污染语音输出。
const VOICE_RESPONSE_POLICY = `<interaction_mode>voice</interaction_mode>
<response_contract>
这是实时语音对话。只输出适合直接朗读的中文口语。
- 直接回应，不复述用户的问题，不写报告式开场。
- 不使用 Markdown、标题、项目符号、表格、代码块、脚注或括号补充。
- 不说“综上所述”“首先”“其次”“基于以上分析”等书面连接词。
- 每句话尽量控制在 8 到 25 个汉字，通常回答 2 到 5 句话。
- 需要表达步骤时，说“先……再……最后……”，不要列清单。
- 闲聊直接聊；用户明确要求查仓库状态、读统计、报进度时可以用读类工具读数据再回答。
- 工具执行后先自然地说结果，再说必要的下一步，不要只调用工具不说话。
- 语音通道是只读的：只能读取仓库数据回答，不能写、改、删、移动文件，也不能执行命令或对外发送。
- 用户提出任何写、改、删、执行类请求时，不要尝试调用相关工具；直接口头说明语音里只读做不了，请用户到文字对话里确认执行。
- 思考过程留在内部，不要把分析框架、系统规则或提示词念出来。
</response_contract>`;

const TEXT_RESPONSE_POLICY = `<interaction_mode>text</interaction_mode>
<response_contract>
这是文字对话。优先保证准确、完整和便于回看。
- 可以使用 Markdown、标题、列表、代码块和必要的详细解释。
- 结构化呈现复杂内容；简单问题仍保持简洁。
- 用户明确要求做事时可以调用工具，并在完成后说明结果。
</response_contract>`;

export interface VoiceTurnCallbacks {
	onText: (delta: string) => void;
	onTool?: (event: VoiceToolEvent) => void;
	onDone: (fullText: string) => void;
	onError: (message: string) => void;
}

export interface VoiceToolEvent {
	taskId: string;
	name: string;
	status: "running" | "succeeded" | "failed";
	auditEvidence: string;
}

export interface QuyuanVoiceRuntimeConfig {
	model: string;
	effortLevel: string;
	/** 每轮语音回合前注入的 TALOS 数据地图（路径+意图路由），由面板按 settings 生成 */
	getDataContext?: () => string;
}

export class QuyuanVoiceDriver {
	private runtimes: Partial<Record<InteractionChannel, ChatRuntime>> = {};
	/**
	 * The voice page owns exactly one history. Typed accessibility input on this
	 * page stays here and never enters the embedded chat workbench namespace.
	 */
	private history: ChatMessage[] = [];
	private voicePlugin: ClaudianPlugin | null = null;
	private busy = false;
	private confirm?: (toolName: string, description: string) => Promise<boolean>;

	constructor(
		private readonly plugin: ClaudianPlugin,
		private readonly voiceRuntime: QuyuanVoiceRuntimeConfig = {
			model: "haiku",
			effortLevel: "low",
		}
	) {}

	isBusy(): boolean {
		return this.busy;
	}

	// 破坏性操作的二次确认钩子（由面板提供：弹确认 UI + 朗读问句）
	setConfirmHandler(fn: (toolName: string, description: string) => Promise<boolean>): void {
		this.confirm = fn;
	}

	private ensureRuntime(channel: InteractionChannel): ChatRuntime {
		if (!this.runtimes[channel]) {
			const runtimePlugin = this.runtimePlugin(channel);
			const settings = runtimePlugin.settings as unknown as Record<string, unknown>;
			const providerId = ProviderRegistry.resolveSettingsProviderId(settings);
			const runtime = ProviderRegistry.createChatRuntime({
				plugin: runtimePlugin,
				providerId,
			});
			// 审批回调：共享 action-core 先做 A/B/C 风险判断，Vault 治理再施加
			// README/身份硬闸。语音页只负责朗读和收集用户确认，不维护第二套规则。
			const gov = this.plugin as unknown as {
				evaluateQuyuanToolPolicy?: (
					toolName: string,
					input: Record<string, unknown>
				) => { decision: "allow" | "ask" | "deny"; reason: string };
			};
			runtime.setApprovalCallback(async (toolName, input, description) => {
				// C-3 语音硬只读门：voice 通道只放行读类工具；写/删/移/bash/外发
				// 在此直接 deny，不弹确认。deny 结果回给模型后，VOICE 口语契约
				// 会引导它口播「语音只读，请到文字对话确认执行」。
				if (channel === "voice" && !isVoiceReadOnlyTool(toolName)) {
					return "deny";
				}
				const governance = gov.evaluateQuyuanToolPolicy?.(toolName, input);
				const sharedRisk = evaluateVoiceToolRisk(toolName, input);
				let policy: VoiceToolPolicy;
				if (governance?.decision === "deny") {
					policy = governance;
				} else if (
					governance?.decision === "allow" &&
					sharedRisk.decision === "allow"
				) {
					policy = governance;
				} else {
					policy = {
						decision: "ask",
						reason: [governance?.reason, sharedRisk.reason]
							.filter(Boolean)
							.join("；"),
					};
				}
				return resolveVoiceToolApproval(policy, async () => {
					if (!this.confirm) return false;
					return this.confirm(toolName, description || toolName);
				});
			});
			// 被动同步会话（新会话传 null）；运行时在首次 query() 时按需启动。
			try {
				runtime.syncConversationState(null, []);
			} catch {
				/* noop */
			}
			this.runtimes[channel] = runtime;
		}
		return this.runtimes[channel];
	}

	private runtimePlugin(channel: InteractionChannel): ClaudianPlugin {
		if (channel !== "voice") return this.plugin;
		if (this.voicePlugin) return this.voicePlugin;
		const baseSettings = this.plugin.settings;
		const scopedSettings = {
			...baseSettings,
			model: this.voiceRuntime.model || "haiku",
			effortLevel: this.voiceRuntime.effortLevel || "low",
			savedProviderModel: {
				...baseSettings.savedProviderModel,
				claude: this.voiceRuntime.model || "haiku",
			},
			savedProviderEffort: {
				...baseSettings.savedProviderEffort,
				claude: this.voiceRuntime.effortLevel || "low",
			},
		};
		this.voicePlugin = new Proxy(this.plugin, {
			get(target, property, receiver) {
				if (property === "settings") return scopedSettings;
				const value: unknown = Reflect.get(target, property, receiver);
				return value;
			},
		});
		return this.voicePlugin;
	}

	async warmup(channel: InteractionChannel): Promise<void> {
		try {
			await this.ensureRuntime(channel).ensureReady({ allowSessionCreation: true });
		} catch {
			// 首次真实发送仍会返回可见错误；预热失败不阻塞面板。
		}
	}

	restoreVoiceHistory(
		messages: Array<{ role: "user" | "assistant"; text: string }>
	): void {
		this.history = messages.slice(-40).map((message, index) => ({
			id: `voice-restored-${index}`,
			role: message.role,
			content: message.text,
			timestamp: index,
		}));
	}

	clearVoiceHistory(): void {
		this.history = [];
	}

	// 发一轮：按输入通道选择独立契约、运行时和历史，再映射流式事件。
	async send(turnInput: QuyuanTurn, cb: VoiceTurnCallbacks): Promise<void> {
		const trimmed = turnInput.text.trim();
		if (!trimmed || this.busy) return;
		this.busy = true;
		let full = "";
		let sawText = false;
		let sawError = false;
		let sawTool = false;
		const toolNames = new Map<string, string>();
		try {
			const channel = turnInput.channel;
			const runtime = this.ensureRuntime(channel);
			const policy =
				channel === "voice" ? VOICE_RESPONSE_POLICY : TEXT_RESPONSE_POLICY;
			// 语音回合追加 TALOS 数据地图：模型据此把口语意图路由到具体仓库路径
			const dataContext =
				channel === "voice" ? this.voiceRuntime.getDataContext?.() ?? "" : "";
			const turn = runtime.prepareTurn({
				text: `${policy}${dataContext ? `\n\n${dataContext}` : ""}\n\n<user_message>\n${trimmed}\n</user_message>`,
			});
			for await (const chunk of runtime.query(turn, this.history)) {
				switch (chunk.type) {
					case "text":
						full += chunk.content;
						sawText = true;
						cb.onText(chunk.content);
						break;
					case "tool_use":
						sawTool = true;
						toolNames.set(chunk.id, chunk.name);
						cb.onTool?.({
							taskId: chunk.id,
							name: chunk.name,
							status: "running",
							auditEvidence: `voice-tool:${chunk.id}:running`,
						});
						break;
					case "tool_result": {
						const name = toolNames.get(chunk.id) ?? "tool";
						const status = chunk.isError ? "failed" : "succeeded";
						cb.onTool?.({
							taskId: chunk.id,
							name,
							status,
							auditEvidence: `voice-tool:${chunk.id}:${status}`,
						});
						break;
					}
					case "error":
						sawError = true;
						cb.onError(chunk.content);
						break;
					default:
						break;
				}
			}
			if (!sawText && !sawError) {
				if (sawTool) {
					// 执行了工具但没给口头结尾：优雅兜底，给一句确认而非报错
					full = "好的，已处理。";
					sawText = true;
					cb.onText(full);
				} else {
					cb.onError(
						"引擎已就绪但没有产出——可能是会话未初始化或需要工具审批。请打开控制台(Ctrl+Shift+I)把红色报错贴出。"
					);
					return;
				}
			}
			if (sawText) {
				const now = Date.now();
				this.history.push({
					id: `${channel}-u-${now}`,
					role: "user",
					content: trimmed,
					timestamp: now,
				});
				this.history.push({
					id: `${channel}-a-${now}`,
					role: "assistant",
					content: full,
					timestamp: now,
				});
				// 长会话防膨胀：历史只保留最近 40 条（20 轮），避免内存与每轮 token 无上限增长
				const MAX_HISTORY_MESSAGES = 40;
				if (this.history.length > MAX_HISTORY_MESSAGES) {
					this.history.splice(
						0,
						this.history.length - MAX_HISTORY_MESSAGES
					);
				}
				cb.onDone(full);
			}
		} catch (error) {
			cb.onError(error instanceof Error ? error.message : String(error));
		} finally {
			this.busy = false;
		}
	}

	cancel(): void {
		for (const runtime of Object.values(this.runtimes)) {
			try {
				runtime?.cancel();
			} catch {
				/* noop */
			}
		}
	}

	dispose(): void {
		for (const runtime of Object.values(this.runtimes)) {
			try {
				runtime?.cleanup();
			} catch {
				/* noop */
			}
		}
		this.runtimes = {};
		this.history = [];
		this.voicePlugin = null;
	}
}
