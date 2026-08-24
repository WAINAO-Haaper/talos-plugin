import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(`${projectRoot}styles.talos.css`, "utf8");

// D-TLP-012 延续 · C-4：v1 规范块之后残余离梯字号逐页收敛契约。
// 钉死四档阶梯归位、流式 clamp 同步、作用域限 theme-geometric-modern，
// 以及备案不动项（hero/展示数字/图表微标/装饰元素）不被本块波及。
describe("UI spec v2 convergence (D-TLP-012 / C-4)", () => {
	it("places the v2 block after the v1 fluid tiers in the same theme scope", () => {
		const v1 = css.indexOf("UI 规范 v1");
		const v2 = css.indexOf("UI 规范 v2");
		expect(v1).toBeGreaterThan(-1);
		expect(v2).toBeGreaterThan(v1);
		expect(css.slice(v2)).toContain("theme-geometric-modern");
	});

	it("converges leftover off-ladder sizes into the four tiers", () => {
		const v2 = css.slice(css.indexOf("UI 规范 v2"));
		// 标题档 15px：原 17px strong / 16px daily-win / 16px 空态
		for (const sel of [
			".overview-detail-title strong",
			".overview-secondary-copy b",
			".daily-win strong",
			".jv-agent .jv-log .empty",
		]) {
			expect(v2).toContain(sel);
		}
		// 正文 14px：原 13/13.5px
		for (const sel of [
			".overview-progress-head b",
			".pagenav-card .command span",
			".jv-perm-title",
		]) {
			expect(v2).toContain(sel);
		}
		// 辅助 12px：原 12.5/11.5px
		for (const sel of [
			".overview-detail-body p",
			".overview-secondary-row b",
			".day b",
			".jv-tool-input",
		]) {
			expect(v2).toContain(sel);
		}
		// 元信息 11px：原 10.5/10/11.5/9.5px
		for (const sel of [
			".date",
			".day span",
			".overview-primary-card small",
			".jv-perm-reason",
			".command .cap-src",
		]) {
			expect(v2).toContain(sel);
		}
	});

	it("mirrors every converged tier with the matching cqw fluid clamp", () => {
		const v2 = css.slice(css.indexOf("UI 规范 v2"));
		expect(v2).toContain("clamp(15px, 1.05cqw, 19px)");
		expect(v2).toContain("clamp(14px, 0.98cqw, 17px)");
		expect(v2).toContain("clamp(12px, 0.85cqw, 14px)");
		expect(v2).toContain("clamp(11px, 0.78cqw, 13px)");
	});

	it("keeps documented exclusions out of the v2 block", () => {
		const v2 = css.slice(css.indexOf("UI 规范 v2"));
		// hero 排版、展示型数字、图表微标、装饰描边不在收敛范围
		expect(v2).not.toContain(".talos-console.theme-geometric-modern h1");
		expect(v2).not.toContain(" .sub");
		expect(v2).not.toContain(".signal-pill b");
		expect(v2).not.toContain(".spark-lab");
		expect(v2).not.toContain(".logo-ping");
		expect(v2).not.toContain(".pixel-head");
	});

	it("hides the console view header for top-aligned content", () => {
		// 2026-08-23 仓库所有者指令：去除「TALOS 控制台」标题行、界面顶对齐
		expect(css).toContain(
			'.workspace-leaf-content[data-type="talos-console-view"] .view-header'
		);
		expect(css).toContain("display: none");
	});

	it("cleans up the stray divider line above the console content", () => {
		// 2026-08-23 仓库所有者指令：标题栏隐藏后页签行与内容间的原生分割线清除
		expect(css).toContain(
			'.workspace-tabs:has(.workspace-leaf-content[data-type="talos-console-view"])'
		);
		expect(css).toContain("> .workspace-tab-header-container");
	});

	it("detaches the floating active-tab outline in the console tab group", () => {
		// 2026-08-23 实机反馈：基准线移除后 mod-root 激活页签描边与圆弧
		// 伪元素悬空成超长红线；同作用域摘掉 box-shadow，左栏不受影响
		expect(css).toContain(".workspace-tab-header.is-active {");
		expect(css).toContain(".workspace-tab-header.is-active::before");
		expect(css).toContain(".workspace-tab-header.is-active::after");
	});

	it("brings the secondary page tabs into the thick-border ladder", () => {
		// 2026-08-23 仓库所有者指令：工作流/知识/健康三页顶部二级页签
		// （WP7 后加入组件）统一为 2px 粗线 + 14px 正文档流式字号。
		// 根因修正：实机 visualTheme 未写入（默认 aurora），几何现代
		// 作用域不命中，故规范块改为 .talos-console[data-talos-theme]
		// 全主题作用域（比 layout-overrides 基规则高一级特异性）。
		expect(css).toContain(
			".talos-console[data-talos-theme] .talos-page-tabs {"
		);
		expect(css).toContain(
			".talos-console[data-talos-theme] .talos-page-tab {"
		);
		expect(css).toContain("min-height: 40px");
		expect(css).toContain("clamp(14px, 0.98cqw, 17px)");
	});

	it("strengthens the settings header and side nav with the spec signature", () => {
		// 2026-08-23 仓库所有者指令：设置页顶部模块与左侧导航模块统一
		// 2px 墨线 + 直角 + 6px 硬投影，选中项 2px 墨线 + 4px 内嵌强调条。
		// 根因修正：同上当主题作用域修正（--gm-* 经 var() 回退）。
		expect(css).toContain(
			".talos-console[data-talos-theme] .talos-inline-settings__header"
		);
		expect(css).toContain(
			"box-shadow: 6px 6px 0 var(--gm-ink, var(--text-normal))"
		);
		expect(css).toContain(
			".talos-console[data-talos-theme] .talos-settings--console .talos-settab.is-active"
		);
		expect(css).toContain(
			"box-shadow: inset 4px 0 0 var(--ac, var(--interactive-accent))"
		);
	});

	it("gives secondary page tabs a hard-contrast hover inversion", () => {
		// 2026-08-23 实机反馈：页签悬停无变色——基规则 12% 淡色在底面
		// 不可见；反色为墨底纸字（激活项不反色），并补 transition。
		// 根因修正①：实机主题为 geometric-modern 且默认回退为 aurora
		// 的说法被 CDP 实况证伪——真根因是 vault 主题毯式规则
		// （styles.talos.css:7632 body[data-talos-vault-theme] :is(button…)
		// 以 !important 压制全部按钮背景/文字色），特异性永远无法赢
		// !important，故本规则声明全部加 !important（同级比特异性，
		// 0,5,0 胜 0,1,2）。
		expect(css).toContain(
			".talos-console[data-talos-theme] .talos-page-tab:hover:not(.is-active)"
		);
		expect(css).toContain(
			"background-color: var(--gm-ink, var(--text-normal)) !important"
		);
		expect(css).toContain(
			"color: var(--gm-paper, var(--background-primary)) !important"
		);
	});

	it("gives the settings side nav the same hard-contrast hover inversion", () => {
		// 2026-08-23 实机反馈：设置页左侧导航非选中项悬停无变色——
		// 基规则 7% 蓝淡色不可见；与页签一致反色，方块指示点同步反色
		// （激活项保持墨线+强调条不反色）。根因修正：同上——声明加
		// !important 越过 vault 主题毯式按钮规则；选中项墨线同样
		// 需要 !important（毯式规则含 border-color !important）。
		expect(css).toContain(
			".talos-console[data-talos-theme] .talos-settings--console .talos-settab:hover:not(.is-active)"
		);
		expect(css).toContain(
			".talos-console[data-talos-theme] .talos-settings--console .talos-settab:hover:not(.is-active)::before"
		);
		expect(css).toContain(
			"border-color: var(--gm-ink, var(--text-normal)) !important"
		);
	});
});

// C-4 阶段 2（2026-08-23）：语音助手页（tq-* 语音面板）收敛契约。
// 审计发现：tq 交互元素全是 <button>，vault 主题毯式规则
// （styles.talos.css:7632，!important）同样压死其悬停反馈；
// 另有多处 9/10px 离梯字号。修复＝hover/active 设计色加 !important
// 恢复（D-TLP-018），9/10px 文本升至阶梯档（按钮 12px、元信息 11px）。
const qcss = readFileSync(`${projectRoot}styles.quyuan-shell.css`, "utf8");

describe("UI spec v2 convergence phase 2 · voice panel (C-4)", () => {
	it("restores tq button hover colors over the vault-theme blanket", () => {
		const hoverStart = qcss.indexOf(".tq-btn:hover:not(:disabled) {");
		expect(hoverStart).toBeGreaterThan(-1);
		const block = qcss.slice(hoverStart, hoverStart + 700);
		expect(block).toContain("!important");
		expect(block).toContain("var(--tq-btn-accent) 16%, var(--tq-panel-strong)) !important");
	});

	it("removes the retired side tabs and keeps direct controls theme-safe", () => {
		expect(qcss).not.toContain(".tq-side-tab");
		expect(qcss).not.toContain(".tq-side-composer");
		expect(qcss).toContain(".tq-control-btn {");
		expect(qcss).toContain(".tq-control-btn--danger {");
		expect(qcss).toContain(".tq-go-chat {");
	});

	it("lifts voice panel off-ladder font sizes into the ladder", () => {
		// 新 dock 的直接控制、状态与安全提示保持紧凑但可读。
		const blockWithSize = (sel: string, size: string) => {
			const re = new RegExp(
				sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*font-size: " + size
			);
			return re.test(qcss);
		};
		expect(blockWithSize(".tq-control-btn", "11px")).toBe(true);
		expect(blockWithSize(".tq-dock-live > small", "11px")).toBe(true);
		expect(blockWithSize(".tq-voice-safety", "10px")).toBe(true);
		expect(blockWithSize(".tq-readonly-query__copy > b", "11px")).toBe(true);
	});

	it("documents the console font:inherit flattening on embedded tq buttons", () => {
		// 审计发现（2026-08-23 探针实证）：styles.talos.css:77
		// `.talos-console button { font: inherit }`（0,1,1）以更高特异性把
		// 控制台内全部按钮字号拍平为继承值（实测 14px，正文档在梯），
		// tq 按钮的 0,1,0 字号规则在内嵌语境本就无效——它们只管辖独立
		// 屈原工作台视图。钉死此约束，防止后来者再改 tq 按钮字号
		// 却看不到效果。
		expect(css).toContain(
			".talos-console button, .talos-console input, .talos-console textarea { font: inherit; }"
		);
	});

	it("locks Emotion Ball geometry to the accepted responsive bands", () => {
		const blockHas = (sel: string, needle: string) => {
			const re = new RegExp(
				sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*" + needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			);
			return re.test(qcss);
		};
		// The mounted host carries both tq-emotion-ball-host and tq-emotion-ball.
		// A later 100% root rule expanded it to the full stage; selector separation
		// plus height-driven descendant bands keeps the runtime geometry deterministic.
		expect(blockHas(
			".tq-stage",
			"--tq-ball-size: clamp(500px, min(60cqi, 86cqh), 820px)"
		)).toBe(true);
		expect(qcss).toContain("@container tq-stage (max-width: 1200px)");
		expect(qcss).toContain("clamp(380px, min(58cqi, 82cqh), 560px)");
		expect(qcss).toContain("@container tq-stage (max-width: 800px)");
		expect(qcss).toContain("clamp(300px, min(46cqi, 78cqh), 340px)");
		expect(qcss).toContain("@container tq-stage (max-width: 520px)");
		expect(qcss).toContain("clamp(190px, min(44cqi, 74cqh), 230px)");
		expect(qcss).toContain("clamp(180px, min(44cqi, 76cqh), 230px)");
	});

	it("follows Obsidian light/dark theme for the voice page surface", () => {
		// 2026-08-23 实机反馈：语音页背景随主题——浅色白色系、深色保持
		// Aurora 锁定。浅色解锁块必须是 body.theme-light .tq-voice
		// （0,1,1）且全 !important，才能在同为 !important 的 Aurora 锁定块
		// （0,1,0）之上生效；文字/描边同步翻深保证白底可读。
		const blockHas = (sel: string, needle: string) => {
			const re = new RegExp(
				sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*" + needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			);
			return re.test(qcss);
		};
		expect(blockHas("body.theme-light .tq-voice", "--tq-surface: #ffffff !important")).toBe(true);
		expect(blockHas("body.theme-light .tq-voice", "--tq-text: #0f172a !important")).toBe(true);
		expect(blockHas("body.theme-light .tq-voice", "color-scheme: light !important")).toBe(true);
		// 深色锁定块必须仍在（深色现状不变）
		expect(blockHas(".tq-voice", "--tq-surface: #050810 !important")).toBe(true);
		// jarvis 左侧导航栏硬编码深黑 #070d17 须在浅色下翻白
		expect(
			blockHas('body.theme-light .talos-console[data-talos-page="jarvis"] .sidebar', "background: #ffffff")
		).toBe(true);
		// 新 dock、转写与静态降级都只消费同一组 tq 主题/模块变量。
		expect(blockHas(".tq-voice-dock", "var(--tq-surface)")).toBe(true);
		expect(blockHas(".tq-transcript-editor", "var(--tq-module-surface)")).toBe(true);
		expect(blockHas(".tq-emotion-ball__fallback", "var(--tq-text)")).toBe(true);
		expect(blockHas(
			"body.theme-light .talos-console.theme-geometric-modern .tq-voice",
			"--tq-surface: #f3eedf !important"
		)).toBe(true);
		expect(qcss).not.toContain("body.theme-light .tq-voice .tq-bg");
		expect(qcss).toContain("--tq-ball-surface: #ffffff");
		expect(qcss).toContain("background: var(--tq-ball-eye)");
	});
});
