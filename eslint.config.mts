import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
	globalIgnores([
		'node_modules',
		'dist',
		'prototype',
		// 固定上游版本与哈希的 Emotion Ball 快照；由来源与哈希测试验证，不做本地改写
		'src/quyuan/vendor/emotion-ball/**',
		// 修复前的原始文件备份，不是源码，不参与检查
		'backups',
		'*.selftest.mjs',
		'build-styles.mjs',
		'esbuild.config.mjs',
		'third-party-licenses.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'vitest.config.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			// UI 中英混排 + 含字面量 CLI 命令，句首大写规则不适用
			'obsidianmd/ui/sentence-case': 'off',
		},
	},
	{
		// src/jarvis/ 是「旧版屈原 v1」的冻结回滚层：刻意保持原样以便随时回退，
		// 不重构、不改运行时行为，因此不参与现行代码风格检查。
		// 以下规则均按 2026-07-19 实跑 `npm run lint` 的报错清单关闭。
		files: ['src/jarvis/**/*.ts'],
		rules: {
			// v1 冻结回滚层，保持原状，不参与现行代码风格检查
			'@typescript-eslint/no-base-to-string': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-this-alias': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'no-control-regex': 'off',
			'no-restricted-globals': 'off',
			'obsidianmd/no-static-styles-assignment': 'off',
		},
	},
	{
		// 测试跑在 Node（vitest），没有 window；Obsidian 弹窗兼容规则不适用
		files: ['tests/**/*.ts'],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
);
