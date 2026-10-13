import { describe, expect, it } from "vitest";
import { VAULT_FILE_SPECS, VAULT_FILE_KEYS, fileStatus, planScaffold, specFor } from "../src/data/vault-files";
import { SCHEMA_PRESET_CN, VaultPaths, detectSchemaDetailed, detectVaultFiles, resolveSchema } from "../src/data/schema";

type Node = { name: string; path: string; children?: Node[] };
function tree(paths: string[]): { root: Node; all: Node[] } {
	const root: Node = { name: "", path: "", children: [] };
	const all: Node[] = [];
	for (const full of paths) {
		const isDir = full.endsWith("/");
		const parts = full.replace(/\/$/, "").split("/");
		let cur = root;
		parts.forEach((part, i) => {
			const path = parts.slice(0, i + 1).join("/");
			let next = cur.children?.find((c) => c.name === part);
			if (!next) {
				next = { name: part, path, ...(i < parts.length - 1 || isDir ? { children: [] } : {}) };
				cur.children?.push(next);
				all.push(next);
			}
			cur = next;
		});
	}
	return { root, all };
}
function fakeApp(paths: string[]) {
	const { root, all } = tree(paths);
	return {
		vault: {
			getRoot: () => root,
			getMarkdownFiles: () => all.filter((n) => !n.children && n.path.endsWith(".md")).map((n) => ({ path: n.path })),
			getAllLoadedFiles: () => all,
			getAbstractFileByPath: (p: string) => all.find((n) => n.path === p) ?? null,
		},
	} as never;
}

const KIT = [
	"00-收件箱/", "01-日志/", "02-洞察/", "03-素材/", "04-项目/", "05-归档/", "输出/运营/",
	"System/Identity/CONTEXT.md", "System/Identity/TELOS.md", "System/Identity/PROFILE.md",
	"System/灵魂/PERSONA.md", "System/灵魂/persona-memory.md",
	"System/health-log.md", "System/working-memory/tasks.md", "System/working-memory/candidates.md",
	"System/working-memory/error-patterns.md", "System/模板/", "System/自动化/", "System/配置/",
];

describe("vault file registry", () => {
	it("registers every fixed path once with a module location", () => {
		const keys = VAULT_FILE_SPECS.map((spec) => spec.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(VAULT_FILE_KEYS).toHaveLength(12);
		for (const key of VAULT_FILE_KEYS) expect(specFor(key).module).toBeTruthy();
	});

	it("keeps default paths identical to the previous hard-coded ones", () => {
		const p = new VaultPaths(resolveSchema());
		expect([p.personaFile, p.contextFile, p.telosFile, p.errorPatternsFile, p.loopHealthFile, p.outletFile, p.opsCandidatesFile, p.sceneIndexFile, p.talosProjectDir, p.mocDir]).toEqual([
			"灵魂/PERSONA.md", "Identity/CONTEXT.md", "Identity/TELOS.md", "System/working-memory/error-patterns.md",
			"System/working-memory/loop-health-log.md", "输出/统一出口.md", "输出/运营/运营候选池.md", "04-项目/场景索引.md", "04-项目/TALOS系统", "02-洞察/MOC",
		]);
	});

	it("lets a settings override win and trims slashes", () => {
		const p = new VaultPaths(resolveSchema(), { telos: "/System/Identity/TELOS.md/", mocDir: "知识/索引" });
		expect(p.telosFile).toBe("System/Identity/TELOS.md");
		expect(p.mocReadme).toBe("知识/索引/_README.md");
		expect(p.contextFile).toBe("Identity/CONTEXT.md");
	});

	it("rates files as missing, missing sections, or ok", () => {
		const tasks = specFor("tasksPath");
		expect(fileStatus(tasks, null)).toBe("missing");
		expect(fileStatus(tasks, "# 任务\n只有说明")).toBe("format");
		expect(fileStatus(tasks, tasks.template)).toBe("ok");
		expect(fileStatus(specFor("healthLogPath"), specFor("healthLogPath").template)).toBe("ok");
		expect(fileStatus(specFor("mocDir"), "")).toBe("ok");
	});

	it("uses the same section rules as the parsers (no false alarms on real task files)", () => {
		// 解析器只要求二级标题含「焦点」，所以「## 焦点（最重要的 1-3 件）」是合格的（0.4.15 实测误报）。
		expect(fileStatus(specFor("tasksPath"), "# 任务\n## 焦点（最重要的 1-3 件）\n- [ ] **A**")).toBe("ok");
		// 偏好候选的批准 / 拒绝要求三个分区标题完全一致。
		expect(fileStatus(specFor("candidatesPath"), "## 待确认\n## 已确认\n## 已拒绝（旧）")).toBe("format");
		expect(fileStatus(specFor("candidatesPath"), "## 待确认\n## 已确认\n## 已拒绝")).toBe("ok");
		expect(fileStatus(specFor("pendingApprovalsPath"), "## 当前待审批\n")).toBe("ok");
		const ops = planScaffold({ moduleDirs: [], files: [{ spec: specFor("tasksPath"), path: "t.md", content: "## 焦点（最重要）\n## 待办\n## 已完成\n" }], exists: () => true });
		expect(ops).toEqual([]);
	});
});

describe("planScaffold", () => {
	const files = (contents: Record<string, string | null>) =>
		VAULT_FILE_SPECS.map((spec) => ({ spec, path: `X/${spec.key}${spec.kind === "dir" ? "" : ".md"}`, content: spec.key in contents ? contents[spec.key] ?? null : spec.template || "" }));

	it("creates only missing files and never touches complete ones", () => {
		const ops = planScaffold({ moduleDirs: [], files: files({ tasksPath: null }), exists: () => true });
		expect(ops).toEqual([{ kind: "create", path: "X/tasksPath.md", content: specFor("tasksPath").template, label: "任务池" }]);
	});

	it("appends only the missing sections to an existing file", () => {
		const ops = planScaffold({ moduleDirs: [], files: files({ candidatesPath: "# 候选\n\n## 待确认\n- 已有\n" }), exists: () => true });
		expect(ops).toHaveLength(1);
		expect(ops[0]?.kind).toBe("append");
		expect(ops[0]?.content).toContain("## 已确认");
		expect(ops[0]?.content).toContain("## 已拒绝");
		expect(ops[0]?.content).not.toContain("## 待确认");
	});

	it("skips personal product files and creates parent folders first", () => {
		const ops = planScaffold({ moduleDirs: ["新库/收件箱"], files: files({ talosTasksPath: null, talosProjectDir: null, sceneIndex: null }), exists: () => false });
		expect(ops.map((op) => op.path)).toEqual(["新库", "新库/收件箱", "新库/收件箱/_README.md", "X", "X/sceneIndex.md"]);
		expect(ops.some((op) => op.path.includes("talos"))).toBe(false);
	});
});

describe("detection on the framework kit layout", () => {
	it("finds Identity and soul nested under System", () => {
		const r = detectSchemaDetailed(fakeApp(KIT));
		expect(r.schema.identity).toBe("System/Identity");
		expect(r.schema.soul).toBe("System/灵魂");
		expect(r.schema.system).toBe("System");
		expect(r.schema.templates).toBe("System/模板");
	});

	it("prefers top-level folders when both levels exist", () => {
		const r = detectSchemaDetailed(fakeApp([...KIT, "Identity/", "灵魂/", "模板/"]));
		expect(r.schema.identity).toBe("Identity");
		expect(r.schema.soul).toBe("灵魂");
		expect(r.schema.templates).toBe("模板");
	});

	it("locates fixed files by name when the default location is empty", () => {
		const app = fakeApp([...KIT, "其他/循环/loop-health-log.md"]);
		const found = detectVaultFiles(app, { ...SCHEMA_PRESET_CN, identity: "System/Identity", soul: "System/灵魂" });
		expect(found.loopHealth).toBe("其他/循环/loop-health-log.md");
		expect(found.telos).toBeUndefined();
		expect(found.errorPatterns).toBeUndefined();
	});
});
