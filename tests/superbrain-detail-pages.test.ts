import { describe, expect, it } from "vitest";
import { SUPERBRAIN_WORKFLOW_SLUGS, type SuperbrainEntry } from "../src/module-commands/superbrain-catalog";
import {
	SUPERBRAIN_PAGE_IDS,
	SUPERBRAIN_PAGE_SPECS,
	buildSuperbrainInstruction,
	superbrainPageSpec,
	workflowSlugForPage,
} from "../src/ui/superbrain-page-spec";

function entry(id: string): SuperbrainEntry {
	const index = Number(id.slice(1)) - 1;
	const spec = SUPERBRAIN_PAGE_SPECS[id as keyof typeof SUPERBRAIN_PAGE_SPECS];
	return {
		id: id as SuperbrainEntry["id"],
		title: id,
		summary: id,
		icon: "file",
		files: [],
		tools: [...(spec.tools ?? [])],
		...(id.startsWith("C") ? { slug: SUPERBRAIN_WORKFLOW_SLUGS[index] } : {}),
	};
}

describe("superbrain dedicated page registry", () => {
	it("provides exactly one fixed page for each C01–C15 and M01–M10 entry", () => {
		expect(SUPERBRAIN_PAGE_IDS).toHaveLength(25);
		expect(new Set(SUPERBRAIN_PAGE_IDS).size).toBe(25);
		expect(Object.keys(SUPERBRAIN_PAGE_SPECS)).toEqual([...SUPERBRAIN_PAGE_IDS]);
		for (const id of SUPERBRAIN_PAGE_IDS) {
			const spec = superbrainPageSpec(entry(id));
			expect(spec.id).toBe(id);
			expect(spec.steps).toHaveLength(3);
			expect(spec.steps.every(step => step.icon && step.label)).toBe(true);
			expect(spec.mode).toBe(id.startsWith("C") ? "workflow" : "mechanism");
		}
	});

	it("keeps C pages on their registered workflow and gives every mechanism a real affordance", () => {
		for (const id of SUPERBRAIN_PAGE_IDS.filter(id => id.startsWith("C"))) {
			expect(workflowSlugForPage(entry(id))).toBe(SUPERBRAIN_WORKFLOW_SLUGS[Number(id.slice(1)) - 1]);
			expect(SUPERBRAIN_PAGE_SPECS[id].fields?.length).toBeGreaterThan(0);
		}
		for (const id of SUPERBRAIN_PAGE_IDS.filter(id => id.startsWith("M"))) {
			const spec = SUPERBRAIN_PAGE_SPECS[id];
			expect(Boolean(spec.tools?.length || spec.extraAction || ["M01", "M05", "M07"].includes(id))).toBe(true);
		}
	});

	it("rejects a catalog that would turn vault data into an unregistered action", () => {
		const changed = entry("M08");
		changed.tools = ["health"];
		expect(() => superbrainPageSpec(changed)).toThrow(/未登记的工具/);
		const malformed = entry("C02");
		delete malformed.slug;
		expect(() => superbrainPageSpec(malformed)).toThrow(/页面类型/);
	});

	it("builds the selected task instruction without inventing empty values", () => {
		const spec = SUPERBRAIN_PAGE_SPECS.C02;
		const instruction = buildSuperbrainInstruction(
			spec,
			{ intake: "保留原件，核对交付日" },
			["00-收件箱/新版活动简报.txt", "00-收件箱/旧版活动简报.txt"],
			"不确定的日期标待核",
		);
		expect(instruction).toContain("整理要求：保留原件，核对交付日");
		expect(instruction).toContain("- 00-收件箱/新版活动简报.txt");
		expect(instruction).toContain("补充说明：不确定的日期标待核");
		expect(buildSuperbrainInstruction(spec, {}, [], "")).toBe("");
	});
});
