import { describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
	class File {
		path: string;
		basename: string;
		stat: { ctime: number; mtime: number };
		constructor(path: string, mtime = 1) {
			this.path = path;
			this.basename = path.split("/").pop()!.replace(/\.md$/, "");
			this.stat = { ctime: mtime, mtime };
		}
	}
	class Folder { constructor(public path: string, public name: string, public children: unknown[]) {} }
	return { File, Folder };
});
vi.mock("obsidian", () => ({ TFile: fixtures.File, TFolder: fixtures.Folder, normalizePath: (p: string) => p }));

import { collectApprovals, collectCandidates, collectFocusAndFlow } from "../src/data/stats";
import { collectOutputCenter, collectProjectScenes } from "../src/data/navigation";
import { collectCapabilities } from "../src/data/capabilities";

function makeApp(files: Array<{ path: string; text: string; mtime?: number }>, folders: InstanceType<typeof fixtures.Folder>[] = []) {
	const contents = new Map(files.map((f) => [f.path, f.text]));
	const entries = files.map((f) => new fixtures.File(f.path, f.mtime));
	const map = new Map<string, unknown>([...entries.map((f) => [f.path, f] as const), ...folders.map((f) => [f.path, f] as const)]);
	return {
		vault: {
			getAbstractFileByPath: (p: string) => map.get(p) ?? null,
			getMarkdownFiles: () => entries,
			cachedRead: async (f: InstanceType<typeof fixtures.File>) => contents.get(f.path) ?? "",
			read: async (f: InstanceType<typeof fixtures.File>) => contents.get(f.path) ?? "",
			adapter: { exists: async () => false, list: async () => ({ files: [], folders: [] }), read: async () => "" },
		},
		metadataCache: { getFileCache: () => null },
	} as never;
}

const outputPaths = {
	outletFile: "输出/统一出口.md", opsCandidatesFile: "输出/运营.md",
	outputPlatform: (n: string) => `输出/${n}`, readme: () => "输出/_README.md",
} as never;

describe("dashboard statistics use observable, labelled data", () => {
	it("counts task checkboxes from one file and omits examples and plain notes", async () => {
		const app = makeApp([{ path: "tasks.md", text: [
			"## 当前焦点", "- [ ] 一", "- [~] 二", "- [X] 三", "- 四", "- 五", "- 六",
			"<!-- - [ ] 注释示例 -->", "```md", "- [x] 代码示例", "```", "## 待办", "- [ ] 七", "## 其他", "- [x] 八",
		].join("\n") }]);
		const result = await collectFocusAndFlow(app, { tasksPath: "tasks.md" } as never);
		expect(result.focus).toHaveLength(3);
		expect(result.focusTotal).toBe(5);
		expect(result.taskFlow.value).toBe("40%");
		expect(result.taskFlow.counts).toEqual({ open: 2, inProgress: 1, done: 2, total: 5 });
	});

	it("distinguishes an absent or empty task pool from a calculated zero percent", async () => {
		const missing = await collectFocusAndFlow(makeApp([]), { tasksPath: "missing.md" } as never);
		expect(missing.taskFlow.value).toBe("—");
		expect(missing.taskFlow.counts).toBeUndefined();
		const empty = await collectFocusAndFlow(makeApp([{ path: "tasks.md", text: "## 当前焦点\n- 普通说明" }]), { tasksPath: "tasks.md" } as never);
		expect(empty.taskFlow.value).toBe("—");
		expect(empty.taskFlow.counts?.total).toBe(0);
	});

	it("counts all explicit open output tasks once per line but renders only eight", async () => {
		const tasks = Array.from({ length: 11 }, (_, i) => `- [ ] 任务 ${i} [[A]] [[B]]`);
		const app = makeApp([{ path: "输出/统一出口.md", text: [...tasks, "- [X] 已完成", "普通说明 [[A]]", "<!-- - [ ] 注释 -->", "```", "- [ ] 示例", "```"].join("\n") }]);
		const result = await collectOutputCenter(app, outputPaths);
		expect(result.queueStatus).toBe("ready");
		expect(result.queueTotal).toBe(11);
		expect(result.queue).toHaveLength(8);
		expect(result.metrics[0]?.value).toBe("11");
	});

	it("does not equate missing or unrecognized output with an empty queue", async () => {
		const missing = await collectOutputCenter(makeApp([]), outputPaths);
		expect(missing.queueStatus).toBe("missing");
		expect(missing.queueTotal).toBeUndefined();
		const unknown = await collectOutputCenter(makeApp([{ path: "输出/统一出口.md", text: "# 待处理\n- [[未明确状态]]" }]), outputPaths);
		expect(unknown.queueStatus).toBe("format");
		expect(unknown.metrics[0]?.value).toBe("—");
		expect(unknown.queue).toHaveLength(1);
		expect(unknown.queue[0]?.meta).toContain("未计入统计");
		const empty = await collectOutputCenter(makeApp([{ path: "输出/统一出口.md", text: "- [x] 完成" }]), outputPaths);
		expect(empty.queueTotal).toBe(0);
		const mixed = await collectOutputCenter(makeApp([{ path: "输出/统一出口.md", text: "- [ ] 明确任务\n- [[旧式任务]]" }]), outputPaths);
		expect(mixed.queueStatus).toBe("format");
		expect(mixed.queueTotal).toBeUndefined();
		expect(mixed.queue).toHaveLength(2);
	});

	it("counts only the standard outgoing queue table and handles wiki aliases", async () => {
		const text = ["# 统一出口", "## 今日待发", "| 日期 | 今天发 | 平台 | 动作 |", "|---|---|---|---|", "| 今天 | [[作品 A|别名]] | X | 发布 |",
			"## 待发队列", "| 内容 | 平台 | 成熟度 | 备注 |", "|---|---|---|---|", "| [[作品 A|别名]] | X | 🟢 成品就绪 |  |", "| 作品 B | 抖音 | 🟡 需要改 | 说明\\|补充 |",
			"## 发布后回填", "发布后补充数据。", "## 队列纪律", "- 只在这里决定发什么。"].join("\n");
		const result = await collectOutputCenter(makeApp([{ path: "输出/统一出口.md", text }]), outputPaths);
		expect(result.queueStatus).toBe("ready");
		expect(result.queueTotal).toBe(2);
		expect(result.queue.map((item) => item.title)).toEqual(["别名", "作品 B"]);
	});

	it("recognizes a valid empty standard queue without counting its headings or instructions", async () => {
		const text = ["## 今日待发", "| 日期 | 今天发 | 平台 | 动作 |", "|---|---|---|---|", "## 待发队列", "| 内容 | 平台 | 成熟度 | 备注 |", "|---|---|---|---|", "| — | — | — | — |", "## 队列纪律", "- 保持队列清晰。"].join("\n");
		const result = await collectOutputCenter(makeApp([{ path: "输出/统一出口.md", text }]), outputPaths);
		expect(result.queueStatus).toBe("ready");
		expect(result.queueTotal).toBe(0);
	});

	it("keeps malformed, mixed, and already published queue rows unknown", async () => {
		const prefix = ["## 待发队列", "| 内容 | 平台 | 成熟度 | 备注 |", "|---|---|---|---|"].join("\n");
		for (const suffix of ["| 项目 A | X |", "| 项目 A | X | 已发布 |  |", "| 项目 A | X | 就绪 |  |\n- [ ] 表外任务", "| 项目 A | X | 就绪 |  |\n## 其他\n| 不明 | 列表 | 内容 | 状态 |", "| [[不完整 | X | 就绪 |  |"]) {
			const result = await collectOutputCenter(makeApp([{ path: "输出/统一出口.md", text: `${prefix}\n${suffix}` }]), outputPaths);
			expect(result.queueStatus).toBe("format");
			expect(result.queueTotal).toBeUndefined();
		}
	});

	it("does not infer a pending queue from a today pointer and an available-content table", async () => {
		const text = ["## 今日待发（指针）", "| 日期 | 今天发 | 动作 |", "|---|---|---|", "| 今天 | [[作品 A]] | 发布 |", "## 现存可用内容", "| 内容 | 平台 | 日期 |", "|---|---|---|", "| [[作品 A]] | X | 今天 |", "| [[作品 B]] | 抖音 | 明天 |"].join("\n");
		const result = await collectOutputCenter(makeApp([{ path: "输出/统一出口.md", text }]), outputPaths);
		expect(result.queueStatus).toBe("format");
		expect(result.queueTotal).toBeUndefined();
	});

	it("does not infer priority from project names and identifies sampled progress", async () => {
		const folder = new fixtures.Folder("项目/TALOS", "TALOS", []);
		const root = new fixtures.Folder("项目", "项目", [folder]);
		const files = Array.from({ length: 41 }, (_, i) => ({ path: `项目/TALOS/${i}.md`, text: i === 40 ? "- [X] done\n<!-- - [ ] hidden -->\n```\n- [ ] example\n```" : "- [ ] todo", mtime: i + 1 }));
		const result = await collectProjectScenes(makeApp(files, [root, folder]), { dir: () => "项目" } as never);
		expect(result[0]?.priority).toBe("p1");
		expect(result[0]?.latestMtime).toBe(41);
		expect(result[0]?.progress).toEqual({ done: 1, total: 40, sampled: true, scannedFiles: 40, totalFiles: 41 });
	});

	it("marks suggested fallback commands separately from discovered files", async () => {
		const groups = await collectCapabilities(makeApp([]));
		const commands = groups.find((g) => g.key === "commands")!;
		expect(commands.sourceStatus).toBe("unavailable");
		expect(commands.items.length).toBeGreaterThan(0);
		expect(commands.items.every((item) => item.origin === "fallback")).toBe(true);
		expect(groups.find((g) => g.key === "workflows")?.sourceStatus).toBe("unavailable");
	});

	it("ignores instructional and commented examples while preserving real review items", async () => {
		const app = makeApp([
			{ path: "approvals.md", text: "## 当前待审批\n<!-- ### 示例\n**状态**：待审批 -->\n### 提案 A\n**状态**：待审批\n" },
			{ path: "candidates.md", text: "## 待确认\n- 说明：这里记录偏好\n- 喜欢简洁沟通  \n<!-- - 例子 -->\n  - 缩进说明\n## 已确认\n## 已拒绝\n" },
		]);
		const settings = { pendingApprovalsPath: "approvals.md", candidatesPath: "candidates.md" } as never;
		expect((await collectApprovals(app, settings)).map((x) => x.title)).toEqual(["提案 A"]);
		expect((await collectCandidates(app, settings)).map((x) => x.title)).toEqual(["喜欢简洁沟通"]);
	});
});
