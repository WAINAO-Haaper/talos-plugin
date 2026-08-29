#!/usr/bin/env node
// 部署后功能硬门：目标 Vault 的工作台会话在指定窗口内必须产生完整的
// user.message -> assistant.final -> turn.finished 回合；回答不得早于问题，
// assistant/thinking/tool-update/usage 瞬态流不得落入持久历史，否则本次部署
// 记 fail。
//
// 存在理由：截至 2026-08-27，全部部署门都是数据完整性门（产物哈希、data.json、
// 会话计数、业务保护树、自动回滚）。一次「模型不可达」故障可以让十余个候选
// 全部通过 694 项测试与逐字节校验而无人发现。本门补上「东西要能用」。
//
// 只读元数据：解析事件的 type / timestamp / runtimeId；正文只做非空布尔判断，
// 不记录、不输出提示词、凭据、本机绝对路径或正文。不代发任何模型消息。
//
//   node agent-workbench-chat-gate.selftest.mjs <vaultRoot> [--since <ISO>] [--runtime <id>]
//
// 退出码：0 通过；1 未达门槛；2 参数或路径错误。

import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const EVENTS_ROOT = [".talos", "agent-workbench", "v1", "conversations"];
const RUNTIME_IDS = new Set(["claude", "codex", "ohmypi"]);
const EVENT_TYPES = new Set([
	"user.message", "assistant.start", "assistant.delta", "assistant.final",
	"thinking.delta", "plan.updated", "context.compacted", "tool.started",
	"tool.updated", "tool.finished", "file.diff", "task.progress",
	"subagent.updated", "approval.requested", "approval.resolved", "user.question",
	"usage.updated", "session.bound", "handoff.created", "runtime.status",
	"notice", "error", "turn.finished",
]);
const TRANSIENT_PERSISTED_TYPES = new Set([
	"assistant.delta", "thinking.delta", "tool.updated", "usage.updated",
]);

function parseArgs(argv) {
	const [vaultRoot, ...rest] = argv;
	if (!vaultRoot || vaultRoot.startsWith("--")) {
		throw new Error("用法：node agent-workbench-chat-gate.selftest.mjs <vaultRoot> [--since <ISO>] [--runtime <id>]");
	}
	const options = { vaultRoot, since: null, sinceMs: null, runtime: null };
	for (let index = 0; index < rest.length; index += 2) {
		const flag = rest[index];
		const value = rest[index + 1];
		if (!value) throw new Error(`缺少 ${flag} 的取值`);
		if (flag === "--since") {
			const sinceMs = Date.parse(value);
			if (Number.isNaN(sinceMs)) throw new Error("--since 不是合法 ISO 时间");
			options.since = new Date(sinceMs).toISOString();
			options.sinceMs = sinceMs;
		} else if (flag === "--runtime") {
			if (!RUNTIME_IDS.has(value)) throw new Error("--runtime 必须是 claude、codex 或 ohmypi");
			options.runtime = value;
		} else {
			throw new Error(`未知参数：${flag}`);
		}
	}
	return options;
}

async function listEventFiles(conversationsRoot) {
	let conversations;
	try {
		conversations = await readdir(conversationsRoot, { withFileTypes: true });
	} catch {
		return null;
	}
	const files = [];
	for (const entry of conversations) {
		if (!entry.isDirectory()) continue;
		const conversationDirectory = path.join(conversationsRoot, entry.name);
		let children;
		try {
			children = await readdir(conversationDirectory, { withFileTypes: true });
		} catch {
			continue;
		}
		const eventsEntry = children.find((child) => child.name === "events");
		if (!eventsEntry?.isDirectory()) continue;
		const eventsDirectory = path.join(conversationDirectory, eventsEntry.name);
		let eventEntries;
		try {
			eventEntries = await readdir(eventsDirectory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const eventEntry of eventEntries) {
			if (eventEntry.isFile() && eventEntry.name.endsWith(".json")) {
				files.push(path.join(eventsDirectory, eventEntry.name));
			}
		}
	}
	return files;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	let canonicalVaultRoot;
	let conversationsRoot;
	try {
		canonicalVaultRoot = await realpath(options.vaultRoot);
		conversationsRoot = await realpath(path.join(canonicalVaultRoot, ...EVENTS_ROOT));
	} catch {
		throw new Error("目标 Vault 或工作台会话目录不可访问");
	}
	const relativeConversationsRoot = path.relative(canonicalVaultRoot, conversationsRoot);
	if (relativeConversationsRoot === ".." || relativeConversationsRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeConversationsRoot)) {
		throw new Error("工作台会话目录越出目标 Vault");
	}
	const files = await listEventFiles(conversationsRoot);
	if (files === null) {
		console.error("FAIL 找不到工作台会话目录，无法判定功能门");
		process.exit(2);
	}

	const counts = new Map();
	let assistantFinal = 0;
	let errors = 0;
	let considered = 0;
	let latest = null;
	let latestMs = null;
	const eventRecords = [];

	for (const file of files) {
		let event;
		try {
			event = JSON.parse(await readFile(file, "utf8"));
		} catch {
			continue;
		}
		const type = EVENT_TYPES.has(event.type) ? event.type : "unknown";
		const timestampMs = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
		if (options.sinceMs !== null && (Number.isNaN(timestampMs) || timestampMs < options.sinceMs)) continue;
		if (options.runtime && event.runtimeId !== options.runtime) continue;
		considered += 1;
		counts.set(type, (counts.get(type) ?? 0) + 1);
		if (!Number.isNaN(timestampMs) && (latestMs === null || timestampMs > latestMs)) {
			latestMs = timestampMs;
			latest = new Date(timestampMs).toISOString();
		}
		if (type === "assistant.final") {
			// 只判定文本非空，不读取、不记录内容。
			const text = event.payload && typeof event.payload.text === "string" ? event.payload.text : "";
			if (text.trim().length > 0) assistantFinal += 1;
		}
		if (type === "error") errors += 1;
		eventRecords.push({
			type,
			eventId: typeof event.eventId === "string" ? event.eventId : "",
			conversationId: typeof event.conversationId === "string" ? event.conversationId : "",
			turnId: typeof event.turnId === "string" ? event.turnId : "",
			runtimeId: typeof event.runtimeId === "string" ? event.runtimeId : "",
			timestampMs: Number.isNaN(timestampMs) ? Number.MAX_SAFE_INTEGER : timestampMs,
			hasText: type === "assistant.final" && typeof event.payload?.text === "string" && event.payload.text.trim().length > 0,
		});
	}

	const turns = new Map();
	for (const event of eventRecords.sort((left, right) => left.timestampMs - right.timestampMs || left.eventId.localeCompare(right.eventId))) {
		const key = `${event.conversationId}:${event.turnId}`;
		const current = turns.get(key) ?? [];
		current.push(event);
		turns.set(key, current);
	}
	let qualifiedTurns = 0;
	let invalidTurnOrder = 0;
	let persistedTransient = 0;
	for (const events of turns.values()) {
		persistedTransient += events.filter((event) => TRANSIENT_PERSISTED_TYPES.has(event.type)).length;
		const userIndex = events.findIndex((event) => event.type === "user.message");
		const finalIndex = events.findIndex((event) => event.hasText);
		const finishIndex = events.findIndex((event) => event.type === "turn.finished");
		if (finalIndex >= 0 && (userIndex < 0 || finalIndex < userIndex)) invalidTurnOrder += 1;
		if (userIndex >= 0 && finalIndex > userIndex && finishIndex > finalIndex) qualifiedTurns += 1;
	}

	const summary = [...counts.entries()].sort().map(([type, count]) => `${type}=${count}`).join(" ");
	console.log(`窗口内事件 ${considered} 条${options.since ? `（since ${options.since}）` : ""}${options.runtime ? `（runtime ${options.runtime}）` : ""}`);
	console.log(`分布：${summary || "（空）"}`);
	console.log(`最新事件时间：${latest ?? "无"}`);
	console.log(`带非空文本的 assistant.final：${assistantFinal}｜error：${errors}`);
	console.log(`完整有序回合：${qualifiedTurns}｜乱序/无问题回答：${invalidTurnOrder}｜持久化瞬态事件：${persistedTransient}`);

	if (assistantFinal < 1 || qualifiedTurns < 1) {
		console.error("FAIL 窗口内没有完整的 user.message -> assistant.final -> turn.finished 回合");
		process.exit(1);
	}
	if (invalidTurnOrder > 0) {
		console.error("FAIL 存在回答早于问题或没有问题归属的 assistant.final");
		process.exit(1);
	}
	if (persistedTransient > 0) {
		console.error("FAIL assistant/thinking/tool-update/usage 瞬态事件被写入持久历史");
		process.exit(1);
	}
	console.log("PASS 功能门通过：模型已在目标环境产生真实回复");
}

main().catch((error) => {
	console.error(`FAIL ${error instanceof Error ? error.message : "未知错误"}`);
	process.exit(2);
});
