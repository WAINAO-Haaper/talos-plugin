import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const main = readFileSync(`${root}src/main.ts`, "utf8");
const view = readFileSync(`${root}src/view.ts`, "utf8");
const legacy = readFileSync(`${root}src/quyuan/claudian/main.ts`, "utf8");

describe("D-TLP-034 ownership baseline", () => {
	it("makes the TALOS plugin own the workbench by composition", () => {
		expect(main).toMatch(/class TalosPlugin extends Plugin\b/);
		expect(main).not.toContain("extends ClaudianWorkbenchPlugin");
		expect(main).not.toContain("await super.onload()");
	});

	it("keeps the serialized codex slot while exposing TALOS Agent", () => {
		expect(view).toContain('id: "codex"');
		expect(view).toContain('label: "TALOS 智能体"');
		expect(view).toContain("TalosAgentWorkbench");
	});

	it("never rewrites legacy Claudian sessions during startup", () => {
		expect(legacy).not.toContain("migratedLegacyConversations");
		expect(legacy).not.toContain("migratedFromLegacyProvider");
	});
});
