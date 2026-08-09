import { describe, expect, it } from "vitest";
import {
	isProviderModuleAllowed,
	setProviderModuleAllowed,
} from "../src/ai/provider/provider-module-access";

describe("provider module access settings", () => {
	it("defaults every module to allowed for legacy and empty settings", () => {
		expect(
			isProviderModuleAllowed({}, "claude-api", "identity")
		).toBe(true);
		expect(
			isProviderModuleAllowed(
				{ "openai-compatible": {} },
				"openai-compatible",
				"projects"
			)
		).toBe(true);
	});

	it("updates one provider without changing the other provider", () => {
		const current = {
			"claude-api": { identity: true },
			"openai-compatible": { projects: false },
		};

		const updated = setProviderModuleAllowed(
			current,
			"claude-api",
			"identity",
			false
		);

		expect(updated).toEqual({
			"claude-api": { identity: false },
			"openai-compatible": { projects: false },
		});
		expect(updated).not.toBe(current);
		expect(current["claude-api"].identity).toBe(true);
	});

	it("can explicitly re-enable a module while preserving sibling decisions", () => {
		const updated = setProviderModuleAllowed(
			{
				"claude-api": {
					identity: false,
					projects: false,
				},
			},
			"claude-api",
			"identity",
			true
		);

		expect(updated["claude-api"]).toEqual({
			identity: true,
			projects: false,
		});
	});
});
