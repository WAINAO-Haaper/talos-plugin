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
import { VadTurnMachine } from "./src/quyuan/vad-turn.ts";
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

const missingReadTarget = evaluateQuyuanGovernance(
	request({ toolName: "Read", input: {} })
);
assert.equal(missingReadTarget.decision, "deny");
assert.match(missingReadTarget.reason, /缺少可验证的目标路径/);
assert.equal(
	evaluateQuyuanGovernance(
		request({
			toolName: "Read",
			input: { file_path: "02-洞察/安全.md" },
		})
	).decision,
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
const compatibilityHost = readFileSync("src/agent-workbench/ui/claudian-compatibility-host.ts", "utf8");
assert.match(talosMain, /extends Plugin/);
assert.match(talosMain, /new ClaudianCompatibilityHost\(this\)/);
assert.match(talosMain, /initializeQuyuanSoul/);
assert.match(talosMain, /activateQuyuanV2MainView/);
assert.match(talosMain, /candidate\.getRoot\(\) === workspace\.rootSplit/);
assert.match(talosMain, /id: "quyuan-diagnostics"/);
assert.match(talosMain, /writeQuyuanDiagnostics/);
assert.match(talosMain, /recordQuyuanRuntimeError/);
assert.match(talosMain, /window\.unhandledrejection/);
assert.match(talosMain, /activateQuyuanV2View\.postOpenCheck/);
assert.match(talosMain, /private async initializeQuyuanWorkbench\(\): Promise<void>[\s\S]*await service\.initialize\(\)/);
assert.match(compatibilityHost, /initialize\(\): Promise<void>[\s\S]*super\.onload\(\)/);
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
	compatibilityHost,
	/protected shouldRegisterWorkbenchRibbon\(\): boolean \{\s*return false;/
);
assert.match(
	embeddedWorkbenchMain,
	/shouldRegisterWorkbenchSettingTab\(\)[\s\S]*if \(this\.shouldRegisterWorkbenchSettingTab\(\)\)/
);
assert.match(
	compatibilityHost,
	/protected shouldRegisterWorkbenchSettingTab\(\): boolean \{\s*return false;/
);
assert.match(
	talosSettingsSource,
	/\{\s*id:\s*"channel",\s*label:\s*"智能体与模型"/
);
assert.match(
	talosSettingsSource,
	/Anthropic API Key[\s\S]*OpenAI API Key[\s\S]*OhMyPi/
);
assert.doesNotMatch(
	talosSettingsSource,
	/renderWorkbench|ClaudianSettingTab|屈原 · 高级/
);
assert.equal((talosMain.match(/this\.addRibbonIcon\(/g) ?? []).length, 1);
const talosViewSource = readFileSync("src/view.ts", "utf8");
const navigationModelSource = readFileSync("src/ui/navigation-model.ts", "utf8");
// WP7：文字对话与语音分别进入 TALOS 的一级页面，旧 page key 继续由纯路由模型兼容。
assert.match(talosViewSource, /new QuyuanVoicePanel\(/);
assert.match(talosViewSource, /this\.activePage = "jarvis"/);
assert.match(
	navigationModelSource,
	/key:\s*"workbench"[\s\S]*key:\s*"chat"[\s\S]*key:\s*"voice"[\s\S]*key:\s*"workflow"[\s\S]*key:\s*"knowledge"[\s\S]*key:\s*"system"/
);
assert.match(
	navigationModelSource,
	/key:\s*"voice"[\s\S]*icon:\s*"audio-lines"[\s\S]*key:\s*"vault"[\s\S]*icon:\s*"database"/
);
assert.match(navigationModelSource, /key:\s*"identity"[\s\S]*label:\s*"身份上下文"/);
assert.match(talosViewSource, /for \(const page of PRIMARY_NAVIGATION\)/);
assert.match(talosViewSource, /const mark = item\.createDiv[\s\S]*setIcon\(mark,\s*page\.icon\)/);
assert.match(
	talosViewSource,
	/item\.setAttribute\("role",\s*"button"\)[\s\S]*item\.setAttribute\("tabindex",\s*"0"\)[\s\S]*event\.key !== "Enter"[\s\S]*event\.key !== " "/
);

// D-TLP-016 · C-3b：旧面板/引擎已移除，复用的 voice I/O 运行时保留。
assert.equal(existsSync("src/jarvis/panel.ts"), false);
assert.equal(existsSync("src/jarvis/engine.ts"), false);
assert.equal(existsSync("src/jarvis/voiceio.ts"), true);

assert.equal(VIEW_TYPE_CLAUDIAN, "talos-quyuan-view");
assert.equal(
	CLAUDIAN_STORAGE_PATH === ".talos/quyuan" &&
		SESSIONS_PATH === ".talos/quyuan/sessions",
	true
);

const talosCss = readFileSync("styles.talos.css", "utf8");
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
const emotionBallViewSource = readFileSync("src/quyuan/emotion-ball-view.ts", "utf8");
const voiceCharacterSource = readFileSync("src/quyuan/voice-character-stage.ts", "utf8");
const voiceDriverSource = readFileSync("src/quyuan/voice-driver.ts", "utf8");
const voiceParticleSource = readFileSync("src/quyuan/voice-particle-field.ts", "utf8");
const vadSource = readFileSync("src/quyuan/vad-mic.ts", "utf8");
const vadTurnSource = readFileSync("src/quyuan/vad-turn.ts", "utf8");
const sileroSource = readFileSync("src/quyuan/silero-vad.ts", "utf8");
const localVoiceSupplySource = readFileSync(
	"src/quyuan/local-voice-supply-chain.ts",
	"utf8"
);
const bundledLocalVoiceSource = readFileSync(
	"src/quyuan/bundled-local-voice-runtime.ts",
	"utf8"
);
const qwenRealtimeSource = readFileSync(
	"src/quyuan/qwen-realtime-voice.ts",
	"utf8"
);
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
assert.match(voicePanelSource, /new EmotionBallView\(createPinnedEmotionBall\)/);
assert.match(talosSettingsSource, /quyuanVoiceRecognitionEnabled:\s*boolean/);
assert.match(talosSettingsSource, /quyuanVoiceRecognitionEnabled:\s*true/);
assert.match(voicePanelSource, /quyuanVoiceRecognitionEnabled === false[\s\S]*renderVoiceRecognitionOff/);
assert.match(voicePanelSource, /setVoiceRecognitionEnabled[\s\S]*this\.asr\?\.stop\(\)/);
assert.match(voicePanelSource, /toggleVoiceRecognitionMode[\s\S]*setVoiceRecognitionEnabled/);
assert.match(voicePanelSource, /语音识别已退出，文字输入仍可使用/);
assert.match(voicePanelSource, /tq-readonly-query[\s\S]*文本只读查询/);
assert.match(voicePanelSource, /tq-go-chat[\s\S]*转到 AI 对话[\s\S]*goToChat/);
assert.doesNotMatch(
	voicePanelSource,
	/buildFunctionalSidebar|installSideResizer|tq-side-composer|tq-fab/
);
assert.match(
	voicePanelSource,
	/tq-approval-card[\s\S]*确认执行/
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
	/private history:\s*ChatMessage\[][\s\S]*restoreVoiceHistory/
);
assert.doesNotMatch(
	voiceDriverSource,
	/histories:\s*Record<InteractionChannel,\s*ChatMessage\[]>/
);
assert.match(
	voicePanelSource,
	/data-session-namespace",\s*"voice"/
);
assert.match(voicePanelSource, /new VoiceSessionStore\(/);
assert.match(voicePanelSource, /commitUser\(command,\s*"voice"\)/);
assert.match(voicePanelSource, /commitUser\(text,\s*"text"\)/);
assert.match(voicePanelSource, /channel === "voice"[\s\S]*this\.tts\?\.feed\(delta\)/);
assert.match(
	voicePanelSource,
	/syncAsrBusy[\s\S]*setBusy\(busy,\s*busy\)/
);
// Realtime 唤醒态由显式休眠/退出/离开页面结束，不再保留旧 30 秒计时器。
assert.match(voicePanelSource, /private pauseWakeWindow\(\)/);
assert.doesNotMatch(voicePanelSource, /wakeWindowMs|wakeTimer/);
assert.match(voicePanelSource, /There is intentionally no legacy 30-second timer/);
assert.doesNotMatch(
	sourceRegion(
		voicePanelSource,
		"private syncAsrBusy(): void {",
		"// ---------- 状态机 ----------"
	),
	/pauseWakeWindow|refreshWakeWindow/
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
// 打断阈值：正常音量即可打断（AEC 开启时回授残响远低于阈值）
assert.match(vadSource, /BARGE_RMS = 0\.05[\s\S]*BARGE_FRAMES = 40/);
assert.match(vadSource, /BARGE_GUARD_MS = 500/);
// 打断成功后转入收音：打断句本身可被转写为新指令
assert.match(vadSource, /BARGE_PREROLL = PRE_ROLL \+ BARGE_FRAMES \+ 12/);
assert.match(vadSource, /onSpeechStart\(\)[\s\S]*this\.turn\.beginFromBarge\(/);
assert.match(vadTurnSource, /SILENCE_MS = 550/);
// 软结束：静音判定不再是硬切，定案前留可重开窗口 + 短段合并窗口
assert.match(vadTurnSource, /REOPEN_MS = 700[\s\S]*CONTINUATION_FRAMES = 2[\s\S]*MERGE_MS = 350/);
assert.match(vadTurnSource, /BUSY_SHORT_MIN_SPEECH_MS = 220/);
assert.doesNotMatch(vadSource, /endUtterance/);
// 阶段 2：判定来源换成 Silero 人声概率，响度只留兜底与打断
assert.match(
	vadSource,
	/startVoiced: byProb \? this\.speechProb >= SPEECH_START_PROB : rms > START_RMS/
);
assert.match(vadSource, /keepVoiced: byProb \?[\s\S]*SPEECH_KEEP_PROB : rms >= KEEP_RMS/);
// onLevel（粒子球音量驱动）仍由 RMS 计算，不能被概率判定顶掉
assert.match(vadSource, /const rms = this\.rmsOf\(frame\);[\s\S]*this\.h\.onLevel\?\.\(/);
// 打断判定必须留在响度：屈原自己的朗读在模型看来同样是人声
assert.match(vadSource, /BARGE_RMS = 0\.05[\s\S]*rms > BARGE_RMS/);
// 降级路径：任一环失败都回退响度判定 + 一次性中文提示；过期生命周期不得复活。
assert.match(
	vadSource,
	/private fallbackToRms\(reason: string, generation = this\.lifecycleGeneration\): void[\s\S]*generation !== this\.lifecycleGeneration[\s\S]*return;/
);
assert.match(vadSource, /this\.turn\.setPeakGate\(true\)[\s\S]*语音断句已回退到响度判定/);
// 本地 VAD 供应链：禁止远程 JavaScript/自定义 CDN，只接受固定清单与校验后资产。
assert.match(sileroSource, /BUNDLED_SILERO_VAD_PACKAGE/);
assert.match(sileroSource, /loadVerifiedVoiceModelAsset\(modelPackage\.manifest/);
assert.match(sileroSource, /runtimeVersion[\s\S]*\^\(latest\|main\|master\|head\)\$/);
assert.match(sileroSource, /const clear = \(\): void =>[\s\S]*task\.then\(clear, clear\)/);
assert.match(sileroSource, /dispose\(\): void[\s\S]*\+\+this\.loadGeneration[\s\S]*session\?\.release/);
assert.doesNotMatch(sileroSource, /\bimport\s*\(|\bfetch\s*\(|requestUrl|quyuanVadCdn/);
assert.match(bundledLocalVoiceSource, /BUNDLED_SILERO_VAD_PACKAGE[\s\S]*= null/);
assert.match(bundledLocalVoiceSource, /runtimeDelivery: "build-time-static"/);
assert.match(bundledLocalVoiceSource, /dynamicRemoteJavaScript: false/);
assert.match(bundledLocalVoiceSource, /modelIntegrity: "sha256-required"/);
assert.match(localVoiceSupplySource, /模型清单缺少 NOTICE 声明/);
assert.match(localVoiceSupplySource, /\^\[a-f0-9\]\{64\}\$/);
assert.match(localVoiceSupplySource, /actual !== manifest\.sha256/);
assert.match(talosSettingsSource, /quyuanVadEnabled:\s*boolean/);
// 旧本地 VAD 不参与 Qwen Realtime；兼容字段保留并默认关闭，但无效控件不再显示。
assert.match(talosSettingsSource, /quyuanVadEnabled:\s*false/);
assert.match(talosSettingsSource, /quyuanVadNetworkConsent:\s*boolean/);
assert.match(talosSettingsSource, /quyuanVadNetworkConsent:\s*false/);
assert.match(
	vadSource,
	/if \(this\.settings\.quyuanVadEnabled === false\) return;/
);
assert.doesNotMatch(
	talosSettingsSource,
	/允许首次获取固定 VAD 模型|旧本地断句（存档）/
);
assert.match(
	talosMain,
	/settings\.quyuanVadCdn = "";[\s\S]*settings\.quyuanVadModel = "";/
);
assert.match(talosSettingsSource, /quyuanVadCdn:\s*""[\s\S]*quyuanVadModel:\s*""/);

// 阶段 3：流式转写只对本地引擎开；云端引擎（按次计费 + 上传录音）必须零改动
const localAsrSource = readFileSync("src/quyuan/local-asr.ts", "utf8");
const cloudAsrSource = readFileSync("src/quyuan/cloud-asr.ts", "utf8");
assert.match(vadSource, /protected supportsPartial\(\): boolean \{\s*return false;/);
assert.match(localAsrSource, /protected override supportsPartial\(\): boolean \{\s*return true;/);
assert.doesNotMatch(cloudAsrSource, /supportsPartial|onPartial|partial/i);
// 同一个 ONNX session 不能并发跑：中途与最终转写共用串行队列；超时不提前放行底层推理。
assert.match(localAsrSource, /export class SerializedInferenceQueue[\s\S]*private tail: Promise<unknown>/);
assert.match(localAsrSource, /const operation = this\.tail\.then\(task, task\)[\s\S]*this\.tail = operation\.catch/);
assert.match(localAsrSource, /this\.inferenceQueue\.run\([\s\S]*\(\) => transcriber\(samples/);
assert.match(localAsrSource, /protected override requiresFinalTranscription\(\): boolean[\s\S]*return true/);
// 中途结果只喂字幕；轮次已定案就不再刷，避免上一句残影
assert.match(vadSource, /if \(this\.supportsPartial\(\)\) this\.maybePartial\(\);/);
assert.match(vadSource, /live\?\.turnId === snap\.turnId\) this\.h\.onPartial\?\.\(text\)/);
assert.match(vadSource, /PARTIAL_MIN_MS = 1200[\s\S]*PARTIAL_INTERVAL_MS = 700/);
// 完全相同的音频才复用中途结果，不做任何近似
assert.match(
	vadSource,
	/cached\.turnId === turnId && cached\.samples === total && cached\.text/
);
// 兼容 ASR 回调：partial 受 lifecycle 守卫保护，且绝不触发唤醒或发送。
assert.match(
	voicePanelSource,
	/onPartial: \(text\) => \{[\s\S]*if \(current\(\)\) this\.showPartialTranscript\(text\)/
);
const partialRegion = sourceRegion(
	voicePanelSource,
	"private showPartialTranscript(text: string): void {",
	"private showFinalTranscript"
);
assert.doesNotMatch(partialRegion, /commitUser|matchWake|activateWake|respond\(/);
assert.match(
	partialRegion,
	/!this\.wakeActive[\s\S]*inputMode !== "push-to-talk"[\s\S]*return;/
);
assert.match(partialRegion, /this\.setState\("reco"\)/);
// 忙碌 = 本轮已交给 agent：软结束的立即定案，半句一律丢弃
assert.match(vadSource, /if \(busy\) this\.turn\.onBusy\(\);/);
// VadMic 为 partial/final 提供稳定流标识，流式 Worker 才能在 final 时正确 flush。
assert.match(
	vadSource,
	/protected abstract transcribe\([\s\S]*samples: Float32Array,[\s\S]*sampleRate: number,[\s\S]*context: VadTranscriptionContext[\s\S]*\): Promise<string>/
);
assert.match(vadSource, /streamId: `\$\{lifecycleGeneration\}:\$\{snap\.turnId\}`[\s\S]*phase: "partial"/);
assert.match(vadSource, /streamId: `\$\{lifecycleGeneration\}:\$\{turnId\}`[\s\S]*phase: "final"/);
assert.match(voiceIoSource, /rest\.length > 28/);
assert.match(
	voicePanelSource,
	/type VoiceState = "sleep" \| "idle" \| "listen"/
);
assert.match(voicePanelSource, /wakeWord = "屈原"/);
assert.match(voicePanelSource, /sleepWord = "退下"/);
assert.doesNotMatch(voicePanelSource, /wakeWindowMs|wakeTimer/);
assert.match(
	voicePanelSource,
	/onText: \(text\) => \{[\s\S]*this\.handleVoiceTranscript\(text\)[\s\S]*renderPushToTalkReady/
);
assert.match(talosSettingsSource, /quyuanVoiceInputMode:\s*"continuous" \| "push-to-talk"/);
// 活跃麦克风主链固定为 Qwen Realtime；打开页面不会构造或启动本地 ASR。
assert.match(
	voicePanelSource,
	/Local ASR is no longer part of the active path[\s\S]*this\.asr = null;[\s\S]*this\.realtime = this\.buildRealtime\(lifecycleGeneration\)/
);
assert.match(voicePanelSource, /return new QwenRealtimeVoiceSession\(/);
assert.match(qwenRealtimeSource, /type: "semantic_vad"/);
assert.match(qwenRealtimeSource, /interrupt_response: true/);
assert.match(
	voicePanelSource,
	/onInputTranscript: \(text, final\) => \{[\s\S]*showPartialTranscript\(text\)[\s\S]*showFinalTranscript\(trimmed\)/
);
assert.match(
	voicePanelSource,
	/setVoiceRecognitionEnabled[\s\S]*fallbackToPushToTalk\("Realtime 会话未能进入就绪状态"\)/
);
// TPI-114：转写只显示一次；partial 与 final 复用同一字幕流，不再创建可编辑 textarea。
assert.match(voicePanelSource, /tq-transcript-editor is-visible[\s\S]*tq-transcript-lines/);
assert.match(voicePanelSource, /tq-transcript-line tq-transcript-line--partial/);
assert.match(
	voicePanelSource,
	/private showFinalTranscript[\s\S]*this\.pushTranscriptLine\(text\)[\s\S]*requestAnimationFrame[\s\S]*is-visible/
);
assert.match(voicePanelSource, /private pushTranscriptLine[\s\S]*this\.clearPartialTranscript\(\)/);
const transcriptMountRegion = sourceRegion(
	voicePanelSource,
	"this.overlayTranscriptEl = dock.createDiv({",
	"const controls = dock.createDiv({"
);
assert.doesNotMatch(transcriptMountRegion, /createEl\("textarea"/);
assert.doesNotMatch(voicePanelSource, /showTranscriptEditor|最终文本可编辑/);
assert.match(
	voicePanelSource,
	/handleVoiceTranscript[\s\S]*activateWake[\s\S]*commitUser\(command,\s*"voice"\)/
);
assert.match(
	voiceIoSource,
	/export function normalizeForSpeech[\s\S]*const spoken = normalizeForSpeech\(sentence\)/
);
assert.doesNotMatch(
	quyuanShellCss,
	/--tq-side-size|\.tq-body\.is-side-collapsed/
);
assert.match(
	quyuanShellCss,
	/\.tq-body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
);
assert.match(
	voicePanelSource,
	/setAttribute\("data-input-mode",\s*inputMode\)[\s\S]*renderVoiceModeBtn\(\)/
);
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
assert.match(voiceParticleSource, /PARTICLE_SAMPLE_STRIDE = 2/);
assert.match(voiceParticleSource, /index % PARTICLE_SAMPLE_STRIDE === 0/);
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
const activeInterval = Number(voiceParticleSource.match(/ACTIVE_FRAME_INTERVAL = (\d+)/)?.[1]);
const sleepInterval = Number(voiceParticleSource.match(/SLEEP_FRAME_INTERVAL = (\d+)/)?.[1]);
assert.ok(activeInterval > 0 && activeInterval <= 17);
assert.ok(sleepInterval >= activeInterval && sleepInterval <= 34);
const dprLimit = Number(voiceParticleSource.match(/Math\.min\(this\.activeWindow\.devicePixelRatio \|\| 1,\s*([\d.]+)\)/)?.[1]);
assert.ok(dprLimit > 0 && dprLimit <= 1);
assert.match(voiceParticleSource, /"sleep" \| "idle" \| "listen" \| "reco" \| "think" \| "speak"/);
assert.match(particleColorRegion, /!this\.awake[\s\S]*"listen"[\s\S]*"reco"[\s\S]*"think"[\s\S]*"speak"/);
assert.doesNotMatch(voiceParticleSource, /drawEyes|eyeWidth/);
assert.match(particleRenderRegion, /requestAnimationFrame/);
assert.match(particleDestroyRegion, /this\.disposed = true[\s\S]*cancelAnimationFrame[\s\S]*resizeObserver\.disconnect[\s\S]*removeEventListener/);
assert.doesNotMatch(voiceParticleSource, /\.png|new Image\(|createElement\("img"\)/i);
assert.doesNotMatch(voiceParticleSource, /setInterval/);
// D-TLP-022：旧右栏与 FAB 已退役；字幕、只读查询和控制集中在中央舞台下方 Dock。
assert.match(
	quyuanShellCss,
	/\.tq-overlay-text[\s\S]*\.tq-overlay-reply[\s\S]*\.tq-transcript-editor[\s\S]*\.tq-readonly-query/
);
assert.match(
	quyuanShellCss,
	/\.tq-stage\s*\{[\s\S]*--tq-ball-size:\s*clamp\(500px,\s*min\(60cqi,\s*86cqh\),\s*820px\)/
);
assert.match(
	quyuanShellCss,
	/\.tq-emotion-ball-host\s*\{[\s\S]*min\(var\(--tq-ball-size\),\s*100cqi,\s*100cqh\)[\s\S]*max-width:\s*100%;[\s\S]*max-height:\s*100%;[\s\S]*aspect-ratio:\s*1/
);
assert.match(quyuanShellCss, /\.tq-emotion-stage\s*\{[\s\S]*container:\s*tq-emotion \/ size/);
assert.doesNotMatch(quyuanShellCss, /filter:\s*drop-shadow\(0 22px 48px/);
assert.match(quyuanShellCss, /\.tq-emotion-ball-host::before\s*\{[\s\S]*box-shadow:/);
assert.doesNotMatch(
	quyuanShellCss,
	/\.tq-emotion-ball,\s*\.tq-emotion-ball__engine/
);
assert.match(
	quyuanShellCss,
	/\.tq-voice-dock\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/
);
assert.match(
	quyuanShellCss,
	/@container tq-stage \(max-width: 1200px\)[\s\S]*\.tq-emotion-ball-host[\s\S]*--tq-ball-size:\s*clamp\(380px,\s*min\(58cqi,\s*82cqh\),\s*560px\)/
);
assert.match(
	quyuanShellCss,
	/@container tq-stage \(max-width: 800px\)[\s\S]*--tq-ball-size:\s*clamp\(300px,\s*min\(46cqi,\s*78cqh\),\s*340px\)/
);
assert.match(
	quyuanShellCss,
	/@container tq-stage \(max-width: 520px\)[\s\S]*--tq-ball-size:\s*clamp\(190px,\s*min\(44cqi,\s*74cqh\),\s*230px\)/
);
assert.match(
	quyuanShellCss,
	/@container tq-stage \(max-width: 520px\) and \(max-height: 520px\)[\s\S]*--tq-ball-size:\s*clamp\(180px,\s*min\(44cqi,\s*76cqh\),\s*230px\)/
);
assert.match(quyuanShellCss, /\.tq-voice \.tq-pixel-head-scene[\s\S]*opacity:\s*0\.1;/);
assert.doesNotMatch(quyuanShellCss, /\.tq-voice \.tq-bg/);
assert.doesNotMatch(
	voicePanelSource,
	/QuyuanBackgroundField|QuyuanBackgroundType|toggleBackground|renderBgBtn|cls:\s*"tq-bg"/
);
assert.match(voicePanelSource, /sketch:\s*false/);
assert.doesNotMatch(voicePanelSource, /sketch:\s*key\.includes/);
assert.match(emotionBallViewSource, /color:\s*"#FFFFFF"[\s\S]*eyeColor:\s*"#1A1A1A"/);
assert.match(quyuanShellCss, /--tq-ball-surface:\s*#ffffff/);
assert.match(
	quyuanShellCss,
	/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.tq-emotion-ball-host[\s\S]*transition:\s*none !important/
);
assert.doesNotMatch(quyuanShellCss, /\.tq-fab(?:\b|[-_])/);
assert.match(
	quyuanShellCss,
	/theme-cosmos-dark[\s\S]*theme-animal-island[\s\S]*theme-system-classic[\s\S]*theme-data-stream[\s\S]*theme-soft-relief[\s\S]*theme-geometric-modern/
);
assert.match(
	quyuanShellCss,
	/\.talos-console \.app\s*\{[\s\S]*grid-template-columns:\s*72px minmax\(0,\s*1fr\) !important/
);
assert.match(
	quyuanShellCss,
	/\.talos-console \.sidebar\s*\{[\s\S]*width:\s*72px/
);
assert.doesNotMatch(
	quyuanShellCss,
	/:not\(\[data-talos-page="overview"\]\) \.app\s*\{/
);
assert.doesNotMatch(
	talosCss,
	/\[data-talos-page="overview"\] \.pagenav-card \.nav\s*\{[\s\S]*?flex-direction:\s*row/
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

// WP7 Task 14：确定性合成验收必须直接组合现有核心，fixture 只提供协议与恢复证据。
const wp7E2eSource = readFileSync("tests/wp7-e2e.test.ts", "utf8");
for (const sharedCore of [
	"createBuiltinActionRegistry",
	"TalosTaskRunner",
	"TalosAskService",
	"ProviderFacade",
	"VaultRetriever",
	"proposeAnswerWriteback",
	"VoiceSessionStore",
]) {
	assert.match(wp7E2eSource, new RegExp(`\\b${sharedCore}\\b`));
}
assert.doesNotMatch(wp7E2eSource, /\bfetch\s*\(|\brequestUrl\s*\(|https?:\/\//);
const wp7FixtureRegistry = JSON.parse(
	readFileSync(
		"fixtures/wp7-vault/TALOS中枢/适配器/runtime-command-registry.json",
		"utf8"
	)
);
assert.equal(wp7FixtureRegistry.commands.length, 13);
assert.equal(
	wp7FixtureRegistry.commands.some(
		(command) =>
			command.id === "talos-ask" &&
			command.request_path === ".talos/command-requests/talos-ask.json"
	),
	true
);
assert.equal(
	[
		"fixtures/wp7-vault/.env.fixture",
		"fixtures/wp7-vault/.talos/private/mock-provider.json",
		"fixtures/wp7-vault/.talos/command-requests/talos-ask.json",
	].every((path) => existsSync(path)),
	true
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

// ============================================================
// 屈原语音层 · VAD 轮次状态机沙盘
//   构造 8ms/帧的帧序列（16k、128 样本），断言「什么时候定案、定案几次、
//   合并后多长」。只驱动状态机，不碰 AudioWorklet / 麦克风。
// ============================================================
const VAD_FRAME_SAMPLES = 128;
const VAD_FRAME_MS = 8;
const VOICE_LEVEL = 0.08; // > START_RMS(0.03) 且 > MIN_PEAK_RMS(0.045)
const QUIET_LEVEL = 0.002; // < KEEP_RMS(0.015)

function vadSandbox() {
	const commits = [];
	const states = [];
	const machine = new VadTurnMachine(
		{
			onState: (state) => states.push(state),
			onCommit: (frames, peak, durationMs) => commits.push({ frames, peak, durationMs }),
		},
		16000
	);
	const feed = (ms, level) => {
		const count = Math.round(ms / VAD_FRAME_MS);
		for (let i = 0; i < count; i++) {
			machine.push({
				frame: new Float32Array(VAD_FRAME_SAMPLES).fill(level),
				rms: level,
				frameMs: VAD_FRAME_MS,
				startVoiced: level > 0.03,
				keepVoiced: level >= 0.015,
			});
		}
	};
	return { machine, commits, states, feed };
}

// 1) 中途停顿 600ms：软结束后在可重开窗口内续说 → 只定案一次，两截拼成一句
{
	const { commits, feed } = vadSandbox();
	feed(600, VOICE_LEVEL);
	feed(600, QUIET_LEVEL);
	feed(800, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 1, "中途停顿 600ms 不得切成两句");
	// 语音净时长 1400ms + 尾部保留 + 续说前导缓冲，允许区间断言
	assert.ok(
		commits[0].durationMs > 1400 && commits[0].durationMs < 1800,
		`合并后总时长异常：${commits[0].durationMs}`
	);
}

// 2) 停顿超过「静音判定 + 可重开窗口」→ 两次独立定案
{
	const { commits, feed } = vadSandbox();
	feed(600, VOICE_LEVEL);
	feed(1400, QUIET_LEVEL); // > SILENCE_MS(550) + REOPEN_MS(700)
	feed(800, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 2, "长停顿应切成两句");
}

// 3) 连续短促语气（250ms + 200ms 停 + 250ms）→ 合并为一次定案，不再被丢弃
{
	const { commits, feed } = vadSandbox();
	feed(250, VOICE_LEVEL);
	feed(200, QUIET_LEVEL);
	feed(250, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 1, "短促语气应合并为一句");
}

// 3b) 两段都短且间隔跨过重开窗口 → 走短段合并窗口，仍只定案一次
{
	const { commits, feed } = vadSandbox();
	feed(250, VOICE_LEVEL);
	feed(1400, QUIET_LEVEL);
	feed(250, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 1, "短段合并窗口内的第二段应接回前一段");
}

// 4) 孤立短噪音：重开窗口 + 合并窗口都过期 → 按噪音丢弃
{
	const { commits, feed } = vadSandbox();
	feed(250, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 0, "孤立短段应按噪音丢弃");
}

// 5) 软结束期间 agent 转入忙碌 → 立即强制定案，不得再重开追加
{
	const { machine, commits, feed } = vadSandbox();
	feed(600, VOICE_LEVEL);
	feed(600, QUIET_LEVEL);
	assert.equal(commits.length, 0, "软结束阶段还不该定案");
	machine.onBusy();
	assert.equal(commits.length, 1, "转入忙碌必须立即定案");
	const firstDuration = commits[0].durationMs;
	assert.ok(firstDuration > 550 && firstDuration < 900, `首段时长异常：${firstDuration}`);
	assert.equal(machine.getPhase(), "idle");
}

// 6) 收音途中转入忙碌 → 半句丢弃，绝不送进 agent
{
	const { machine, commits, feed } = vadSandbox();
	feed(300, VOICE_LEVEL);
	machine.onBusy();
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 0, "忙碌打断的半句不得定案");
}

// 7) 打断句（朗读中喊「停」）走放宽阈值 → 短指令也能被收下
{
	const { machine, commits, feed } = vadSandbox();
	machine.beginFromBarge([], VOICE_LEVEL);
	feed(300, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 1, "打断短指令必须被收下");
}

// 7b) 屈原刚说完的短答窗口内，单个短促指令（「好」「继续」）同样收得下
{
	const { machine, commits, feed } = vadSandbox();
	machine.openShortWindow();
	feed(300, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 1, "短答窗口内的短指令必须被收下");
}

// 7c) 短答窗口过期后回到严格门槛：待机噪音不得白烧一次转写
{
	const { machine, commits, feed } = vadSandbox();
	machine.openShortWindow(200);
	feed(400, QUIET_LEVEL); // 窗口在静默中过期
	feed(300, VOICE_LEVEL);
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 0, "短答窗口过期后应回到严格门槛");
}

// 7d) 轮次序号：续说仍是同一轮（中途结果可继续用），新一轮才递增
{
	const { machine, feed } = vadSandbox();
	feed(600, VOICE_LEVEL);
	assert.equal(machine.peekCaptured()?.turnId, 1, "第一轮序号应为 1");
	feed(600, QUIET_LEVEL); // 软结束但未定案
	assert.ok(machine.peekCaptured(), "软结束期间仍可取到本轮音频（供流式转写）");
	feed(800, VOICE_LEVEL); // 续说接回
	assert.equal(machine.peekCaptured()?.turnId, 1, "续说不得换轮次号");
	feed(2000, QUIET_LEVEL); // 定案
	assert.equal(machine.peekCaptured(), null, "定案后不应再有可取音频");
	feed(600, VOICE_LEVEL);
	assert.equal(machine.peekCaptured()?.turnId, 2, "新一轮序号必须递增");
}

// 8) reset 后不得留下任何待定轮次
{
	const { machine, commits, feed } = vadSandbox();
	feed(600, VOICE_LEVEL);
	feed(600, QUIET_LEVEL);
	machine.reset();
	feed(2000, QUIET_LEVEL);
	assert.equal(commits.length, 0, "reset 必须清空软结束与短段缓冲");
	assert.equal(machine.getPhase(), "idle");
}

console.log("Quyuan v2 self-test: passed");
