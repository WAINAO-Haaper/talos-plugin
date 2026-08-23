import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const panel = readFileSync(`${root}src/quyuan/voice-panel.ts`, "utf8");
const shellCss = readFileSync(`${root}styles.quyuan-shell.css`, "utf8");
const uiCss = readFileSync(`${root}styles.ui-v2.css`, "utf8");

describe("voice focus workspace v2", () => {
	it("adds compact workspace identity, live state, and read-only boundary", () => {
		expect(panel).toContain('root.dataset.talosComponent = "voice-workspace"');
		expect(panel).toContain("tq-workspace-bar");
		expect(panel).toContain("VOICE WORKSPACE");
		expect(panel).toContain("屈原语音");
		expect(panel).toContain("语音只读");
		expect(panel).toContain("this.workspaceStatusEl?.setText(meta.caption)");
		expect(uiCss).toContain(".tq-workspace-bar");
		expect(uiCss).toContain(".tq-workspace-state__dot");
	});

	it("marks the stage and session-context rail as distinct workspace regions", () => {
		expect(panel).toContain('"data-workspace-section": "voice-stage"');
		expect(panel).toContain('"data-workspace-section": "session-context"');
		expect(panel).toContain('"aria-label": "动态语音舞台"');
		expect(panel).toContain('"aria-label": "会话、上下文与能力"');
	});

	it("preserves the existing particle, transcript, radial-menu, and session contracts", () => {
		for (const contract of [
			"QuyuanBackgroundField",
			"QuyuanVoiceCharacterStage",
			"tq-overlay-text",
			"tq-fab-menu",
			"toggleBackground",
			"setOutputLevel",
			"VoiceSessionStore",
			'data-session-namespace", "voice"',
		]) {
			expect(panel).toContain(contract);
		}
		for (const contract of [
			".tq-fab-menu",
			".tq-overlay-line",
			"@keyframes tq-button-shake",
			"@media (prefers-reduced-motion: reduce)",
			".talos-console.theme-cosmos-dark .tq-voice",
			".talos-console.theme-geometric-modern .tq-voice",
		]) {
			expect(shellCss).toContain(contract);
		}
	});

	it("uses the existing voice tokens and stage container for responsive reflow", () => {
		const chrome = uiCss.slice(
			uiCss.indexOf("/* Voice focus workspace chrome · D-TLP-019")
		);
		expect(chrome).toContain("var(--tq-state)");
		expect(chrome).toContain("var(--tq-panel-strong)");
		expect(chrome).toContain("@container tq-stage (max-width: 620px)");
		expect(chrome).not.toContain("animation:");
	});
});
