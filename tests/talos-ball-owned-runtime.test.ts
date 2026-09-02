import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	generateCrownKeelPath,
	generateCrownKeelPoints,
	generateValveEyes,
	ORB_STATES,
	renderStaticSvg,
	STATE_VECTORS,
	TALOS_COLORS,
	transitionDuration,
	TransitionEngine,
} from "../src/quyuan/talos-ball";

const root = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(directory: string): string[] {
	const output: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) output.push(...sourceFiles(path));
		else if (/\.(?:ts|js|css)$/.test(entry.name)) output.push(path);
	}
	return output;
}

describe("TALOS-owned ball runtime", () => {
	it("owns a complete twelve-state semantic contract", () => {
		expect(ORB_STATES).toEqual([
			"idle",
			"listening",
			"receiving",
			"working",
			"thinking",
			"searching",
			"responding",
			"success",
			"warning",
			"error",
			"restricted",
			"stopped",
		]);
		expect(new Set(ORB_STATES).size).toBe(12);
		for (const state of ORB_STATES) {
			expect(STATE_VECTORS[state]).toBeDefined();
			expect(transitionDuration(state, "reduced")).toBeLessThanOrEqual(120);
			expect(transitionDuration(state, "none")).toBe(0);
		}
	});

	it("generates the Crown-Keel body and valve eyes deterministically", () => {
		const first = generateCrownKeelPath(STATE_VECTORS.idle);
		const second = generateCrownKeelPath(STATE_VECTORS.idle);
		const points = generateCrownKeelPoints(STATE_VECTORS.idle);
		const eyes = generateValveEyes(
			STATE_VECTORS.listening,
			{ x: 0.4, y: -0.2 },
			0
		);
		expect(first).toBe(second);
		expect(points).toHaveLength(48);
		expect(first).toMatch(/^M /);
		expect(first).toContain(" C ");
		expect(first).not.toContain("NaN");
		expect(eyes.left).toMatch(/^M /);
		expect(eyes.right).toMatch(/^M /);
		expect(eyes.left).not.toBe(eyes.right);
		expect(eyes.left).not.toContain("A ");
		expect(eyes.right).not.toContain("A ");
	});

	it("renders every state mouthless with the four TALOS colors", () => {
		const allowed = new Set(
			Object.values(TALOS_COLORS).map((value) => value.toUpperCase())
		);
		for (const state of ORB_STATES) {
			const svg = renderStaticSvg({
				state,
				size: 96,
				idPrefix: "test-" + state,
			});
			expect(svg).toMatch(/^<svg /);
			expect(svg).toContain("data-state=" + JSON.stringify(state));
			expect(svg.endsWith("</svg>")).toBe(true);
			expect(svg).not.toMatch(
				/data-part=[" ](?:mouth|lip|smile)|<(?:mouth|lip|smile)\b/i
			);
			for (const color of svg.match(/#[0-9a-f]{6}/gi) ?? []) {
				expect(allowed.has(color.toUpperCase())).toBe(true);
			}
		}
	});

	it("retargets interrupted transitions from the visible frame", () => {
		const engine = new TransitionEngine("idle");
		engine.retarget("working", 0, 440);
		const visible = engine.sample(213);
		engine.retarget("error", 213, 440);
		expect(engine.sample(213)).toEqual(visible);
		expect(engine.sample(653)).toEqual(STATE_VECTORS.error);
	});

	it("contains no Emotion Ball runtime, visual data, or vendor identity", () => {
		const vendorPath = join(root, "src/quyuan/vendor/emotion-ball");
		expect(existsSync(vendorPath)).toBe(false);
		const source = sourceFiles(join(root, "src/quyuan"))
			.map((path) => readFileSync(path, "utf8"))
			.join("\n");
		expect(source).not.toMatch(/EmotionBall|emotion-ball|sam70361/i);
	});
});
