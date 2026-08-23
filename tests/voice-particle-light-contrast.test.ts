import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const src = readFileSync(`${projectRoot}src/quyuan/voice-particle-field.ts`, "utf8");

// 2026-08-23 实机反馈：浅色主题下粒子色彩对比度加强。
// 粒子画布颜色由 JS 读取 --tq-particle-* 计算，CSS 变量翻转只给输入，
// 对比度关键在 JS 三处：加深系数、电青/电紫常量、透明度衰减。
// 深色路径必须保持原值不变。
describe("voice particle light-surface contrast (C-4)", () => {
	it("deepens the palette factor on light surfaces (0.52) and keeps dark at 1", () => {
		expect(src).toContain("const factor = this.lightSurface ? 0.52 : 1;");
	});

	it("uses deep electric cyan/violet constants on light surfaces", () => {
		expect(src).toContain(
			"const electricCyan: Rgb = this.lightSurface ? { r: 2, g: 132, b: 199 } : { r: 72, g: 224, b: 255 };"
		);
		expect(src).toContain(
			"const electricViolet: Rgb = this.lightSurface ? { r: 124, g: 58, b: 237 } : { r: 174, g: 104, b: 255 };"
		);
	});

	it("removes the light-surface alpha attenuation (was 0.88/0.9)", () => {
		expect(src).not.toContain("this.lightSurface ? 0.88 : 1");
		expect(src).not.toContain("this.lightSurface ? 0.9 : 1");
	});
});
