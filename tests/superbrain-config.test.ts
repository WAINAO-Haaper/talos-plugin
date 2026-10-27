import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type TalosPlugin from "../src/main";
import type { TalosSettings } from "../src/settings";

const ui = vi.hoisted(() => ({ text: new Map<string, (value: string) => Promise<void>>(), dropdown: new Map<string, (value: string) => Promise<void>>(), button: new Map<string, () => Promise<void>>(), notices: vi.fn() }));
vi.mock("obsidian", () => {
	class Stub {}
	class TFile { path = "System/config.json"; }
	class Setting {
		name = "";
		setName(name: string) { this.name = name; return this; }
		setDesc() { return this; }
		setHeading() { return this; }
		addText(fn: (value: unknown) => unknown) { fn(this.control("text")); return this; }
		addDropdown(fn: (value: unknown) => unknown) { fn(this.control("dropdown")); return this; }
		addButton(fn: (value: unknown) => unknown) { fn(this.control("button")); return this; }
		control(kind: "text" | "dropdown" | "button") {
			let name = this.name;
			const control: Record<string, unknown> = {};
			for (const method of ["setValue", "setPlaceholder", "addOption", "setCta", "setWarning"]) control[method] = () => control;
			control.setButtonText = (text: string) => { name = text; return control; };
			control.onChange = (fn: (value: string) => Promise<void>) => { if (kind !== "button") ui[kind].set(name, fn); return control; };
			control.onClick = (fn: () => Promise<void>) => { ui.button.set(name, fn); return control; };
			return control;
		}
	}
	class PluginSettingTab { constructor(public app: unknown) {} }
	const known: Record<string, unknown> = { __esModule: true, Setting, PluginSettingTab, TFile, Notice: class { constructor(...args: unknown[]) { ui.notices(...args); } } };
	return new Proxy(known, { get: (target, key: string) => key in target ? target[key] : key === "then" ? undefined : Stub, has: () => true });
});
vi.mock("../src/plugin/quyuan-diagnostics", () => ({ recordQuyuanRuntimeError: vi.fn() }));
vi.mock("../src/plugin/quyuan-workbench-init", () => ({ initializeQuyuanSoul: vi.fn() }));
const { DEFAULT_SETTINGS, TalosSettingTab } = await import("../src/settings");
const { VaultPaths, detectSchemaDetailed, resolveSchema } = await import("../src/data/schema");
const { syncSuperbrainDirectoryConfig: sync, getSuperbrainDirectoryConfig, applyDetectedDirectorySettings, markDirectorySettingsManual } = await import("../src/plugin/superbrain-config");
const { autoDetectVaultSchemaOnFirstRun } = await import("../src/plugin/first-run");
const { recordQuyuanRuntimeError } = await import("../src/plugin/quyuan-diagnostics");

function fakePlugin(initial: Partial<TalosSettings> = {}, input: unknown = {}) {
	let raw = JSON.stringify(input);
	let exists = true;
	const saveSettings = vi.fn(async () => undefined);
	const readConfig = vi.fn(async () => raw);
	const plugin = {
		hasSuperbrainCatalog: true,
		talosSettings: structuredClone({ ...DEFAULT_SETTINGS, ...initial }),
		app: { vault: {
			getAbstractFileByPath: (path: string) => path === "System/config.json" && exists ? new TFile() : null,
			cachedRead: readConfig,
			getMarkdownFiles: () => [{ path: "System/health-log.md" }],
			getRoot: () => ({ children: ["Inbox", "Projects", "Notes"].map(name => ({ name, children: [] })) }),
		} },
		get paths() { return new VaultPaths(resolveSchema(plugin.talosSettings.vaultSchema), plugin.talosSettings.vaultFiles); },
		saveTalosSettings: saveSettings, refreshViews: vi.fn(), refreshAllViews: vi.fn(), applyViewSettings: vi.fn(),
	} as unknown as TalosPlugin;
	return { plugin, saveSettings, readConfig, setConfig: (config: unknown) => { raw = JSON.stringify(config); }, setRaw: (value: string) => { raw = value; }, removeConfig: () => { exists = false; } };
}
function renderLibrary(plugin: TalosPlugin) {
	const tab = new TalosSettingTab(plugin.app, plugin);
	vi.spyOn(tab, "display").mockImplementation(() => undefined);
	(tab as unknown as { renderLibrary(c: unknown): void }).renderLibrary({});
}

beforeEach(() => { vi.clearAllMocks(); ui.text.clear(); ui.dropdown.clear(); ui.button.clear(); });

describe("framework directory synchronization", () => {
	it("consumes the nested kit even when first-run detection was already marked, and saves only changes", async () => {
		const { plugin, saveSettings } = fakePlugin({ schemaAutoDetected: true });
		await autoDetectVaultSchemaOnFirstRun(plugin);
		expect(plugin.paths.dir("identity")).toBe("System/Identity");
		expect(plugin.paths.personaFile).toBe("System/灵魂/PERSONA.md");
		expect(plugin.talosSettings.healthLogPath).toBe("System/health-log.md");
		expect(saveSettings).toHaveBeenCalledTimes(1);
		await sync(plugin);
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it("updates automatic module, fixed-file and write paths when config changes", async () => {
		const { plugin, setConfig } = fakePlugin({}, { module_paths: { inbox: "Notes/Inbox", identity: "People/Me" } });
		await sync(plugin);
		expect(plugin.paths.contextFile).toBe("People/Me/CONTEXT.md");
		setConfig({ module_paths: { inbox: "Journal/Capture", identity: "Profiles/Owner" } });
		await sync(plugin);
		expect(plugin.talosSettings.inboxFolder).toBe("Journal/Capture");
		expect(plugin.paths.contextFile).toBe("Profiles/Owner/CONTEXT.md");
		expect(plugin.talosSettings.directoryConfig?.conflicts).toEqual([]);
	});

	it("preserves ambiguous saved schema, file and source fields with explicit conflicts", async () => {
		const { plugin, setConfig } = fakePlugin({ schemaAutoDetected: true, vaultSchema: { identity: "Identity" }, vaultFiles: { persona: "Old/Persona.md" }, tasksPath: "Old/tasks.md" });
		await sync(plugin);
		expect(plugin.paths.dir("identity")).toBe("Identity");
		expect(plugin.paths.personaFile).toBe("Old/Persona.md");
		expect(plugin.talosSettings.tasksPath).toBe("Old/tasks.md");
		expect(plugin.talosSettings.directoryConfig?.conflicts.map(item => item.key)).toEqual(expect.arrayContaining(["schema.identity", "file.persona", "tasksPath"]));
		setConfig({ module_paths: { identity: "New/Identity" } });
		await sync(plugin);
		expect(plugin.paths.dir("identity")).toBe("Identity");
		expect(plugin.talosSettings.directoryConfig?.conflicts.find(item => item.key === "schema.identity")?.configured).toBe("New/Identity");
	});

	it("does not guess that a legacy value equal to the config is automatic", async () => {
		const { plugin, setConfig } = fakePlugin({ vaultSchema: { inbox: "00-收件箱" } });
		await sync(plugin);
		setConfig({ module_paths: { inbox: "Other/Inbox" } });
		await sync(plugin);
		expect(plugin.paths.dir("inbox")).toBe("00-收件箱");
		expect(plugin.talosSettings.directoryConfig?.legacyKeys).toContain("schema.inbox");
	});

	it("framework config replaces known automatic detection but preserves explicit manual fields during scans", async () => {
		const { plugin } = fakePlugin();
		const detection = detectSchemaDetailed(plugin.app);
		applyDetectedDirectorySettings(plugin.talosSettings, detection);
		markDirectorySettingsManual(plugin.talosSettings, ["schema.inbox", "inboxFolder"]);
		applyDetectedDirectorySettings(plugin.talosSettings, { ...detection, schema: { ...detection.schema, inbox: "Capture" } });
		await sync(plugin);
		expect(plugin.paths.dir("inbox")).toBe("Inbox");
		expect(plugin.talosSettings.inboxFolder).toBe("Inbox");
		expect(plugin.paths.dir("identity")).toBe("System/Identity");
	});

	it("retains untracked changes to prior automatic values instead of silently overwriting them", async () => {
		const { plugin } = fakePlugin();
		await sync(plugin);
		plugin.talosSettings.vaultSchema.inbox = "Unknown/Source";
		await sync(plugin);
		expect(plugin.paths.dir("inbox")).toBe("Unknown/Source");
		expect(plugin.talosSettings.directoryConfig?.conflicts).toContainEqual(expect.objectContaining({ key: "schema.inbox", current: "Unknown/Source" }));
	});

	it("keeps extra adopted directories visible without inventing a module assignment", async () => {
		const { plugin } = fakePlugin({}, { content_dirs: ["读书笔记", "System/Identity"], search_dirs: ["读书笔记"], asset_dirs: ["图片"] });
		await sync(plugin);
		expect(getSuperbrainDirectoryConfig(plugin)).toMatchObject({ extraContentDirs: ["读书笔记"], searchDirs: ["读书笔记"], assetDirs: ["图片"] });
		expect(Object.values(plugin.talosSettings.vaultSchema)).not.toContain("读书笔记");
	});

	it("leaves settings intact for invalid config, reports the error once, and recovers", async () => {
		const fixture = fakePlugin();
		await sync(fixture.plugin);
		const before = structuredClone(fixture.plugin.talosSettings);
		fixture.saveSettings.mockClear();
		fixture.setRaw("{bad JSON");
		await sync(fixture.plugin); await sync(fixture.plugin);
		expect(fixture.plugin.talosSettings).toEqual(before);
		expect(fixture.saveSettings).not.toHaveBeenCalled();
		expect(recordQuyuanRuntimeError).toHaveBeenCalledTimes(1);
		fixture.setConfig({ module_paths: { inbox: "Recovered" } });
		await sync(fixture.plugin);
		expect(fixture.plugin.paths.dir("inbox")).toBe("Recovered");
	});

	it("rolls back in-memory settings when persistence fails", async () => {
		const { plugin, saveSettings } = fakePlugin();
		const before = plugin.talosSettings;
		saveSettings.mockRejectedValueOnce(new Error("disk unavailable"));
		await sync(plugin);
		expect(plugin.talosSettings).toBe(before);
		expect(recordQuyuanRuntimeError).toHaveBeenCalledTimes(1);
	});

	it.each([{}, { module_paths: { inbox: "Foreign/Inbox" } }])("ignores a same-named config when the vault has no framework catalog: %j", async config => {
		const { plugin, saveSettings, readConfig } = fakePlugin({ consoleMode: "superbrain" }, config);
		plugin.hasSuperbrainCatalog = false;
		const before = structuredClone(plugin.talosSettings);
		await sync(plugin);
		expect(plugin.talosSettings).toEqual(before);
		expect(saveSettings).not.toHaveBeenCalled();
		expect(readConfig).not.toHaveBeenCalled();
		expect(getSuperbrainDirectoryConfig(plugin)).toBeUndefined();
	});

	it("continues ordinary first-run detection when a non-framework vault has a same-named config", async () => {
		const { plugin, saveSettings, readConfig } = fakePlugin({}, { module_paths: { inbox: "Foreign/Inbox" } });
		plugin.hasSuperbrainCatalog = false;
		await autoDetectVaultSchemaOnFirstRun(plugin);
		expect(plugin.paths.dir("inbox")).toBe("Inbox");
		expect(plugin.paths.dir("identity")).toBe("Identity");
		expect(plugin.talosSettings.schemaAutoDetected).toBe(true);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(readConfig).not.toHaveBeenCalled();
	});

	it("leaves a vault without framework config alone", async () => {
		const { plugin, removeConfig, saveSettings } = fakePlugin(); removeConfig();
		await sync(plugin);
		expect(plugin.talosSettings.directoryConfig).toBeNull();
		expect(saveSettings).not.toHaveBeenCalled();
	});
});

describe("settings write provenance", () => {
	it("pins manual edits even when the user enters the previous automatic value", async () => {
		const { plugin, setConfig } = fakePlugin(); await sync(plugin); renderLibrary(plugin);
		await ui.text.get("Identity")!("System/Identity");
		await ui.text.get("AI 人格（PERSONA）")!("System/灵魂/PERSONA.md");
		await ui.text.get("系统焦点任务")!(plugin.talosSettings.tasksPath);
		setConfig({ module_paths: { identity: "Profiles/Me", soul: "Profiles/AI", system: "Meta" } }); await sync(plugin);
		expect(plugin.paths.dir("identity")).toBe("System/Identity");
		expect(plugin.paths.personaFile).toBe("System/灵魂/PERSONA.md");
		expect(plugin.talosSettings.tasksPath).toBe("System/working-memory/tasks.md");
		expect(plugin.talosSettings.directoryConfig?.manualKeys).toEqual(expect.arrayContaining(["schema.identity", "file.persona", "tasksPath"]));
	});

	it("derives automatic fixed files after manual module edits", async () => {
		const { plugin } = fakePlugin(); await sync(plugin); renderLibrary(plugin);
		await ui.text.get("Identity")!("Personal/Profile");
		expect(plugin.paths.contextFile).toBe("Personal/Profile/CONTEXT.md");
	});

	it("records applying presets and restoring defaults as explicit module choices", async () => {
		const { plugin, setConfig } = fakePlugin(); await sync(plugin); renderLibrary(plugin);
		await ui.dropdown.get("自动识别")!("en");
		setConfig({ module_paths: { inbox: "Capture" } }); await sync(plugin);
		expect(plugin.paths.dir("inbox")).toBe("00-Inbox");
		await ui.button.get("恢复默认目录")!();
		await sync(plugin);
		expect(plugin.paths.dir("inbox")).toBe("00-收件箱");
		expect(plugin.talosSettings.directoryConfig?.manualKeys).toContain("schema.inbox");
	});

	it("keeps a newly confirmed manual field when the existing conflict button accepts the remaining fields", async () => {
		const { plugin } = fakePlugin({ vaultSchema: { identity: "Identity", soul: "灵魂" } });
		await sync(plugin); renderLibrary(plugin);
		expect(plugin.talosSettings.directoryConfig?.conflicts.map(item => item.key)).toEqual(["schema.identity", "schema.soul"]);
		await ui.text.get("Identity")!("Personal/Identity");
		await ui.button.get("采用冲突中的框架路径")!();
		expect(plugin.paths.dir("identity")).toBe("Personal/Identity");
		expect(plugin.paths.dir("soul")).toBe("System/灵魂");
		expect(plugin.talosSettings.directoryConfig?.manualKeys).toContain("schema.identity");
		expect(plugin.talosSettings.directoryConfig?.conflicts).toEqual([]);
	});

	it("lets the user explicitly resolve legacy conflicts in favor of framework paths", async () => {
		const { plugin } = fakePlugin({ vaultSchema: { identity: "Identity" } });
		await sync(plugin); renderLibrary(plugin);
		await ui.button.get("采用冲突中的框架路径")!();
		expect(plugin.paths.dir("identity")).toBe("System/Identity");
		expect(plugin.talosSettings.directoryConfig?.conflicts).toEqual([]);
	});
});
