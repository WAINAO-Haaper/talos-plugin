import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";
import { decodeProviderModelSelectionId, encodeProviderModelSelectionId, toProviderRuntimeModelId } from "../src/quyuan/claudian/core/providers/modelSelection";

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
		for (const contract of ["talos-agent-runtime-switcher", "talos-agent-runtime-button", "talos-agent-provider-picker", "talos-agent-model-control", "talos-agent-model-trigger", "talos-agent-model-menu", "talos-agent-model-picker", "talos-agent-workflow", "talos-agent-permission-picker", "talos-agent-runtime-status", "talos-agent-install-link", "talos-agent-handoff-marker", "talos-agent-approval-region"]) expect(view).toContain(contract);
		expect(view).toContain('setAttribute("aria-live", "polite")');
		expect(view).toContain('setAttribute("aria-live", "assertive")');
		expect(view).toContain('setAttribute("role", "listbox")');
		expect(view).toContain('setAttribute("aria-selected"');
		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain("@container talos-main (max-width: 720px)");
	});

	it("uses a dynamic in-conversation model switcher with visible purpose and switching feedback", () => {
		for (const contract of ["automaticModelPresentation", "presentRuntimeModel", "正在切换到", "从下一回合生效", "handleModelMenuKeydown"]) {
			expect(view).toContain(contract);
		}
		for (const contract of [".talos-agent-model-option", ".talos-agent-model-option-badge", "talos-agent-model-menu-in", "talos-agent-model-progress"]) {
			expect(css).toContain(contract);
		}
	});

	it("shows runtime handoffs as one temporary overlay instead of taking chat layout space", () => {
		for (const contract of ["handoffToast", "handoffDismissTimer", "clearHandoffToast", 'marker.classList.add("is-visible")']) {
			expect(view).toContain(contract);
		}
		expect(view).toContain("}, 3200)");
		expect(css).toMatch(/\.talos-agent-handoff-marker\s*\{[^}]*position:\s*absolute/s);
		expect(css).toContain(".talos-agent-handoff-marker.is-visible");
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
		expect(css).toMatch(/\.talos-agent-compatibility-body \.claudian-model-selector\s*\{[^}]*display:\s*none !important/s);
		expect(css).toContain(".talos-quyuan-capabilities--embedded");
	});

	it("routes the top logo switcher into the embedded runtime and gives OhMyPi an unambiguous model namespace", () => {
		expect(view).toContain("compatibility.selectRuntime");
		expect(view).toContain('button.dataset.runtime = runtime.id');
		expect(view).toContain('button.addEventListener("click"');
		expect(view).toContain("this.updateRuntimeButtons(runtimeId)");
		expect(decodeProviderModelSelectionId(encodeProviderModelSelectionId("ohmypi", "synthetic/model"))).toEqual({ providerId: "ohmypi", modelId: "synthetic/model" });
	});

	it("restores each runtime's saved model and persists runtime-native model ids", () => {
		expect(claudianView).toContain("const resolvedModelId = modelId ?? (savedModel || 'default')");
		expect(claudianView).toContain("ProviderSettingsCoordinator.getProviderSettingsSnapshot");
		expect(claudianView).toContain("toProviderRuntimeModelId(runtimeId, model)");
		expect(view).toContain("current.runtimeId === runtimeId ? undefined : null");
		expect(claudianView).not.toContain("modelId = 'default'");
		expect(tab).toContain("const runtimeModel = toProviderRuntimeModelId(modelProvider, model)");
		expect(tab).toContain("const runtimeModel = toProviderRuntimeModelId(newProvider, model)");
		expect(tab).toContain("tab.draftModel = runtimeModel");
		expect(tab).toContain("settings.model = runtimeModel");
		expect(tab).toContain("nextUIConfig.applyModelDefaults(runtimeModel, settings)");
		expect(tab).toContain("const runtimeModel = toProviderRuntimeModelId(boundProvider, model)");
		expect(toProviderRuntimeModelId("codex", encodeProviderModelSelectionId("codex", "gpt-5.5"))).toBe("gpt-5.5");
		expect(toProviderRuntimeModelId("claude", encodeProviderModelSelectionId("claude", "sonnet"))).toBe("sonnet");
		expect(toProviderRuntimeModelId("ohmypi", encodeProviderModelSelectionId("ohmypi", "deepseek/deepseek-chat"))).toBe("deepseek/deepseek-chat");
	});
});
