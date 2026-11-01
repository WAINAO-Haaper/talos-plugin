// Lens「系统」与「设置」：顶部维护概况条（lens-maintenance-summary），下面按页签展示
// 健康、审批、能力与全库。审批只做浏览与定位，处理仍在原文件里进行（不新增写库入口）。
import { el, heading, icon, panel, section, type LensChild } from "./lens-dom";
import { num, time } from "./lens-format";
import { distribution, metricStrip, signalDeck } from "./lens-library";
import type { LensContext } from "./lens-pages";

function maintenanceSummary(ctx: LensContext): HTMLElement {
	const { doc } = ctx;
	const d = ctx.data.collected;
	const health = d.healthDigest.metrics.find((m) => m.label === "健康分");
	const score = d.setup?.healthLogPath === "ok" ? health?.value ?? "—" : "—";
	const approvalsReady = d.setup?.pendingApprovalsPath === "ok";
	const errorsReady = !!ctx.app.vault.getAbstractFileByPath(ctx.paths.errorPatternsFile);
	return el(doc, "div", { class: "lens-maintenance-summary", "aria-label": "维护概况" },
		el(doc, "span", {}, icon(doc, "activity"), `健康分 ${score}`),
		el(doc, "span", {}, icon(doc, "scan-line"), errorsReady ? `错误记录预览 ${d.healthDigest.errors.length} 条` : "错误记录未配置"),
		el(doc, "span", {}, icon(doc, "badge-check"), approvalsReady ? `待审批 ${d.approvals.length} 项` : "审批来源未就绪"),
		el(doc, "small", {}, `数据采集 ${time(ctx.data.capturedAt)} · ${d.setup?.healthLogPath === "ok" ? health?.sub ?? "健康日志无有效记录" : d.setup?.healthLogPath === "format" ? "健康日志格式不识别" : "健康日志未配置或状态未知"}`));
}

export function renderSystem(ctx: LensContext): LensChild[] {
	const { doc } = ctx;
	const d = ctx.data.collected;
	const summary = maintenanceSummary(ctx);
	if (ctx.tab === "approvals") {
		return [summary,
			heading(doc, "审批", "B/C 类变更与偏好候选；点开定位原文件处理", "系统"),
			signalDeck(ctx, "approvals", "待审批变更", d.approvals, "待审批"),
			signalDeck(ctx, "candidates", "偏好候选", d.candidates, "候选")];
	}
	if (ctx.tab === "capability") {
		const found = d.capGroups.reduce((n, g) => n + g.items.filter((i) => i.origin === "discovered").length, 0);
		const fallback = d.capGroups.reduce((n, g) => n + g.items.filter((i) => i.origin === "fallback").length, 0);
		const uncertain = d.capGroups.some((g) => g.sourceStatus !== "ready");
		return [summary,
			heading(doc, "能力", `实际发现 ${found} 项 · 推荐 ${fallback} 项${uncertain ? " · 部分来源未找到或无法读取" : ""}`, "系统"),
			...d.capGroups.map((group) => section(doc, `${group.label} · ${group.items.length}`, [
				el(doc, "div", { class: "ta-project-grid" }, ...group.items.map((item) => {
					const invoke = el(doc, "button", { type: "button", class: "ta-button", "aria-label": `填入对话：${item.invoke}` }, "填入对话");
					invoke.addEventListener("click", () => ctx.invokeCommand(item.invoke));
					const source = item.path ? el(doc, "button", { type: "button", class: "ta-button", "aria-label": `打开源文件：${item.name}` }, "查看来源") : null;
					if (source && item.path) source.addEventListener("click", () => ctx.openDrawer(item.path!));
					const card = el(doc, "div", { class: "ta-project-card" },
						el(doc, "div", { class: "ta-card-title" }, el(doc, "h3", {}, item.name)),
						el(doc, "p", {}, item.desc || "未提供说明"),
						el(doc, "footer", {}, el(doc, "span", {}, item.invoke), el(doc, "span", {}, item.origin === "fallback" ? "推荐，未确认安装" : item.origin === "discovered" ? "实际发现" : "来源未知")),
						el(doc, "div", { class: "ta-head-actions" }, invoke, source));
					return card;
				})),
			]))];
	}
	if (ctx.tab === "vault") {
		return [summary,
			heading(doc, "全库", `共 ${num(d.total)} 篇笔记`, "系统"),
			panel(doc, "内容目录", distribution(ctx, d.dist.map((x) => ({ name: x.name, count: x.count, onClick: () => ctx.openDrawer(x.readme) })), "知识笔记共 {total} 篇")),
			panel(doc, "全部模块", distribution(ctx, d.modules.map((m) => ({ name: m.name, count: m.count, onClick: () => ctx.openDrawer(m.readme) })), "含系统与配置共 {total} 篇"))];
	}
	return [summary,
		heading(doc, "系统健康", "健康分、错误模式与闭环状态", "系统"),
		metricStrip(ctx, d.healthDigest.metrics.filter((m) => m.label === "健康分" || m.label === "断链").map((m) => d.setup?.healthLogPath === "ok" ? m : { ...m, value: "—", aux: undefined, sub: d.setup?.healthLogPath === "format" ? "健康日志格式不识别" : "健康日志未配置或状态未知" })),
		ctx.app.vault.getAbstractFileByPath(ctx.paths.errorPatternsFile) ? signalDeck(ctx, "errors", "错误模式（最多 6 条预览）", d.healthDigest.errors, "错误") : el(doc, "p", {}, "错误模式来源未配置。"),
		ctx.app.vault.getAbstractFileByPath(ctx.paths.loopHealthFile) ? signalDeck(ctx, "loops", "闭环状态（最多 4 条预览）", d.healthDigest.loopStatus, "闭环") : el(doc, "p", {}, "循环状态来源未配置。")];
}

export function renderPreferences(ctx: LensContext): LensChild[] {
	const { doc } = ctx;
	const host = el(doc, "div", { class: "talos-lens-native talos-lens-settings" });
	ctx.renderSettings(host);
	return [heading(doc, "设置", "界面语言、外观、库与数据、对话模型与语音"), host];
}
