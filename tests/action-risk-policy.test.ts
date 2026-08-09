import { describe, expect, it } from "vitest";
import { evaluateActionRisk } from "../src/action-core/risk-policy";
import type {
	TalosActionDefinition,
	TalosActionRequest,
} from "../src/action-core/types";

function definition(
	overrides: Partial<TalosActionDefinition> = {}
): TalosActionDefinition {
	return {
		id: "test-action",
		label: "测试动作",
		description: "测试风险策略",
		risk: "A",
		readScope: ["**"],
		writeScope: [],
		timeoutMs: 10_000,
		cancelable: false,
		reversible: false,
		execute: async () => undefined,
		...overrides,
	};
}

function request(overrides: Partial<TalosActionRequest> = {}): TalosActionRequest {
	return {
		readPaths: [],
		writePaths: [],
		effects: [],
		...overrides,
	};
}

describe("evaluateActionRisk", () => {
	it("allows an A-class read-only action immediately", () => {
		const result = evaluateActionRisk(
			definition({ risk: "A", readScope: ["**"] }),
			request({ readPaths: ["30 洞察/README.md"] })
		);

		expect(result.decision).toBe("allow");
		expect(result.reason).toContain("只读");
	});

	it("runs a fixed-scope reversible B action after taking a snapshot", () => {
		const result = evaluateActionRisk(
			definition({
				risk: "B",
				reversible: true,
				writeScope: ["00 收件箱/**", "30 洞察/**"],
			}),
			request({
				writePaths: ["00 收件箱/想法.md", "30 洞察/主题.md"],
				effects: ["write"],
			})
		);

		expect(result.decision).toBe("snapshot-and-run");
	});

	it("escalates a B action when a target leaves its declared scope", () => {
		const result = evaluateActionRisk(
			definition({
				risk: "B",
				reversible: true,
				writeScope: ["00 收件箱/**"],
			}),
			request({
				writePaths: ["70 输出/周报.md"],
				effects: ["write"],
			})
		);

		expect(result.decision).toBe("propose");
		expect(result.reason).toContain("超出");
	});

	it.each([
		"00 收件箱/../10 身份/private.md",
		["", "00 收件箱", "private.md"].join("/"),
		["C:", "Vault", "00 收件箱", "private.md"].join("\\"),
		"00 收件箱//private.md",
	])("fails closed for unsafe scoped path %s", (path) => {
		const result = evaluateActionRisk(
			definition({
				risk: "B",
				reversible: true,
				writeScope: ["00 收件箱/**"],
			}),
			request({ writePaths: [path], effects: ["write"] })
		);

		expect(result.decision).toBe("propose");
		expect(result.reason).toContain("超出");
	});

	it.each([
		["delete", { effects: ["delete"] }],
		["move", { effects: ["move"] }],
		["identity", { effects: ["write"], touchesIdentity: true }],
		["top-level", { effects: ["move"], touchesTopLevelStructure: true }],
		["external publish", { effects: ["external-publish"] }],
		["shell", { effects: ["shell"] }],
	] as const)("always proposes for %s", (_label, overrides) => {
		const result = evaluateActionRisk(
			definition({
				risk: "B",
				reversible: true,
				writeScope: ["**"],
			}),
			request(overrides as Partial<TalosActionRequest>)
		);

		expect(result.decision).toBe("propose");
	});

	it("keeps a declared C action behind a proposal", () => {
		const result = evaluateActionRisk(
			definition({
				risk: "C",
				writeScope: ["<external>"],
			}),
			request({ effects: ["external-publish"] })
		);

		expect(result.decision).toBe("propose");
	});
});
