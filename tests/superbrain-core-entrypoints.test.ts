import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseModuleInvocation } from "../src/ui/console-mode";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");

describe("Superbrain core entrypoints", () => {
	it("routes every fixed C/M id to its detail page", () => {
		const ids = [
			...Array.from({ length: 15 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`),
			...Array.from({ length: 10 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`),
		];
		for (const id of ids) expect(parseModuleInvocation(`superbrain:${id}`)).toEqual({ kind: "detail", id });
		expect(mainSource).toContain("leaf.view.openSuperbrainDetailPage(id)");
	});

	it("rejects malformed C/M identifiers before the module action router", () => {
		for (const invalid of ["C00", "C16", "M00", "M11", "C1", "C01\n", "../C01", ""]) {
			expect(parseModuleInvocation(`superbrain:${invalid}`)).toEqual({ kind: "invalid" });
		}
	});

	it("keeps the framework home and generic module actions", () => {
		expect(parseModuleInvocation("superbrain")).toEqual({ kind: "home" });
		expect(parseModuleInvocation("capture.note")).toEqual({ kind: "action", invocation: "capture.note" });
		expect(viewSource).toContain("this.renderDecisionWorkspace(host, this.data, 12)");
	});

	it("registers module commands only in superbrain framework mode", () => {
		expect(mainSource).toContain('if (this.talosSettings.consoleMode === "superbrain") this.registerSuperbrainCommands();');
	});
});
