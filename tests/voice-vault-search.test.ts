import { describe, expect, it } from "vitest";
import {
	formatVoiceVaultSearchResult,
	searchVoiceVault,
	type VoiceVaultSearchPort,
} from "../src/quyuan/voice-vault-search";

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

describe("voice Vault search", () => {
	it("finds Chinese and named-project evidence while excluding private paths and secrets", async () => {
		const vault = memoryVault({
			"04-项目/TPI-111.md": `${"历史背景。".repeat(80)}\nTPI-111 真实语音验收：待执行真人唤醒、打断和休眠测试。`,
			"03-素材/语音方案.md": "语音模块采用 Qwen Realtime WebRTC 与语义 VAD。",
			"01-日志/无关.md": "今天整理了桌面布局。",
			"03-素材/凭证泄漏.md": "Authorization: Bearer fake-token-value",
			".config/plugins/talos/private.md": "TPI-111 不得读取",
			".talos/private/secret.md": "TPI-111 不得读取",
			"attachments/audio.pdf": "TPI-111 binary",
		});

		const result = await searchVoiceVault(
			vault,
			"屈原，请帮我查一下 TPI-111 真实语音验收状态",
			{
				configDir: ".config",
				maxHits: 2,
				maxExcerptChars: 220,
			}
		);

		expect(result.hits[0]?.path).toBe("04-项目/TPI-111.md");
		expect(result.hits[0]?.excerpt).toContain("真实语音验收");
		expect(result.hits).toHaveLength(2);
		expect(result.blockedFiles).toBe(1);
		expect(vault.reads).not.toContain(".config/plugins/talos/private.md");
		expect(vault.reads).not.toContain(".talos/private/secret.md");
		expect(vault.reads).not.toContain("attachments/audio.pdf");
		expect(result.hits.map((hit) => hit.path)).not.toContain(
			"03-素材/凭证泄漏.md"
		);

		const output = JSON.parse(formatVoiceVaultSearchResult(result)) as {
			found: boolean;
			sources: Array<{ path: string; excerpt: string }>;
		};
		expect(output.found).toBe(true);
		expect(output.sources).toHaveLength(2);
		expect(output.sources[0]?.path).toBe("04-项目/TPI-111.md");
	});

	it("prioritizes path matches before applying the bounded scan limit", async () => {
		const vault = memoryVault({
			"00/alpha.md": "无关",
			"00/beta.md": "无关",
			"99/TPI-111.md": "验收结论",
		});

		const result = await searchVoiceVault(vault, "TPI-111", {
			maxFiles: 2,
			maxHits: 1,
		});

		expect(result.truncatedScan).toBe(true);
		expect(result.scannedFiles).toBe(2);
		expect(vault.reads).toContain("99/TPI-111.md");
		expect(result.hits[0]?.path).toBe("99/TPI-111.md");
	});

	it("returns a fail-closed no-match instruction instead of fabricated context", async () => {
		const result = await searchVoiceVault(
			memoryVault({ "04-项目/其他.md": "完全无关" }),
			"不存在的专名 ZXQ-987"
		);
		const output = formatVoiceVaultSearchResult(result);

		expect(result.hits).toEqual([]);
		expect(output).toContain('"found":false');
		expect(output).toContain("不要凭空补全");
	});

	it("hard-limits the exact payload sent to the realtime provider", () => {
		const output = formatVoiceVaultSearchResult({
			query: "Q".repeat(1000),
			hits: Array.from({ length: 10 }, (_, index) => ({
				path: `${index}-${"长路径/".repeat(200)}.md`,
				excerpt: "片段\n".repeat(2000),
				score: 100 - index,
			})),
			scannedFiles: 10,
			blockedFiles: 0,
			truncatedScan: false,
		});
		const parsed = JSON.parse(output) as {
			sources: Array<{ path: string; excerpt: string }>;
		};

		expect(output.length).toBeLessThanOrEqual(6000);
		expect(parsed.sources).toHaveLength(4);
		expect(parsed.sources.every((source) => source.path.length <= 320)).toBe(true);
	});
});
