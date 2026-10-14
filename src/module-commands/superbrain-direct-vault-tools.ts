import { createHash } from "node:crypto";
import type { ApiToolRunner } from "../ai/provider/api-agent-runtime";
import type { ToolCall, ToolOutcome } from "../jarvis/agent/vault-tools";
import { inspectVaultContent, inspectVaultPath } from "../ai/context/secret-policy";
import { validateVaultRelativePath } from "./data-format";

/** The host must repeat its boundary and version checks at the actual IO operation. */
export interface SuperbrainDirectVaultHost {
	files(): string[];
	assertPath(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	/** expected=null creates only; a string compares the old content before replacement. */
	write(path: string, content: string, expected: string | null): Promise<void>;
}

export interface SuperbrainDirectVaultChange {
	path: string;
	kind: "create" | "modify";
	beforeSha256: string | null;
	afterSha256: string;
	bytes: number;
}

const TEXT_EXTENSIONS = new Set(["md", "txt", "json", "yaml", "yml", "csv", "tsv", "html", "htm", "srt", "vtt", "canvas"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_OUTPUT = 24_000;
const MAX_SEARCH_FILES = 10_000;
const MAX_SEARCH_HITS = 100;

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function inputString(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== "string") throw new Error(`${key} 必须是文本`);
	return value;
}

function textPath(raw: unknown): string {
	if (typeof raw !== "string") throw new Error("文件路径无效");
	const path = validateVaultRelativePath(raw);
	if (inspectVaultPath(path).blocked) throw new Error("秘密或凭据文件不可由模型工具访问");
	if (/(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/i.test(path)
		|| path.toLocaleLowerCase("en-US").startsWith("system/working-memory/workflow-runs/")) throw new Error("系统规则和运行收据不可由模型工具修改或读取");
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	if (!TEXT_EXTENSIONS.has(ext)) throw new Error("模型工具只处理库内文本文件");
	return path;
}

function assertContent(content: string): void {
	if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new Error("文件内容超过本轮工具上限");
	if (content.includes("\u0000")) throw new Error("模型工具不处理含 NUL 的内容");
}

function assertNoSecret(path: string, content: string): void {
	if (inspectVaultContent(path, content).blocked) throw new Error("文件含秘密内容，模型工具不可读取或覆盖");
}

function globRegex(pattern: string): RegExp {
	if (!pattern || pattern.length > 240 || pattern.includes("\u0000") || pattern.startsWith("/") || pattern.includes("\\") || pattern.split("/").some(part => part === "..")) throw new Error("搜索模式无效");
	let source = "^";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === "*" && pattern[i + 1] === "*") {
			if (pattern[i + 2] === "/") { source += "(?:.*/)?"; i += 2; }
			else { source += ".*"; i++; }
		} else if (char === "*") source += "[^/]*";
		else if (char === "?") source += "[^/]";
		else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(source + "$", "i");
}

/** One model invocation owns one instance, so its mutation ledger cannot mix runs. */
export class SuperbrainDirectVaultTools implements ApiToolRunner {
	private readonly changed = new Map<string, SuperbrainDirectVaultChange>();

	constructor(private readonly host: SuperbrainDirectVaultHost, private readonly signal?: AbortSignal) {}

	changes(): SuperbrainDirectVaultChange[] {
		return [...this.changed.values()].map(change => ({ ...change }));
	}

	async verifyChanges(): Promise<void> {
		for (const change of this.changed.values()) {
			await this.host.assertPath(change.path);
			if (!(await this.host.exists(change.path)) || sha256(await this.host.read(change.path)) !== change.afterSha256) {
				throw new Error(`运行后文件已变化，证据无法核对：${change.path}`);
			}
		}
	}

	async run(call: ToolCall): Promise<ToolOutcome> {
		try {
			this.notCancelled();
			switch (call.name) {
				case "Read": return await this.read(call.input);
				case "Glob": return await this.glob(call.input);
				case "Grep": return await this.grep(call.input);
				case "Write": return await this.write(call.input);
				case "Edit": return await this.edit(call.input);
				default: return { content: "该工具未授权；仅允许库内文本文件读写搜索", isError: true };
			}
		} catch (error) {
			return { content: error instanceof Error ? error.message : "工具执行失败", isError: true };
		}
	}

	private notCancelled(): void {
		if (this.signal?.aborted) throw new Error("本轮 API 工作流已取消");
	}

	private async checkedPath(raw: unknown): Promise<string> {
		const path = textPath(raw);
		await this.host.assertPath(path);
		this.notCancelled();
		return path;
	}

	private async read(input: Record<string, unknown>): Promise<ToolOutcome> {
		const path = await this.checkedPath(input.file_path);
		if (!(await this.host.exists(path))) throw new Error("文件不存在");
		const content = await this.host.read(path);
		assertContent(content);
		assertNoSecret(path, content);
		const offset = input.offset === undefined ? 0 : input.offset;
		if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > content.length) throw new Error("读取位置无效");
		const nextOffset = Math.min(content.length, offset + MAX_TOOL_OUTPUT);
		return { content: JSON.stringify({ path, content: content.slice(offset, nextOffset), nextOffset, truncated: nextOffset < content.length }), isError: false };
	}

	private async write(input: Record<string, unknown>): Promise<ToolOutcome> {
		const path = await this.checkedPath(input.file_path);
		const content = inputString(input, "content");
		assertContent(content);
		const existed = await this.host.exists(path);
		const before = existed ? await this.host.read(path) : null;
		if (before !== null) assertNoSecret(path, before);
		if (before === content) return { content: JSON.stringify({ path, changed: false }), isError: false };
		this.notCancelled();
		await this.host.assertPath(path);
		await this.host.write(path, content, before);
		const actual = await this.host.read(path);
		this.record(path, before, actual);
		if (actual !== content) throw new Error("写入后文件内容不一致");
		return { content: JSON.stringify({ path, changed: true, sha256: sha256(actual) }), isError: false };
	}

	private async edit(input: Record<string, unknown>): Promise<ToolOutcome> {
		const path = await this.checkedPath(input.file_path);
		const oldString = inputString(input, "old_string");
		const newString = inputString(input, "new_string");
		if (!oldString) throw new Error("old_string 不能为空");
		if (!(await this.host.exists(path))) throw new Error("文件不存在");
		const before = await this.host.read(path);
		assertNoSecret(path, before);
		const first = before.indexOf(oldString);
		if (first < 0) throw new Error("找不到要替换的原文");
		if (before.indexOf(oldString, first + oldString.length) >= 0) throw new Error("原文出现多次，请提供唯一片段");
		const after = before.slice(0, first) + newString + before.slice(first + oldString.length);
		assertContent(after);
		if (after === before) return { content: JSON.stringify({ path, changed: false }), isError: false };
		this.notCancelled();
		await this.host.assertPath(path);
		await this.host.write(path, after, before);
		const actual = await this.host.read(path);
		this.record(path, before, actual);
		if (actual !== after) throw new Error("编辑后文件内容不一致");
		return { content: JSON.stringify({ path, changed: true, sha256: sha256(actual) }), isError: false };
	}

	private record(path: string, before: string | null, after: string): void {
		const prior = this.changed.get(path);
		this.changed.set(path, {
			path,
			kind: prior?.kind ?? (before === null ? "create" : "modify"),
			beforeSha256: prior ? prior.beforeSha256 : before === null ? null : sha256(before),
			afterSha256: sha256(after),
			bytes: new TextEncoder().encode(after).byteLength,
		});
	}

	private async searchableFiles(pattern: RegExp): Promise<string[]> {
		const files = this.host.files();
		const safe: string[] = [];
		for (const raw of files) {
			this.notCancelled();
			if (!pattern.test(raw)) continue;
			try { safe.push(await this.checkedPath(raw)); } catch { /* protected paths never reach the model */ }
			if (safe.length > MAX_SEARCH_FILES) throw new Error("匹配文件过多，请缩小搜索范围");
		}
		return safe;
	}

	private async glob(input: Record<string, unknown>): Promise<ToolOutcome> {
		const pattern = globRegex(inputString(input, "pattern"));
		const files = await this.searchableFiles(pattern);
		return { content: JSON.stringify({ paths: files.slice(0, MAX_SEARCH_HITS), truncated: files.length > MAX_SEARCH_HITS }), isError: false };
	}

	private async grep(input: Record<string, unknown>): Promise<ToolOutcome> {
		const query = inputString(input, "pattern");
		if (!query || query.length > 200) throw new Error("搜索文本无效");
		const pattern = globRegex(typeof input.glob === "string" ? input.glob : "**/*");
		const paths = await this.searchableFiles(pattern);
		const hits: Array<{ path: string; line: number; text: string }> = [];
		for (const path of paths) {
			this.notCancelled();
			const content = await this.host.read(path);
			if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) continue;
			if (inspectVaultContent(path, content).blocked) continue;
			for (const [index, line] of content.split(/\r?\n/).entries()) {
				if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) hits.push({ path, line: index + 1, text: line.slice(0, 300) });
				if (hits.length >= MAX_SEARCH_HITS) return { content: JSON.stringify({ hits, truncated: true }), isError: false };
			}
		}
		return { content: JSON.stringify({ hits, truncated: false }), isError: false };
	}
}
