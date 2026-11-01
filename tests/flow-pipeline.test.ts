import { describe, expect, it, vi } from "vitest";
import { flowStations, renderFlowPipeline } from "../src/ui/flow-pipeline";
import type { Collected } from "../src/ui/talos-view-model";
import type { TalosView } from "../src/view";
import { createObsidianHost } from "./helpers/obsidian-dom";

function collected(overrides: { inboxCount?: number; oldestDays?: number; queue?: number; platforms?: Collected["output"]["platforms"] } = {}): Collected {
	return {
		overview: { totalNotes: { value: "600", sub: "六大内容目录 · 近 7 天 +3" } },
		inbox: { count: overrides.inboxCount ?? 32, oldestDays: overrides.oldestDays ?? 52, clusters: [], recent: [], ageBuckets: [] },
		knowledge: {
			metrics: [
				{ label: "MOC 枢纽", value: "12", sub: "" },
				{ label: "原创洞察", value: "132", sub: "" },
				{ label: "外部素材", value: "346", sub: "" },
			],
			mocs: [],
			recentInsights: [],
			recentMaterials: [],
		},
		output: {
			metrics: [{ label: "待处理输出", value: String(overrides.queue ?? 2), sub: "" }],
			queueStatus: "ready", queueTotal: overrides.queue ?? 2,
			queue: [],
			opsCandidates: [],
			platforms: overrides.platforms ?? [
				{ name: "抖音", count: 5, published: 3, pending: 1, readme: "a.md", latestTitle: "" },
				{ name: "公众号", count: 2, published: 2, pending: 0, readme: "b.md", latestTitle: "" },
			],
		},
	} as unknown as Collected;
}

describe("content flow pipeline", () => {
	it("reads every station from existing statistics", () => {
		const stations = flowStations(collected());
		expect(stations.map((s) => [s.label, s.value])).toEqual([
			["知识笔记", "600"],
			["收件", "32"],
			["洞察", "132"],
			["素材", "346"],
			["待处理", "2"],
		]);
		expect(stations.map((s) => s.pageKey)).toEqual(["knowledge", "inbox", "knowledge", "knowledge", "output"]);
	});

	it("flags stuck stations: two-week backlog and queued output", () => {
		const stuck = (d: Collected) => flowStations(d).filter((s) => s.stuck).map((s) => s.key);
		expect(stuck(collected())).toEqual(["inbox", "queue"]);
		expect(stuck(collected({ oldestDays: 13, queue: 0, platforms: [{ name: "抖音", count: 3, published: 3, pending: 0, readme: "", latestTitle: "" }] }))).toEqual([]);
		expect(flowStations(collected({ inboxCount: 0 }))[1]).toMatchObject({ sub: "已清空", stuck: false });
	});

	it("reports unavailable sources without presenting zero as a count", () => {
		const data = collected();
		data.output.queueStatus = "format";
		data.output.queueTotal = undefined;
		expect(flowStations(data, false)[1]).toMatchObject({ value: "—", sub: "收件目录未配置" });
		expect(flowStations(data)[4]).toMatchObject({ value: "—", stuck: false });
	});

	it("highlights the current page and navigates from the other stations", () => {
		const navigateToPage = vi.fn();
		const view = { navigateToPage, paths: { dir: () => "目录" }, app: { vault: { getAbstractFileByPath: () => ({ children: [] }) } }, plugin: { talosSettings: { inboxFolder: "收件箱" } } } as unknown as TalosView;
		const { host, element } = createObsidianHost();
		renderFlowPipeline(view, host, collected(), "knowledge");
		const stations = element.all("talos-flow-station");
		expect(stations.filter((s) => s.classList.contains("is-current")).map((s) => s.dataset.flowStation)).toEqual(["total", "insights", "materials"]);
		stations[1].click();
		stations[2].click();
		stations[4].click();
		expect(navigateToPage.mock.calls).toEqual([["inbox"], ["output"]]);
	});
});
