#!/usr/bin/env node
/**
 * Electron/Obsidian realm 兼容补丁（npm ci 后自动重放）
 *
 * 根因：@anthropic-ai/claude-agent-sdk 在 createAbortController 里调用
 *   events.setMaxListeners(n, abortController.signal)
 * Obsidian (Electron renderer) 中 AbortSignal 是 Chromium Web API 实现，
 * 过不了 Node events 的 `instanceof EventTarget` 检查，抛
 *   ERR_INVALID_ARG_TYPE: The "eventTargets" argument must be an instance of
 *   EventEmitter or EventTarget. Received an instance of AbortSignal
 * 导致 Claude 通道所有消息发送失败。
 *
 * 修复：setMaxListeners 只是抑制监听器警告的性能优化，包 try/catch 即可，
 * 行为不变（上游 Claudian/Obsidian 系插件同款 workaround，见 YishenTu/claudian#284）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sdkPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.mjs");
const source = await readFile(sdkPath, "utf8");
const needle = "function da(e=w1){let t=new AbortController;return x1(e,t.signal),t}";
const replacement = "function da(e=w1){let t=new AbortController;try{x1(e,t.signal)}catch{}return t}";
if (source.includes(replacement)) {
	console.log("[sdk-electron-patch] 已应用，跳过");
	process.exit(0);
}
if (!source.includes(needle)) {
	// SDK 版本升级后 minified 签名可能变化：退化为通用替换
	const generic = /function (\w+)\((\w+)=(\w+)\)\{let (\w+)=new AbortController;return (\w+)\(\2,\4\.signal\),\4\}/;
	const match = source.match(generic);
	if (!match) {
		console.error("[sdk-electron-patch] 未找到补丁目标（SDK 版本变化？），请人工检查 createAbortController");
		process.exit(1);
	}
	await writeFile(sdkPath, source.replace(match[0], match[0].replace(`return ${match[5]}(${match[2]},${match[4]}.signal),${match[4]}`, `try{${match[5]}(${match[2]},${match[4]}.signal)}catch{}return ${match[4]}`)));
	console.log("[sdk-electron-patch] 已应用（通用签名匹配）");
	process.exit(0);
}
await writeFile(sdkPath, source.replace(needle, replacement));
console.log("[sdk-electron-patch] 已应用");
