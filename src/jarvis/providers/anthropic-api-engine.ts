import { App, FileSystemAdapter } from "obsidian";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type {
	Engine,
	JarvisEvents,
	SeedTurn,
	UserTurn,
} from "../engine-types";
import type { TalosSettings } from "../../settings";
import { AgentLoop } from "../agent/loop";
import { VaultToolHost } from "../agent/vault-tools";
import { ANTHROPIC_TOOLS } from "../agent/tool-schema";
import { buildSystemPrompt, hasChildProcess } from "./persona";
import { AnthropicModelClient } from "../../ai/provider/anthropic-model-client";
import {
	providerSecretStoreFromApp,
	readProviderSecret,
} from "../../ai/provider/secret-storage-runtime";

export class AnthropicApiEngine implements Engine {
	private loop: AgentLoop | null = null;
	private client: AnthropicModelClient | null = null;
	private sessionId: string | null = null;
	private busy = false;
	private pendingSeed: SeedTurn[] | null = null;

	constructor(
		private app: App,
		private settings: TalosSettings,
		private ev: JarvisEvents
	) {}

	async start(): Promise<void> {
		if (this.loop) return;
		const model =
			this.settings.jarvisModel.trim() || "claude-sonnet-4-6";
		const system = await buildSystemPrompt(this.app, this.settings);
		const secretStore = providerSecretStoreFromApp(this.app);
		this.client = new AnthropicModelClient(
			{
				endpoint: this.settings.anthropicBaseUrl,
				thinkingLevel: this.settings.jarvisThinkingLevel,
			},
			model,
			system,
			() =>
				readProviderSecret(
					this.settings,
					"anthropicApiKey",
					secretStore
				)
		);
		if (this.pendingSeed) {
			this.client.seed(this.pendingSeed);
			this.pendingSeed = null;
		}

		const tapped: JarvisEvents = {
			...this.ev,
			onBusyChange: (busy) => {
				this.busy = busy;
				this.ev.onBusyChange?.(busy);
			},
		};
		const tools = new VaultToolHost(this.app, tapped, {
			permissionMode: () => this.settings.jarvisPermissionMode,
			supportsBash:
				hasChildProcess() &&
				this.app.vault.adapter instanceof FileSystemAdapter,
		});
		this.loop = new AgentLoop(this.client, tools, tapped);
		this.sessionId = `api-${Date.now()}`;
		this.ev.onSystemInit?.({
			sessionId: this.sessionId,
			model,
			tools: ANTHROPIC_TOOLS.map((tool) => tool.name),
			cwd:
				this.app.vault.adapter instanceof FileSystemAdapter
					? this.app.vault.adapter.getBasePath()
					: "",
			permissionMode: this.settings.jarvisPermissionMode,
		});
	}

	send(turn: UserTurn): void {
		if (!turn.text.trim() && !(turn.images && turn.images.length)) return;
		void this.ensure().then((loop) => loop.turn(turn));
	}

	async interrupt(): Promise<void> {
		this.loop?.abort();
		this.busy = false;
	}

	seed(turns: SeedTurn[]): void {
		if (turns.length === 0) return;
		if (this.client) this.client.seed(turns);
		else this.pendingSeed = turns;
	}

	async setPermissionMode(_mode: PermissionMode): Promise<void> {
		void _mode;
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	isBusy(): boolean {
		return this.busy;
	}

	dispose(): void {
		this.loop?.abort();
		this.loop = null;
		this.client = null;
	}

	private async ensure(): Promise<AgentLoop> {
		if (!this.loop) await this.start();
		return this.loop as AgentLoop;
	}
}
