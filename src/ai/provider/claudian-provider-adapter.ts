import type ClaudianPlugin from "../../quyuan/claudian/main";
import { ProviderRegistry } from "../../quyuan/claudian/core/providers/ProviderRegistry";
import { ProviderWorkspaceRegistry } from "../../quyuan/claudian/core/providers/ProviderWorkspaceRegistry";
import type {
	ProviderCapabilities as ClaudianCapabilities,
	ProviderId,
	ProviderWorkspaceServices,
} from "../../quyuan/claudian/core/providers/types";
import type {
	ChatRuntimeConversationState,
	ChatRuntimeQueryOptions,
	ChatTurnRequest,
	PreparedChatTurn,
} from "../../quyuan/claudian/core/runtime/types";
import type {
	ChatMessage,
	StreamChunk,
} from "../../quyuan/claudian/core/types";
import type {
	AskEvent,
	AskRequest,
	ProviderCapability,
	TalosProvider,
} from "./types";

type ClaudianApprovalCallback = (
	toolName: string,
	input: Record<string, unknown>
) => Promise<"allow" | "deny">;

export interface ClaudianRuntimePort {
	prepareTurn(request: ChatTurnRequest): PreparedChatTurn;
	syncConversationState(
		state: ChatRuntimeConversationState | null,
		externalContextPaths?: string[]
	): void;
	ensureReady(options?: { allowSessionCreation?: boolean }): Promise<boolean>;
	query(
		turn: PreparedChatTurn,
		history?: ChatMessage[],
		options?: ChatRuntimeQueryOptions
	): AsyncIterable<StreamChunk>;
	cancel(): void;
	getSessionId(): string | null;
	setApprovalCallback(callback: ClaudianApprovalCallback | null): void;
}

export interface ClaudianRegistryPort {
	getRegisteredProviderIds(): ReadonlyArray<ProviderId>;
	createRuntime(
		providerId: ProviderId,
		plugin: ClaudianPlugin
	): ClaudianRuntimePort;
	getCapabilities(providerId: ProviderId): ClaudianCapabilities;
	getWorkspaceServices(providerId: ProviderId): ProviderWorkspaceServices | null;
}

const DEFAULT_REGISTRY: ClaudianRegistryPort = {
	getRegisteredProviderIds() {
		return ProviderRegistry.getRegisteredProviderIds();
	},
	createRuntime(providerId, plugin) {
		return ProviderRegistry.createChatRuntime({
			plugin,
			providerId,
		});
	},
	getCapabilities(providerId) {
		return ProviderRegistry.getCapabilities(providerId);
	},
	getWorkspaceServices(providerId) {
		return ProviderWorkspaceRegistry.getServices(providerId);
	},
};

export interface ClaudianProviderAdapterOptions {
	providerId: ProviderId;
	plugin: ClaudianPlugin;
	registry?: ClaudianRegistryPort;
}

function mapCapabilities(
	native: ClaudianCapabilities,
	_workspace: ProviderWorkspaceServices | null
): ReadonlySet<ProviderCapability> {
	const capabilities = new Set<ProviderCapability>([
		"chat",
		"stream",
		"tools",
		"usage",
		"cancel",
	]);
	if (native.supportsPersistentRuntime || native.supportsNativeHistory) {
		capabilities.add("resume");
	}
	if (native.supportsFork) capabilities.add("fork");
	return capabilities;
}

function asHistoryRef(value: unknown): ChatMessage[] | undefined {
	return Array.isArray(value) ? (value as ChatMessage[]) : undefined;
}

export class ClaudianProviderAdapter implements TalosProvider {
	readonly id: string;
	readonly kind = "cli" as const;
	private readonly registry: ClaudianRegistryPort;
	private readonly runtimes = new Map<string, ClaudianRuntimePort>();
	private pendingResumeSessionId: string | null = null;

	constructor(private readonly options: ClaudianProviderAdapterOptions) {
		this.id = options.providerId;
		this.registry = options.registry ?? DEFAULT_REGISTRY;
	}

	capabilities(): ReadonlySet<ProviderCapability> {
		return mapCapabilities(
			this.registry.getCapabilities(this.options.providerId),
			this.registry.getWorkspaceServices(this.options.providerId)
		);
	}

	async *chat(request: AskRequest): AsyncIterable<AskEvent> {
		const runtime = this.registry.createRuntime(
			this.options.providerId,
			this.options.plugin
		);
		this.runtimes.set(request.runId, runtime);
		const sessionId = request.sessionId ?? this.pendingResumeSessionId;
		this.pendingResumeSessionId = null;
		runtime.syncConversationState(
			sessionId
				? {
						sessionId,
						providerState: request.providerStateRef,
					}
				: null,
			[]
		);
		if (request.toolsAllowed === false) {
			runtime.setApprovalCallback(async () => "deny");
		}
		await runtime.ensureReady({ allowSessionCreation: true });
		const turn = runtime.prepareTurn({ text: request.text });
		for await (const chunk of runtime.query(
			turn,
			asHistoryRef(request.historyRef),
			request.toolsAllowed === false ? { allowedTools: [] } : undefined
		)) {
			const event = this.mapChunk(chunk, runtime);
			if (event) yield event;
		}
	}

	async cancel(runId: string): Promise<void> {
		this.runtimes.get(runId)?.cancel();
	}

	async resume(sessionId: string): Promise<void> {
		this.pendingResumeSessionId = sessionId;
	}

	private mapChunk(
		chunk: StreamChunk,
		runtime: ClaudianRuntimePort
	): AskEvent | null {
		switch (chunk.type) {
			case "text":
				return { type: "text", text: chunk.content };
			case "thinking":
				return { type: "thinking", text: chunk.content };
			case "tool_use":
				return {
					type: "tool-request",
					toolCallId: chunk.id,
					name: chunk.name,
					input: chunk.input,
				};
			case "tool_result":
				return {
					type: "tool-result",
					toolCallId: chunk.id,
					output: chunk.content,
					isError: chunk.isError === true,
				};
			case "usage":
				return {
					type: "usage",
					inputTokens: chunk.usage.inputTokens,
					outputTokens: 0,
				};
			case "error":
				return {
					type: "error",
					message: chunk.content,
					retryable: false,
				};
			case "done": {
				const sessionId = runtime.getSessionId();
				return sessionId
					? { type: "done", sessionId }
					: { type: "done" };
			}
			default:
				return null;
		}
	}
}

export function createClaudianProviderAdapters(
	plugin: ClaudianPlugin,
	registry: ClaudianRegistryPort = DEFAULT_REGISTRY
): ClaudianProviderAdapter[] {
	return registry
		.getRegisteredProviderIds()
		.map(
			(providerId) =>
				new ClaudianProviderAdapter({ providerId, plugin, registry })
		);
}
