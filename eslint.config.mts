import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
	globalIgnores([
		'node_modules',
		'dist',
		'prototype',
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
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
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
		// 测试跑在 Node（vitest），没有 window；Obsidian 弹窗兼容规则不适用
		files: ['tests/**/*.ts'],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
);
