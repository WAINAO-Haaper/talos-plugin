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
});
