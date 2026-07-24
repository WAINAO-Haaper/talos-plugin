import { describe, expect, it } from "vitest";
import { auditProviderEgress } from "../src/ai/privacy/provider-egress-gate";

describe("provider egress gate", () => {
	it("allows authorized identity context while masking direct identifiers", async () => {
		const result = await auditProviderEgress({
			providerId: "claude-api",
			vaultAccess: "full",
			paths: ["10 身份/身份.md", "40 项目/WP7.md"],
			text: [
				"姓名可作为上下文使用。",
				"邮箱 owner@example.com",
				"手机 13812345678",
				"证件 11010519491231002X",
				"本机路径 /Users/apple/Documents/private.md",
			].join("\n"),
		});

		expect(result.allowed).toBe(true);
		expect(result.redactedText).toContain("姓名可作为上下文使用");
		expect(result.redactedText).not.toContain("owner@example.com");
		expect(result.redactedText).not.toContain("13812345678");
		expect(result.redactedText).not.toContain("11010519491231002X");
		expect(result.redactedText).not.toContain("/Users/apple");
		expect(result.audit.modules).toEqual(["10 身份", "40 项目"]);
		expect(result.audit.redactions).toMatchObject({
			email: 1,
			phone: 1,
			identityNumber: 1,
			absolutePath: 1,
		});
		expect(JSON.stringify(result.audit)).not.toContain("owner@example.com");
		expect(result.audit.contentDigest).toMatch(/^[a-f0-9]{64}$/);
	});

	it("blocks secrets without returning or auditing the original", async () => {
		const secret = "Authorization: Bearer fake-bearer-token-value";
		const result = await auditProviderEgress({
			providerId: "openai-compatible",
			vaultAccess: "full",
			paths: ["30 洞察/note.md"],
			text: secret,
		});

		expect(result.allowed).toBe(false);
		expect(result.redactedText).toBe("");
		expect(result.audit.blockedReasons).toEqual(["bearer-token"]);
		expect(JSON.stringify(result)).not.toContain("fake-bearer");
	});

	it("blocks all Vault content when the provider lacks authorization", async () => {
		const result = await auditProviderEgress({
			providerId: "untrusted",
			vaultAccess: "denied",
			paths: ["20 知识/a.md"],
			text: "普通知识",
		});

		expect(result).toMatchObject({
			allowed: false,
			redactedText: "",
			audit: { blockedReasons: ["vault-access-denied"] },
		});
	});
});
