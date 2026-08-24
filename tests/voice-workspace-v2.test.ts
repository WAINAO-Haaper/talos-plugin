import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const panel = readFileSync(`${root}src/quyuan/voice-panel.ts`, "utf8");
const shellCss = readFileSync(`${root}styles.quyuan-shell.css`, "utf8");
const uiCss = readFileSync(`${root}styles.ui-v2.css`, "utf8");

describe("voice focus workspace v2", () => {
	it("mounts Emotion Ball as the single center visual with a lower control dock", () => {
		expect(panel).toContain('root.dataset.talosComponent = "voice-workspace"');
		expect(panel).toContain("tq-workspace-bar");
		expect(panel).toContain("VOICE WORKSPACE");
		expect(panel).toContain("屈原语音");
		expect(panel).toContain("语音硬只读");
		expect(panel).toContain("tq-emotion-ball-host");
		expect(panel).toContain("tq-voice-dock");
		expect(panel).toContain('"data-workspace-section": "voice-controls"');
		expect(panel).toContain("this.workspaceStatusEl?.setText(meta.caption)");
		expect(uiCss).toContain(".tq-workspace-bar");
		expect(uiCss).toContain(".tq-workspace-state__dot");
	});

	it("deletes the old right history, tabs, composer, resizer, and radial menu", () => {
		expect(panel).toContain('"data-workspace-section": "voice-stage"');
		for (const retired of [
			"tq-side",
			"tq-convo",
			"tq-bub",
			"tq-side-tabs",
			"tq-side-composer",
			"tq-side-resizer",
			"tq-fab",
		]) {
			expect(panel).not.toContain(retired);
			expect(shellCss).not.toContain(retired);
		}
	});

	it("preserves voice capabilities, isolated session state, and security copy", () => {
		for (const contract of [
			"QuyuanBackgroundField",
			"QuyuanVoiceCharacterStage",
			"EmotionBallView",
			"tq-overlay-text",
			"tq-transcript-editor",
			"tq-readonly-query",
			"播报已开",
			"stopCurrentWork",
			"toggleBackground",
			"setOutputLevel",
			"VoiceSessionStore",
			'data-session-namespace", "voice"',
			"SecretStorage 隔离",
			"A/B/C 审批与永久禁区保持生效",
		]) {
			expect(panel).toContain(contract);
		}
		for (const contract of [
			".tq-emotion-ball-host",
			".tq-voice-dock",
			".tq-overlay-line",
			"@keyframes tq-button-shake",
			"@media (prefers-reduced-motion: reduce)",
			".talos-console.theme-cosmos-dark .tq-voice",
			".talos-console.theme-geometric-modern .tq-voice",
		]) {
			expect(shellCss).toContain(contract);
		}
	});

	it("uses the accepted state mapping and responsive geometry bands", () => {
		for (const mapping of [
			'waiting: "35"',
			'receiving: "31"',
			'busy: "32"',
			'thinking: "30"',
			'searching: "40"',
			'replying: "39"',
			'done: "33"',
			'error: "34"',
			'restricted: "38"',
			'stop: "41"',
		]) expect(panel + readFileSync(`${root}src/quyuan/emotion-ball-view.ts`, "utf8")).toContain(mapping);
		expect(shellCss).toContain("min(40cqi, 62cqh)");
		expect(shellCss).toContain("clamp(280px, min(43cqi, 62cqh), 340px)");
		expect(shellCss).toContain("clamp(180px, min(58cqi, 58cqh), 230px)");
		const chrome = uiCss.slice(
			uiCss.indexOf("/* Voice focus workspace chrome · D-TLP-019 / D-TLP-022")
		);
		expect(chrome).toContain("var(--tq-state)");
		expect(chrome).toContain("var(--tq-panel-strong)");
		expect(chrome).toContain("@container tq-stage (max-width: 620px)");
	});

	it("keeps canonical viewport geometry centered and inside the stage", () => {
		const clamp = (minimum: number, preferred: number, maximum: number): number =>
			Math.max(minimum, Math.min(preferred, maximum));
		const ballDiameter = (width: number, height: number): number => {
			let diameter = clamp(320, Math.min(width * 0.4, height * 0.62), 420);
			if (width <= 800) {
				diameter = clamp(280, Math.min(width * 0.43, height * 0.62), 340);
			}
			if (width <= 520) {
				diameter = clamp(180, Math.min(width * 0.58, height * 0.58), 230);
			}
			if (height <= 520) {
				diameter = clamp(180, Math.min(width * 0.42, height * 0.5), 280);
			}
			return diameter;
		};
		const cases = [
			{ width: 1440, height: 700, band: [320, 420] },
			{ width: 1024, height: 620, band: [320, 420] },
			{ width: 736, height: 600, band: [280, 340] },
			{ width: 520, height: 600, band: [180, 230] },
			{ width: 360, height: 600, band: [180, 230] },
		] as const;
		for (const { width, height, band } of cases) {
			const diameter = ballDiameter(width, height);
			expect(diameter).toBeGreaterThanOrEqual(band[0]);
			expect(diameter).toBeLessThanOrEqual(band[1]);
			expect(diameter).toBeLessThanOrEqual(width);
			expect(diameter).toBeLessThanOrEqual(height);
		}
		expect(shellCss).toContain("place-items: center");
		expect(shellCss).toContain("max-width: 100%");
		expect(shellCss).toContain("max-height: 100%");
		expect(shellCss).toContain("overflow-x: hidden");
		expect(shellCss).toContain("grid-template-columns: minmax(0, 1fr)");
	});

	it("reuses the live chat route after stopping capture, playback, and processing", () => {
		const route = panel.slice(panel.indexOf("private goToChat(): void"), panel.indexOf("private stopCurrentWork(): void"));
		expect(route.indexOf("this.navigatingToChat = true")).toBeLessThan(route.indexOf("this.asr?.stop()"));
		expect(route.indexOf("this.asr?.stop()")).toBeLessThan(route.indexOf("this.driver?.cancel()"));
		expect(route.indexOf("this.driver?.cancel()")).toBeLessThan(route.indexOf("this.tts?.stop()"));
		expect(route.indexOf("this.tts?.stop()")).toBeLessThan(route.indexOf('this.navigateToPage("chat")'));
		expect(panel).toContain("if (this.navigatingToChat) return;");
		const view = readFileSync(`${root}src/view.ts`, "utf8");
		expect(view).toContain("(pageKey) => this.navigateToPage(pageKey)");
	});
});
