import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_PROVIDER_ID } from "../src/quyuan/claudian/core/providers/types";
import { getBuiltInProviderDefaultConfigs } from "../src/quyuan/claudian/providers/defaultProviderConfigs";
import { getCodexProviderSettings } from "../src/quyuan/claudian/providers/codex/settings";
import {
	engineProviderSettingForProvider,
	providerIdForEngineSetting,
} from "../src/ui/provider-center";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string =>
	readFileSync(`${projectRoot}${rel}`, "utf8");

// D-TLP-011/D-TLP-013：Codex harness 取代 claudian 旧内核后的结构契约。
// 这些断言钉死“替换而非并存”：唯一 harness、旧链路源码移除、凭证边界不破。
describe("codex harness replacement contract", () => {
	it("registers codex as the only harness provider", () => {
		const registry = readSrc("src/quyuan/claudian/providers/index.ts");
		expect(registry).toContain("ProviderRegistry.register('codex'");
		expect(registry).not.toContain("ProviderRegistry.register('claude'");
		expect(registry).not.toContain("ProviderRegistry.register('opencode'");
		expect(registry).not.toContain("ProviderRegistry.register('pi'");
		expect(DEFAULT_CHAT_PROVIDER_ID).toBe("codex");
	});

	it("removes the legacy provider source chains", () => {
		for (const dir of ["claude", "opencode", "pi", "acp"]) {
			expect(
				existsSync(
					`${projectRoot}src/quyuan/claudian/providers/${dir}`
				)
			).toBe(false);
		}
	});

	it("defaults to codex and force-enables it as the sole harness", () => {
		const defaults = getBuiltInProviderDefaultConfigs();
		expect(Object.keys(defaults)).toEqual(["codex"]);
		expect(
			getCodexProviderSettings({ providerConfigs: defaults }).enabled
		).toBe(true);
		const defaultSettings = readSrc(
			"src/quyuan/claudian/app/settings/defaultSettings.ts"
		);
		expect(defaultSettings).toContain("settingsProvider: 'codex'");
		const claudianMain = readSrc("src/quyuan/claudian/main.ts");
		expect(claudianMain).toContain("ensureSoleHarnessEnabled");
	});

	it("migrates legacy claude-cli engine settings to codex-cli", () => {
		const main = readSrc("src/main.ts");
		expect(main).toContain('settings.engineProvider === "claude-cli"');
		expect(providerIdForEngineSetting("codex-cli")).toBe("codex");
		expect(engineProviderSettingForProvider("codex")).toBe("codex-cli");
		// claude-cli 旧映射不得复活
		expect(providerIdForEngineSetting("claude-cli")).not.toBe("claude");
	});

	it("exposes codex harness key/base_url/model in the settings page", () => {
		const settings = readSrc("src/settings.ts");
		expect(settings).toContain("codexApiKey");
		expect(settings).toContain("codexBaseUrl");
		expect(settings).toContain("codexModel");
		expect(settings).not.toContain('addOption("claude-cli"');
	});

	it("keeps the codex API key out of persisted settings text", () => {
		const main = readSrc("src/main.ts");
		// 持久化同步路径把 OPENAI_API_KEY 从环境文本剔除（D-WP7-004）
		expect(main).toContain(
			'new Set(["OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY"])'
		);
		// key 只在 spawn 子进程前经 getActiveEnvironmentVariables 运行时注入
		expect(main).toContain("getActiveEnvironmentVariables");
		expect(main).toContain("OPENAI_API_KEY=${key}");
		expect(main).toContain('readProviderSecret("codexApiKey")');
	});

	it("keeps the TALOS egress audit bridge and approval contracts intact", () => {
		const main = readSrc("src/main.ts");
		expect(main).toContain("auditQuyuanChatEgress");
		expect(main).toContain("preflightChatProviderEgress");
		expect(main).toContain("createConsoleActionRuntime");
	});
});
