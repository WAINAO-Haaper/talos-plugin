import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isVoiceReadOnlyTool } from "../src/quyuan/voice-tool-gateway";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string =>
	readFileSync(`${projectRoot}${rel}`, "utf8");

// D-TLP-016：C-3 语音模块只读化契约。
// 钉死三件事：① voice 通道只放行读类工具；② 审批回调按通道前置 deny，
// 不弹确认；③ 每轮语音回合注入 TALOS 数据地图与只读口语契约。
describe("voice read-only policy (D-TLP-016)", () => {
	it("classifies read tools as voice-safe and everything else as blocked", () => {
		for (const ok of ["read", "glob", "grep", "search", "websearch", "webfetch"]) {
			expect(isVoiceReadOnlyTool(ok)).toBe(true);
			expect(isVoiceReadOnlyTool(ok.toUpperCase())).toBe(true);
		}
		for (const blocked of [
			"write",
			"edit",
			"delete",
			"move",
			"bash",
			"publish",
			"send",
			"applypatch",
		]) {
			expect(isVoiceReadOnlyTool(blocked)).toBe(false);
		}
	});

	it("gates the approval callback by channel before any confirm prompt", () => {
		const driver = readSrc("src/quyuan/voice-driver.ts");
		// 通道分流必须位于治理/风险合并之前，且只作用于 voice 通道
		expect(driver).toContain(
			'if (channel === "voice" && !isVoiceReadOnlyTool(toolName))'
		);
		const gateIndex = driver.indexOf(
			'if (channel === "voice" && !isVoiceReadOnlyTool(toolName))'
		);
		const govIndex = driver.indexOf("gov.evaluateQuyuanToolPolicy");
		expect(gateIndex).toBeGreaterThan(-1);
		expect(govIndex).toBeGreaterThan(-1);
		expect(gateIndex).toBeLessThan(govIndex);
	});

	it("carries the read-only spoken contract in the voice response policy", () => {
		const driver = readSrc("src/quyuan/voice-driver.ts");
		expect(driver).toContain("语音通道是只读的");
		expect(driver).toContain("请到文字对话");
		// 文字通道契约不受只读门影响
		const textPolicy = driver.slice(driver.indexOf("TEXT_RESPONSE_POLICY"));
		expect(textPolicy).toContain("可以调用工具");
	});

	it("injects the TALOS data map into voice turns only", () => {
		const driver = readSrc("src/quyuan/voice-driver.ts");
		expect(driver).toContain("getDataContext?.()");
		expect(driver).toContain('channel === "voice" ? this.voiceRuntime.getDataContext');
		const dataMap = readSrc("src/quyuan/voice-data-map.ts");
		expect(dataMap).toContain("<talos_data_map>");
		for (const field of [
			"settings.tasksPath",
			"settings.talosTasksPath",
			"settings.healthLogPath",
			"settings.reportsFolder",
			"settings.pendingApprovalsPath",
			"settings.candidatesPath",
			"settings.inboxFolder",
			"settings.dailyFolder",
		]) {
			expect(dataMap).toContain(field);
		}
		expect(dataMap).toContain("意图路由");
	});

	it("wires the panel to pass the data map and to show the read-only hint", () => {
		const panel = readSrc("src/quyuan/voice-panel.ts");
		expect(panel).toContain("getDataContext: () => buildTalosDataMap(this.settings)");
		expect(panel).toContain("语音只读：可查状态、读统计、报进度");
	});
});
