import { describe, expect, it } from "vitest";
import { sanitizeAuditValue } from "../src/task-core/audit-sanitizer";

describe("sanitizeAuditValue", () => {
	it("redacts credential fields and secret-looking strings recursively", () => {
		const githubTokenPrefix = ["gh", "p_"].join("");
		const fakeGithubToken = [
			githubTokenPrefix,
			"abcdefghijklmnopqrstuvwxyz123456",
		].join("");
		const sanitized = sanitizeAuditValue({
			provider: "claude",
			headers: {
				Authorization: "Bearer fake-secret-token",
				"x-api-key": "sk-ant-api03-fake-secret-value",
			},
			nested: [
				{ cookie: "session=fake-cookie" },
				`token=${fakeGithubToken}`,
			],
		});
		const text = JSON.stringify(sanitized);

		expect(text).toContain("[REDACTED]");
		expect(text).not.toContain("fake-secret");
		expect(text).not.toContain("fake-cookie");
		expect(text).not.toContain(githubTokenPrefix);
	});

	it("masks absolute home paths but preserves Vault-relative paths", () => {
		const fakeHomePath = [
			"",
			"Users",
			"example",
			"Documents",
			"private.md",
		].join("/");
		const sanitized = sanitizeAuditValue({
			absolute: fakeHomePath,
			relative: "30 洞察/主题.md",
		});

		expect(sanitized).toEqual({
			absolute: "[HOME_PATH]",
			relative: "30 洞察/主题.md",
		});
	});

	it("redacts complete Unix and Windows home paths embedded in messages", () => {
		const unixHomePath = [
			"",
			"Users",
			"example",
			"Documents",
			"private.md",
		].join("/");
		const windowsHomePath = [
			"C:",
			"Users",
			"example",
			"Documents",
			"private.md",
		].join("\\");
		const sanitized = sanitizeAuditValue(
			`Read failed at "${unixHomePath}": copied from ${windowsHomePath}. Denied!`
		);

		expect(sanitized).toBe(
			'Read failed at "[HOME_PATH]": copied from [HOME_PATH]. Denied!'
		);
		expect(sanitized).not.toContain("example");
		expect(sanitized).not.toContain("private.md");
	});
});
