export interface WorkbenchUiState {
	schemaVersion: 1;
	openConversationIds: string[];
	activeConversationId?: string;
	historyOpen: boolean;
}

export interface WorkbenchUiStateAdapter {
	read(): Promise<unknown>;
	write(value: WorkbenchUiState): Promise<void>;
}

const DEFAULT_STATE: WorkbenchUiState = {
	schemaVersion: 1,
	openConversationIds: [],
	historyOpen: false,
};

function normalize(value: unknown): WorkbenchUiState {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_STATE };
	const record = value as Record<string, unknown>;
	const openConversationIds = Array.isArray(record.openConversationIds)
		? [...new Set(record.openConversationIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))]
		: [];
	return {
		schemaVersion: 1,
		openConversationIds,
		...(typeof record.activeConversationId === "string" ? { activeConversationId: record.activeConversationId } : {}),
		historyOpen: record.historyOpen === true,
	};
}

/** One-way projection of the retired tab sidecar into native conversation ids. */
export function migrateLegacyTabManagerState(tabState: unknown, importState: unknown): WorkbenchUiState | null {
	if (!tabState || typeof tabState !== "object" || Array.isArray(tabState)) return null;
	if (!importState || typeof importState !== "object" || Array.isArray(importState)) return null;
	const tabsRecord = tabState as Record<string, unknown>;
	const importRecord = importState as Record<string, unknown>;
	const imports = importRecord.imports && typeof importRecord.imports === "object" && !Array.isArray(importRecord.imports)
		? importRecord.imports as Record<string, unknown>
		: {};
	const legacyToNative = new Map<string, string>();
	for (const value of Object.values(imports)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const entry = value as Record<string, unknown>;
		if (typeof entry.legacyConversationId === "string" && typeof entry.conversationId === "string") {
			legacyToNative.set(entry.legacyConversationId, entry.conversationId);
		}
	}
	const tabs = Array.isArray(tabsRecord.openTabs) ? tabsRecord.openTabs : [];
	const byTabId = new Map<string, string>();
	const openConversationIds: string[] = [];
	for (const value of tabs) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const tab = value as Record<string, unknown>;
		if (typeof tab.conversationId !== "string") continue;
		const nativeId = legacyToNative.get(tab.conversationId);
		if (!nativeId) continue;
		if (!openConversationIds.includes(nativeId)) openConversationIds.push(nativeId);
		if (typeof tab.tabId === "string") byTabId.set(tab.tabId, nativeId);
	}
	if (!openConversationIds.length) return null;
	const activeConversationId = typeof tabsRecord.activeTabId === "string"
		? byTabId.get(tabsRecord.activeTabId)
		: undefined;
	return {
		schemaVersion: 1,
		openConversationIds,
		...(activeConversationId ? { activeConversationId } : {}),
		historyOpen: false,
	};
}

/** Durable, TALOS-owned tab and history-panel state. */
export class WorkbenchUiStateStore {
	private tail = Promise.resolve();

	constructor(private readonly adapter: WorkbenchUiStateAdapter) {}

	async load(): Promise<WorkbenchUiState> {
		await this.tail;
		return normalize(await this.adapter.read());
	}

	save(value: WorkbenchUiState): Promise<void> {
		const next = normalize(value);
		this.tail = this.tail.then(() => this.adapter.write(next));
		return this.tail;
	}
}
