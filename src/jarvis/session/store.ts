// ============================================================
// SessionStore · 多标签会话 store（持久化 + 恢复）
//   持久化到 settings.jarvisTabsJson（随插件 data.json 落盘）。
//   存转写快照(entries)用于重开后可视恢复；直连通道继续对话时
//   panel 会把 entries 经 engine.seed() 回灌进上下文（真·resume）。
//   SDK/CLI 通道 seed 为 no-op（CLI 自有 resume 机制）。
// ============================================================

export interface LogEntry {
	kind: "user" | "assistant" | "system" | "tool";
	text: string; // user/assistant/system 文本；tool 时为工具名
	toolInput?: string; // tool：入参预览
	toolOutput?: string; // tool：输出预览
	toolError?: boolean;
}

export interface TabRecord {
	id: string;
	title: string;
	provider: string; // 该标签创建时的执行通道
	entries: LogEntry[];
	updatedAt: number;
	sdkSessionId?: string; // SDK/CLI 通道的 sessionId，用于跨重启 resume（P3.1）
}

interface TabsPersist {
	tabs: TabRecord[];
	activeId: string | null;
}

export class SessionStore {
	tabs: TabRecord[] = [];
	activeId: string | null = null;

	static fromJson(raw: string): SessionStore {
		const s = new SessionStore();
		try {
			const data = JSON.parse(raw || "{}") as Partial<TabsPersist>;
			if (Array.isArray(data.tabs)) s.tabs = data.tabs.filter((t) => t && typeof t.id === "string");
			s.activeId = typeof data.activeId === "string" ? data.activeId : null;
		} catch {
			/* 损坏则空白起步 */
		}
		return s;
	}

	toJson(): string {
		const data: TabsPersist = { tabs: this.tabs, activeId: this.activeId };
		return JSON.stringify(data);
	}

	get(id: string): TabRecord | undefined {
		return this.tabs.find((t) => t.id === id);
	}

	active(): TabRecord | undefined {
		return this.activeId ? this.get(this.activeId) : undefined;
	}

	create(provider: string, title = "新对话"): TabRecord {
		const rec: TabRecord = {
			id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			title,
			provider,
			entries: [],
			updatedAt: Date.now(),
		};
		this.tabs.push(rec);
		this.activeId = rec.id;
		return rec;
	}

	remove(id: string): void {
		this.tabs = this.tabs.filter((t) => t.id !== id);
		if (this.activeId === id) this.activeId = this.tabs.length ? (this.tabs[this.tabs.length - 1]?.id ?? null) : null;
	}

	appendEntry(id: string, entry: LogEntry): LogEntry | null {
		const rec = this.get(id);
		if (!rec) return null;
		rec.entries.push(entry);
		rec.updatedAt = Date.now();
		return entry;
	}

	rename(id: string, title: string): void {
		const rec = this.get(id);
		if (rec) rec.title = title;
	}
}
