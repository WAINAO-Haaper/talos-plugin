import { describe, expect, it } from "vitest";
import { preflightChatProviderEgress } from "../src/ai/privacy/chat-provider-egress-preflight";

describe("chat provider egress preflight", () => {
	it("audits the prepared prompt and explicit Vault context without retaining content", async () => {
		const reads: string[] = [];
		const result = await preflightChatProviderEgress({
			providerId: "claude",
			vaultAccess: "full",
			prompt: "只回答合成项目代号",
			historyText: "assistant: safe history",
			contextPaths: ["Identity/CONTEXT.md"],
			readContext: async (path) => {
				reads.push(path);
				return "Synthetic WP7 context";
			},
		});

		expect(result.allowed).toBe(true);
		expect(reads).toEqual(["Identity/CONTEXT.md"]);
		expect(result.audit.modules).toEqual(["Identity"]);
		expect(result.audit.contentDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(result.audit)).not.toContain("Synthetic WP7 context");
	});

	it("blocks protected paths before reading them", async () => {
		let read = false;
		const result = await preflightChatProviderEgress({
			providerId: "claude",
			vaultAccess: "full",
			configDir: "custom-config",
			prompt: "读取插件设置",
			contextPaths: ["custom-config/plugins/talos/data.json"],
			readContext: async () => {
				read = true;
				return "must not be read";
			},
		});

		expect(read).toBe(false);
		expect(result.allowed).toBe(false);
		expect(result.audit.blockedReasons).toContain("plugin-data");
	});

	it.each([
		"safe/../.talos/private/provider.json",
		["", "30 洞察", "absolute.md"].join("/"),
		["C:", "Vault", "30 洞察", "absolute.md"].join("\\"),
	])("blocks unsafe path %s before reading it", async (path) => {
		let read = false;
		const result = await preflightChatProviderEgress({
			providerId: "claude",
			vaultAccess: "full",
			prompt: "读取上下文",
			contextPaths: [path],
			readContext: async () => {
				read = true;
				return "must not be read";
			},
		});

		expect(read).toBe(false);
		expect(result.allowed).toBe(false);
		expect(result.audit.blockedReasons).toContain("unsafe-path");
	});

	it("fails closed when direct chat would require redaction", async () => {
		const result = await preflightChatProviderEgress({
			providerId: "claude",
			vaultAccess: "full",
			prompt: "总结当前笔记",
			contextPaths: ["30 洞察/context.md"],
			readContext: async () => "联系邮箱 owner@example.com",
		});

		expect(result.allowed).toBe(false);
		expect(result.audit.redactions.email).toBe(1);
		expect(result.audit.blockedReasons).toContain("redaction-required");
		expect(result.redactedText).toBe("");
	});

	it("blocks media, MCP and external context until those payloads are audited", async () => {
		const result = await preflightChatProviderEgress({
			providerId: "claude",
			vaultAccess: "full",
			prompt: "处理扩展上下文",
			externalContextPaths: ["external-folder"],
			hasImages: true,
			hasMcpMentions: true,
			readContext: async () => "",
		});

		expect(result.allowed).toBe(false);
		expect(result.audit.blockedReasons).toEqual(
			expect.arrayContaining([
				"external-context-not-audited",
				"image-egress-not-audited",
				"mcp-egress-not-audited",
			])
		);
	});
});
