import type {
	AskEvent,
	AskRequest,
	ProviderCapability,
	ProviderReviewTurn,
	ProviderSessionSnapshot,
	ProviderSwitchPoint,
	TalosProvider,
} from "./types";

interface ProviderSessionState {
	sessionId: string;
	providerId: string;
	switchPoints: ProviderSwitchPoint[];
	completedToolIds: Set<string>;
	reviews: ProviderReviewTurn[];
	forkedFrom?: {
		sessionId: string;
		atTurnId: string;
	};
}

export class ProviderFacade {
	private readonly providers = new Map<string, TalosProvider>();
	private readonly sessions = new Map<string, ProviderSessionState>();
	private readonly activeRuns = new Map<
		string,
		{ provider: TalosProvider; owner: object }
	>();

	constructor(private readonly now: () => number = Date.now) {}

	register(provider: TalosProvider): void {
		if (this.providers.has(provider.id)) {
			throw new Error(`Provider "${provider.id}" is already registered`);
		}
		this.providers.set(provider.id, provider);
	}

	listProviders(): Array<{ id: string; kind: TalosProvider["kind"] }> {
		return [...this.providers.values()].map(({ id, kind }) => ({ id, kind }));
	}

	getAvailability(
		providerId: string,
		required: ProviderCapability[]
	): { enabled: boolean; missing: ProviderCapability[] } {
		const provider = this.requireProvider(providerId);
		const supported = provider.capabilities();
		const missing = required.filter(
			(capability) => !supported.has(capability)
		);
		return { enabled: missing.length === 0, missing };
	}

	createSession(input: {
		sessionId: string;
		providerId: string;
	}): ProviderSessionSnapshot {
		this.requireProvider(input.providerId);
		if (this.sessions.has(input.sessionId)) {
			throw new Error(`Provider session "${input.sessionId}" already exists`);
		}
		const state: ProviderSessionState = {
			sessionId: input.sessionId,
			providerId: input.providerId,
			switchPoints: [],
			completedToolIds: new Set(),
			reviews: [],
		};
		this.sessions.set(input.sessionId, state);
		return this.snapshot(state);
	}

	getSession(sessionId: string): ProviderSessionSnapshot {
		return this.snapshot(this.requireSession(sessionId));
	}

	switchProvider(
		sessionId: string,
		providerId: string,
		atTurnId: string
	): ProviderSessionSnapshot {
		const state = this.requireSession(sessionId);
		this.requireProvider(providerId);
		if (state.providerId === providerId) return this.snapshot(state);
		state.switchPoints.push({
			fromProviderId: state.providerId,
			toProviderId: providerId,
			atTurnId,
			changedAt: this.now(),
		});
		state.providerId = providerId;
		return this.snapshot(state);
	}

	forkSession(input: {
		sourceSessionId: string;
		sessionId: string;
		providerId?: string;
		atTurnId: string;
	}): ProviderSessionSnapshot {
		const source = this.requireSession(input.sourceSessionId);
		const providerId = input.providerId ?? source.providerId;
		this.requireProvider(providerId);
		if (this.sessions.has(input.sessionId)) {
			throw new Error(`Provider session "${input.sessionId}" already exists`);
		}
		const fork: ProviderSessionState = {
			sessionId: input.sessionId,
			providerId,
			switchPoints: [],
			completedToolIds: new Set(source.completedToolIds),
			reviews: [],
			forkedFrom: {
				sessionId: source.sessionId,
				atTurnId: input.atTurnId,
			},
		};
		this.sessions.set(input.sessionId, fork);
		return this.snapshot(fork);
	}

	async *chat(
		sessionId: string,
		request: AskRequest
	): AsyncIterable<AskEvent> {
		const state = this.requireSession(sessionId);
		const provider = this.requireProvider(state.providerId);
		yield* this.runProvider(provider, state, {
			...request,
			sessionId,
			toolsAllowed: request.toolsAllowed !== false,
			executedToolIds: new Set(state.completedToolIds),
		});
	}

	async *reviewTurn(
		sessionId: string,
		providerId: string,
		request: AskRequest & { reviewOfTurnId: string }
	): AsyncIterable<AskEvent> {
		const state = this.requireSession(sessionId);
		const provider = this.requireProvider(providerId);
		state.reviews.push({
			providerId,
			turnId: request.turnId,
			reviewOfTurnId: request.reviewOfTurnId,
		});
		yield* this.runProvider(
			provider,
			state,
			{
				...request,
				sessionId,
				toolsAllowed: false,
				executedToolIds: new Set(state.completedToolIds),
			},
			true
		);
	}

	async cancel(sessionId: string, runId: string): Promise<void> {
		const state = this.requireSession(sessionId);
		const active = this.activeRuns.get(this.runKey(sessionId, runId));
		await (active?.provider ?? this.requireProvider(state.providerId)).cancel(runId);
	}

	async resume(sessionId: string): Promise<void> {
		const state = this.requireSession(sessionId);
		await this.requireProvider(state.providerId).resume(sessionId);
	}

	private async *runProvider(
		provider: TalosProvider,
		state: ProviderSessionState,
		request: AskRequest,
		reviewMode = false
	): AsyncIterable<AskEvent> {
		const activeKey = this.runKey(state.sessionId, request.runId);
		const owner = {};
		this.activeRuns.set(activeKey, { provider, owner });
		const blockedToolIds = new Set<string>();
		try {
			for await (const event of provider.chat(request)) {
				if (event.type === "tool-request") {
					const reason = reviewMode
						? "review-mode"
						: state.completedToolIds.has(event.toolCallId)
							? "already-executed"
							: null;
					if (reason) {
						blockedToolIds.add(event.toolCallId);
						yield {
							type: "tool-skipped",
							toolCallId: event.toolCallId,
							reason,
						};
						continue;
					}
				}
				if (event.type === "tool-result") {
					if (reviewMode || blockedToolIds.has(event.toolCallId)) continue;
					if (!event.isError) state.completedToolIds.add(event.toolCallId);
				}
				yield event;
			}
		} finally {
			if (this.activeRuns.get(activeKey)?.owner === owner) {
				this.activeRuns.delete(activeKey);
			}
		}
	}

	private runKey(sessionId: string, runId: string): string {
		return `${sessionId}\0${runId}`;
	}

	private requireProvider(providerId: string): TalosProvider {
		const provider = this.providers.get(providerId);
		if (!provider) throw new Error(`Provider "${providerId}" is not registered`);
		return provider;
	}

	private requireSession(sessionId: string): ProviderSessionState {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Provider session "${sessionId}" does not exist`);
		}
		return session;
	}

	private snapshot(state: ProviderSessionState): ProviderSessionSnapshot {
		return {
			sessionId: state.sessionId,
			providerId: state.providerId,
			switchPoints: state.switchPoints.map((point) => ({ ...point })),
			completedToolIds: [...state.completedToolIds],
			reviews: state.reviews.map((review) => ({ ...review })),
			...(state.forkedFrom
				? { forkedFrom: { ...state.forkedFrom } }
				: {}),
		};
	}
}
