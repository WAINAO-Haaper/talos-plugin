import type { SuperbrainEntry, SuperbrainToolId, SuperbrainWorkflowSlug } from "../module-commands/superbrain-catalog";

export const SUPERBRAIN_PAGE_IDS = [
	"C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C11", "C12", "C13", "C14", "C15",
	"M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10",
] as const;

export type SuperbrainPageId = typeof SUPERBRAIN_PAGE_IDS[number];
export type SuperbrainField = {
	readonly key: string;
	readonly label: string;
	readonly hint: string;
	readonly kind: "text" | "textarea" | "choice";
	readonly choices?: readonly string[];
};

export interface SuperbrainPageSpec {
	readonly id: SuperbrainPageId;
	readonly mode: "workflow" | "mechanism";
	readonly steps: readonly { readonly icon: string; readonly label: string }[];
	readonly fields?: readonly SuperbrainField[];
	readonly sourceRoots?: readonly string[];
	readonly tools?: readonly SuperbrainToolId[];
	readonly extraAction?: "preference-review" | "settings";
}

const step = (icon: string, label: string) => ({ icon, label });
const field = (key: string, label: string, hint: string, kind: SuperbrainField["kind"] = "text", choices?: readonly string[]): SuperbrainField => ({ key, label, hint, kind, choices });

/** Fixed UI affordances. Vault catalog text never names executable actions. */
export const SUPERBRAIN_PAGE_SPECS: Readonly<Record<SuperbrainPageId, SuperbrainPageSpec>> = {
	C01: { id: "C01", mode: "workflow", steps: [step("list-checks", "核对任务"), step("sun", "确定焦点"), step("check", "写入完成条件")], fields: [field("focus", "今日目标", "本次最重要的结果")], tools: ["inventory"] },
	C02: { id: "C02", mode: "workflow", steps: [step("files", "选原件"), step("git-compare", "核对新旧"), step("folder-input", "整理入库")], sourceRoots: ["00-收件箱"], fields: [field("intake", "整理要求", "需要保留的来源和待核问题", "textarea")], tools: ["inventory", "members", "index"] },
	C03: { id: "C03", mode: "workflow", steps: [step("search", "查候选"), step("file-search", "读原文"), step("git-compare", "核对冲突")], fields: [field("question", "检索问题", "希望从资料库查清的问题")], tools: ["search", "index"] },
	C04: { id: "C04", mode: "workflow", steps: [step("file-text", "回看工作"), step("brain", "提取记忆"), step("list-checks", "写入下一步")], fields: [field("memory", "需要接续的事", "事实、决定或未完成事项", "textarea")] },
	C05: { id: "C05", mode: "workflow", steps: [step("scan-eye", "看观察"), step("git-compare", "查反证"), step("user-check", "审议候选")], fields: [field("candidate", "审议重点", "需要辨析的偏好或规则候选", "textarea")], extraAction: "preference-review" },
	C06: { id: "C06", mode: "workflow", steps: [step("history", "找重复"), step("lightbulb", "提候选"), step("check-check", "留待回验")], fields: [field("pattern", "观察范围", "哪类重复工作或错误值得核对", "textarea")] },
	C07: { id: "C07", mode: "workflow", steps: [step("stethoscope", "检查"), step("wrench", "修复"), step("check-check", "复查")], fields: [field("scope", "检查范围", "全库或指定问题")], tools: ["health", "members", "index"] },
	C08: { id: "C08", mode: "workflow", steps: [step("files", "选素材"), step("pen-line", "形成草稿"), step("link", "核对来源")], sourceRoots: ["03-素材", "02-洞察"], fields: [field("deliverable", "作品目标", "希望形成的作品和读者") ] },
	C09: { id: "C09", mode: "workflow", steps: [step("file-check", "查成熟度"), step("send", "准备出口"), step("circle-check", "回填状态")], sourceRoots: ["输出"], fields: [field("status", "本次目标", "选择要处理的状态", "choice", ["准备交付", "核对已发布结果", "整理反馈"]) ] },
	C10: { id: "C10", mode: "workflow", steps: [step("inbox", "批量收件"), step("workflow", "深处理"), step("refresh-cw", "更新记忆")], fields: [field("scope", "循环范围", "选择这轮重点", "choice", ["全部待处理", "指定项目", "只检查未完成项"])], tools: ["inventory", "health"] },
	C11: { id: "C11", mode: "workflow", steps: [step("calendar-days", "回看一周"), step("stethoscope", "检查健康"), step("archive", "核对恢复点")], fields: [field("week", "复盘重点", "本周需要特别核对的事")], tools: ["health", "snapshot"] },
	C12: { id: "C12", mode: "workflow", steps: [step("fingerprint", "查主体"), step("link", "查来源"), step("badge-check", "核对署名")], sourceRoots: ["输出"], fields: [field("author", "署名要求", "本次要核对的主体或许可") ] },
	C13: { id: "C13", mode: "workflow", steps: [step("chart-bar", "取指标"), step("calendar", "核对周期"), step("trending-up", "看趋势")], fields: [field("platform", "平台", "未接入平台时可说明手工记录"), field("period", "统计周期", "例如 2026-09") ] },
	C14: { id: "C14", mode: "workflow", steps: [step("receipt-text", "选事件"), step("link", "关联来源"), step("notebook-text", "记入台账")], fields: [field("eventType", "事件类型", "选择本次记录", "choice", ["交付", "收入", "推广", "反馈", "更正"]), field("event", "事件内容", "时间、金额或反馈原文及来源", "textarea") ] },
	C15: { id: "C15", mode: "workflow", steps: [step("folder-tree", "选子树"), step("scan-eye", "预检暴露"), step("package-open", "库外导出")], fields: [field("purpose", "导出用途", "需要保留或排除的内容")], tools: ["export"] },
	M01: { id: "M01", mode: "mechanism", steps: [step("fingerprint", "身份"), step("bot", "角色"), step("target", "焦点")] },
	M02: { id: "M02", mode: "mechanism", steps: [step("link", "来源"), step("calendar", "时序"), step("check-check", "验证")], tools: ["health"] },
	M03: { id: "M03", mode: "mechanism", steps: [step("file-text", "人写职责"), step("folders", "机器成员"), step("check-check", "核对目录")], tools: ["members"] },
	M04: { id: "M04", mode: "mechanism", steps: [step("scan-eye", "观察"), step("sparkles", "候选"), step("user-check", "采用或暂缓")], extraAction: "preference-review" },
	M05: { id: "M05", mode: "mechanism", steps: [step("list-checks", "任务"), step("milestone", "决定"), step("target", "下一步")] },
	M06: { id: "M06", mode: "mechanism", steps: [step("lock-keyhole", "宿主权限"), step("sliders-horizontal", "操作策略"), step("shield-check", "本库范围")], extraAction: "settings" },
	M07: { id: "M07", mode: "mechanism", steps: [step("toggle-left", "启用配置"), step("clock-3", "预检任务"), step("receipt-text", "核对收据")] },
	M08: { id: "M08", mode: "mechanism", steps: [step("stethoscope", "结构检查"), step("flask-conical", "夹具自测"), step("check-check", "对照结果")], tools: ["health", "selftest"] },
	M09: { id: "M09", mode: "mechanism", steps: [step("archive", "创建快照"), step("badge-check", "校验快照"), step("archive-restore", "隔离恢复")], tools: ["snapshot"] },
	M10: { id: "M10", mode: "mechanism", steps: [step("panels-top-left", "Obsidian"), step("terminal", "本机智能体"), step("cloud", "模型 API")], tools: ["inventory"], extraAction: "settings" },
};

export function superbrainPageSpec(entry: SuperbrainEntry): SuperbrainPageSpec {
	if (!Object.prototype.hasOwnProperty.call(SUPERBRAIN_PAGE_SPECS, entry.id)) throw new Error(`没有 ${entry.id} 的页面定义`);
	const spec = SUPERBRAIN_PAGE_SPECS[entry.id as SuperbrainPageId];
	if ((spec.mode === "workflow") !== Boolean(entry.slug)) throw new Error(`${entry.id} 页面类型与目录不匹配`);
	for (const tool of spec.tools ?? []) if (!entry.tools.includes(tool)) throw new Error(`${entry.id} 页面使用了未登记的工具 ${tool}`);
	return spec;
}

export function buildSuperbrainInstruction(
	spec: SuperbrainPageSpec,
	values: Readonly<Record<string, string>>,
	selectedFiles: readonly string[],
	extra: string,
): string {
	const lines: string[] = [];
	for (const item of spec.fields ?? []) {
		const value = values[item.key]?.trim();
		if (value) lines.push(`${item.label}：${value.slice(0, 4_000)}`);
	}
	if (selectedFiles.length) lines.push(`本轮选定资料：\n${selectedFiles.slice(0, 24).map(path => `- ${path}`).join("\n")}`);
	if (extra.trim()) lines.push(`补充说明：${extra.trim().slice(0, 4_000)}`);
	return lines.join("\n\n").slice(0, 19_000);
}

export function workflowSlugForPage(entry: SuperbrainEntry): SuperbrainWorkflowSlug {
	if (!entry.slug || superbrainPageSpec(entry).mode !== "workflow") throw new Error(`${entry.id} 不是工作流`);
	return entry.slug;
}
