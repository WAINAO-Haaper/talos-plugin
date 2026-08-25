import { describe, expect, it } from "vitest";
import type {
	AuxQueryConfig,
	AuxQueryRunner,
} from "../src/quyuan/claudian/core/auxiliary/AuxQueryRunner";
import { QueryBackedInstructionRefineService } from "../src/quyuan/claudian/core/auxiliary/QueryBackedInstructionRefineService";
import { QueryBackedInlineEditService } from "../src/quyuan/claudian/core/auxiliary/QueryBackedInlineEditService";
import { QueryBackedTitleGenerationService } from "../src/quyuan/claudian/core/auxiliary/QueryBackedTitleGenerationService";
import { CodexAuxQueryRunner } from "../src/quyuan/claudian/providers/codex/runtime/CodexAuxQueryRunner";

class RecordingRunner implements AuxQueryRunner {
	readonly calls: Array<{ config: AuxQueryConfig; prompt: string }> = [];

	constructor(private readonly response: string) {}

	async query(config: AuxQueryConfig, prompt: string): Promise<string> {
		this.calls.push({ config, prompt });
		return this.response;
	}

	reset(): void {}
}

describe("auxiliary provider egress", () => {
	it("tags title, instruction-refine, and inline-edit as separate audited calls", async () => {
		const titleRunner = new RecordingRunner("Generate concise title");
		const refineRunner = new RecordingRunner(
			"<instruction>- Be precise.</instruction>"
		);
		const inlineRunner = new RecordingRunner(
			"<replacement>safe replacement</replacement>"
		);
		const title = new QueryBackedTitleGenerationService({
			createRunner: () => titleRunner,
		});
		const refine = new QueryBackedInstructionRefineService(refineRunner);
		const inline = new QueryBackedInlineEditService(inlineRunner);

		await title.generateTitle("conversation-1", "Fix audit", async () => {});
		await refine.refineInstruction("be precise", "");
		await inline.editText({
			mode: "selection",
			instruction: "improve",
			notePath: "30 洞察/note.md",
			selectedText: "draft",
			contextFiles: ["20 知识/context.md"],
		});

		expect(titleRunner.calls.map((call) => call.config.auditKind)).toEqual([
			"title-generation",
		]);
		expect(refineRunner.calls.map((call) => call.config.auditKind)).toEqual([
			"instruction-refine",
		]);
		expect(inlineRunner.calls[0]?.config).toMatchObject({
			auditKind: "inline-edit",
			sourcePaths: ["30 洞察/note.md", "20 知识/context.md"],
		});
	});

	it("fails closed before process startup when the host audit bridge is missing", async () => {
		let launchResolved = false;
		const plugin = {
			settings: {},
			getResolvedProviderCliPath: () => {
				launchResolved = true;
				return "codex";
			},
		} as never;
		const runner = new CodexAuxQueryRunner(plugin);

		await expect(
			runner.query(
				{
					auditKind: "title-generation",
					systemPrompt: "system",
				},
				"prompt"
			)
		).rejects.toThrow("外发审计桥缺失");
		expect(launchResolved).toBe(false);
	});

	it("records one audit attempt per query and does not start when denied", async () => {
		const audits: unknown[] = [];
		let launchResolved = false;
		const plugin = {
			settings: {},
			auditQuyuanProviderEgress: async (input: unknown) => {
				audits.push(input);
				return { allowed: false, message: "blocked" };
			},
			getResolvedProviderCliPath: () => {
				launchResolved = true;
				return "codex";
			},
		} as never;
		const runner = new CodexAuxQueryRunner(plugin);

		for (const auditKind of [
			"title-generation",
			"instruction-refine",
			"inline-edit",
		] as const) {
			await expect(
				runner.query({ auditKind, systemPrompt: "system" }, "prompt")
			).rejects.toThrow("blocked");
		}
		expect(audits).toHaveLength(3);
		expect(audits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "title-generation" }),
				expect.objectContaining({ kind: "instruction-refine" }),
				expect.objectContaining({ kind: "inline-edit" }),
			])
		);
		expect(launchResolved).toBe(false);
	});
});
