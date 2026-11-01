import { TalosActionRegistry } from "./registry";
import type {
	TalosActionContext,
	TalosActionDefinition,
} from "./types";

type BuiltinExecutor = (
	input: unknown,
	context: TalosActionContext
) => unknown;

export interface BuiltinActionDependencies {
	refreshStats: BuiltinExecutor;
	vaultLint: BuiltinExecutor;
	deepResearch: BuiltinExecutor;
	createNote: BuiltinExecutor;
	publishBackfill: BuiltinExecutor;
	decideApproval: BuiltinExecutor;
	decidePreference: BuiltinExecutor;
	/** 收件箱分诊「收下」：把一条笔记移到目标目录（经提案批准后才执行）。 */
	moveInboxNote: BuiltinExecutor;
}

export interface BuiltinActionScopes {
	noteWriteScopes: string[];
	/** 收件箱分诊：读取范围是收件箱，写入范围是收件箱与可选目标目录。 */
	inboxTriageReadScopes?: string[];
	inboxTriageWriteScopes?: string[];
}

const DEFAULT_SCOPES: BuiltinActionScopes = {
	noteWriteScopes: [
		"00 收件箱/**",
		"01 日志/**",
		"30 洞察/**",
		"70 输出/**",
	],
};

function executor(
	dependency: BuiltinExecutor
): TalosActionDefinition["execute"] {
	return async (context, input) => dependency(input, context);
}

export function createBuiltinActionRegistry(
	dependencies: BuiltinActionDependencies,
	scopes: BuiltinActionScopes = DEFAULT_SCOPES
): TalosActionRegistry {
	return new TalosActionRegistry([
		{
			id: "refresh-stats",
			label: "刷新统计",
			description: "重新读取 Vault 并刷新 TALOS 统计卡片",
			risk: "A",
			readScope: ["**"],
			writeScope: [],
			timeoutMs: 15_000,
			cancelable: false,
			reversible: false,
			execute: executor(dependencies.refreshStats),
		},
		{
			id: "vault-lint",
			label: "运行 Vault Lint",
			description: "只读检查 Vault 结构、链接和常见格式问题",
			risk: "A",
			readScope: ["**"],
			writeScope: [],
			timeoutMs: 60_000,
			cancelable: true,
			reversible: false,
			execute: executor(dependencies.vaultLint),
		},
		{
			id: "deep-research",
			label: "打开 AI 研究工作台",
			description: "打开真实 AI 工作台；保留已有草稿，由用户输入研究问题并发送",
			risk: "C",
			readScope: ["**"],
			writeScope: ["<external>"],
			timeoutMs: 10 * 60_000,
			cancelable: true,
			reversible: false,
			execute: executor(dependencies.deepResearch),
		},
		{
			id: "create-note",
			label: "新建内容",
			description: "在预先允许的模块中创建一篇可恢复的新笔记",
			risk: "B",
			readScope: [],
			writeScope: [...scopes.noteWriteScopes],
			timeoutMs: 30_000,
			cancelable: false,
			reversible: true,
			execute: executor(dependencies.createNote),
		},
		{
			id: "publish-backfill",
			label: "发布回填",
			description: "更新发布状态并可能触发外部发布流程",
			risk: "C",
			readScope: ["**"],
			writeScope: ["<publish>", "70 输出/**"],
			timeoutMs: 2 * 60_000,
			cancelable: true,
			reversible: true,
			execute: executor(dependencies.publishBackfill),
		},
		{
			id: "decide-approval",
			label: "处理变更审批",
			description: "批准或拒绝待审批变更，并在批准后受控执行",
			risk: "C",
			readScope: ["**"],
			writeScope: ["<approval>"],
			timeoutMs: 2 * 60_000,
			cancelable: true,
			reversible: true,
			execute: executor(dependencies.decideApproval),
		},
		{
			id: "decide-preference",
			label: "处理偏好候选",
			description: "把偏好候选写回已确认或已拒绝分区",
			risk: "C",
			readScope: ["**"],
			writeScope: ["<preference>"],
			timeoutMs: 30_000,
			cancelable: false,
			reversible: true,
			execute: executor(dependencies.decidePreference),
		},
		{
			id: "triage-inbox-note",
			label: "收件箱分诊归档",
			description: "把一条收件箱笔记移到选定目录，Obsidian 同步更新反链",
			risk: "C",
			readScope: [...(scopes.inboxTriageReadScopes ?? ["**"])],
			writeScope: [...(scopes.inboxTriageWriteScopes ?? ["<inbox-triage>"])],
			timeoutMs: 30_000,
			cancelable: false,
			reversible: true,
			execute: executor(dependencies.moveInboxNote),
		},
	]);
}
