import { describe, expect, it } from "vitest";
import {
	SCHEMA_PRESET_CN,
	SCHEMA_PRESET_EN,
	detectSchemaDetailed,
	listTopFolders,
} from "../src/data/schema";

/** 构造一个最小 App 替身：只提供检测用到的 vault API */
function fakeApp(folders: string[], files: string[] = []) {
	return {
		vault: {
			getRoot: () => ({
				children: folders.map((name) => ({ name, children: [] })),
			}),
			getMarkdownFiles: () => files.map((path) => ({ path })),
		},
	} as never;
}

describe("listTopFolders", () => {
	it("列出顶层目录并跳过隐藏目录", () => {
		// 此处的 ".obsidian" 是测试数据（验证会跳过隐藏目录），并非真实 config 路径访问
		// eslint-disable-next-line obsidianmd/hardcoded-config-path
		expect(listTopFolders(fakeApp(["00-Inbox", ".obsidian", "Identity"])))
			.toEqual(["00-Inbox", "Identity"]);
	});
});

describe("detectSchemaDetailed · 标准结构", () => {
	it("中文预设库全部精确命中", () => {
		const r = detectSchemaDetailed(fakeApp(Object.values(SCHEMA_PRESET_CN) as string[]));
		expect(r.matchedCount).toBe(13);
		expect(r.schema).toEqual(SCHEMA_PRESET_CN);
		expect(r.entries.every((e) => e.how === "exact")).toBe(true);
	});

	it("英文预设库全部精确命中", () => {
		const r = detectSchemaDetailed(fakeApp(Object.values(SCHEMA_PRESET_EN) as string[]));
		expect(r.schema.inbox).toBe("00-Inbox");
		expect(r.schema.insights).toBe("02-Insights");
		expect(r.schema.output).toBe("Output");
	});
});

describe("detectSchemaDetailed · 任意命名（客户真实库）", () => {
	it("认得出完全自定义的中文命名", () => {
		const r = detectSchemaDetailed(
			fakeApp(["收集箱", "每日日记", "我的想法", "参考资料", "工程", "存档"])
		);
		expect(r.schema.inbox).toBe("收集箱");
		expect(r.schema.logs).toBe("每日日记");
		expect(r.schema.insights).toBe("我的想法");
		expect(r.schema.assets).toBe("参考资料");
		expect(r.schema.projects).toBe("工程");
		expect(r.schema.archive).toBe("存档");
	});

	it("认得出英文自定义命名", () => {
		const r = detectSchemaDetailed(
			fakeApp(["Inbox", "Journal", "Notes", "Resources", "Projects", "Archive"])
		);
		expect(r.schema.inbox).toBe("Inbox");
		expect(r.schema.logs).toBe("Journal");
		expect(r.schema.projects).toBe("Projects");
	});

	it("带序号前缀的自定义命名也能认（01-我的日记）", () => {
		const r = detectSchemaDetailed(fakeApp(["01-我的日记", "07-项目管理"]));
		expect(r.schema.logs).toBe("01-我的日记");
		expect(r.schema.projects).toBe("07-项目管理");
	});

	it("中英混合结构正确解析", () => {
		const r = detectSchemaDetailed(
			fakeApp(["00-Inbox", "02-Insights", "灵魂", "Identity", "System"])
		);
		expect(r.schema.inbox).toBe("00-Inbox");
		expect(r.schema.soul).toBe("灵魂");
		expect(r.schema.identity).toBe("Identity");
	});
});

describe("detectSchemaDetailed · 边界与安全", () => {
	it("空库不硬套：无命中项保留默认且标记 none", () => {
		const r = detectSchemaDetailed(fakeApp([]));
		expect(r.matchedCount).toBe(0);
		expect(r.schema).toEqual(SCHEMA_PRESET_CN);
		expect(r.entries.every((e) => e.how === "none")).toBe(true);
	});

	it("无关目录不会被误认", () => {
		const r = detectSchemaDetailed(fakeApp(["attachments", "Excalidraw", "图片"]));
		expect(r.matchedCount).toBe(0);
	});

	it("一个目录只认领一个模块（不重复分配）", () => {
		const r = detectSchemaDetailed(fakeApp(["笔记"]));
		const claimed = r.entries.filter((e) => e.matched === "笔记");
		expect(claimed).toHaveLength(1);
	});

	it("同类候选并存时各归其位，不互相抢占", () => {
		const r = detectSchemaDetailed(fakeApp(["洞察", "笔记", "素材"]));
		const matched = r.entries.filter((e) => e.matched).map((e) => e.matched);
		expect(new Set(matched).size).toBe(matched.length); // 无重复
		expect(r.schema.insights).toBe("洞察"); // 精确名优先于别名
		expect(r.schema.assets).toBe("素材");
	});
});

describe("detectDataSources · 统计来源文件", () => {
	it("定位到 System 下的关键文件", () => {
		const r = detectSchemaDetailed(
			fakeApp(
				["System", "00-收件箱"],
				[
					"System/working-memory/tasks.md",
					"System/pending-approvals.md",
					"System/working-memory/candidates.md",
					"System/working-memory/health-log.md",
				]
			)
		);
		expect(r.dataSources.tasksPath).toBe("System/working-memory/tasks.md");
		expect(r.dataSources.pendingApprovalsPath).toBe("System/pending-approvals.md");
		expect(r.dataSources.candidatesPath).toBe("System/working-memory/candidates.md");
		expect(r.dataSources.healthLogPath).toBe("System/working-memory/health-log.md");
	});

	it("优先 System 下的副本，不误认归档副本", () => {
		const r = detectSchemaDetailed(
			fakeApp(
				["System", "05-归档"],
				["05-归档/2025/tasks.md", "System/working-memory/tasks.md"]
			)
		);
		expect(r.dataSources.tasksPath).toBe("System/working-memory/tasks.md");
	});

	it("认得出中文命名的数据源文件", () => {
		const r = detectSchemaDetailed(fakeApp(["System"], ["System/任务.md"]));
		expect(r.dataSources.tasksPath).toBe("System/任务.md");
	});

	it("文件不存在时不返回该项（不写脏路径）", () => {
		const r = detectSchemaDetailed(fakeApp(["System"], []));
		expect(r.dataSources.tasksPath).toBeUndefined();
	});
});
