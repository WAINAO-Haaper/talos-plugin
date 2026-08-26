import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";
import { decodeProviderModelSelectionId, encodeProviderModelSelectionId } from "../src/quyuan/claudian/core/providers/modelSelection";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/agent-workbench/ui/talos-agent-workbench.ts`, "utf8");
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");
const registration = readFileSync(`${root}src/agent-workbench/ui/adapter-provider-registration.ts`, "utf8");
const compatibilityHost = readFileSync(`${root}src/agent-workbench/ui/claudian-compatibility-host.ts`, "utf8");
const claudianView = readFileSync(`${root}src/quyuan/claudian/features/chat/ClaudianView.ts`, "utf8");
const tab = readFileSync(`${root}src/quyuan/claudian/features/chat/tabs/Tab.ts`, "utf8");

describe("TALOS agent workbench compatibility UI", () => {
	it("registers all three TALOS adapter providers while preserving the renderer provider contract", () => {
		for (const id of ["claude", "codex", "ohmypi"]) expect(registration).toContain(`ProviderRegistry.register("${id}"`);
		expect(registration).toContain("AdapterCompatibilityRuntime");
		expect(registration).toContain("QueryBackedTitleGenerationService");
		expect(registration).toContain("QueryBackedInstructionRefineService");
		expect(registration).toContain("QueryBackedInlineEditService");
	});

	it("forwards the owning workbench service through the transitional compatibility host", () => {
		expect(compatibilityHost).toContain("getAgentWorkbenchService(): AgentWorkbenchService");
		expect(compatibilityHost).toContain("return this.delegate.getAgentWorkbenchService();");
	});

	it("keeps Plan/Execute orthogonal to Ask/Scoped/Vault Full in service state", () => {
		const service = new AgentWorkbenchService({ compatibility: { initialize: async () => {}, dispose: () => {} } });
		service.setWorkflowMode("execute"); service.setPermissionMode("vault-full");
		expect(service.getWorkflowMode()).toBe("execute");
		expect(service.getPermissionMode()).toBe("vault-full");
		service.setWorkflowMode("plan");
		expect(service.getPermissionMode()).toBe("vault-full");
	});

	it("exposes runtime/provider/model, dual permission dimensions, status/install, handoff and accessible live regions", () => {
		for (const contract of ["talos-agent-runtime-switcher", "talos-agent-runtime-button", "talos-agent-provider-picker", "talos-agent-model-picker", "talos-agent-workflow", "talos-agent-permission-picker", "talos-agent-runtime-status", "talos-agent-install-link", "talos-agent-handoff-marker", "talos-agent-approval-region"]) expect(view).toContain(contract);
		expect(view).toContain('setAttribute("aria-live", "polite")');
		expect(view).toContain('setAttribute("aria-live", "assertive")');
		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain("@container talos-main (max-width: 720px)");
	});

	it("uses the registered standard provider SVG prototypes and plain-language dynamic modes", () => {
		for (const icon of ["CLAUDE_PROVIDER_ICON", "OPENAI_PROVIDER_ICON", "PI_PROVIDER_ICON"]) {
			expect(view).toContain(icon);
			expect(registration).toContain(icon);
		}
		for (const label of ["只规划", "可执行", "每次询问", "仅已授权范围", "Vault 普通写入自动", "已就绪", "未安装"]) {
			expect(view).toContain(label);
		}
		expect(css).toContain(".talos-agent-runtime-button.is-active");
		expect(css).toContain("background-color: transparent !important");
	});

	it("removes duplicate embedded chrome while preserving capabilities beside the composer", () => {
		expect(claudianView).toContain("if (!this.embeddedMode)");
		expect(claudianView).toContain("buildTalosCapabilityControls(navActionsEl, true)");
		expect(claudianView).toContain("talos-quyuan-capability-button--embedded");
		expect(css).toContain(".talos-agent-compatibility-body :is(.claudian-header, .talos-quyuan-statusbar)");
		expect(css).toContain(".talos-quyuan-capabilities--embedded");
	});

	it("routes the top logo switcher into the embedded runtime and gives OhMyPi an unambiguous model namespace", () => {
		expect(view).toContain("compatibility.selectRuntime");
		expect(decodeProviderModelSelectionId(encodeProviderModelSelectionId("ohmypi", "synthetic/model"))).toEqual({ providerId: "ohmypi", modelId: "synthetic/model" });
	});

	it("restores each runtime's saved model and persists runtime-native model ids", () => {
		expect(claudianView).toContain("const resolvedModelId = modelId ?? (savedModel || 'default')");
		expect(claudianView).toContain("ProviderSettingsCoordinator.getProviderSettingsSnapshot");
		expect(claudianView).not.toContain("modelId = 'default'");
		expect(tab).toContain("const runtimeModel = toProviderRuntimeModelId(modelProvider, model)");
		expect(tab).toContain("settings.model = runtimeModel");
		expect(tab).toContain("nextUIConfig.applyModelDefaults(runtimeModel, settings)");
	});
});
