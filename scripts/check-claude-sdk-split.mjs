#!/usr/bin/env node
/**
 * 生产 bundle 检查：Claude Agent SDK 必须只存在于 claude-sdk.cjs，不得被静态
 * import 回 main.js（SDK 约占原 bundle 一半，进 main.js 会拖慢每次启动）。
 * claude-sdk.cjs 必须能被 require 并导出 query / forkSession。
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// 只出现在 SDK 运行时代码里的标记；插件自身源码不包含这些字符串。
export const SDK_MARKERS = ["CLAUDE_CODE_ENTRYPOINT", "@anthropic-ai/claude-agent-sdk"];

export function sdkMarkersIn(bundleText) {
  return SDK_MARKERS.filter((marker) => bundleText.includes(marker));
}

export function assertMainBundleWithoutSdk(bundleText) {
  const found = sdkMarkersIn(bundleText);
  if (found.length > 0) {
    throw new Error(`main.js 含 Claude SDK 代码（${found.join(", ")}）；SDK 只能通过 claude-sdk.cjs 按需加载。`);
  }
  return true;
}

export function assertSdkBundleExports(sdkModule) {
  if (!sdkModule || typeof sdkModule.query !== "function" || typeof sdkModule.forkSession !== "function") {
    throw new Error("claude-sdk.cjs 未导出 query / forkSession。");
  }
  return true;
}

function main() {
  assertMainBundleWithoutSdk(readFileSync(join(root, "main.js"), "utf8"));
  const sdkPath = join(root, "claude-sdk.cjs");
  if (!existsSync(sdkPath)) throw new Error("缺少 claude-sdk.cjs。");
  assertSdkBundleExports(createRequire(import.meta.url)(sdkPath));
  console.log("claude-sdk split guard: pass");
}

if (process.argv[1] && process.argv[1].endsWith("check-claude-sdk-split.mjs")) {
  main();
}
