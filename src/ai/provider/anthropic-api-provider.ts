import {
	AnthropicModelClient,
	type AnthropicModelClientConfig,
} from "./anthropic-model-client";
import {
	ApiAgentRuntime,
	type ApiToolRunner,
} from "./api-agent-runtime";
import type { ProviderSecretStore } from "./provider-secret-store";
import type {
	AskEvent,
	AskRequest,
	ProviderCapability,
	TalosProvider,
} from "./types";

export interface AnthropicApiProviderOptions {
	id: string;
	endpoint: string;
	model: string;
	systemPrompt: string;
	secretRef: string;
	secrets: ProviderSecretStore;
	toolRunner: ApiToolRunner;
	thinkingLevel?: string;
	fetcher?: typeof fetch;
}

export class AnthropicApiProvider implements TalosProvider {
	readonly id: string;
	readonly kind = "api" as const;
	private readonly runtime: ApiAgentRuntime;

	constructor(options: AnthropicApiProviderOptions) {
		this.id = options.id;
		const config: AnthropicModelClientConfig = {
			endpoint: options.endpoint,
			thinkingLevel: options.thinkingLevel ?? "off",
		};
		this.runtime = new ApiAgentRuntime({
			id: options.id,
			toolRunner: options.toolRunner,
			modelFactory: () =>
				new AnthropicModelClient(
					config,
					options.model,
					options.systemPrompt,
					() => options.secrets.get(options.secretRef),
					options.fetcher
				),
		});
	}

	capabilities(): ReadonlySet<ProviderCapability> {
		return this.runtime.capabilities();
	}

	chat(request: AskRequest): AsyncIterable<AskEvent> {
		return this.runtime.chat(request);
	}

	cancel(runId: string): Promise<void> {
		return this.runtime.cancel(runId);
	}

	resume(sessionId: string): Promise<void> {
		return this.runtime.resume(sessionId);
	}
}
