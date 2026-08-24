import { describe, expect, it } from "vitest";
import { assembleVaultContext } from "../src/ai/context/context-assembler";
import type {
	RetrievalHit,
	VaultRetrievalResult,
} from "../src/ai/context/vault-retrieval";

function hit(overrides: Partial<RetrievalHit> = {}): RetrievalHit {
	return {
		path: "notes/a.md",
		excerpt: "一段库内资料",
		truncated: false,
		source: "keyword",
		score: 1,
		reasons: [],
		...overrides,
	};
}

function retrieval(
	hits: RetrievalHit[],
	blocked: VaultRetrievalResult["blocked"] = []
): VaultRetrievalResult {
	return { hits, blocked };
}

describe("assembleVaultContext", () => {
	it("labels hits by retrieval reason and appends the user query", () => {
		const result = assembleVaultContext(
			"今天该做什么？",
			retrieval([
				hit({ path: "tasks/today.md", reasons: ["candidate-context"] }),
				hit({ path: "notes/guess.md", reasons: ["inferred-context"] }),
				hit({ path: "notes/fact.md" }),
			])
		);
		expect(result.text).toContain("[候选 | keyword | tasks/today.md]");
		expect(result.text).toContain("[推断 | keyword | notes/guess.md]");
		expect(result.text).toContain("[库内资料 | keyword | notes/fact.md]");
		expect(result.text).toContain("用户问题：今天该做什么？");
		expect(result.text).toContain("不得冒充已确认事实");
		expect(result.usedPaths).toEqual([
			"tasks/today.md",
			"notes/guess.md",
			"notes/fact.md",
		]);
		expect(result.blocked).toEqual([]);
	});

	it("blocks hits that fail secret inspection and reports the reason", () => {
		const result = assembleVaultContext(
			"q",
			retrieval([
				hit({ path: ".talos/private/token.md" }),
				hit({
					path: "notes/leak.md",
					excerpt: "key: sk-ant-abcdef1234567890",
				}),
				hit({ path: "notes/safe.md", excerpt: "安全内容" }),
			])
		);
		expect(result.usedPaths).toEqual(["notes/safe.md"]);
		expect(result.text).toContain("notes/safe.md");
		expect(result.text).not.toContain("sk-ant-");
		expect(result.text).not.toContain("token.md");
		expect(result.blocked.map((b) => b.path)).toEqual([
			".talos/private/token.md",
			"notes/leak.md",
		]);
		expect(result.blocked[0].reasons).toContain("talos-private");
		expect(result.blocked[1].reasons).toContain("api-key");
	});

	it("carries through retriever-side blocked entries untouched", () => {
		const result = assembleVaultContext(
			"q",
			retrieval([hit()], [
				{ path: "secretstorage/x", reasons: ["secret-storage"] },
			])
		);
		expect(result.blocked).toContainEqual({
			path: "secretstorage/x",
			reasons: ["secret-storage"],
		});
		expect(result.usedPaths).toEqual(["notes/a.md"]);
	});

	it("truncates fragments at maxChars and stops accepting further hits", () => {
		const result = assembleVaultContext(
			"q",
			retrieval([
				hit({ path: "a.md", excerpt: "x".repeat(50) }),
				hit({ path: "b.md", excerpt: "y".repeat(50) }),
			]),
			{ maxChars: 70 }
		);
		expect(result.usedPaths).toEqual(["a.md"]);
		const body = result.text.split("用户问题")[0];
		expect(body.length).toBeLessThan(200);
	});

	it("falls back to an explicit empty-context notice when nothing is safe", () => {
		const result = assembleVaultContext("q", retrieval([]));
		expect(result.text).toContain("（没有找到可安全发送的库内上下文）");
		expect(result.usedPaths).toEqual([]);
	});
});
