import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
	checkQuyuanCapabilityContract,
	QUYUAN_REQUIRED_CAPABILITIES,
} from "./src/quyuan/contract.ts";
import { evaluateQuyuanGovernance } from "./src/quyuan/governance.ts";
import {
	loadQuyuanSoulContext,
	QuyuanSoulBootstrapError,
} from "./src/quyuan/persona-context.ts";
import {
	CLAUDIAN_STORAGE_PATH,
	SESSIONS_PATH,
} from "./src/quyuan/claudian/core/bootstrap/StoragePaths.ts";
import { VIEW_TYPE_CLAUDIAN } from "./src/quyuan/claudian/core/types/chat.ts";
import {
	generateTalosMarkOutlinePoints,
	generateTalosMarkPoints,
	generateTalosRoundedMarkPoints,
	generateTalosSlimMarkPoints,
	TALOS_ICON_SVG,
} from "./src/talos-mark.ts";

function sourceRegion(source, startMarker, endMarker) {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
	return source.slice(start, end);
}

function request(overrides = {}) {
	return {
		toolName: "Edit",
		input: { file_path: "02-洞察/测试.md" },
		readPaths: new Set(),
		...overrides,
	};
}

const talosMarkPoints = generateTalosMarkPoints(4);
const denseTalosMarkPoints = generateTalosMarkPoints(3);
const outlineTalosMarkPoints = generateTalosMarkOutlinePoints(2, 13);
const slimTalosMarkPoints = generateTalosSlimMarkPoints(2);
const roundedTalosMarkPoints = generateTalosRoundedMarkPoints(2);
assert.ok(talosMarkPoints.length > 1800, "TALOS 粒子采样密度不足");
assert.ok(denseTalosMarkPoints.length > 4000, "TALOS 高密度采样不足");
assert.ok(outlineTalosMarkPoints.length > 5000, "TALOS 窄边框采样密度不足");
assert.ok(outlineTalosMarkPoints.length < generateTalosMarkPoints(2).length * 0.62);
assert.ok(slimTalosMarkPoints.length >= 6000 && slimTalosMarkPoints.length <= 6400);
assert.ok(roundedTalosMarkPoints.length >= 6100 && roundedTalosMarkPoints.length <= 6400);
assert.equal(
	slimTalosMarkPoints.some(({ x, y }) => Math.abs(x) < 0.16 && y > 0.08),
	false,
	"屈原粒子嘴部必须向底部贯通"
);
assert.deepEqual(talosMarkPoints, generateTalosMarkPoints(4));
assert.ok(talosMarkPoints.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
assert.ok(talosMarkPoints.some(({ x, y }) => x < -0.45 && Math.abs(y) < 0.25));
assert.ok(talosMarkPoints.some(({ x, y }) => x > 0.45 && Math.abs(y) < 0.25));
assert.equal(
	talosMarkPoints.some(({ x, y }) => Math.abs(x) < 0.08 && y > -0.15 && y < 0.3),
	false,
	"TALOS 标志中央负形 T 必须保持留空"
);
assert.match(TALOS_ICON_SVG, /M180 247H249/);

assert.equal(
	evaluateQuyuanGovernance(request({ toolName: "Read", input: {} })).decision,
	"allow"
);

const missingReadme = evaluateQuyuanGovernance(request());
assert.equal(missingReadme.decision, "deny");
assert.deepEqual(missingReadme.requiredReads, ["02-洞察/_README.md"]);

assert.equal(
	evaluateQuyuanGovernance(
		request({ readPaths: new Set(["02-洞察/_README.md"]) })
	).decision,
	"ask"
);

assert.equal(
	evaluateQuyuanGovernance(
		request({
			input: { file_path: "Identity/PROFILE.md" },
			readPaths: new Set(["Identity/_README.md"]),
		})
	).decision,
	"deny"
);

assert.equal(
	evaluateQuyuanGovernance(
		request({
			input: { file_path: "Identity/CONTEXT.md" },
			readPaths: new Set(["Identity/_README.md"]),
			approvalGranted: true,
			approvedWorkflow: "identity-change",
		})
	).decision,
	"allow"
);

const allCapabilities = new Set([...QUYUAN_REQUIRED_CAPABILITIES, "rewind"]);
assert.equal(
	checkQuyuanCapabilityContract({
		provider: "claude",
		supported: allCapabilities,
	}).ok,
	true
);

assert.equal(
	evaluateQuyuanGovernance(
		request({
			toolName: "inline-edit",
			input: { file_path: "02-洞察/测试.md" },
			readPaths: new Set(["02-洞察/_README.md"]),
			approvalGranted: true,
		})
	).decision,
	"allow"
);

const upstreamCapabilityFiles = [
	"src/quyuan/claudian/core/providers/ProviderRegistry.ts",
	"src/quyuan/claudian/core/runtime/ChatRuntime.ts",
	"src/quyuan/claudian/core/bootstrap/SessionStorage.ts",
	"src/quyuan/claudian/features/inline-edit/ui/InlineEditModal.ts",
	"src/quyuan/claudian/core/mcp/McpTester.ts",
	"src/quyuan/claudian/features/chat/services/SubagentManager.ts",
];
assert.equal(upstreamCapabilityFiles.every((path) => existsSync(path)), true);

const talosMain = readFileSync("src/main.ts", "utf8");
const talosSettingsSource = readFileSync("src/settings.ts", "utf8");
const embeddedWorkbenchMain = readFileSync("src/quyuan/claudian/main.ts", "utf8");
assert.match(talosMain, /extends ClaudianWorkbenchPlugin/);
assert.match(talosMain, /initializeQuyuanSoul/);
assert.match(talosMain, /activateQuyuanV2MainView/);
assert.match(talosMain, /candidate\.getRoot\(\) === workspace\.rootSplit/);
assert.match(talosMain, /id: "quyuan-diagnostics"/);
assert.match(talosMain, /writeQuyuanDiagnostics/);
assert.match(talosMain, /recordQuyuanRuntimeError/);
assert.match(talosMain, /window\.unhandledrejection/);
assert.match(talosMain, /activateQuyuanV2View\.postOpenCheck/);
assert.match(talosMain, /private async initializeQuyuanWorkbench\(\): Promise<void>[\s\S]*await super\.onload\(\)/);
assert.match(talosMain, /void this\.initializeQuyuanWorkbench\(\)/);
assert.ok(
	talosMain.indexOf("this.registerView(\n\t\t\tVIEW_TYPE_TALOS") <
		talosMain.indexOf("void this.initializeQuyuanWorkbench()"),
	"TALOS 主控制台视图必须先注册，屈原完整工作台只能后置异步初始化"
);
assert.match(
	embeddedWorkbenchMain,
	/shouldRegisterWorkbenchRibbon\(\)[\s\S]*if \(this\.shouldRegisterWorkbenchRibbon\(\)\)/
);
assert.match(
	talosMain,
	/protected shouldRegisterWorkbenchRibbon\(\): boolean \{\s*return false;/
);
assert.match(
	embeddedWorkbenchMain,
	/shouldRegisterWorkbenchSettingTab\(\)[\s\S]*if \(this\.shouldRegisterWorkbenchSettingTab\(\)\)/
);
assert.match(
	talosMain,
	/protected shouldRegisterWorkbenchSettingTab\(\): boolean \{\s*return false;/
);
assert.match(talosSettingsSource, /id: "workbench", label: "屈原 · 高级"/);
assert.match(
	talosSettingsSource,
	/renderWorkbench[\s\S]*new ClaudianSettingTab\(this\.app, this\.plugin\)/
);
assert.equal((talosMain.match(/this\.addRibbonIcon\(/g) ?? []).length, 1);
const talosViewSource = readFileSync("src/view.ts", "utf8");
// 2026-06-29 设计变更：主页「屈原」入口改为控制台内的语音页（QuyuanVoicePanel，
// 经 openQuyuan → activePage="jarvis"），不再打开 v2 工作台 tab；v2 引擎由语音壳的
// QuyuanVoiceDriver 经 createChatRuntime 复用，完整工作台仍可经命令面板单独打开。
assert.match(talosViewSource, /new QuyuanVoicePanel\(/);
assert.match(talosViewSource, /this\.activePage = "jarvis"/);
assert.match(
	talosViewSource,
	/icon:\s*"layout-dashboard"[\s\S]*icon:\s*"ear"[\s\S]*icon:\s*"database"/
);
assert.match(talosViewSource, /const NAV_GROUPS[\s\S]*label:\s*"现在"[\s\S]*label:\s*"系统"/);
assert.match(talosViewSource, /key:\s*"identity"[\s\S]*label:\s*"身份上下文"/);
assert.match(talosViewSource, /const mark = a\.createDiv[\s\S]*setIcon\(mark,\s*p\.icon\)/);
assert.match(
	talosViewSource,
	/a\.setAttribute\("role",\s*"button"\)[\s\S]*a\.setAttribute\("tabindex",\s*"0"\)[\s\S]*event\.key !== "Enter"[\s\S]*event\.key !== " "/
);

assert.equal(
	[
		"src/jarvis/panel.ts",
		"src/jarvis/engine.ts",
		"src/jarvis/voiceio.ts",
	].every((path) => existsSync(path)),
	true
);

assert.equal(VIEW_TYPE_CLAUDIAN, "talos-quyuan-view");
assert.equal(
	CLAUDIAN_STORAGE_PATH === ".talos/quyuan" &&
		SESSIONS_PATH === ".talos/quyuan/sessions",
	true
);

const quyuanShellCss = readFileSync("styles.quyuan-shell.css", "utf8");
assert.match(quyuanShellCss, /container-type:\s*inline-size/);
assert.match(quyuanShellCss, /@container talos-quyuan \(max-width:\s*620px\)/);
assert.match(
	quyuanShellCss,
	/\.talos-quyuan-shell\s*\{[\s\S]*--talos-qy-paper:\s*var\(--background-primary\)[\s\S]*color-scheme:\s*inherit/
);
assert.match(
	quyuanShellCss,
	/body\[data-talos-vault-theme\] \.talos-quyuan-shell\s*\{[\s\S]*--talos-qy-paper:\s*var\(--tv-bg\)[\s\S]*--talos-qy-radius:\s*var\(--tv-radius\)[\s\S]*--claudian-brand-rgb:\s*var\(--tv-accent-rgb\)[\s\S]*font-family:\s*var\(--tv-font\)/
);
assert.doesNotMatch(
	quyuanShellCss.match(/\.talos-quyuan-shell\s*\{[\s\S]*?\n\}/)?.[0] ?? "",
	/color-scheme:\s*light|--background-primary:\s*var\(--talos-qy-paper\)/
);
assert.match(quyuanShellCss, /\.claudian-welcome-greeting[\s\S]*?white-space:\s*nowrap/);
assert.match(
	quyuanShellCss,
	/\.talos-quyuan-action-row[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
);
assert.doesNotMatch(
	quyuanShellCss.match(/\.claudian-welcome-greeting\s*\{[\s\S]*?\}/)?.[0] ?? "",
	/\bvw\b/
);
assert.doesNotMatch(quyuanShellCss, /content:\s*"权"/);
assert.doesNotMatch(quyuanShellCss, /grid-template-columns:\s*repeat\(6,\s*max-content\)/);
const quyuanTabSource = readFileSync(
	"src/quyuan/claudian/features/chat/tabs/Tab.ts",
	"utf8"
);
const quyuanViewSource = readFileSync(
	"src/quyuan/claudian/features/chat/ClaudianView.ts",
	"utf8"
);
assert.match(quyuanTabSource, /talos-quyuan-voice-track/);
assert.match(quyuanViewSource, /openWorkbench/);
assert.match(quyuanViewSource, /renderOpenError/);
assert.match(quyuanViewSource, /writeQuyuanDiagnostics/);

const voicePanelSource = readFileSync("src/quyuan/voice-panel.ts", "utf8");
const voiceCharacterSource = readFileSync("src/quyuan/voice-character-stage.ts", "utf8");
const voiceDriverSource = readFileSync("src/quyuan/voice-driver.ts", "utf8");
const voiceParticleSource = readFileSync("src/quyuan/voice-particle-field.ts", "utf8");
const vadSource = readFileSync("src/quyuan/vad-mic.ts", "utf8");
const voiceIoSource = readFileSync("src/jarvis/voiceio.ts", "utf8");
const particleCreateRegion = sourceRegion(
	voiceParticleSource,
	"private createParticles(): Particle[]",
	"private resize(): void"
);
const particleColorRegion = sourceRegion(
	voiceParticleSource,
	"private particleColor(",
	"private render(time: number)"
);
const particleRenderRegion = voiceParticleSource.slice(voiceParticleSource.indexOf("private render(time: number)"));
const particleDestroyRegion = sourceRegion(
	voiceParticleSource,
	"destroy(): void",
	"private createParticles(): Particle[]"
);
const panelAsrStateRegion = sourceRegion(
	voicePanelSource,
	"onState: (s) =>",
	"onSpeechStart: () =>"
);
const panelTtsErrorRegion = sourceRegion(
	voicePanelSource,
	`} else if (s === "error") {`,
	"}, (level) => {"
);
assert.match(voicePanelSource, /new QuyuanVoiceCharacterStage\(/);
assert.doesNotMatch(voicePanelSource, /new QuyuanVoiceParticleField\(/);
assert.match(voiceCharacterSource, /tq-pixel-head-scene/);
assert.equal((voiceCharacterSource.match(/createEl\("canvas"/g) ?? []).length, 2);
assert.match(voiceCharacterSource, /new QuyuanVoiceParticleField\(/);
assert.match(voiceCharacterSource, /setAwake\(awake\)[\s\S]*setState\(state/);
assert.match(voiceCharacterSource, /setInputLevel[\s\S]*setOutputLevel[\s\S]*destroy/);
assert.match(voiceCharacterSource.slice(voiceCharacterSource.indexOf("destroy(): void")), /field\?\.destroy\(\)[\s\S]*root\.remove\(\)/);
assert.doesNotMatch(voiceCharacterSource, /TALOS-Mascot-Character-Transparent-v1\.png/);
assert.doesNotMatch(voiceCharacterSource, /createImage|getResourcePath/);
assert.match(voicePanelSource, /buildFunctionalSidebar/);
assert.match(talosSettingsSource, /quyuanVoiceRecognitionEnabled:\s*boolean/);
assert.match(talosSettingsSource, /quyuanVoiceRecognitionEnabled:\s*true/);
assert.match(voicePanelSource, /quyuanVoiceRecognitionEnabled === false[\s\S]*renderVoiceRecognitionOff/);
assert.match(voicePanelSource, /setVoiceRecognitionEnabled[\s\S]*this\.asr\?\.stop\(\)/);
assert.match(voicePanelSource, /toggleVoiceRecognitionMode[\s\S]*setVoiceRecognitionEnabled/);
assert.match(voicePanelSource, /语音识别已退出，文字输入仍可使用/);
assert.match(voicePanelSource, /当前语音会话[\s\S]*当前上下文[\s\S]*已启用能力/);
assert.match(voicePanelSource, /talos-quyuan-side-width[\s\S]*installSideResizer/);
assert.match(voicePanelSource, /tq-side-composer[\s\S]*给屈原发送文字消息/);
assert.match(voicePanelSource, /tq-fab[\s\S]*tq-fab-menu[\s\S]*tq-fab-ring/);
assert.match(voicePanelSource, /setFabButtonLabel[\s\S]*aria-labelledby/);
assert.match(voicePanelSource, /button\.removeAttribute\("aria-label"\)/);
assert.match(voicePanelSource, /tq-fab-sr-label/);
assert.match(
	voicePanelSource,
	/tq-btn tq-btn--danger tq-btn--sm[\s\S]*确认执行/
);
assert.match(voicePanelSource, /updateSendState[\s\S]*sendBtn\.disabled/);
assert.match(voicePanelSource, /MarkdownRenderer\.render/);
assert.match(
	voiceDriverSource,
	/export type InteractionChannel = "voice" \| "text"/
);
assert.match(voiceDriverSource, /VOICE_RESPONSE_POLICY[\s\S]*TEXT_RESPONSE_POLICY/);
assert.match(
	voiceDriverSource,
	/runtimes:\s*Partial<Record<InteractionChannel,\s*ChatRuntime>>/
);
assert.match(
	voiceDriverSource,
	/histories:\s*Record<InteractionChannel,\s*ChatMessage\[]>/
);
assert.match(voicePanelSource, /commitUser\(command,\s*"voice"\)/);
assert.match(voicePanelSource, /commitUser\(text,\s*"text"\)/);
assert.match(voicePanelSource, /channel === "voice"[\s\S]*this\.tts\?\.feed\(delta\)/);
assert.match(
	voicePanelSource,
	/syncAsrBusy[\s\S]*setBusy\(busy,\s*this\.ttsSpeaking\)/
);
assert.match(voicePanelSource, /ttsPending[\s\S]*ttsSpeaking[\s\S]*responseActive/);
assert.match(voicePanelSource, /\(level\) => \{[\s\S]*characterStage\?\.setOutputLevel\(level\)/);
assert.match(voicePanelSource, /onLevel: \(level\)[\s\S]*characterStage\?\.setInputLevel\(visualLevel\)/);
assert.match(voicePanelSource, /characterStage\?\.setState\(state,\s*this\.wakeActive\)/);
assert.match(panelAsrStateRegion, /if \(!this\.wakeActive\) this\.setState\("sleep"\)[\s\S]*else if \(s === "transcribing"\)/);
assert.match(panelTtsErrorRegion, /setOutputLevel\(0\)[\s\S]*setState\(/);
assert.match(
	voiceDriverSource,
	/runtimePlugin[\s\S]*scopedSettings[\s\S]*model:\s*this\.voiceRuntime\.model[\s\S]*effortLevel:\s*this\.voiceRuntime\.effortLevel/
);
assert.match(vadSource, /BARGE_RMS = 0\.09[\s\S]*BARGE_FRAMES = 75/);
assert.match(vadSource, /BARGE_GUARD_MS = 600/);
assert.match(vadSource, /SILENCE_MS = 550/);
assert.match(voiceIoSource, /rest\.length > 28/);
assert.match(
	voicePanelSource,
	/type VoiceState = "sleep" \| "idle" \| "listen"/
);
assert.match(voicePanelSource, /wakeWord = "屈原"/);
assert.match(voicePanelSource, /sleepWord = "退下"/);
assert.match(voicePanelSource, /wakeWindowMs = 30_000/);
assert.match(voicePanelSource, /onText: \(text\) => this\.handleVoiceTranscript\(text\)/);
assert.match(voicePanelSource, /tq-transcript-editor[\s\S]*createEl\("textarea"[\s\S]*语音识别文字，可编辑/);
assert.match(voicePanelSource, /channel === "voice"[\s\S]*showTranscriptEditor\(trimmed\)/);
assert.match(voicePanelSource, /showTranscriptEditor[\s\S]*requestAnimationFrame[\s\S]*is-visible/);
assert.match(
	voicePanelSource,
	/handleVoiceTranscript[\s\S]*activateWake[\s\S]*commitUser\(command,\s*"voice"\)/
);
assert.match(
	voiceIoSource,
	/export function normalizeForSpeech[\s\S]*const spoken = normalizeForSpeech\(sentence\)/
);
assert.match(quyuanShellCss, /--tq-side-size:\s*360px/);
assert.match(quyuanShellCss, /\.tq-body\.is-side-collapsed/);
assert.match(quyuanShellCss, /\.tq-btn:focus-visible/);
assert.match(quyuanShellCss, /\.tq-btn:disabled/);
assert.match(quyuanShellCss, /\.talos-quyuan-open-error/);
assert.match(
	quyuanShellCss,
	/\.tq-btn--primary[\s\S]*\.tq-btn--secondary[\s\S]*\.tq-btn--ghost[\s\S]*\.tq-btn--danger/
);
assert.match(
	quyuanShellCss,
	/Uiverse\.io \/ gharsh11032000[\s\S]*translateY\(105%\)[\s\S]*tq-button-shake/
);
assert.match(
	quyuanShellCss,
	/\.tq-btn\.tq-stop[\s\S]*--tq-btn-fill:\s*#f53844/
);
assert.match(
	quyuanShellCss,
	/body\[data-talos-vault-theme\][\s\S]*\.tq-btn:not\(\.tq-btn--tab\):not\(\.tq-btn--row\)[\s\S]*background-color:\s*#212121\s*!important/
);
assert.match(
	quyuanShellCss,
	/\.tq-btn\.tq-btn--tab[\s\S]*background:\s*#212121[\s\S]*\.tq-btn\.tq-btn--tab\.is-active::before/
);
assert.match(
	quyuanShellCss,
	/\.tq-btn:not\(\.tq-btn--row\)\.is-active::before[\s\S]*color-mix\(in srgb,\s*var\(--tq-btn-fill\)\s*70%,\s*#111\)/
);
assert.match(
	quyuanShellCss,
	/@font-face[\s\S]*TALOS Ma Shan Zheng[\s\S]*MaShanZheng-Regular\.ttf/
);
assert.match(
	quyuanShellCss,
	/\.tq-copy h1\.tq-cap[\s\S]*font-family:\s*"TALOS Ma Shan Zheng"/
);
assert.match(
	quyuanShellCss,
	/\.theme-geometric-modern \.tq-voice[\s\S]*--tq-theme-key:\s*geometric-modern-xuan-paper[\s\S]*--tq-surface:\s*#f1ebdd[\s\S]*--tq-text:\s*#25231f[\s\S]*color-scheme:\s*light/
);
assert.match(
	quyuanShellCss,
	/\.theme-geometric-modern\[data-talos-page="jarvis"\] \.sidebar[\s\S]*background:\s*#e6ddcb/
);
assert.match(quyuanShellCss, /\.tq-stage[\s\S]*container:\s*tq-stage \/ size/);
assert.match(quyuanShellCss, /\.tq-pixel-head-scene[\s\S]*\.tq-pixel-head-canvas--back[\s\S]*\.tq-pixel-head-canvas--front/);
assert.match(quyuanShellCss, /\.tq-pixel-head-scene\.is-fallback[\s\S]*\.tq-pixel-head-fallback/);
assert.match(vadSource, /onLevel\?\:\s*\(level:\s*number\)/);
assert.match(vadSource, /this\.h\.onLevel\?\.\(/);
// 现行人物适配层内部使用 Antigravity 风格 TALOS Logo 粒子磁场；面板不直接依赖渲染器。
assert.match(voiceParticleSource, /export class QuyuanVoiceParticleField/);
assert.match(voiceParticleSource, /generateTalosRoundedMarkPoints\(2\)/);
assert.match(voiceParticleSource, /createSeededRandom/);
assert.match(particleCreateRegion, /swapIndex/);
assert.match(particleCreateRegion, /freeRadius:[\s\S]*freeAngle:[\s\S]*freeSpeed:/);
assert.match(voiceParticleSource, /private drawSphereParticle\([\s\S]*context\.arc\([\s\S]*safeRadius/);
assert.doesNotMatch(voiceParticleSource, /fillRect\(/);
assert.match(particleRenderRegion, /spherePulse[\s\S]*drawSphereParticle/);
assert.match(particleRenderRegion, /0\.000085[\s\S]*freeBreath[\s\S]*0\.18/);
assert.match(voiceParticleSource, /setAwake\(awake:\s*boolean\)/);
assert.match(voiceParticleSource, /private targetAttraction\(\): number/);
assert.match(voiceParticleSource, /!this\.awake[\s\S]*0\.08[\s\S]*"reco"[\s\S]*0\.99/);
assert.match(particleRenderRegion, /particleAttraction[\s\S]*targetX = freeX \+ \(logoX - freeX\) \* particleAttraction/);
assert.match(particleRenderRegion, /this\.awake \? 0\.22 : 0\.07/);
assert.match(particleRenderRegion, /this\.awake \? 0\.22 : 0\.085/);
assert.doesNotMatch(particleRenderRegion, /particle\.layer > 0\.52/);
assert.match(voiceParticleSource, /eyeFreeX[\s\S]*eyeFreeY[\s\S]*eyeAttraction/);
assert.match(voiceParticleSource, /EYE_PARTICLES_PER_SIDE = 240/);
assert.match(voiceParticleSource, /private createEyeParticles\(\): EyeParticle\[]/);
assert.match(voiceParticleSource, /baseX: side \* 0\.155 \+ Math\.cos\(angle\) \* radius \* 0\.055/);
assert.match(voiceParticleSource, /baseY: -0\.095 \+ Math\.sin\(angle\) \* radius \* 0\.055/);
assert.match(voiceParticleSource, /electricCyan[\s\S]*electricViolet[\s\S]*spectral/);
assert.match(voiceParticleSource, /private neonCloudColor\(seed: number, time: number\): Rgb/);
assert.match(voiceParticleSource, /r: 0, g: 255, b: 210[\s\S]*r: 255, g: 72, b: 210[\s\S]*r: 255, g: 184, b: 64/);
assert.match(particleRenderRegion, /0\.42 \+ particle\.layer \* 0\.34/);
assert.match(particleRenderRegion, /this\.awake \? 24 : 14/);
assert.match(voiceParticleSource, /private eyeColor\(time: number\): Rgb/);
assert.match(voiceParticleSource, /private drawParticleEyes\([\s\S]*state === "reco"[\s\S]*state === "think"[\s\S]*state === "speak"/);
assert.match(particleRenderRegion, /this\.drawParticleEyes\(centerX, centerY, scale, energy, animationTime\)/);
assert.match(particleRenderRegion, /this\.pointerInside[\s\S]*influence/);
assert.match(particleRenderRegion, /this\.width <= 620/);
assert.match(particleRenderRegion, /state === "listen"[\s\S]*state === "reco"[\s\S]*state === "think"[\s\S]*state === "speak"/);
assert.match(particleRenderRegion, /index % \(this\.awake \? 24 : 14\)/);
assert.match(voiceParticleSource, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
const reducedInterval = Number(voiceParticleSource.match(/REDUCED_MOTION_FRAME_INTERVAL = (\d+)/)?.[1]);
assert.ok(reducedInterval >= 120 && reducedInterval <= 500);
const dprLimit = Number(voiceParticleSource.match(/Math\.min\(this\.activeWindow\.devicePixelRatio \|\| 1,\s*([\d.]+)\)/)?.[1]);
assert.ok(dprLimit > 0 && dprLimit <= 1.5);
assert.match(voiceParticleSource, /"sleep" \| "idle" \| "listen" \| "reco" \| "think" \| "speak"/);
assert.match(particleColorRegion, /!this\.awake[\s\S]*"listen"[\s\S]*"reco"[\s\S]*"think"[\s\S]*"speak"/);
assert.doesNotMatch(voiceParticleSource, /drawEyes|eyeWidth/);
assert.match(particleRenderRegion, /requestAnimationFrame/);
assert.match(particleDestroyRegion, /this\.disposed = true[\s\S]*cancelAnimationFrame[\s\S]*resizeObserver\.disconnect[\s\S]*removeEventListener/);
assert.doesNotMatch(voiceParticleSource, /\.png|new Image\(|createElement\("img"\)/i);
assert.doesNotMatch(voiceParticleSource, /setInterval/);
// 7/10 沉浸式界面已退役旧 tq-flow / tq-copy；当前契约是字幕 overlay + FAB。
assert.match(quyuanShellCss, /\.tq-overlay-text[\s\S]*\.tq-overlay-reply[\s\S]*\.tq-transcript-editor[\s\S]*\.tq-overlay-user/);
assert.match(
	quyuanShellCss,
	/\.tq-transcript-editor\s*\{[\s\S]*right:\s*clamp\(28px,\s*3\.5vw,\s*56px\)[\s\S]*bottom:\s*calc\(clamp\(205px,\s*18vh,\s*250px\) \+ 92px\)[\s\S]*translate3d\(42px,\s*14px,\s*0\)/
);
assert.match(quyuanShellCss, /\.tq-overlay-reply\s*\{[\s\S]*width:\s*calc\(100% - clamp\(300px,\s*32vw,\s*430px\)\)/);
assert.match(quyuanShellCss, /\.tq-stage:has\(\.tq-fab\.is-open\) \.tq-transcript-editor\.is-visible[\s\S]*translate3d\(0,\s*-64px,\s*0\)/);
assert.match(quyuanShellCss, /\.tq-fab[\s\S]*\.tq-fab-menu[\s\S]*\.tq-fab-ring/);
assert.match(
	quyuanShellCss,
	/\.tq-fab\s*\{[\s\S]*right:\s*clamp\(210px,\s*12vw,\s*260px\)[\s\S]*bottom:\s*clamp\(205px,\s*18vh,\s*250px\)/
);
assert.match(quyuanShellCss, /\.tq-fab\.is-open \.tq-fab-btn:is\(:hover, :focus-visible\)\s*\{[\s\S]*z-index:\s*8/);
assert.match(quyuanShellCss, /\.tq-fab-btn::after\s*\{[\s\S]*z-index:\s*9[\s\S]*bottom:\s*calc\(100% \+ 10px\)/);
assert.match(quyuanShellCss, /nth-child\(-n \+ 2\)::after[\s\S]*left:\s*calc\(100% \+ 10px\)/);
assert.match(quyuanShellCss, /nth-child\(n \+ 6\)::after[\s\S]*right:\s*calc\(100% \+ 10px\)/);
assert.match(
	quyuanShellCss,
	/theme-cosmos-dark[\s\S]*theme-animal-island[\s\S]*theme-system-classic[\s\S]*theme-data-stream[\s\S]*theme-soft-relief[\s\S]*theme-geometric-modern/
);
assert.match(
	quyuanShellCss,
	/:not\(\[data-talos-page="overview"\]\) \.app[\s\S]*grid-template-columns:\s*72px minmax\(0,\s*1fr\)/
);
assert.match(
	quyuanShellCss,
	/sidebar:is\(:hover,\s*:focus-within\)[\s\S]*width:\s*296px/
);
assert.match(
	quyuanShellCss,
	/sidebar:is\(:hover,\s*:focus-within\)[\s\S]*pagenav-card \.nav-label[\s\S]*display:\s*block/
);
assert.match(
	quyuanShellCss,
	/sidebar:not\(:hover\):not\(:focus-within\)[\s\S]*pagenav-card[\s\S]*padding:\s*0 !important[\s\S]*border:\s*0 !important[\s\S]*box-shadow:\s*none !important/
);
assert.match(
	quyuanShellCss,
	/:not\(\[data-talos-page="overview"\]\):not\(\[data-talos-page="jarvis"\]\)[\s\S]*\.main[\s\S]*padding:\s*18px !important/
);

function mockApp(files) {
	return {
		vault: {
			adapter: {
				exists: async (path) => Object.hasOwn(files, path),
				read: async (path) => files[path],
			},
		},
	};
}

const soul = await loadQuyuanSoulContext(
	mockApp({
		"灵魂/PERSONA.md": "persona",
		"灵魂/persona-memory.md": "memory",
		"Identity/CONTEXT.md": "context",
	})
);
assert.equal(soul.sources.length, 3);
assert.match(soul.systemContext, /persona-memory/);

await assert.rejects(
	() =>
		loadQuyuanSoulContext(
			mockApp({
				"灵魂/PERSONA.md": "persona",
				"Identity/CONTEXT.md": "context",
			})
		),
	(error) =>
		error instanceof QuyuanSoulBootstrapError &&
		error.missingPaths.includes("灵魂/persona-memory.md")
);

console.log("Quyuan v2 self-test: passed");
