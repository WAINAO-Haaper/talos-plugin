import { describe, expect, it } from "vitest";
import {
	inspectVaultContent,
	inspectVaultPath,
} from "../src/ai/context/secret-policy";

const privateKeyLabel = ["PRIVATE", "KEY"].join(" ");
const privateKeyFixture = [
	`-----BEGIN ${privateKeyLabel}-----`,
	"fake",
	`-----END ${privateKeyLabel}-----`,
].join("\n");

describe("secret policy", () => {
	it.each([
		[".env", "environment-file"],
		["project/.env.local", "environment-file"],
		[".config/plugins/talos/data.json", "plugin-data"],
		[".talos/private/provider.json", "talos-private"],
		["System/SecretStorage/notes.md", "secret-storage"],
		["System/github-credentials.md", "credential-file"],
		["System/access-token.txt", "credential-file"],
		["System/api-key.md", "credential-file"],
	])("blocks permanent secret path %s", (path, reason) => {
		expect(inspectVaultPath(path, { configDir: ".config" })).toEqual({
			blocked: true,
			reasons: [reason],
		});
	});

	it.each([
		["Authorization: Bearer fake-bearer-token-value", "bearer-token"],
		["x-api-key: fake-api-key-value", "sensitive-header"],
		["Cookie: session=fake-cookie-value", "cookie"],
		[privateKeyFixture, "private-key"],
		["sk-ant-api03-fake-secret-value", "api-key"],
	])("blocks secret content without returning the match", (content, reason) => {
		const result = inspectVaultContent("30 洞察/note.md", content);

		expect(result).toEqual({
			blocked: true,
			reasons: [reason],
		});
		expect(JSON.stringify(result)).not.toContain("fake");
	});

	it("allows normal Vault knowledge", () => {
		expect(
			inspectVaultContent(
				"30 洞察/研究.md",
				"这是关于 Provider 架构和人工审批的普通笔记。"
			)
		).toEqual({ blocked: false, reasons: [] });
	});

	it("normalizes path separators before inspection", () => {
		expect(
			inspectVaultPath(".config\\plugins\\talos\\data.json", {
				configDir: ".config",
			})
		).toMatchObject({ blocked: true, reasons: ["plugin-data"] });
	});

	it.each([
		"safe/../.talos/private/provider.json",
		["", "30 洞察", "absolute.md"].join("/"),
		["C:", "Vault", "30 洞察", "absolute.md"].join("\\"),
		"30 洞察//empty-segment.md",
		"safe/%2e%2e/.talos/private/provider.json",
	])("fails closed for unsafe Vault path %s", (path) => {
		expect(inspectVaultPath(path)).toEqual({
			blocked: true,
			reasons: ["unsafe-path"],
		});
	});

	it.each([
		[".TALOS/PRIVATE/provider.json", "talos-private"],
		["．talos/private/provider.json", "talos-private"],
		[".CONFIG/plugins/talos/other.json", "config-directory"],
		[".codex/config.toml", "config-directory"],
		[".claudian/settings.json", "config-directory"],
	])("blocks normalized or case-variant protected path %s", (path, reason) => {
		expect(inspectVaultPath(path, { configDir: ".config" })).toEqual({
			blocked: true,
			reasons: [reason],
		});
	});
});
