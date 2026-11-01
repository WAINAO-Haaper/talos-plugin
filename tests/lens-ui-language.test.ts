import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class TFile { path = ""; stat = { mtime: 0, size: 0 }; }
	class Stub {}
	const known: Record<string, unknown> = { __esModule: true, TFile };
	return new Proxy(known, {
		get: (target, key: string): unknown => (key in target ? target[key] : key === "then" ? undefined : Stub),
		has: () => true,
	});
});

const { normalizeUiLanguage } = await import("../src/settings");
const { greeting, freshness, stageIndex, label } = await import("../src/ui/lens/lens-format");
const { LENS_MODULES, LENS_RAIL_SHORTCUTS, defaultTab } = await import("../src/ui/lens/lens-pages");
const { summarizeMarkdown } = await import("../src/ui/lens/lens-drawer");
const { buildLensFocus } = await import("../src/ui/lens/lens-data");
const { recentHeatCells } = await import("../src/ui/lens/lens-library");

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("Lens interface language", () => {
	it("limits recent creation activity to local today across month boundaries", () => {
		const cells = [
			...Array.from({ length: 15 }, (_, i) => ({ date: `2026-10-${String(i + 17).padStart(2, "0")}`, count: 0, level: 0 as const })),
			...Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, count: i, level: 0 as const })),
		];
		const days = recentHeatCells([{ label: "fixture", weeks: [cells] }], new Date(2026, 10, 1, 9));
		expect(days).toHaveLength(14);
		expect(days[0].date).toBe("2026-10-19");
		expect(days.at(-1)?.date).toBe("2026-11-01");
	});
	it("is an opt-in setting that falls back to the classic console", () => {
		expect(normalizeUiLanguage("lens")).toBe("lens");
		expect(normalizeUiLanguage(undefined)).toBe("classic");
		expect(normalizeUiLanguage("other")).toBe("classic");
		const settings = read("src/settings.ts");
		expect(settings).toContain('uiLanguage: "classic",');
		expect(settings).toContain('lensAppearance: "light",');
		expect(read("src/main.ts")).toContain('this.talosSettings.uiLanguage === "lens"');
	});

	it("organises overview, voice and the compact workbench like the classic interface", () => {
		expect(LENS_MODULES.map((m) => m.title)).toEqual(["系统总览", "语音助手", "工作台", "设置"]);
		expect(LENS_RAIL_SHORTCUTS).toEqual(["overview", "assistant", "workbench"]);
		expect(LENS_MODULES.find((m) => m.id === "workbench")?.tabs?.map(([id]) => id)).toEqual(["inbox", "projects", "health"]);
		expect(LENS_MODULES.find((m) => m.id === "assistant")?.tabs?.map(([id]) => id)).toEqual(["voice", "chat", "harness"]);
		expect(defaultTab("overview")).toBe("today");
		expect(defaultTab("workbench")).toBe("inbox");
		expect(defaultTab("assistant")).toBe("voice");
	});

	it("uses Lens's own wording for greetings, freshness, stages and statuses", () => {
		expect(greeting(new Date(2026, 9, 8, 12, 30)).word).toBe("中午好");
		expect(greeting(new Date(2026, 9, 8, 12, 30)).date).toBe("10月8日 星期四");
		const now = Date.UTC(2026, 9, 8);
		expect(freshness(now - 3 * 86400000, now)).toMatchObject({ label: "3 天前", tone: "pass" });
		expect(freshness(now - 20 * 86400000, now)).toMatchObject({ label: "2 周前", tone: "warn" });
		expect(freshness(null)).toMatchObject({ label: "时间未知", tone: "idle" });
		expect(stageIndex("review")).toBe(2);
		expect(stageIndex("archived")).toBe(-1);
		expect(label("planned")).toBe("计划中");
		expect(label("unknown")).toBe("未登记");
	});

	it("summarises notes locally: existing summary first, then the first paragraph, headings as points", () => {
		expect(summarizeMarkdown("正文", { summary: "已有摘要" }, ["要点"])).toMatchObject({ text: "已有摘要", method: "existing", highlights: ["要点"] });
		const local = summarizeMarkdown("---\na: 1\n---\n# 标题\n\n这是 [[目标|别名]] 的 **首段**。\n\n第二段", undefined, []);
		expect(local).toMatchObject({ text: "这是 别名 的 首段。", method: "local" });
		expect(summarizeMarkdown("# 只有标题", undefined, ["一", "二"])).toMatchObject({ method: "structured" });
		expect(summarizeMarkdown("", undefined, [])).toBeNull();
	});

	it("builds the focus card from the lili status snapshot and hides it when the bridge is off", () => {
		expect(buildLensFocus(null)).toBeNull();
		expect(buildLensFocus({ state: "disabled" })).toBeNull();
		const focus = buildLensFocus({
			state: "ready",
			readStatus: "current",
			envelope: {
				summary: {
					current_focus: { project_id: "talos", name: "TALOS System" },
					state: { revision: 1, status: "active", priority: "P0", last_updated: "2026-10-01" },
					mainline: { work_item_id: "w", title: "主线", status: "active" },
					next_action: { work_item_id: "w", action: "下一步" },
					blockers: [{ blocker_id: "b1", title: "阻碍", severity: "high", status: "open" }, { blocker_id: "b2", title: "已解", severity: "low", status: "resolved" }],
					checkpoint: { build: "passed", tests: "passed", install: "not_run", launch: "not_run", user_validation: "pending" },
				},
			},
		} as never);
		expect(focus).toMatchObject({ name: "TALOS System", status: "active", next: "下一步", stale: false });
		expect(focus?.blockers).toEqual([{ title: "阻碍", severity: "high" }]);
	});

	it("switches the console shell by language and maps classic entry points onto Lens modules", () => {
		const view = read("src/view.ts");
		expect(view).toContain("if (this.usesLens) {\n\t\t\tthis.buildLensShell();");
		expect(view).toContain("this.lens.setData(this.data, this.peerStatus);");
		expect(view).toContain('inbox: "workbench"');
		expect(view).toContain('settings: "preferences"');
		expect(view).toContain('jarvis: "assistant"');
		expect(view).toContain("mountVoice: (host) => void this.mountLensVoice(host),");
		const shell = read("src/ui/lens/lens-console.ts");
		expect(shell).toContain('if (isVoice(this.location) && !isVoice(next)) this.host.unmountVoice();');
		expect(shell).toContain('if (isVoice(this.location) && !first) return;');
		expect(view).toContain("void this.rebuildShell();");
		const console = read("src/ui/lens/lens-console.ts");
		expect(console).toContain('el(doc, "div", { id: LENS_ROOT_ID, "data-motion": "on" }, windowEl)');
		expect(console).toContain("this.root.dataset.talosTheme = this.host.appearance();");
	});
});
