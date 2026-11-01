import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 设置页简化（2026-10-08）：合并重复内容，去掉无效与纯说明的设置项。
const root = fileURLToPath(new URL("../", import.meta.url));
const settings = readFileSync(`${root}src/settings.ts`, "utf8");

describe("simplified settings", () => {
	it("merges folder mapping and data sources into one library tab", () => {
		expect(settings).toContain('type TabId = "ui" | "library" | "channel" | "voice" | "maintenance";');
		expect(settings).toContain('id: "maintenance"');
		expect(settings).not.toContain("renderSchema(");
		expect(settings).not.toContain("renderData(");
		expect(settings).toContain('new Setting(c).setName("模块目录").setHeading();');
		expect(settings).toContain('new Setting(c).setName("统计来源文件").setHeading();');
	});

	it("derives the inbox and diary write folders from the module mapping instead of asking twice", () => {
		expect(settings).not.toContain('"收件箱目录", "Inbox 计数 + 写入", "inboxFolder"');
		expect(settings).not.toContain('"日记目录", "New Diary 写入", "dailyFolder"');
		expect(settings).toContain("this.plugin.talosSettings.inboxFolder = schema.inbox;");
		expect(settings).toContain("this.plugin.talosSettings.dailyFolder = schema.logs;");
		expect(settings.match(/this\.syncWriteFolders\(\);/g)?.length).toBeGreaterThanOrEqual(3);
	});

	it("drops settings without effect and headings without settings", () => {
		expect(settings).not.toContain('"Eyebrow 小标题"');
		expect(settings).not.toContain('setName("权限").setHeading()');
		expect(settings).not.toContain('setName("OhMyPi").setHeading()');
		expect(settings).not.toContain("隐私与计费：");
	});

	it("keeps every setting that still drives behaviour", () => {
		for (const key of [
			"mainTitle", "visualTheme", "syncVaultTheme", "openOnStartup", "welcomeEasterEgg", "talosPeerStatusBridgeEnabled",
			"tasksPath", "talosTasksPath", "pendingApprovalsPath", "candidatesPath", "healthLogPath", "reportsFolder", "freezeStartDate",
			"aliyunApiKey", "quyuanRealtimeWorkspaceId", "quyuanRealtimeRegion", "quyuanRealtimeModel", "quyuanRealtimeVoice",
			"quyuanVoiceModel", "quyuanVoiceEffort", "voicePersona", "voiceLang", "ttsVoice", "ttsRate", "ttsPitch",
		]) expect(settings, key).toContain(key);
	});
});
