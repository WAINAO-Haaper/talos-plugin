import { describe, expect, it } from "vitest";
import { sanitizeAuditValue } from "../src/task-core/audit-sanitizer";

describe("sanitizeAuditValue", () => {
	it("redacts credential fields and secret-looking strings recursively", () => {
		const sanitized = sanitizeAuditValue({
			provider: "claude",
			headers: {
				Authorization: "Bearer fake-secret-token",
				"x-api-key": "sk-ant-api03-fake-secret-value",
			},
			nested: [
				{ cookie: "session=fake-cookie" },
				"token=ghp_abcdefghijklmnopqrstuvwxyz123456",
			],
		});
		const text = JSON.stringify(sanitized);

		expect(text).toContain("[REDACTED]");
		expect(text).not.toContain("fake-secret");
		expect(text).not.toContain("fake-cookie");
		expect(text).not.toContain("ghp_");
	});

	it("masks absolute home paths but preserves Vault-relative paths", () => {
		const sanitized = sanitizeAuditValue({
			absolute: "/Users/apple/Documents/private.md",
			relative: "30 洞察/主题.md",
		});

		expect(sanitized).toEqual({
			absolute: "[HOME]/Documents/private.md",
			relative: "30 洞察/主题.md",
		});
	});
});
