import { describe, expect, it } from "vitest";
import type { CanUseTool, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSdkQueryPort, type ClaudeSdkFacade } from "../src/agent-workbench/transports/claude-sdk-port";
import { automaticModelPresentation, explicitDefaultModel, presentRuntimeModel, reasoningForModel } from "../src/agent-workbench/ui/model-switcher-presentation";

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

	it("pins a concrete discovered model only for a new OhMyPi session", () => {
		const models = [{ id: "provider/model-a", label: "Model A" }, { id: "provider/model-b", label: "Model B" }];
		expect(explicitDefaultModel("ohmypi", models, undefined)).toBe("provider/model-a");
		expect(explicitDefaultModel("ohmypi", models, "provider/model-b")).toBe("provider/model-b");
		expect(explicitDefaultModel("codex", models, undefined)).toBeUndefined();
		expect(explicitDefaultModel("claude", models, undefined)).toBeUndefined();
	});

	it("selects the active model's reasoning default and drops incompatible modes", () => {
		const model = {
			id: "gpt-test",
			label: "GPT Test",
			reasoningOptions: [
				{ value: "low", label: "low" },
				{ value: "high", label: "high" },
			],
			defaultReasoning: "low",
		};
		expect(reasoningForModel(model, undefined)).toBe("low");
		expect(reasoningForModel(model, "high")).toBe("high");
		expect(reasoningForModel(model, "unsupported")).toBe("low");
		expect(reasoningForModel({ id: "sonnet", label: "Sonnet" }, "high")).toBeUndefined();
		expect(reasoningForModel(undefined, "high")).toBeUndefined();
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

	it("returns updated AskUserQuestion answers through Claude canUseTool", async () => {
		let permissionResult: Awaited<ReturnType<CanUseTool>> | undefined;
		const sdk: ClaudeSdkFacade = {
			query(input) {
				const stream = (async function* (): AsyncGenerator<SDKMessage, void> {
					const canUseTool = input.options?.canUseTool;
					if (!canUseTool) throw new Error("missing canUseTool");
					permissionResult = await canUseTool("AskUserQuestion", { questions: [] }, {
						signal: new AbortController().signal,
						toolUseID: "tool-1",
						requestId: "request-1",
					});
					yield { type: "auth_status", isAuthenticating: false } as SDKMessage;
				})();
				return stream as Query;
			},
			forkSession: async () => ({ sessionId: "forked" }),
		};
		const updatedInput = { questions: [], answers: { choice: "A" } };
		const port = new ClaudeSdkQueryPort(
			"/synthetic/vault",
			async () => ({ runtimeId: "claude", status: "ready" }),
			{ decide: async () => ({ allow: true, updatedInput }) },
			[],
			undefined,
			{},
			sdk,
		);
		await port.create({ conversationId: "conversation-1", vaultRoot: "/synthetic/vault" });
		for await (const frame of port.turn({
			sessionId: "conversation-1",
			prompt: "question",
			workflow: "plan",
			permissionMode: "default",
			sandbox: { enabled: true, failIfUnavailable: true },
		})) void frame;
		expect(permissionResult).toMatchObject({ behavior: "allow", updatedInput });
	});
});
