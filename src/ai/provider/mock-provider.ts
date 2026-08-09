import type {
	AskEvent,
	AskRequest,
	ProviderCapability,
	TalosProvider,
	TalosProviderKind,
} from "./types";

export interface MockToolResult {
	output: unknown;
	isError: boolean;
}

export interface MockProviderOptions {
	id: string;
	kind?: TalosProviderKind;
	seed: number;
	capabilities: ProviderCapability[];
	fixtures: AskEvent[][];
	toolResults?: Record<string, MockToolResult>;
}

export interface MockProviderDiagnostics {
	cancelledRunIds: string[];
	resumedSessionIds: string[];
	requestCount: number;
}

function cloneEvent(event: AskEvent): AskEvent {
	switch (event.type) {
		case "tool-request":
			return { ...event, input: { ...event.input } };
		case "tool-result":
			return { ...event };
		default:
			return { ...event };
	}
}

export class MockProvider implements TalosProvider {
	readonly id: string;
	readonly kind: TalosProviderKind;
	private readonly supported: ReadonlySet<ProviderCapability>;
	private readonly fixtures: AskEvent[][];
	private readonly toolResults: Readonly<Record<string, MockToolResult>>;
	private readonly cancelledRunIds: string[] = [];
	private readonly resumedSessionIds: string[] = [];
	private requestCount = 0;

	constructor(private readonly options: MockProviderOptions) {
		if (options.fixtures.length === 0) {
			throw new Error("MockProvider requires at least one fixture");
		}
		this.id = options.id;
		this.kind = options.kind ?? "mock";
		this.supported = new Set(options.capabilities);
		this.fixtures = options.fixtures.map((fixture) => fixture.map(cloneEvent));
		this.toolResults = options.toolResults ?? {};
	}

	capabilities(): ReadonlySet<ProviderCapability> {
		return new Set(this.supported);
	}

	async *chat(_request: AskRequest): AsyncIterable<AskEvent> {
		const index =
			(Math.abs(this.options.seed) + this.requestCount) % this.fixtures.length;
		this.requestCount += 1;
		const fixture = this.fixtures[index] ?? [];
		const fixtureToolResults = new Set(
			fixture
				.filter(
					(event): event is Extract<AskEvent, { type: "tool-result" }> =>
						event.type === "tool-result"
				)
				.map((event) => event.toolCallId)
		);
		for (const event of fixture) {
			const cloned = cloneEvent(event);
			yield cloned;
			if (
				cloned.type === "tool-request" &&
				!fixtureToolResults.has(cloned.toolCallId)
			) {
				const result = this.toolResults[cloned.toolCallId];
				if (result) {
					yield {
						type: "tool-result",
						toolCallId: cloned.toolCallId,
						output: result.output,
						isError: result.isError,
					};
				}
			}
		}
	}

	async cancel(runId: string): Promise<void> {
		this.cancelledRunIds.push(runId);
	}

	async resume(sessionId: string): Promise<void> {
		this.resumedSessionIds.push(sessionId);
	}

	diagnostics(): MockProviderDiagnostics {
		return {
			cancelledRunIds: [...this.cancelledRunIds],
			resumedSessionIds: [...this.resumedSessionIds],
			requestCount: this.requestCount,
		};
	}
}
