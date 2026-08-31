import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const panel = readFileSync(`${root}src/quyuan/voice-panel.ts`, "utf8");
const particleField = readFileSync(`${root}src/quyuan/voice-particle-field.ts`, "utf8");
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
			"QuyuanVoiceCharacterStage",
			"EmotionBallView",
			"tq-overlay-text",
			"tq-transcript-editor",
			"tq-readonly-query",
			"播报已开",
			"stopCurrentWork",
			"setOutputLevel",
			"VoiceSessionStore",
			'data-session-namespace", "voice"',
			"SecretStorage 隔离",
			"仅明确说“联网搜索”或“上网查”才发送当前问题",
			"QwenRealtimeVoiceSession",
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

	it("shows each realtime transcript once without a bordered editor", () => {
		expect(panel).toContain("仅显示转写 · 不自动注入 AI 对话");
		expect(panel).toContain("tq-transcript-line--partial");
		expect(panel).toContain("this.clearPartialTranscript()");
		expect(panel).toContain("this.pushTranscriptLine(text)");
		expect(panel).not.toContain("tq-overlay-user");
		expect(panel).not.toContain("最终文本可编辑");
		expect(shellCss).not.toContain(".tq-overlay-user");
	});

	it("removes the perspective background while retaining the weak particle atmosphere", () => {
		for (const retired of [
			"QuyuanBackgroundField",
			"QuyuanBackgroundType",
			"tq-bg",
			"toggleBackground",
			"renderBgBtn",
		]) expect(panel).not.toContain(retired);
		expect(panel).toContain("QuyuanVoiceCharacterStage");
		expect(shellCss).toContain("opacity: 0.1");
		expect(shellCss).toContain("background: var(--tq-surface)");
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
		expect(shellCss).toContain("clamp(500px, min(60cqi, 86cqh), 820px)");
		expect(shellCss).toContain("clamp(380px, min(58cqi, 82cqh), 560px)");
		expect(shellCss).toContain("clamp(300px, min(46cqi, 78cqh), 340px)");
		expect(shellCss).toContain("clamp(190px, min(44cqi, 74cqh), 230px)");
		expect(shellCss).toContain("clamp(180px, min(44cqi, 76cqh), 230px)");
		expect(shellCss).not.toMatch(
			/\.tq-emotion-ball,\s*\.tq-emotion-ball__engine/
		);
		const chrome = uiCss.slice(
			uiCss.indexOf("/* Voice focus workspace chrome · D-TLP-019 / D-TLP-022")
		);
		expect(chrome).toContain("var(--tq-state)");
		expect(chrome).toContain("var(--tq-module-surface)");
		expect(chrome).toContain("@container tq-stage (max-width: 620px)");
	});

	it("keeps canonical viewport geometry centered and inside the stage", () => {
		const clamp = (minimum: number, preferred: number, maximum: number): number =>
			Math.max(minimum, Math.min(preferred, maximum));
		const ballDiameter = (width: number, height: number): number => {
			let diameter = clamp(500, Math.min(width * 0.6, height * 0.86), 820);
			if (width <= 1200) {
				diameter = clamp(380, Math.min(width * 0.58, height * 0.82), 560);
			}
			if (width <= 800) {
				diameter = clamp(300, Math.min(width * 0.46, height * 0.78), 340);
			}
			if (width <= 520) {
				diameter = clamp(190, Math.min(width * 0.44, height * 0.74), 230);
			}
			if (height <= 520) {
				diameter = clamp(260, Math.min(width * 0.58, height * 0.82), 440);
			}
			if (width <= 520 && height <= 520) {
				diameter = clamp(180, Math.min(width * 0.44, height * 0.76), 230);
			}
			return Math.min(diameter, width, height);
		};
		const cases = [
			{ width: 1440, height: 700, band: [560, 620] },
			{ width: 1024, height: 620, band: [480, 520] },
			{ width: 736, height: 600, band: [280, 340] },
			{ width: 520, height: 600, band: [180, 230] },
			{ width: 360, height: 600, band: [180, 230] },
			{ width: 124, height: 360, band: [120, 124] },
			{ width: 1024, height: 500, band: [380, 440] },
		] as const;
		for (const { width, height, band } of cases) {
			const diameter = ballDiameter(width, height);
			expect(diameter).toBeGreaterThanOrEqual(band[0]);
			expect(diameter).toBeLessThanOrEqual(band[1]);
			expect(diameter).toBeLessThanOrEqual(width);
			expect(diameter).toBeLessThanOrEqual(height);
		}
		expect(ballDiameter(1440, 700) / 700).toBeGreaterThanOrEqual(0.8);
		expect(ballDiameter(1024, 620) / 620).toBeGreaterThanOrEqual(0.8);
		expect(shellCss).toContain("place-items: center");
		expect(shellCss).toContain("max-width: 100%");
		expect(shellCss).toContain("max-height: 100%");
		expect(shellCss).toContain("container: tq-emotion / size");
		expect(shellCss).toContain("min(var(--tq-ball-size), 100cqi, 100cqh)");
		expect(shellCss).toContain("overflow-x: hidden");
		expect(shellCss).toContain("grid-template-columns: minmax(0, 1fr)");
		expect(shellCss).toContain(
			"@container tq-stage (max-width: 1200px)"
		);
		expect(shellCss).toMatch(
			/@container tq-stage \(max-width: 800px\)[\s\S]*\.tq-emotion-ball-host/
		);
	});

	it("keeps the weak particle atmosphere smooth without full-stage animated filters", () => {
		expect(particleField).toContain("const ACTIVE_FRAME_INTERVAL = 16");
		expect(particleField).toContain("const SLEEP_FRAME_INTERVAL = 33");
		expect(particleField).toContain("const PARTICLE_SAMPLE_STRIDE = 2");
		expect(particleField).toContain("index % PARTICLE_SAMPLE_STRIDE === 0");
		expect(particleField).toContain("devicePixelRatio || 1, 1)");
		const particleLayer = shellCss.slice(
			shellCss.indexOf(".tq-voice .tq-pixel-head-scene,"),
			shellCss.indexOf("body.theme-light .tq-voice .tq-pixel-head-scene,")
		);
		expect(particleLayer).toContain("filter: none");
		expect(shellCss).not.toContain("filter: drop-shadow(0 22px 48px");
		expect(shellCss).toMatch(/\.tq-emotion-ball-host::before\s*\{[\s\S]*box-shadow:/);
	});

	it("uses theme-bound modular controls from the accepted visual direction", () => {
		for (const contract of [
			"--tq-module-border",
			"--tq-module-yellow: #f4c63d",
			"--tq-module-red: #e7473e",
			"--tq-module-blue: #3362c7",
			".tq-btn.tq-control-btn--mic",
			"box-shadow: 5px 5px 0 var(--tq-module-shadow)",
			"border-radius: 0 !important",
		]) expect(shellCss).toContain(contract);
		expect(uiCss).toContain("background: var(--tq-module-surface)");
		expect(panel).toContain("tq-control-btn--mic");
		expect(shellCss).toContain(
			".tq-btn.tq-control-btn:not(.tq-btn--tab):not(.tq-btn--row)"
		);
	});

	it("keeps all six lower control labels visible at the accepted desktop width", () => {
		const dock = shellCss.slice(
			shellCss.indexOf(".tq-voice-dock {"),
			shellCss.indexOf(".tq-dock-status,")
		);
		const controls = shellCss.slice(
			shellCss.indexOf(".tq-voice-controls {"),
			shellCss.indexOf(".tq-control-btn {")
		);
		const label = shellCss.slice(
			shellCss.indexOf(".tq-control-btn .tq-control-label {"),
			shellCss.indexOf(".tq-control-btn--danger {")
		);
		const minimumControlGridWidth = 6 * 104 + 5 * 7;

		expect(minimumControlGridWidth).toBe(659);
		expect(dock).toContain("minmax(660px, 0.95fr)");
		expect(controls).toContain(
			"repeat(auto-fit, minmax(104px, 1fr))"
		);
		expect(label).toContain("min-width: max-content");
		expect(label).toContain("overflow: visible");
		expect(label).toContain("text-overflow: clip");
		expect(label).not.toContain("text-overflow: ellipsis");
		expect(shellCss).toContain("@media (max-width: 1200px)");
	});

	it("keeps a solid white ball while themes style the surrounding workspace", () => {
		const view = readFileSync(`${root}src/quyuan/emotion-ball-view.ts`, "utf8");
		expect(panel).toContain("sketch: false");
		expect(panel).not.toContain('sketch: key.includes("geometric-modern")');
		expect(view).toContain('color: "#FFFFFF"');
		expect(view).toContain('eyeColor: "#1A1A1A"');
		expect(shellCss).toContain("--tq-ball-surface: #ffffff");
		expect(shellCss).toContain("background: var(--tq-ball-eye)");
	});

	it("reuses the live chat route after stopping capture, playback, and processing", () => {
		const route = panel.slice(panel.indexOf("private goToChat(): void"), panel.indexOf("private stopCurrentWork(): void"));
		expect(route.indexOf("this.navigatingToChat = true")).toBeLessThan(route.indexOf("++this.lifecycleGeneration"));
		expect(route.indexOf("++this.lifecycleGeneration")).toBeLessThan(route.indexOf("this.realtime?.stop()"));
		expect(route.indexOf("this.realtime?.stop()")).toBeLessThan(route.indexOf("this.driver?.cancel()"));
		expect(route.indexOf("this.driver?.cancel()")).toBeLessThan(route.indexOf("this.tts?.stop()"));
		expect(route.indexOf("this.tts?.stop()")).toBeLessThan(route.indexOf('this.navigateToPage("chat")'));
		expect(panel).toContain("if (!current() || this.navigatingToChat) return;");
		const view = readFileSync(`${root}src/view.ts`, "utf8");
		expect(view).toContain("(pageKey) => this.navigateToPage(pageKey)");
	});
});
