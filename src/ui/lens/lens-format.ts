// Lens 的文案与格式规则（问候语、相对时间、状态名、阶段轨道），与 TALOS Lens 保持同一口径。

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function greeting(now = new Date()): { word: string; date: string } {
	const h = now.getHours();
	const word = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
	return { word, date: `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]}` };
}

export function num(value: number): string {
	return Number(value).toLocaleString("en-US");
}

export function bytes(n: number): string {
	return n >= 1048576 ? `${(n / 1048576).toFixed(2)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`;
}

export function time(value: number | string | null | undefined, short = false): string {
	if (value === null || value === undefined || value === "") return "来源未提供";
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return String(value);
	return short
		? d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
		: d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function ageInDays(value: number | string | null | undefined, now = Date.now()): number | null {
	if (value === null || value === undefined || value === "") return null;
	const at = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
	return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 86400000)) : null;
}

export function freshness(value: number | string | null | undefined, now = Date.now()): { label: string; tone: string; days: number | null } {
	const days = ageInDays(value, now);
	if (days === null) return { label: "时间未知", tone: "idle", days };
	const label = days === 0 ? "今天" : days === 1 ? "昨天" : days < 7 ? `${days} 天前`
		: days < 30 ? `${Math.floor(days / 7)} 周前` : days < 365 ? `${Math.floor(days / 30)} 个月前` : `${Math.floor(days / 365)} 年前`;
	return { label, tone: days < 7 ? "pass" : days < 30 ? "warn" : "idle", days };
}

const LABELS: Readonly<Record<string, string>> = {
	planned: "计划中", active: "进行中", blocked: "受阻", review: "待评审", completed: "已完成",
	paused: "已暂停", cancelled: "已取消", archived: "已归档", unknown: "未登记",
	passed: "通过", failed: "失败", not_run: "未运行", "not-run": "未运行", pending: "待核验",
	open: "未解决", resolved: "已解决", current: "当前", stale: "过期", partial: "部分",
};

export function label(status: string | null | undefined): string {
	return (status && LABELS[status]) || status || "未提供";
}

export const STAGES: ReadonlyArray<[string, string]> = [["planned", "计划"], ["active", "推进中"], ["review", "待确认"], ["completed", "已完成"]];

export function stageIndex(status: string): number {
	return STAGES.findIndex(([id]) => id === status);
}

/** 项目状态 → 色调（与 Lens statusTone 一致）。 */
