import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
	class File { constructor(public path: string) {} }
	class Folder { constructor(public path: string) {} }
	return { File, Folder };
});
vi.mock("obsidian", () => ({ TFile: fixture.File, TFolder: fixture.Folder, normalizePath: (path: string) => path }));
import { collectHealthTrend, parseHealthHistory } from "../src/data/stats";
import { collectHealthDigest } from "../src/data/navigation";

function appWith(text: string) {
	const file = new fixture.File("health.md");
	return { vault: {
		getAbstractFileByPath: (path: string) => path === file.path ? file : null,
		cachedRead: async () => text,
	} } as never;
}
const settings = { healthLogPath: "health.md", pendingApprovalsPath: "approvals.md", candidatesPath: "candidates.md" } as never;
const paths = { errorPatternsFile: "errors.md", loopHealthFile: "loops.md" } as never;
const wrap = (lines: string[]) => ["<!-- EVAL_HISTORY -->", "| 日期 | 健康分 | 说明 |", "|---|---|---|", ...lines, "<!-- EVAL_HISTORY_END -->"].join("\n");

describe("health history uses one chronological source", () => {
	it("sorts out-of-order records across years, keeps same-day source order, and agrees with the summary", async () => {
		const text = wrap([
			"| 2026-01-02 | 84 | 二 |", "| 2025-12-31 | 72 | 一 |",
			"| 2026-01-02 | 0 | 同日末条 |", "| 2025-02-29 | 99 | 无效日期 |",
			"| 2026-13-01 | 88 | 无效月份 |", "| 2026-01-03 | 未知 | 无效分数 |",
		]);
		const trend = await collectHealthTrend(appWith(text), settings);
		expect(trend).toEqual([{ label: "2025-12-31", score: 72 }, { label: "2026-01-02", score: 84 }, { label: "2026-01-02", score: 0 }]);
		const digest = await collectHealthDigest(appWith(text), paths, settings, [], []);
		expect(digest.metrics[0]?.value).toBe("0");
		expect(digest.metrics[0]?.sub).toContain("2026-01-02");
	});

	it("keeps only the newest nine after sorting, not the last nine source rows", async () => {
		const lines = Array.from({ length: 12 }, (_, i) => `| 2025-12-${String(i + 1).padStart(2, "0")} | ${i} | 记录 |`).reverse();
		const trend = await collectHealthTrend(appWith(wrap(lines)), settings);
		expect(trend).toHaveLength(9);
		expect(trend[0]).toEqual({ label: "2025-12-04", score: 3 });
		expect(trend.at(-1)).toEqual({ label: "2025-12-12", score: 11 });
		expect(await collectHealthTrend(appWith(wrap(lines)), settings, 0)).toEqual([]);
	});

	it("accepts a legacy unmarked table and keeps the history block as the authoritative source when present", () => {
		expect(parseHealthHistory("| 2024-01-01 | 85/100 | 旧记录 |\n| 2024-01-02 | 0分 | 旧记录 |"))
			.toEqual([{ date: "2024-01-01", score: 85 }, { date: "2024-01-02", score: 0 }]);
		const text = `| 2030-01-01 | 99 | 其他表 |\n${wrap(["| 2025-01-01 | 65 | 历史 |"])}\n| 2040-01-01 | 88 | 其他表 |`;
		expect(parseHealthHistory(text)).toEqual([{ date: "2025-01-01", score: 65 }]);
		expect(parseHealthHistory("<!-- EVAL_HISTORY -->\n| 2024-01-01 | 80 |" )).toEqual([]);
	});
});
