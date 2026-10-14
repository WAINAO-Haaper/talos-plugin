import { describe, expect, it } from "vitest";
import { SuperbrainDirectVaultTools, type SuperbrainDirectVaultHost } from "../src/module-commands/superbrain-direct-vault-tools";

function fixture(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	const writes: string[] = [];
	const host: SuperbrainDirectVaultHost = {
		files: () => [...files.keys(), ".talos/private/token.json", "secret/credentials.md"],
		async assertPath(path) {
			if (path.startsWith(".talos/") || path.startsWith("secret/") || path.includes("alias")) throw new Error("目标超出允许的数据范围");
		},
		async exists(path) { return files.has(path); },
		async read(path) { const text = files.get(path); if (text === undefined) throw new Error("not found"); return text; },
		async write(path, content, expected) {
			if (expected === null && files.has(path)) throw new Error("目标已变化");
			if (expected !== null && files.get(path) !== expected) throw new Error("目标已变化");
			files.set(path, content); writes.push(path);
		},
	};
	return { files, writes, host, tools: new SuperbrainDirectVaultTools(host) };
}

const call = (name: string, input: Record<string, unknown>) => ({ id: crypto.randomUUID(), name, input });

describe("direct API Vault tools", () => {
	it("creates and edits a text file under one task grant while recording actual bytes", async () => {
		const { files, tools, writes } = fixture();
		expect((await tools.run(call("Write", { file_path: "00-收件箱/新笔记.md", content: "# 新笔记\n草稿" }))).isError).toBe(false);
		expect((await tools.run(call("Edit", { file_path: "00-收件箱/新笔记.md", old_string: "草稿", new_string: "已整理" }))).isError).toBe(false);
		expect(files.get("00-收件箱/新笔记.md")).toBe("# 新笔记\n已整理");
		expect(writes).toHaveLength(2);
		expect(tools.changes()).toMatchObject([{ path: "00-收件箱/新笔记.md", kind: "create", beforeSha256: null }]);
		await expect(tools.verifyChanges()).resolves.toBeUndefined();
	});

	it("rejects Bash, traversal, protected paths and non-text files before write", async () => {
		const { tools, writes } = fixture();
		for (const request of [
			call("Bash", { command: "echo private" }),
			call("Write", { file_path: "../outside.md", content: "x" }),
			call("Read", { file_path: ".talos/private/token.json" }),
			call("Write", { file_path: "System/working-memory/workflow-runs/receipts/model.json", content: "x" }),
			call("Write", { file_path: "photo.png", content: "x" }),
			call("Write", { file_path: "00-收件箱/alias.md", content: "x" }),
		]) expect((await tools.run(request)).isError).toBe(true);
		expect(writes).toEqual([]);
	});

	it("filters protected files from search results and uses literal text search", async () => {
		const { tools } = fixture({ "00-收件箱/a.md": "# A\nTPI-111", "02-洞察/b.md": "# B\nno match" });
		const glob = await tools.run(call("Glob", { pattern: "**/*.md" }));
		expect(glob.isError).toBe(false);
		expect(glob.content).toContain("00-收件箱/a.md");
		expect(glob.content).not.toContain("credentials");
		const grep = await tools.run(call("Grep", { pattern: "TPI-111", glob: "**/*.md" }));
		expect(grep.content).toContain("00-收件箱/a.md");
		expect(grep.content).not.toContain("02-洞察/b.md");
	});

	it("keeps secret-bearing note content out of model reads and search", async () => {
		const { tools } = fixture({
			"00-收件箱/safe.md": "ordinary note",
			"00-收件箱/private.md": "authorization: Bearer secret-value",
			"00-收件箱/token.md": "credential",
		});
		expect((await tools.run(call("Read", { file_path: "00-收件箱/private.md" }))).isError).toBe(true);
		expect((await tools.run(call("Read", { file_path: "00-收件箱/token.md" }))).isError).toBe(true);
		const results = await tools.run(call("Grep", { pattern: "secret-value", glob: "**/*.md" }));
		expect(results.content).not.toContain("secret-value");
		expect(results.content).not.toContain("private.md");
	});

	it("reads long text in bounded pages without hiding its remaining content", async () => {
		const { tools } = fixture({ "03-素材/long.md": "a".repeat(25_000) + "END" });
		const first = await tools.run(call("Read", { file_path: "03-素材/long.md" }));
		const firstPage = JSON.parse(first.content) as { nextOffset: number; truncated: boolean; content: string };
		expect(firstPage).toMatchObject({ nextOffset: 24_000, truncated: true });
		const second = await tools.run(call("Read", { file_path: "03-素材/long.md", offset: firstPage.nextOffset }));
		expect(second.content).toContain("END");
	});

	it("fails a repeated edit with ambiguous text and a stale compare-and-write", async () => {
		const { files, tools, writes } = fixture({ "02-洞察/a.md": "repeat repeat" });
		expect((await tools.run(call("Edit", { file_path: "02-洞察/a.md", old_string: "repeat", new_string: "next" }))).isError).toBe(true);
		expect(writes).toEqual([]);
		const conflictHost = fixture({ "02-洞察/a.md": "before" });
		conflictHost.host.write = async () => { conflictHost.files.set("02-洞察/a.md", "concurrent"); throw new Error("目标已变化"); };
		const result = await conflictHost.tools.run(call("Write", { file_path: "02-洞察/a.md", content: "after" }));
		expect(result.isError).toBe(true);
		expect(conflictHost.files.get("02-洞察/a.md")).toBe("concurrent");
		expect(files.get("02-洞察/a.md")).toBe("repeat repeat");
	});

	it("detects a file changed after model execution before its receipt is trusted", async () => {
		const { files, tools } = fixture({ "00-收件箱/a.md": "old" });
		await tools.run(call("Write", { file_path: "00-收件箱/a.md", content: "new" }));
		files.set("00-收件箱/a.md", "changed elsewhere");
		await expect(tools.verifyChanges()).rejects.toThrow("文件已变化");
	});
});
