import { describe, expect, it } from "vitest";
import { proposeAnswerWriteback } from "../src/ai/writeback-policy";

describe("answer writeback policy", () => {
	it("does not write answers by default", () => {
		expect(
			proposeAnswerWriteback({
				intent: "display-only",
				title: "回答",
				content: "正文",
			})
		).toBeNull();
	});

	it("routes knowledge conclusions to 30 洞察 as an approval proposal", () => {
		const proposal = proposeAnswerWriteback({
			intent: "knowledge",
			title: "Provider 结论",
			content: "正文",
		});
		expect(proposal).toMatchObject({
			targetPath: "30 洞察/Provider 结论.md",
			risk: "B",
			approvalRequired: true,
		});
		expect(proposal?.diffPreview).toContain("+正文");
	});

	it("routes deliverables to 70 输出 and sanitizes the filename", () => {
		expect(
			proposeAnswerWriteback({
				intent: "output",
				title: "../产品/草案",
				content: "交付正文",
			})
		).toMatchObject({
			targetPath: "70 输出/产品-草案.md",
			risk: "B",
			approvalRequired: true,
		});
	});
});
