import type {
	QuyuanCapability,
	QuyuanCapabilitySnapshot,
	QuyuanProviderId,
} from "./contract";

export type QuyuanStreamChunk =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool-start"; id: string; name: string; input: unknown }
	| { type: "tool-end"; id: string; output: unknown; isError: boolean }
	| { type: "usage"; inputTokens: number; outputTokens: number; contextWindow: number }
	| { type: "result"; isError: boolean };

export interface QuyuanTurn {
	text: string;
	images?: { mime: string; dataB64: string }[];
	contextPaths?: string[];
}

export interface QuyuanWorkbenchAdapter {
	readonly providerId: QuyuanProviderId;
	start(): Promise<void>;
	query(turn: QuyuanTurn): AsyncGenerator<QuyuanStreamChunk>;
	cancel(): void;
	resume(sessionId: string): Promise<void>;
	getSessionId(): string | null;
	getCapabilities(): ReadonlySet<QuyuanCapability>;
	dispose(): void;
}

export function snapshotAdapterCapabilities(
	adapter: QuyuanWorkbenchAdapter
): QuyuanCapabilitySnapshot {
	return {
		provider: adapter.providerId,
		supported: adapter.getCapabilities(),
	};
}

