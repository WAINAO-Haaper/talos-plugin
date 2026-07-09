import type { PermissionResult, PermissionMode } from "@anthropic-ai/claude-agent-sdk";

// ============================================================
// 屈原 · 执行通道统一契约（承重墙）
//   所有通道（SdkCliEngine / AnthropicApiEngine / OpenAiEngine）都实现 Engine
//   并发射同一套 JarvisEvents —— panel.ts 只订阅事件，不认具体厂商。
//   差异化（语音 voiceio / 屈原人格）全部挂在事件总线之上，换通道零改动。
//   方案见同目录《多通道执行链路对齐方案.md》。
// ============================================================

export interface ToolUseEvent {
	id: string;
	name: string;
	input: unknown;
}

export interface ToolResultEvent {
	id: string;
	content: unknown;
	isError: boolean;
}

export interface PermissionAsk {
	toolUseID: string;
	toolName: string;
	input: Record<string, unknown>;
	title?: string;
	displayName?: string;
	description?: string;
	blockedPath?: string;
	decisionReason?: string;
	suggestions?: unknown[]; // PermissionUpdate[]：用于「允许并记住」
}

export interface ResultEvent {
	isError: boolean;
	result: string;
	costUsd: number;
	durationMs: number;
	numTurns: number;
}

export interface SystemInitEvent {
	sessionId: string;
	model: string;
	tools: string[];
	cwd: string;
	permissionMode: string;
}

// token 用量（上下文 % 估算用）
export interface UsageInfo {
	inputTokens: number;
	outputTokens: number;
	contextWindow: number;
}

export interface JarvisEvents {
	onSystemInit?: (info: SystemInitEvent) => void;
	onTextDelta?: (delta: string) => void; // 流式增量，喂给 TTS / 实时渲染
	onAssistantText?: (text: string) => void; // 一个文本块定稿
	onThinkingDelta?: (delta: string) => void;
	onToolUse?: (t: ToolUseEvent) => void;
	onToolResult?: (t: ToolResultEvent) => void;
	onPermissionRequest?: (req: PermissionAsk) => Promise<PermissionResult>;
	onResult?: (r: ResultEvent) => void;
	onBusyChange?: (busy: boolean) => void;
	onUsage?: (u: UsageInfo) => void; // token 用量上报（底栏上下文 %）
	onError?: (e: Error) => void;
}

// 模型上下文窗口估算（底栏 % 用，近似值）
export function contextWindowFor(model: string): number {
	const m = model.toLowerCase();
	if (m.includes("gpt-4.1")) return 1000000;
	if (m.includes("gpt-5")) return 400000;
	if (m.includes("gpt-4o") || m.includes("gpt-4") || m.includes("o1") || m.includes("o3")) return 128000;
	if (m.includes("claude") || m.includes("opus") || m.includes("sonnet") || m.includes("haiku")) return 200000;
	return 128000;
}

// 一条用户输入。P0 仅文字；P4 起带 @提及文件 + 图片附件（见 context/mentions.ts）。
export interface UserTurn {
	text: string;
	images?: { mime: string; dataB64: string }[];
	mentions?: { path: string; kind: "file" | "selection" }[];
}

// 恢复用：把历史转写灌回上下文的一条（仅文本）
export interface SeedTurn {
	role: "user" | "assistant";
	text: string;
}

// 执行通道契约。P4 起 send 携带 UserTurn（文字 + 图片 + @提及）。
export interface Engine {
	start(): Promise<void>;
	send(turn: UserTurn): void;
	interrupt(): Promise<void>;
	setPermissionMode(mode: PermissionMode): Promise<void>;
	getSessionId(): string | null;
	isBusy(): boolean;
	dispose(): void;
	// 可选：会话恢复时把历史转写灌回上下文（直连通道实现）。
	seed?(turns: SeedTurn[]): void;
	// 可选：跨重启续接（SDK/CLI 通道用 sessionId resume；直连通道不实现，走 seed）。
	resume?(sessionId: string): void;
}
