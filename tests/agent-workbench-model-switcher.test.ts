import { describe, expect, it } from "vitest";
import { ClaudeSdkQueryPort } from "../src/agent-workbench/transports/claude-sdk-port";
import { automaticModelPresentation, presentRuntimeModel } from "../src/agent-workbench/ui/model-switcher-presentation";

describe("TALOS in-conversation model switcher", () => {
	it("describes the official Codex 5.6 tiers without inventing one generic choice", () => {
		expect(presentRuntimeModel("codex", { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" })).toMatchObject({ kicker: "旗舰", badge: "推荐" });
		expect(presentRuntimeModel("codex", { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" })).toMatchObject({ kicker: "均衡" });
		expect(presentRuntimeModel("codex", { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" })).toMatchObject({ kicker: "高效" });
	});

	it("gives Claude Code official aliases concise task-oriented labels", () => {
		expect(presentRuntimeModel("claude", { id: "sonnet", label: "sonnet" })).toMatchObject({ label: "Sonnet", kicker: "均衡", badge: "推荐" });
		expect(presentRuntimeModel("claude", { id: "opus", label: "opus" }).description).toContain("高难度");
		expect(presentRuntimeModel("claude", { id: "haiku", label: "haiku" }).description).toContain("低延迟");
	});

	it("keeps OhMyPi model ids and provider ownership dynamic", () => {
		expect(presentRuntimeModel("ohmypi", { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", providerProfileId: "deepseek" })).toEqual({
			label: "DeepSeek V4 Pro",
			kicker: "OhMyPi",
			description: "来自 deepseek",
		});
		expect(presentRuntimeModel("ohmypi", { id: "zhipu-coding-plan/glm-5", label: "GLM-5", providerProfileId: "zhipu-coding-plan" }).label).toBe("GLM-5");
	});

	it("explains that automatic mode follows the selected terminal runtime", () => {
		expect(automaticModelPresentation("codex").description).toContain("Codex");
		expect(automaticModelPresentation("claude").description).toContain("Claude Code");
	});

	it("offers Claude Code aliases when no API-specific model catalog is configured", async () => {
		const port = new ClaudeSdkQueryPort(
			"/synthetic/vault",
			async () => ({ runtimeId: "claude", status: "ready" }),
			{ decide: async () => ({ allow: false }) },
		);
		expect(await port.models()).toEqual([
			{ id: "sonnet", label: "Sonnet" },
			{ id: "opus", label: "Opus" },
			{ id: "haiku", label: "Haiku" },
			{ id: "fable", label: "Fable" },
		]);
	});
});
