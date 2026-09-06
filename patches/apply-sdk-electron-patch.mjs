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
// Match the AbortController factory independent of SDK minified symbol names.
// Require exactly one recognized factory; never patch an ambiguous upgrade.
const factory = /function (\w+)\((\w+)=(\w+)\)\{let (\w+)=new AbortController;return (\w+)\(\2,\4\.signal\),\4\}/g;
const patchedFactory = /function (\w+)\((\w+)=(\w+)\)\{let (\w+)=new AbortController;try\{(\w+)\(\2,\4\.signal\)\}catch\(error\)\{if\(error\?\.code!=="ERR_INVALID_ARG_TYPE"\)throw error\}return \4\}/g;
const targets = [...source.matchAll(factory)];
const patched = [...source.matchAll(patchedFactory)];
if (targets.length === 0 && patched.length === 1) {
	console.log("[sdk-electron-patch] 已应用，跳过");
} else if (targets.length === 1 && patched.length === 0) {
	const [original, name, limit, defaultLimit, controller, setListeners] = targets[0];
	const replacement = `function ${name}(${limit}=${defaultLimit}){let ${controller}=new AbortController;try{${setListeners}(${limit},${controller}.signal)}catch(error){if(error?.code!=="ERR_INVALID_ARG_TYPE")throw error}return ${controller}}`;
	await writeFile(sdkPath, source.replace(original, replacement));
	console.log("[sdk-electron-patch] 已应用");
} else {
	console.error("[sdk-electron-patch] 补丁目标缺失或不唯一（SDK 版本变化？），请人工检查 createAbortController");
	process.exitCode = 1;
}
