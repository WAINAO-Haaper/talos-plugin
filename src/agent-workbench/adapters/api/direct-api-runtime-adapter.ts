import type { AskEvent, TalosProvider } from "../../../ai/provider/types";
import { AnthropicApiProvider } from "../../../ai/provider/anthropic-api-provider";
import { OpenAiCompatibleProvider } from "../../../ai/provider/openai-compatible-provider";
import { ProviderSecretStore } from "../../../ai/provider/provider-secret-store";
import { runtimePrompt } from "../../contracts/execution-request";
import type { ProviderProfile } from "../../contracts/provider-profile";
import { isDirectApiProviderProfile } from "../../contracts/provider-profile";
import type {
	AgentRuntimeAdapter,
	CreateSessionInput,
	ModelDescriptor,
	NativeSessionBinding,
	RuntimeProbe,
	RuntimeTurn,
} from "../../contracts/runtime-adapter";
import type { RuntimeCapabilities } from "../../contracts/runtime-capabilities";
import { RuntimeEventFactory } from "../shared/event-factory";

export interface DirectApiRuntimeAdapterOptions {
	profile: ProviderProfile;
	resolveSecret(reference: string): string | null;
	fetcher?: typeof fetch;
}

export class DirectApiRuntimeAdapter implements AgentRuntimeAdapter {
	readonly id;
	private binding: NativeSessionBinding | null = null;
	private systemContext = "";
	private active: { provider: TalosProvider; runId: string } | null = null;
	private readonly events;

	constructor(private readonly options: DirectApiRuntimeAdapterOptions) {
		if (!isDirectApiProviderProfile(options.profile)) {
			throw new Error("Direct API adapter 只接受 anthropic-messages 或 openai-chat profile");
		}
		this.id = options.profile.runtimeId;
		this.events = new RuntimeEventFactory(this.id);
	}

	async probe(): Promise<RuntimeProbe> {
		return {
			runtimeId: this.id,
			status: "ready",
			reason: `${this.options.profile.displayName} · Direct API · Plan-only`,
		};
	}

	async listModels(): Promise<ModelDescriptor[]> {
		return this.options.profile.models.map((id) => ({
			id,
			label: id,
			providerProfileId: this.options.profile.id,
		}));
	}

	async createSession(input: CreateSessionInput): Promise<NativeSessionBinding> {
		this.systemContext = input.initialContext?.trim() ?? "";
		return this.binding = {
			runtimeId: this.id,
			sessionId: crypto.randomUUID(),
			providerProfileId: this.options.profile.id,
			protocolVersion: "talos-direct-api-v1",
		};
	}

	async resumeSession(binding: NativeSessionBinding): Promise<void> {
		if (
			binding.runtimeId !== this.id
			|| binding.providerProfileId !== this.options.profile.id
		) {
			throw new Error("Direct API session binding 与当前 profile 不匹配");
		}
		this.binding = binding;
	}

	async synchronizeContext(input: { context: string }): Promise<void> {
		this.systemContext = input.context.trim();
	}

	private secretStore(): ProviderSecretStore {
		const reference = this.options.profile.secretRef;
		if (!reference) throw new Error(`${this.options.profile.displayName} 缺少 SecretStorage 引用`);
		return new ProviderSecretStore({
			setSecret: () => {
				throw new Error("Direct API adapter 不写入 SecretStorage");
			},
			getSecret: (id) => this.options.resolveSecret(id),
			listSecrets: () => this.options.resolveSecret(reference) ? [reference] : [],
		});
	}

	private provider(model: string, thinkingLevel: string): TalosProvider {
		const profile = this.options.profile;
		const secretRef = profile.secretRef;
		if (!secretRef) throw new Error(`${profile.displayName} 缺少 SecretStorage 引用`);
		const toolRunner = {
			async run() {
				return {
					content: "Direct API Plan-only 通道不执行工具",
					isError: true,
				};
			},
		};
		if (profile.protocol === "anthropic-messages") {
			return new AnthropicApiProvider({
				id: profile.id,
				endpoint: profile.endpoint ?? "https://api.anthropic.com",
				model,
				systemPrompt: this.systemContext,
				secretRef,
				secrets: this.secretStore(),
				toolRunner,
				thinkingLevel,
				fetcher: this.options.fetcher,
			});
		}
		return new OpenAiCompatibleProvider({
			id: profile.id,
			endpoint: profile.endpoint ?? "https://api.openai.com",
			model,
			systemPrompt: this.systemContext,
			secretRef,
			secrets: this.secretStore(),
			toolRunner,
			thinkingLevel,
			fetcher: this.options.fetcher,
		});
	}

	async *send(turn: RuntimeTurn) {
		if (!this.binding) throw new Error("Direct API session 尚未绑定");
		if (turn.workflow === "execute") {
			yield this.events.create({
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				type: "error",
				payload: {
					message: "Direct API 通道仅支持 Plan；需要执行工具时请使用具备 OS sandbox 的本机 runtime。",
					recoverable: true,
				},
			});
			return;
		}
		if (turn.input?.some((block) => block.type === "image")) {
			yield this.events.create({
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				type: "error",
				payload: {
					message: "Direct API 安全通道当前仅支持文字输入；请移除图片后重试。",
					recoverable: true,
				},
			});
			return;
		}
		const model = turn.model
			?? this.options.profile.models[0];
		if (!model) throw new Error(`${this.options.profile.displayName} 未配置模型`);
		const provider = this.provider(model, turn.reasoning ?? "off");
		this.active = { provider, runId: turn.turnId };
		let text = "";
		try {
			for await (const event of provider.chat({
				runId: turn.turnId,
				turnId: turn.turnId,
				text: runtimePrompt(turn),
				sessionId: this.binding.sessionId,
				historyRef: turn.history,
				toolsAllowed: false,
			})) {
				const mapped = this.mapEvent(turn, event, text);
				if (event.type === "text") text += event.text;
				if (mapped) yield mapped;
				if (event.type === "error" || event.type === "tool-request") return;
				if (event.type === "done") {
					if (!text) {
						yield this.events.create({
							conversationId: turn.conversationId,
							turnId: turn.turnId,
							type: "error",
							payload: {
								message: "Direct API Provider 未返回可显示文本",
								recoverable: true,
							},
						});
						return;
					}
					yield this.events.create({
						conversationId: turn.conversationId,
						turnId: turn.turnId,
						type: "assistant.final",
						payload: { text },
					});
					yield this.events.create({
						conversationId: turn.conversationId,
						turnId: turn.turnId,
						type: "turn.finished",
						payload: { status: "completed" },
					});
					return;
				}
			}
		} finally {
			if (this.active?.runId === turn.turnId) this.active = null;
		}
	}

	private mapEvent(turn: RuntimeTurn, event: AskEvent, accumulated: string) {
		const base = {
			conversationId: turn.conversationId,
			turnId: turn.turnId,
		};
		if (event.type === "text") {
			return this.events.create({
				...base,
				type: "assistant.delta",
				payload: { text: event.text },
			});
		}
		if (event.type === "thinking") {
			return this.events.create({
				...base,
				type: "thinking.delta",
				payload: { text: event.text },
			});
		}
		if (event.type === "usage") {
			return this.events.create({
				...base,
				type: "usage.updated",
				payload: {
					inputTokens: event.inputTokens,
					outputTokens: event.outputTokens,
				},
			});
		}
		if (event.type === "error") {
			return this.events.create({
				...base,
				type: "error",
				payload: {
					message: event.message,
					recoverable: event.retryable,
					accepted: accumulated.length > 0,
				},
			});
		}
		if (event.type === "tool-request") {
			return this.events.create({
				...base,
				type: "error",
				payload: {
					message: "Direct API Plan-only 通道拒绝了工具请求",
					recoverable: true,
				},
			});
		}
		return null;
	}

	async cancel(reason = "user"): Promise<void> {
		const active = this.active;
		if (!active) return;
		await active.provider.cancel(active.runId);
		this.active = null;
		void reason;
	}

	async fork(input: { binding: NativeSessionBinding }): Promise<NativeSessionBinding> {
		return {
			...input.binding,
			sessionId: crypto.randomUUID(),
			protocolVersion: "talos-direct-api-v1",
		};
	}

	async dispose(): Promise<void> {
		await this.cancel("dispose");
		this.binding = null;
	}

	capabilities(): RuntimeCapabilities {
		return {
			session: {
				resume: "talos-emulated",
				fork: "talos-emulated",
				compact: "unavailable",
				rewind: "unavailable",
				steer: "unavailable",
			},
			input: {
				text: "native",
				image: "unavailable",
				vaultFile: "talos-emulated",
				selection: "talos-emulated",
			},
			tools: {
				shell: "unavailable",
				edit: "unavailable",
				mcp: "unavailable",
				skills: "unavailable",
				subagents: "unavailable",
				askUser: "unavailable",
			},
			control: {
				plan: "talos-emulated",
				reasoning: "native",
				serviceTier: "unavailable",
				usage: "native",
			},
			security: {
				nativeApproval: "unavailable",
				nativeSandbox: "unavailable",
				networkPolicy: "talos-emulated",
				externalPathGrant: "unavailable",
			},
		};
	}
}
