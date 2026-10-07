#!/usr/bin/env node
/**
 * 生产 bundle 静态检查：状态桥路径不得保留动态 import("node:fs/promises")。
 * 真实宿主缺陷（2026-09-04）：动态导入在生产 bundle 中使 readFile 落入
 * cache-unreadable，卡片显示「损坏」。状态桥必须静态引入 node:fs/promises。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const FORBIDDEN_PATTERNS = [
  /import\(\s*["']node:fs\/promises["']\s*\)/,
  /import\(\s*["']fs\/promises["']\s*\)/,
];

export function dynamicFsPromisesImports(bundleText) {
  const findings = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    for (const match of bundleText.matchAll(new RegExp(pattern.source, "g"))) {
      findings.push(match[0]);
    }
  }
  return findings;
}

export function assertBundleSafe(bundleText) {
  const findings = dynamicFsPromisesImports(bundleText);
  if (findings.length > 0) {
    throw new Error(
      `peer-status 生产 bundle 含禁用动态导入（${[...new Set(findings)].join(", ")}）；` +
        "node:fs/promises 必须静态 import。",
    );
  }
  return true;
}

function main() {
  const bundle = readFileSync(join(root, "main.js"), "utf8");
  assertBundleSafe(bundle);
  console.log("peer-status bundle static-import guard: pass");
}

if (process.argv[1] && process.argv[1].endsWith("check-peer-status-bundle.mjs")) {
  main();
}
