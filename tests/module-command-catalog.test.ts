import { describe, expect, it } from "vitest";
import {
	LEGACY_COMMAND_ALIASES,
	MODULE_ACTION_IDS,
	MODULE_ACTIONS,
	MODULE_COMMAND_GROUP_IDS,
	MODULE_COMMAND_GROUPS,
	getModuleAction,
	getModuleActionsForGroup,
	getModuleActionsForPage,
	resolveLegacyCommand,
	type ModuleActionId,
} from "../src/module-commands/catalog";
import { resolvePageRoute } from "../src/ui/navigation-model";
import { ModuleCommandService, type ModuleCommandHost } from "../src/module-commands/service";
import { encodeDataPackageFile, serializeDataPackage } from "../src/module-commands/data-format";

describe("module action catalog", () => {
	it("provides ten populated groups and resolves every action through one catalog", () => {
		expect(MODULE_COMMAND_GROUP_IDS).toEqual([
			"setup", "capture", "library", "search", "project", "profile", "flow", "media", "convert", "system",
		]);
		expect(new Set(MODULE_ACTIONS.map((entry) => entry.id)).size).toBe(MODULE_ACTIONS.length);
		expect(MODULE_ACTIONS.map((entry) => entry.id)).toEqual([...MODULE_ACTION_IDS]);
		for (const group of MODULE_COMMAND_GROUPS) {
			const actions = getModuleActionsForGroup(group.id);
			expect(actions.length).toBeGreaterThan(0);
			for (const entry of actions) {
				expect(getModuleAction(entry.id)).toBe(entry);
				expect(entry.id.startsWith(`${group.id}.`)).toBe(true);
				expect(entry.label).not.toBe("");
				expect(entry.description).not.toBe("");
				expect(new Set(entry.inputs.map((input) => input.name)).size).toBe(entry.inputs.length);
			}
		}
		expect(getModuleAction("system.delete-everything")).toBeUndefined();
	});

	it("only references real pages and normalizes existing page aliases", () => {
		for (const entry of MODULE_ACTIONS) {
			expect(entry.pages.length).toBeGreaterThan(0);
			for (const page of entry.pages) {
				expect(resolvePageRoute(page), `${entry.id}: ${page}`).not.toBeNull();
				expect(getModuleActionsForPage(page)).toContain(entry);
			}
		}
		expect(getModuleActionsForPage("workbench")).toEqual(getModuleActionsForPage("overview"));
		expect(getModuleActionsForPage("system")).toEqual(getModuleActionsForPage("health"));
		expect(getModuleActionsForPage("talos-quyuan-view")).toEqual(getModuleActionsForPage("chat"));
		expect(getModuleActionsForPage("unregistered-page")).toEqual([]);
		expect(getModuleActionsForGroup("flow").every((entry) => !entry.pages.includes("workflow"))).toBe(true);
	});

	it("separates native text and user-selected file handling from provider capabilities", () => {
		expect(getModuleAction("library.import")).toMatchObject({
			availability: "local", effect: "write", requiresCapabilities: [],
			inputs: [{ name: "files", type: "files", required: true }],
		});
		expect(getModuleAction("library.restore")).toMatchObject({
			availability: "local", effect: "write", requiresCapabilities: [],
			inputs: [{ name: "file", type: "file", required: true }],
		});
		expect(getModuleAction("convert.convert")).toMatchObject({
			availability: "local", effect: "write", requiresCapabilities: [],
		});
		expect(getModuleAction("convert.convert")?.inputs.find((entry) => entry.name === "format")?.options).toEqual(["md", "txt", "html"]);
		expect(getModuleAction("convert.convert")?.advancedCapabilities?.map((entry) => entry.capability)).toEqual([
			"convert.documents", "convert.images", "convert.video",
		]);
		for (const id of ["media.ocr", "media.transcribe", "search.ask"] as const) {
			const entry = getModuleAction(id)!;
			expect(entry.availability).toBe("capability-required");
			expect(entry.requiresCapabilities.length).toBeGreaterThan(0);
		}
	});

	it("marks profile changes and restoration as writes while lookup and checks remain reads", () => {
		for (const id of ["setup.initialize", "profile.update", "library.restore", "system.repair"] as const) {
			expect(getModuleAction(id)?.effect).toBe("write");
		}
		for (const id of ["setup.inspect", "profile.show", "search.find", "search.ask", "system.check", "flow.morning"] as const) {
			expect(getModuleAction(id)?.effect).toBe("read");
		}
	});

	it("exposes the bounded local cycle and deterministic metadata repair", () => {
		for (const id of ["flow.cycle", "system.repair"] as const) {
			expect(getModuleAction(id)).toMatchObject({ availability: "local", requiresCapabilities: [], effect: "write" });
		}
		expect(getModuleAction("flow.cycle")?.inputs.map(field => field.name)).toEqual(["path", "content", "memory_kind"]);
		expect(getModuleAction("system.repair")?.inputs.map(field => field.name)).toEqual(["scope"]);
		expect(resolveLegacyCommand("/full-cycle")).toMatchObject({
			kind: "action", actionId: "flow.cycle", action: { availability: "local", requiresCapabilities: [] },
		});
		expect(resolveLegacyCommand("/maintain repair")).toMatchObject({
			kind: "action", actionId: "system.repair", action: { availability: "local", requiresCapabilities: [] },
		});
	});
});

describe("legacy command routing", () => {
	it("covers the twenty established commands without invented aliases", () => {
		expect(LEGACY_COMMAND_ALIASES.map((entry) => entry.command).sort()).toEqual([
			"brand", "create", "digest", "export-okf", "full-cycle", "intake", "log", "maintain", "memory", "metrics",
			"mine-rules", "morning", "output", "retrieval", "weekly-reset", "capture", "ingest-customer", "review", "setup", "talos-ask",
		].sort());
		for (const alias of LEGACY_COMMAND_ALIASES) {
			const result = resolveLegacyCommand(`/${alias.command}`);
			expect(result.kind).toBe(alias.extension ? "optional-extension" : alias.capability ? "capability-required" : alias.requiresAction ? "requires-action" : "action");
			if (result.kind === "action") expect(getModuleAction(result.actionId)).toBe(result.action);
		}
	});

	it("keeps brand, business, marketing and rule mining as explicit optional extensions", () => {
		for (const command of ["brand", "create", "output", "log", "metrics", "mine-rules"]) {
			const result = resolveLegacyCommand(`/${command} 示例参数`, { mode: "execute", actionId: "capture.note" });
			expect(result).toMatchObject({ kind: "optional-extension", command, args: "示例参数" });
			expect("actionId" in result).toBe(false);
		}
		expect(resolveLegacyCommand("/marketing")).toMatchObject({ kind: "unknown" });
	});

	it("does not substitute a capture or export action for legacy creation and publishing", () => {
		expect(resolveLegacyCommand("/create", { mode: "execute", actionId: "capture.note" })).toMatchObject({ kind: "optional-extension", extension: "creation" });
		expect(resolveLegacyCommand("/output", { mode: "execute", actionId: "library.export" })).toMatchObject({ kind: "optional-extension", extension: "publishing" });
	});

	it("requires a specific profile action instead of claiming the full memory workflow ran", () => {
		const result = resolveLegacyCommand("/memory", { mode: "execute", actionId: "profile.show" });
		expect(result).toMatchObject({ kind: "requires-action", group: "profile" });
		expect("actionId" in result).toBe(false);
	});

	it("does not misroute business logs or marketing metrics to general personal data actions", () => {
		expect(resolveLegacyCommand("/log")).toMatchObject({ kind: "optional-extension", extension: "business" });
		expect(resolveLegacyCommand("/metrics")).toMatchObject({ kind: "optional-extension", extension: "marketing" });
	});

	it("keeps identity inference pending a profile action instead of importing or overwriting data", () => {
		const result = resolveLegacyCommand("/ingest-customer 资料", { mode: "execute", actionId: "library.import" });
		expect(result).toMatchObject({ kind: "requires-action", group: "profile", args: "资料" });
		expect("actionId" in result).toBe(false);
		expect("extension" in result).toBe(false);
	});

	it("preserves the legacy OKF export contract rather than silently generating a JSON package", () => {
		const result = resolveLegacyCommand("/export-okf 示例", { mode: "execute", actionId: "library.export" });
		expect(result).toMatchObject({ kind: "capability-required", capability: "library.export.okf", format: "okf", args: "示例" });
		expect("actionId" in result).toBe(false);
	});

	it("resolves established aliases, preserving parameters without executing them", () => {
		expect(resolveLegacyCommand("  /RETRIEVAL  测试  资料  ")).toMatchObject({
			kind: "action", command: "retrieval", actionId: "search.find", args: "测试  资料",
		});
		expect(resolveLegacyCommand("/capture 今日记录")).toMatchObject({ actionId: "capture.note" });
		expect(resolveLegacyCommand("/setup")).toMatchObject({ actionId: "setup.inspect" });
	});

	it("does not turn a default maintenance request into a write", () => {
		expect(resolveLegacyCommand("/maintain quick")).toMatchObject({ actionId: "system.check", action: { effect: "read" } });
		expect(resolveLegacyCommand("/maintain repair")).toMatchObject({ actionId: "system.repair", action: { effect: "write" } });
		expect(resolveLegacyCommand("/maintain repair-everything")).toMatchObject({ actionId: "system.check" });
	});

	it("routes ordinary talos-ask to read-only search but requires an explicit action for execution", () => {
		expect(resolveLegacyCommand("/talos-ask 总结资料")).toMatchObject({ actionId: "search.ask", action: { effect: "read" } });
		for (const input of ["/talos-ask --execute 任意指令", "/talos-ask execute 任意指令", "/talos-ask 执行 任意指令"]) {
			expect(resolveLegacyCommand(input)).toMatchObject({ kind: "requires-action" });
		}
		expect(resolveLegacyCommand("/talos-ask 任意指令", { mode: "execute" })).toMatchObject({ kind: "requires-action" });
		expect(resolveLegacyCommand("/talos-ask 任意指令", {
			mode: "execute", actionId: "not.registered" as ModuleActionId,
		})).toMatchObject({ kind: "requires-action" });
	});

	it("returns the same registered action when talos-ask explicitly requests a routed execution", () => {
		const result = resolveLegacyCommand("/talos-ask --execute 新笔记", {
			mode: "execute", actionId: "capture.note",
		});
		expect(result).toMatchObject({ kind: "action", actionId: "capture.note", action: { effect: "write" } });
		if (result.kind === "action") expect(result.action).toBe(getModuleAction("capture.note"));
	});

	it("rejects unknown or malformed command names rather than guessing a fallback", () => {
		for (const input of ["", "//morning", "/unknown", "/morning;delete", "/morning/other", "ordinary prose"]) {
			expect(resolveLegacyCommand(input).kind, input).toBe("unknown");
		}
	});
});

function nativeServiceFixture(): { service: ModuleCommandService; files: Map<string, Uint8Array> } {
	const encoder = new TextEncoder();
	const files = new Map([
		["inbox/source.md", encoder.encode("---\nstatus: inbox\n---\n\n# Example\nOriginal content.\n")],
		["identity/PROFILE.md", encoder.encode("# Existing profile\nConfirmed context.\n")],
		["projects/example.md", encoder.encode("# Example project\n")],
	]);
	const now = new Date("2026-09-05T10:00:00Z");
	const host: ModuleCommandHost = {
		roots: () => ({ inbox: "inbox", logs: "logs", insights: "insights", assets: "assets", projects: "projects", archive: "archive", identity: "identity", output: "output" }),
		files: () => [...files].map(([path, bytes]) => ({ path, extension: path.split(".").pop() ?? "", size: bytes.length, mtime: now.getTime() })),
		exists: async (path) => files.has(path),
		read: async (path) => {
			const bytes = files.get(path);
			if (!bytes) throw new Error("Missing synthetic file");
			return new Uint8Array(bytes);
		},
		write: async (path, bytes) => { files.set(path, new Uint8Array(bytes)); },
		remove: async (path) => { files.delete(path); },
		assertPath: async () => undefined,
		now: () => now,
	};
	return { service: new ModuleCommandService(host), files };
}

/** The UI sends every text control and normalizes file/files controls to input.files. */
function formInput(id: ModuleActionId, values: Record<string, unknown>): Record<string, unknown> {
	const input: Record<string, unknown> = {};
	for (const field of getModuleAction(id)!.inputs) {
		if (field.type === "file" || field.type === "files") input.files = values[field.name];
		else input[field.name] = values[field.name] ?? "";
	}
	return input;
}

describe("catalog inputs against native service preparation", () => {
	it("records a task from its title without submitting an empty body that suppresses fallback", async () => {
		const { service } = nativeServiceFixture();
		const input = formInput("capture.task", { title: "Review the draft" });
		expect(input).toEqual({ title: "Review the draft" });
		const plan = await service.prepare("capture.task", input);
		expect(new TextDecoder().decode(plan.changes[0].after)).toContain("- [ ] Review the draft");
	});

	it("appends confirmed profile text through the declared content field", async () => {
		const { service } = nativeServiceFixture();
		const plan = await service.prepare("profile.update", formInput("profile.update", { content: "Use concise replies." }));
		expect(plan.changes[0].path).toBe("identity/PROFILE.md");
		const text = new TextDecoder().decode(plan.changes[0].after);
		expect(text).toContain("Confirmed context.");
		expect(text).toContain("Use concise replies.");
	});

	it("describes organization as a copy and archival as an in-place status change", async () => {
		const { service, files } = nativeServiceFixture();
		const organize = await service.prepare("library.organize", formInput("library.organize", { path: "inbox/source.md", destination: "insights" }));
		expect(organize.changes).toHaveLength(1);
		expect(organize.changes[0]).toMatchObject({ path: "insights/source.md", before: null });
		expect(organize.changes[0].after).toEqual(files.get("inbox/source.md"));
		expect(getModuleAction("library.organize")?.description).toContain("保留原件");
		const archive = await service.prepare("library.archive", formInput("library.archive", { path: "inbox/source.md" }));
		expect(archive.changes).toHaveLength(1);
		expect(archive.changes[0].path).toBe("inbox/source.md");
		expect(new TextDecoder().decode(archive.changes[0].after)).toContain("status: archived");
		expect(getModuleAction("library.archive")?.description).toContain("保留位置");
	});

	it("requires an explicit backup selection and normalizes one restore file as the UI does", async () => {
		const { service } = nativeServiceFixture();
		expect(getModuleAction("library.backup")?.inputs).toMatchObject([{ name: "path", required: true }]);
		await expect(service.prepare("library.backup", {})).rejects.toThrow("明确选择");
		const backup = await service.prepare("library.backup", formInput("library.backup", { path: "inbox/source.md" }));
		expect(backup.changes[0].path).toMatch(/^output\/资料包-.*\.json$/);
		const bytes = new TextEncoder().encode(serializeDataPackage([encodeDataPackageFile("inbox/example.txt", "Example content")]));
		const restore = await service.prepare("library.restore", formInput("library.restore", { file: [{ name: "backup.json", content: bytes }] }));
		expect(restore.changes).toHaveLength(1);
		expect(restore.changes[0].path).toMatch(/^inbox\/恢复-.*\/inbox\/example\.txt$/);
		expect(restore.changes[0].before).toBeNull();
	});

	it("keeps morning read-only and removes an ignored project path selector", async () => {
		const { service } = nativeServiceFixture();
		const morning = await service.prepare("flow.morning", formInput("flow.morning", {}));
		expect(getModuleAction("flow.morning")?.effect).toBe("read");
		expect(morning.changes).toEqual([]);
		expect(getModuleAction("project.status")?.inputs).toEqual([]);
		const projects = await service.prepare("project.status", formInput("project.status", {}));
		expect(projects.result.paths).toEqual(["projects/example.md"]);
	});

	it("can prepare every advertised output format for a Markdown source", async () => {
		const { service } = nativeServiceFixture();
		const formats = getModuleAction("convert.convert")!.inputs.find((field) => field.name === "format")!.options!;
		for (const format of formats) {
			const plan = await service.prepare("convert.convert", formInput("convert.convert", { path: "inbox/source.md", format }));
			expect(plan.changes).toHaveLength(1);
			expect(plan.changes[0].path.endsWith(`.${format}`)).toBe(true);
			expect(plan.changes[0].before).toBeNull();
		}
	});
});
