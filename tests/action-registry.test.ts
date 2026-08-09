import { describe, expect, it } from "vitest";
import {
	TalosActionRegistry,
	validateActionDefinition,
} from "../src/action-core/registry";
import type { TalosActionDefinition } from "../src/action-core/types";

function action(
	overrides: Partial<TalosActionDefinition> = {}
): TalosActionDefinition {
	return {
		id: "refresh-stats",
		label: "刷新统计",
		description: "重新读取 Vault 并刷新统计卡片",
		risk: "A",
		readScope: ["**"],
		writeScope: [],
		timeoutMs: 10_000,
		cancelable: false,
		reversible: false,
		execute: async () => ({ refreshed: true }),
		...overrides,
	};
}

describe("TalosActionRegistry", () => {
	it("registers and resolves a validated action", () => {
		const registry = new TalosActionRegistry();
		const definition = action();

		registry.register(definition);

		expect(registry.get("refresh-stats")).toBe(definition);
		expect(registry.list()).toEqual([definition]);
	});

	it("rejects duplicate stable IDs", () => {
		const registry = new TalosActionRegistry([action()]);

		expect(() => registry.register(action())).toThrow(/重复动作 ID/);
	});

	it.each([
		["empty id", { id: " " }, /动作 ID/],
		["empty label", { label: " " }, /动作名称/],
		["empty description", { description: "" }, /动作说明/],
		["invalid timeout", { timeoutMs: 0 }, /超时/],
		[
			"reversible B action",
			{ risk: "B", reversible: false, writeScope: ["00 收件箱/**"] },
			/B 类动作必须可恢复/,
		],
		[
			"C action without scope",
			{ risk: "C", writeScope: [] },
			/C 类动作必须声明影响范围/,
		],
	] as const)("rejects %s", (_label, overrides, message) => {
		expect(() =>
			validateActionDefinition(action(overrides as Partial<TalosActionDefinition>))
		).toThrow(message);
	});

	it("returns a frozen list so pages cannot mutate registry order", () => {
		const registry = new TalosActionRegistry([action()]);
		const definitions = registry.list();

		expect(Object.isFrozen(definitions)).toBe(true);
		expect(() => {
			(definitions as TalosActionDefinition[]).push(
				action({ id: "another-action" })
			);
		}).toThrow();
	});
});
