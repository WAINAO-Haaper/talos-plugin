import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../src/actions", () => ({ openFile: vi.fn() }));

import { openFile } from "../src/actions";
import {
	fillBanner,
	fillCapabilityDistribution,
	fillDist,
	fillGateStateChart,
	fillGates,
	fillInboxAgeDist,
	fillInboxClusters,
	fillKnowledgeTreemap,
	fillOutputClosureChart,
	fillPlatforms,
	fillProjectPortfolioChart,
	fillSignalList,
	fillTalosModules,
	fillTrend,
} from "../src/ui/charts/talos-view-charts";
import type { CapabilityGroup } from "../src/data/capabilities";
import type { InboxDigest, OutputPlatform, ProjectScene } from "../src/types";
import type { TalosView } from "../src/view";
import { createObsidianHost, type ObsidianTestElement } from "./helpers/obsidian-dom";

const app = { id: "app" };
const view = { app } as unknown as TalosView;
const opened = vi.mocked(openFile);

function host(): { el: HTMLElement; dom: ObsidianTestElement } {
	const { host: el, element } = createObsidianHost();
	return { el, dom: element };
}

function platform(overrides: Partial<OutputPlatform>): OutputPlatform {
	return { name: "抖音", count: 0, published: 0, pending: 0, readme: "out/README.md", latestTitle: "—", ...overrides };
}

beforeEach(() => opened.mockClear());

describe("signal and gate lists", () => {
	it("shows the empty text when there are no signals", () => {
		const { el, dom } = host();
		fillSignalList(view, el, [], "暂无");
		expect(dom.one("empty").textContent).toBe("暂无");
	});

	it("renders day chips with the inbox folder and opens the note", () => {
		const { el, dom } = host();
		fillSignalList(view, el, [{ title: "笔记", meta: "3d · 00-收件箱/web/a.md", path: "00-收件箱/web/a.md" }], "暂无");
		const row = dom.one("detail-row");
		const meta = row.querySelector<ObsidianTestElement>("span");
		expect(meta?.textContent).toBe("3d");
		expect(meta?.dataset.folder).toBe("web");
		row.click();
		expect(opened).toHaveBeenCalledWith(app, "00-收件箱/web/a.md");
	});

	it("renders gate chips by state and only links gates with a path", () => {
		const { el, dom } = host();
		fillGates(view, el, [
			{ id: "G1", title: "构建", state: "done", path: "g1.md" },
			{ id: "G2", title: "安装", state: "blocked" },
		]);
		const chips = dom.all("gate");
		expect(chips.map((chip) => chip.className)).toEqual(["gate state-done", "gate state-blocked"]);
		chips[0].click();
		chips[1].click();
		expect(opened).toHaveBeenCalledTimes(1);
		expect(opened).toHaveBeenCalledWith(app, "g1.md");
	});

	it("marks an empty gate list with a dash", () => {
		const { el, dom } = host();
		fillGates(view, el, []);
		expect(dom.one("empty").textContent).toBe("—");
	});
});

describe("distribution charts", () => {
	it("scales capability bars against the largest group", () => {
		const { el, dom } = host();
		const group = (label: string, size: number): CapabilityGroup =>
			({ key: label, label, meta: "", items: Array.from({ length: size }, () => ({})) }) as unknown as CapabilityGroup;
		fillCapabilityDistribution(view, el, [group("命令", 4), group("Agent", 2)]);
		const tracks = dom.all("capability-v2-distribution-row__track");
		expect(tracks.map((track) => (track.children[0] as ObsidianTestElement).style.width)).toEqual(["100%", "50%"]);
		expect(tracks[1].getAttribute("aria-label")).toBe("Agent：2 个调用入口");
	});

	it("uses an empty state instead of a zero-width capability chart", () => {
		const { el, dom } = host();
		fillCapabilityDistribution(view, el, []);
		expect(dom.one("talos-ui-empty-state").textContent).toContain("暂无能力分组");
	});

	it("draws gate state segments only for present states and keeps a full legend", () => {
		const { el, dom } = host();
		fillGateStateChart(view, el, [
			{ id: "G1", title: "", state: "done" },
			{ id: "G2", title: "", state: "done" },
			{ id: "G3", title: "", state: "blocked" },
			{ id: "G4", title: "", state: "todo" },
		]);
		const segments = dom.all("talos-v2-gate-chart__segment");
		expect(segments.map((segment) => [segment.className, segment.style.width])).toEqual([
			["talos-v2-gate-chart__segment state-done", "50%"],
			["talos-v2-gate-chart__segment state-blocked", "25%"],
			["talos-v2-gate-chart__segment state-todo", "25%"],
		]);
		expect(dom.one("talos-v2-gate-chart__track").getAttribute("aria-label")).toBe("闸门状态分布：完成 2，就绪 0，阻塞 1，待办 1");
		expect(dom.all("talos-v2-gate-chart__key")).toHaveLength(4);
	});

	it("sorts treemap tiles by parsed value and disables tiles without a source", () => {
		const { el, dom } = host();
		fillKnowledgeTreemap(view, el, [
			{ label: "素材", value: "1", sub: "篇" },
			{ label: "洞察", value: "3 篇", sub: "篇", path: "insight.md", tone: "good" },
		]);
		const tiles = dom.all("knowledge-v2-treemap-node");
		expect(tiles.map((tile) => tile.style.props["--knowledge-share"])).toEqual(["75%", "25%"]);
		expect(tiles[0].className).toContain("tone-good");
		expect(tiles[0].getAttribute("aria-label")).toBe("洞察：3 篇，占 75%");
		expect(tiles[1].disabled).toBe(true);
		tiles[0].click();
		expect(opened).toHaveBeenCalledWith(app, "insight.md");
	});

	it("shows the knowledge empty state when every value is zero", () => {
		const { el, dom } = host();
		fillKnowledgeTreemap(view, el, [{ label: "素材", value: "0", sub: "" }]);
		expect(dom.one("talos-ui-empty-state").textContent).toContain("暂无知识资产统计");
	});

	it("splits output bars into published, pending and unclassified shares", () => {
		const { el, dom } = host();
		fillOutputClosureChart(view, el, [
			platform({ name: "抖音", count: 10, published: 5, pending: 3 }),
			platform({ name: "公众号", count: 0 }),
		]);
		const [first, second] = dom.all("output-v2-bar-track");
		expect(first.children.map((segment) => [(segment as ObsidianTestElement).className, (segment as ObsidianTestElement).style.width])).toEqual([
			["output-v2-bar-segment tone-published", "50%"],
			["output-v2-bar-segment tone-pending", "30%"],
			["output-v2-bar-segment tone-unclassified", "20%"],
		]);
		expect(first.getAttribute("aria-label")).toBe("抖音：已发布 5，待闭环 3，未分类 2");
		expect(second.classList.contains("is-empty")).toBe(true);
		expect(second.children).toHaveLength(0);
	});

	it("summarises tracked task completion and priority spread", () => {
		const { el, dom } = host();
		const project = (priority: ProjectScene["priority"], progress?: ProjectScene["progress"]) =>
			({ priority, progress }) as unknown as ProjectScene;
		fillProjectPortfolioChart(view, el, [project("p0", { done: 3, total: 4 }), project("p1", { done: 0, total: 4 }), project("p1")]);
		const ring = dom.one("project-v2-progress-ring");
		expect(ring.style.props["--project-progress"]).toBe("38%");
		expect(ring.getAttribute("aria-label")).toBe("已跟踪任务完成 3/8，38%");
		const bars = dom.all("project-v2-priority-bar__track");
		expect(bars.map((bar) => (bar.children[0] as ObsidianTestElement).style.width)).toEqual(["50%", "100%", "0%"]);
	});

	it("marks the portfolio ring empty when no project has a task list", () => {
		const { el, dom } = host();
		fillProjectPortfolioChart(view, el, [{ priority: "p2" } as unknown as ProjectScene]);
		const ring = dom.one("project-v2-progress-ring");
		expect(ring.classList.contains("is-empty")).toBe(true);
		expect(ring.textContent).toBe("—");
	});

	it("draws dist bars as css widths relative to the largest bucket", () => {
		const { el, dom } = host();
		fillDist(view, el, [
			{ name: "收件箱", count: 8, readme: "inbox.md" },
			{ name: "输出", count: 2, readme: "out.md" },
		]);
		const bars = dom.all("bwrap").map((wrap) => (wrap.children[0] as ObsidianTestElement).style.props["--talos-w"]);
		expect(bars).toEqual(["100%", "25%"]);
		dom.all("barrow")[1].click();
		expect(opened).toHaveBeenCalledWith(app, "out.md");
	});
});

describe("trend, banner and cards", () => {
	it("reports health deltas and scales bars to at least 100", () => {
		const { el, dom } = host();
		fillTrend(view, el, [
			{ label: "周一", score: 80 },
			{ label: "周二", score: 70 },
		]);
		expect(dom.one("delta").className).toBe("delta down");
		expect(dom.one("delta").textContent).toBe("▼ 10");
		expect(dom.all("spark-bar").map((bar) => bar.style.props["--talos-h"])).toEqual(["80%", "70%"]);
		expect(dom.all("spark-bar")[1].getAttribute("title")).toBe("周二: 70");
	});

	it("shows flat and empty health trends", () => {
		const flat = host();
		fillTrend(view, flat.el, [{ label: "今天", score: 90 }]);
		expect(flat.dom.one("delta").textContent).toBe("持平");
		const empty = host();
		fillTrend(view, empty.el, []);
		expect(empty.dom.one("empty").textContent).toBe("无健康分数据");
	});

	it("rebuilds the release banner and flags a triggered stop condition", () => {
		const { el, dom } = host();
		fillBanner(view, el, { published: 1, totalPub: 3, frozenDays: 2, stopTriggered: false } as never);
		fillBanner(view, el, { published: 2, totalPub: 3, frozenDays: 5, stopTriggered: true } as never);
		expect(dom.all("banner-tag")).toHaveLength(1);
		expect(dom.classList.contains("is-alert")).toBe(true);
		expect(dom.all("banner-num").map((num) => num.textContent)).toEqual(["2/3", "5", "已触发"]);
	});

	it("opens the platform readme from the card and the latest draft from its line", () => {
		const { el, dom } = host();
		fillPlatforms(view, el, [platform({ name: "小红书", count: 4, published: 1, pending: 2, latestTitle: "新稿", latestPath: "out/new.md" })]);
		expect(dom.one("big").textContent).toBe("4");
		dom.one("module-latest").click();
		dom.one("platform-card").click();
		expect(opened.mock.calls).toEqual([[app, "out/new.md"], [app, "out/README.md"]]);
	});

	it("links TALOS module cards to their readme and latest note", () => {
		const { el, dom } = host();
		fillTalosModules(view, el, [{ name: "脊柱", count: 7, readme: "spine.md", latestTitle: "v2", latestPath: "spine/v2.md" }]);
		dom.one("module-latest").click();
		dom.one("talos-module").click();
		expect(opened.mock.calls).toEqual([[app, "spine/v2.md"], [app, "spine.md"]]);
	});
});

describe("inbox charts", () => {
	const inbox = (overrides: Partial<InboxDigest>): InboxDigest => ({
		count: 0,
		oldestDays: 0,
		clusters: [],
		recent: [],
		ageBuckets: [],
		...overrides,
	});

	it("shows cluster shares with a 2% minimum bar and marks the manual bucket", () => {
		const { el, dom } = host();
		fillInboxClusters(view, el, [
			{ name: "AI", count: 99, hint: "" },
			{ name: "其他", count: 1, hint: "" },
		] as InboxDigest["clusters"]);
		expect(dom.all("cluster-pct").map((pct) => pct.textContent)).toEqual(["99%", "1%"]);
		const fills = dom.all("cluster-bar-fill");
		expect(fills.map((fill) => fill.style.width)).toEqual(["100%", "2%"]);
		expect(fills[1].classList.contains("is-manual")).toBe(true);
	});

	it("shows the empty cluster message", () => {
		const { el, dom } = host();
		fillInboxClusters(view, el, []);
		expect(dom.one("empty").textContent).toBe("暂无待消化主题");
	});

	it("draws non-empty age buckets with a minimum visible width", () => {
		const { el, dom } = host();
		fillInboxAgeDist(view, el, inbox({
			count: 200,
			oldestDays: 40,
			ageBuckets: [
				{ label: "≤7d", count: 199, tone: "fresh" },
				{ label: "8–30d", count: 0, tone: "warm" },
				{ label: ">30d", count: 1, tone: "stale" },
			] as InboxDigest["ageBuckets"],
		}));
		expect(dom.one("age-dist-title").textContent).toBe("积压年龄 · 共 200 篇 · 最老 40d");
		expect(dom.all("age-seg").map((seg) => seg.style.width)).toEqual(["99.5%", "1.5%"]);
		expect(dom.one("age-dist-track").getAttribute("aria-label")).toBe("积压年龄分布：≤7d 199 篇，>30d 1 篇");
	});

	it("renders nothing for an empty inbox", () => {
		const { el, dom } = host();
		fillInboxAgeDist(view, el, inbox({}));
		expect(dom.children).toHaveLength(0);
	});
});
