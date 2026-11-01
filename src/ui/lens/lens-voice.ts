// Lens「屈原语音」：挂载插件现有的屈原语音面板（千问 Realtime 引擎、密钥只在插件可信侧、只读查询）。
// 外观按 Lens 的 quyuan-voice 构图重排（styles.lens-voice.css）；离开模块即卸载、释放麦克风。
import { el, type LensChild } from "./lens-dom";
import type { LensContext } from "./lens-pages";

export function renderVoice(ctx: LensContext): LensChild[] {
	const host = el(ctx.doc, "div", { class: "lens-quyuan-voice" });
	ctx.mountVoice(host);
	const harness = el(ctx.doc, "button", { type: "button", class: "talos-focusable" }, "打开 Harness");
	harness.addEventListener("click", () => ctx.openHarness());
	return [harness, host];
}
