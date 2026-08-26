import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");
const vaultAdapterSource = readFileSync(
	`${projectRoot}src/quyuan/claudian/core/storage/VaultFileAdapter.ts`,
	"utf8",
);
const sharedStorageSource = readFileSync(
	`${projectRoot}src/quyuan/claudian/app/storage/SharedStorageService.ts`,
	"utf8",
);

describe("agent workbench plugin data immutability", () => {
	it("stores TALOS-owned settings, permissions and bindings only in the sidecar namespace", () => {
		expect(mainSource).toContain('const workbenchStateRoot = ".talos/agent-workbench/v1"');
		expect(mainSource).toContain('`${workbenchStateRoot}/settings.json`');
		expect(mainSource).toContain('`${workbenchStateRoot}/permission-rules.json`');
		expect(mainSource).toContain('`${workbenchStateRoot}/runtime-bindings.json`');
		expect(mainSource).not.toContain("stored.agentWorkbenchPermissionRules");
		expect(mainSource).not.toContain("stored.agentWorkbenchBindings");
		expect(mainSource).toContain("chat-surface.json");
		expect(viewSource).toContain("this.plugin.setAgentWorkbenchSurface(id)");
		expect(viewSource).not.toContain("this.plugin.talosSettings.harnessSurface = id");
	});

	it("routes compatibility tab and session state away from plugin data in read-only mode", () => {
		expect(sharedStorageSource).toContain("TALOS_COMPATIBILITY_HOST_PATH");
		expect(sharedStorageSource).toContain("TALOS_TAB_MANAGER_STATE_PATH");
		expect(sharedStorageSource).toContain("private sidecarWriteQueue: Promise<void> = Promise.resolve()");
		expect(sharedStorageSource).toContain("this.sidecarWriteQueue.catch(() => {}).then");
		expect(sharedStorageSource).toContain("this.adapter.replace(temporary, path)");
		expect(vaultAdapterSource).toContain("renameFile(adapter.getFullPath(oldPath), adapter.getFullPath(newPath))");
		expect(sharedStorageSource).toContain("const loaded = await this.readSidecar(TALOS_COMPATIBILITY_HOST_PATH)");
		expect(sharedStorageSource).toContain("if (this.readOnly) {\n        await this.writeSidecar(TALOS_TAB_MANAGER_STATE_PATH, state);\n        return;");
		expect(sharedStorageSource).toContain("const data: unknown = this.readOnly\n        ? await this.readSidecar(TALOS_TAB_MANAGER_STATE_PATH)\n        : await this.plugin.loadData();");
	});
});
