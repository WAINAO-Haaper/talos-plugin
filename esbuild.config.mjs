import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';

// claude-agent-sdk 的进程关闭链路裸调 setTimeout(...).unref()（Node timer API）。
// Obsidian 渲染进程的全局 setTimeout 是浏览器版（返回 number，没有 .unref），
// 会抛 Uncaught TypeError: setTimeout(...).unref is not a function ——
// 该异常沿 dispose → unmount → renderPage 冒泡，把 jarvisMounted 状态炸脏，
// 屈原页从此白屏（2026-07-09 定位）。
// 修法：仅对 sdk.mjs 注入 node:timers 的 setTimeout/clearTimeout（模块级 shadow，
// 不污染全局、不影响插件其余代码）。node:timers 在 external 列表里，运行时走
// require("node:timers")，Obsidian 桌面端可用。
const sdkNodeTimersShim = {
	name: 'sdk-node-timers-shim',
	setup(build) {
		build.onLoad(
			{ filter: /@anthropic-ai[\\/]claude-agent-sdk[\\/]sdk\.mjs$/ },
			async (args) => {
				const src = await readFile(args.path, 'utf8');
				const shim =
					'import { setTimeout, clearTimeout } from "node:timers";\n';
				// 保留 shebang 在第一行（否则不是合法 JS）
				const contents = src.startsWith('#!')
					? src.replace(/^(#![^\n]*\n)/, `$1${shim}`)
					: shim + src;
				return { contents, loader: 'js' };
			},
		);
	},
};

const banner = `/*
TALOS PROPRIETARY SOFTWARE
Copyright (c) 2026 外脑玩家 Haaper. All rights reserved.

This generated bundle contains third-party software governed by separate
licenses and service terms. Any distribution of this file MUST include:
LICENSE, THIRD-PARTY-NOTICES.md, and THIRD-PARTY-LICENSES.txt.
*/
`;

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
	banner: {
		js: banner,
	},
	entryPoints: ['src/main.ts'],
	bundle: true,
	plugins: [sdkNodeTimersShim],
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: 'cjs',
	// claude-agent-sdk 顶层调用 createRequire(import.meta.url)；cjs 打包下 import.meta.url
	// 会变 undefined 导致加载即崩。给一个合法 file URL 占位（运行时不会真用它解析原生二进制，
	// 因为我们始终传 pathToClaudeCodeExecutable）。
	define: {
		'import.meta.url': JSON.stringify('file:///talos-plugin/main.js'),
	},
	target: 'es2021',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
