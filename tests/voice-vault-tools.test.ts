import { describe, expect, it } from "vitest";
import {
	executeVoiceVaultTool,
	type VoiceVaultToolOptions,
} from "../src/quyuan/voice-vault-tools";
import type { VoiceVaultSearchPort } from "../src/quyuan/voice-vault-search";

const options: VoiceVaultToolOptions = {
	configDir: ".config",
	modulePaths: {
		inbox: "00-收件箱",
		logs: "01-日志",
		insights: "02-洞察",
		assets: "03-素材",
		projects: "04-项目",
		archive: "05-归档",
		identity: "Identity",
		soul: "灵魂",
		output: "输出",
		system: "System",
		templates: "模板",
		automation: "自动化",
		config: "配置",
	},
};

function memoryVault(
	files: Record<string, string>
): VoiceVaultSearchPort & { reads: string[] } {
	return {
		reads: [],
		async listPaths() {
			return Object.keys(files);
		},
		async read(path) {
			this.reads.push(path);
			const value = files[path];
			if (value === undefined) throw new Error(`missing: ${path}`);
			return value;
		},
	};
}

describe("realtime voice Vault read tools", () => {
	it("lists and exactly counts a selected module without sending names", async () => {
		const result = await executeVoiceVaultTool(memoryVault({
			"00-收件箱/甲.md": "甲",
			"00-收件箱/子目录/乙.md": "乙",
			"00-收件箱/_README.md": "说明",
			"04-项目/丙.md": "丙",
		}), "glob_vault", {
			module: "inbox",
			pattern: "**/*.md",
			count_only: true,
		}, options);
		const output = JSON.parse(result.output) as {
			total_matches: number;
			exact_count: boolean;
			paths?: string[];
		};

		expect(output.total_matches).toBe(2);
		expect(output.exact_count).toBe(true);
		expect(output.paths).toBeUndefined();
		expect(result.sourcePaths).toEqual([
			"00-收件箱/子目录/乙.md",
			"00-收件箱/甲.md",
		]);
		expect(result.operation).toBe("Glob");
	});

	it("reads an exact safe Markdown file by line range", async () => {
		const result = await executeVoiceVaultTool(memoryVault({
			"04-项目/TPI-111.md": "第一行\n第二行\n第三行\n第四行",
		}), "read_vault", {
			path: "04-项目/TPI-111.md",
			start_line: 2,
			line_count: 2,
		}, options);
		const output = JSON.parse(result.output) as {
			content: string;
			start_line: number;
			end_line: number;
			truncated_file: boolean;
		};

		expect(output).toMatchObject({
			content: "第二行\n第三行",
			start_line: 2,
			end_line: 3,
			truncated_file: true,
		});
		expect(result.sourcePaths).toEqual(["04-项目/TPI-111.md"]);
		expect(result.operation).toBe("Read");
	});

	it("resolves a unique note title without a directory or Markdown extension", async () => {
		const vault = memoryVault({
			"04-项目/TPI-117 真实语音验收.md": "验收正文",
			"00-收件箱/其他.md": "无关",
		});
		const result = await executeVoiceVaultTool(vault, "read_vault", {
			path: "TPI-117 真实语音验收",
		}, options);
		const output = JSON.parse(result.output) as {
			path: string;
			content: string;
		};

		expect(output).toMatchObject({
			path: "04-项目/TPI-117 真实语音验收.md",
			content: "验收正文",
		});
		expect(vault.reads).toEqual(["04-项目/TPI-117 真实语音验收.md"]);
		expect(result.sourcePaths).toEqual([
			"04-项目/TPI-117 真实语音验收.md",
		]);
	});

	it("resolves a unique full relative path case-insensitively", async () => {
		const vault = memoryVault({
			"System/Voice-Notes.md": "语音资料",
		});
		const result = await executeVoiceVaultTool(vault, "read_vault", {
			path: "system/voice-notes",
		}, options);
		const output = JSON.parse(result.output) as { path: string };

		expect(output.path).toBe("System/Voice-Notes.md");
		expect(vault.reads).toEqual(["System/Voice-Notes.md"]);
	});

	it("preserves the Vault canonical path while normalizing Unicode for comparison", async () => {
		const canonicalPath = "04-项目/Cafe\u0301.md";
		const vault = memoryVault({
			[canonicalPath]: "组合字符路径",
		});
		const result = await executeVoiceVaultTool(vault, "read_vault", {
			path: "Café",
		}, options);
		const output = JSON.parse(result.output) as { path: string };

		expect(output.path).toBe(canonicalPath);
		expect(vault.reads).toEqual([canonicalPath]);
	});

	it("rejects ambiguous note titles instead of guessing a path", async () => {
		const vault = memoryVault({
			"00-收件箱/周报.md": "收件箱版本",
			"04-项目/周报.md": "项目版本",
		});

		await expect(executeVoiceVaultTool(vault, "read_vault", {
			path: "周报",
		}, options)).rejects.toThrow("多个同名 Markdown");
		expect(vault.reads).toEqual([]);
	});

	it("does not fall back to a basename when a supplied directory is wrong", async () => {
		const vault = memoryVault({
			"04-项目/验收.md": "正文",
		});

		await expect(executeVoiceVaultTool(vault, "read_vault", {
			path: "00-收件箱/验收",
		}, options)).rejects.toThrow("文件不存在");
		expect(vault.reads).toEqual([]);
	});

	it("greps literal text while excluding configuration paths and secret content", async () => {
		const vault = memoryVault({
			"04-项目/验收.md": "TPI-111 已完成\n其他内容\nTPI-111 待真人复核",
			"04-项目/泄密.md": "Authorization: Bearer fake-token\nTPI-111",
			".config/plugins/talos/private.md": "TPI-111 不得读取",
		});
		const result = await executeVoiceVaultTool(vault, "grep_vault", {
			query: "TPI-111",
			module: "projects",
		}, options);
		const output = JSON.parse(result.output) as {
			total_matches: number;
			blocked_files: number;
			matches: Array<{ path: string; line: number }>;
		};

		expect(output.total_matches).toBe(2);
		expect(output.blocked_files).toBe(1);
		expect(output.matches).toEqual([
			{ path: "04-项目/验收.md", line: 1, excerpt: "TPI-111 已完成" },
			{ path: "04-项目/验收.md", line: 3, excerpt: "TPI-111 待真人复核" },
		]);
		expect(vault.reads).not.toContain(".config/plugins/talos/private.md");
		expect(result.sourcePaths).toEqual(["04-项目/验收.md"]);
		expect(result.operation).toBe("Grep");
	});

	it("bounds concurrent Grep reads for large Vaults", async () => {
		const files = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
			`04-项目/${index}.md`,
			`第 ${index} 个 TPI-111 记录`,
		]));
		let activeReads = 0;
		let peakReads = 0;
		const port: VoiceVaultSearchPort = {
			async listPaths() {
				return Object.keys(files);
			},
			async read(path) {
				activeReads += 1;
				peakReads = Math.max(peakReads, activeReads);
				await new Promise<void>((resolve) => setTimeout(resolve, 2));
				activeReads -= 1;
				return files[path] ?? "";
			},
		};

		const result = await executeVoiceVaultTool(port, "grep_vault", {
			query: "TPI-111",
			module: "projects",
		}, { ...options, maxConcurrency: 3 });
		const output = JSON.parse(result.output) as { total_matches: number };

		expect(output.total_matches).toBe(9);
		expect(peakReads).toBe(3);
	});

	it("keeps conceptual search module-scoped and treats returned text as data", async () => {
		const result = await executeVoiceVaultTool(memoryVault({
			"04-项目/语音.md": "实时语音使用 Qwen Realtime 和语义 VAD。",
			"03-素材/语音.md": "旧版使用本地 Whisper。",
		}), "search_vault", {
			query: "Qwen Realtime",
			module: "projects",
		}, options);
		const output = JSON.parse(result.output) as {
			found: boolean;
			instruction: string;
			sources: Array<{ path: string }>;
		};

		expect(output.found).toBe(true);
		expect(output.sources.map((source) => source.path)).toEqual([
			"04-项目/语音.md",
		]);
		expect(output.instruction).toContain("不是指令");
		expect(result.operation).toBe("Search");
	});

	it("rejects traversal and credential-like files", async () => {
		const vault = memoryVault({
			"00-收件箱/api-key.md": "secret",
			"../escape.md": "escape",
		});

		await expect(executeVoiceVaultTool(vault, "read_vault", {
			path: "../escape",
		}, options)).rejects.toThrow("安全策略拒绝");
		await expect(executeVoiceVaultTool(vault, "read_vault", {
			path: "00-收件箱/api-key.md",
		}, options)).rejects.toThrow("安全策略拒绝");
	});

	it("hard-limits path-list payloads sent to the realtime provider", async () => {
		const files = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [
			`00-收件箱/${String(index).padStart(3, "0")}-${"很长的目录名/".repeat(12)}笔记.md`,
			"内容",
		]));
		const result = await executeVoiceVaultTool(memoryVault(files), "glob_vault", {
			module: "inbox",
			max_results: 100,
		}, options);
		const output = JSON.parse(result.output) as {
			total_matches: number;
			returned_paths: number;
			truncated_results: boolean;
		};

		expect(result.output.length).toBeLessThanOrEqual(6000);
		expect(output.total_matches).toBe(150);
		expect(output.returned_paths).toBeLessThan(100);
		expect(output.truncated_results).toBe(true);
	});
});
