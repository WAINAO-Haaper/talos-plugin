import { describe, expect, it } from "vitest";
import {
	VaultRetriever,
	type VaultDocumentPort,
} from "../src/ai/context/vault-retrieval";

function memoryVault(
	files: Record<string, string>
): VaultDocumentPort & { reads: string[] } {
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

const MODULE_FIXTURE: Record<string, string> = {
	"00 收件箱/输入.md": "TALOS 输入材料",
	"10 身份/身份.md": "TALOS 已确认身份",
	"10 身份/候选信息.md": "TALOS 候选：喜欢结构化输出",
	"10 身份/推断信息.md": "TALOS 推断：可能偏好语音",
	"20 知识/架构.md": "TALOS Provider 架构知识",
	"30 洞察/结论.md": "TALOS 已确认洞察",
	"40 项目/WP7.md": "TALOS WP7 项目计划",
	"50 记忆/近期.md": "TALOS 最近已确认记忆",
	"60 资源/模型.md": "TALOS 模型资源",
	"70 输出/草案.md": "TALOS 产品草案",
	"80 归档/旧版.md": "TALOS 旧版记录",
	"90 系统/规则.md": "TALOS 系统规则",
	".env": "ANTHROPIC_API_KEY=sk-ant-api03-fake-secret-value",
	".config/plugins/talos/data.json":
		'{"anthropicApiKey":"sk-ant-api03-fake-secret-value"}',
	".talos/private/provider.json": '{"token":"fake"}',
	"30 洞察/key-leak.md":
		"Authorization: Bearer fake-bearer-token-value",
};

describe("VaultRetriever", () => {
	it("searches all non-secret modules and keeps candidate/inference context", async () => {
		const vault = memoryVault(MODULE_FIXTURE);
		const retriever = new VaultRetriever(vault, {
			maxExcerptChars: 120,
			configDir: ".config",
		});

		const result = await retriever.retrieve({ query: "TALOS" });
		const paths = result.hits.map((hit) => hit.path);

		expect(paths).toEqual(
			expect.arrayContaining([
				"10 身份/身份.md",
				"10 身份/候选信息.md",
				"10 身份/推断信息.md",
				"20 知识/架构.md",
				"40 项目/WP7.md",
				"50 记忆/近期.md",
				"70 输出/草案.md",
			])
		);
		expect(paths).not.toContain(".env");
		expect(paths).not.toContain(
			".config/plugins/talos/data.json"
		);
		expect(paths).not.toContain(".talos/private/provider.json");
		expect(paths).not.toContain("30 洞察/key-leak.md");
		expect(
			result.hits.find((hit) => hit.path.includes("候选信息"))
				?.reasons
		).toContain("candidate-context");
		expect(
			result.hits.find((hit) => hit.path.includes("推断信息"))
				?.reasons
		).toContain("inferred-context");
		expect(result.blocked).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: ".env",
					reasons: ["environment-file"],
				}),
				expect.objectContaining({
					path: "30 洞察/key-leak.md",
					reasons: ["bearer-token"],
				}),
			])
		);
		expect(vault.reads).not.toContain(".env");
	});

	it("uses deterministic source priority and deduplicates paths", async () => {
		const vault = memoryVault(MODULE_FIXTURE);
		const retriever = new VaultRetriever(vault);

		const result = await retriever.retrieve({
			query: "TALOS",
			attachmentPaths: ["40 项目/WP7.md"],
			currentPath: "20 知识/架构.md",
			engineResultPaths: ["70 输出/草案.md", "40 项目/WP7.md"],
			recentConfirmedPaths: ["50 记忆/近期.md"],
		});
		const paths = result.hits.map((hit) => hit.path);

		expect(paths.slice(0, 4)).toEqual([
			"40 项目/WP7.md",
			"20 知识/架构.md",
			"70 输出/草案.md",
			"00 收件箱/输入.md",
		]);
		expect(paths.filter((path) => path === "40 项目/WP7.md")).toHaveLength(
			1
		);
		expect(result.hits[0]?.source).toBe("attachment");
		expect(result.hits[1]?.source).toBe("current");
		expect(result.hits[2]?.source).toBe("engine");
		const confirmed = result.hits.find(
			(hit) => hit.path === "50 记忆/近期.md"
		);
		expect(confirmed?.reasons).toContain("recent-confirmed");
	});

	it("truncates large files deterministically", async () => {
		const content = `TALOS\n${"0123456789".repeat(50)}`;
		const retriever = new VaultRetriever(
			memoryVault({ "30 洞察/large.md": content }),
			{ maxExcerptChars: 80 }
		);

		const first = await retriever.retrieve({ query: "TALOS" });
		const second = await retriever.retrieve({ query: "TALOS" });

		expect(first.hits[0]?.excerpt).toHaveLength(80);
		expect(first.hits[0]?.excerpt).toBe(second.hits[0]?.excerpt);
		expect(first.hits[0]?.truncated).toBe(true);
	});
});
