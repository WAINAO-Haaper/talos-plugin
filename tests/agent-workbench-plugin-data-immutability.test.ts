import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");
const storageSource = readFileSync(`${projectRoot}src/agent-workbench/storage/obsidian-workbench-storage.ts`, "utf8");
const importerSource = readFileSync(`${projectRoot}src/agent-workbench/legacy/claudian-readonly-importer.ts`, "utf8");

describe("agent workbench plugin data immutability", () => {
	it("stores TALOS-owned settings, permissions and bindings only in the sidecar namespace", () => {
		expect(mainSource).toContain('const workbenchStateRoot = ".talos/agent-workbench/v1"');
		expect(mainSource).toContain('`${workbenchStateRoot}/settings.json`');
		expect(mainSource).toContain('`${workbenchStateRoot}/permission-rules.json`');
		expect(mainSource).toContain('`${workbenchStateRoot}/runtime-bindings.json`');
		expect(mainSource).toContain('`${workbenchStateRoot}/input-ledger.json`');
		expect(mainSource).toContain('`${workbenchStateRoot}/ui-state.json`');
		expect(mainSource).not.toContain("stored.agentWorkbenchPermissionRules");
		expect(mainSource).not.toContain("stored.agentWorkbenchBindings");
		expect(mainSource).toContain("chat-surface.json");
		expect(viewSource).toContain("this.plugin.setAgentWorkbenchSurface(id)");
		expect(viewSource).not.toContain("this.plugin.talosSettings.harnessSurface = id");
	});

	it("uses atomic TALOS sidecar writes and keeps old source bytes read-only", () => {
		expect(storageSource).toContain("writeJsonAtomic");
		expect(storageSource).toContain("await this.flush()");
		expect(storageSource).toContain("await this.replace(temporary, file)");
		expect(importerSource).toContain("sourceAggregateBefore");
		expect(importerSource).toContain("sourceAggregateAfter");
		expect(importerSource).toContain("旧 Claudian 源数据在导入期间发生变化");
	});
});
