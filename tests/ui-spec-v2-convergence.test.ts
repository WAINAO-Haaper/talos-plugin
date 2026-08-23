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
		// （WP7 后加入组件）统一为 2px 粗线 + 14px 正文档流式字号
		expect(css).toContain(
			".talos-console.theme-geometric-modern .talos-page-tabs {"
		);
		expect(css).toContain(
			".talos-console.theme-geometric-modern .talos-page-tab {"
		);
		expect(css).toContain("min-height: 40px");
		expect(css).toContain("clamp(14px, 0.98cqw, 17px)");
	});

	it("strengthens the settings header and side nav with the Bauhaus signature", () => {
		// 2026-08-23 仓库所有者指令：设置页顶部模块与左侧导航模块统一
		// 2px 墨线 + 直角 + 6px 硬投影，选中项 2px 墨线 + 4px 内嵌强调条
		expect(css).toContain(
			".talos-console.theme-geometric-modern .talos-inline-settings__header"
		);
		expect(css).toContain("box-shadow: 6px 6px 0 var(--gm-ink)");
		expect(css).toContain(
			".talos-console.theme-geometric-modern .talos-settings--console .talos-settab.is-active"
		);
		expect(css).toContain("box-shadow: inset 4px 0 0 var(--ac)");
	});

	it("gives secondary page tabs a hard-contrast hover inversion", () => {
		// 2026-08-23 实机反馈：页签悬停无变色——基规则 12% 淡色在米色底
		// 不可见；反色为墨底纸字（激活项不反色），并补 transition
		expect(css).toContain(
			".talos-console.theme-geometric-modern .talos-page-tab:hover:not(.is-active)"
		);
		expect(css).toContain("background-color: var(--gm-ink)");
		expect(css).toContain("color: var(--gm-paper)");
	});

	it("gives the settings side nav the same hard-contrast hover inversion", () => {
		// 2026-08-23 实机反馈：设置页左侧导航非选中项悬停无变色——
		// 基规则 7% 蓝淡色不可见；与页签一致反色为墨底纸字，
		// 方块指示点同步反色为纸色（激活项保持墨线+强调条不反色）
		expect(css).toContain(
			".talos-console.theme-geometric-modern .talos-settings--console .talos-settab:hover:not(.is-active)"
		);
		expect(css).toContain(
			".talos-console.theme-geometric-modern .talos-settings--console .talos-settab:hover:not(.is-active)::before"
		);
	});
});
