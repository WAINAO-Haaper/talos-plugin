import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";
import { migrateLegacyTabManagerState, WorkbenchUiStateStore } from "../src/agent-workbench/storage/workbench-ui-state-store";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path: string) => readFileSync(`${root}${path}`, "utf8");
const workbench = source("src/agent-workbench/ui/talos-agent-workbench.ts");
const conversation = source("src/agent-workbench/ui/native-conversation-view.ts");
const serviceSource = source("src/agent-workbench/core/agent-workbench-service.ts");
const composer = source("src/agent-workbench/ui/native-composer.ts");
const renderer = source("src/agent-workbench/ui/native-event-renderer.ts");
const main = source("src/main.ts");
const css = source("styles.ui-v2.css");
const styleIndex = source("src/agent-workbench/ui/styles/index.css");

describe("TALOS native agent workbench UI", () => {
	it("owns every production chat entry without importing the retired implementation", () => {
		expect(main).toContain("TalosAgentRecoveryView");
		expect(main).not.toContain("setSystemContext(this.quyuanSoul");
		expect(main).toContain("VIEW_TYPE_TALOS_AGENT_RECOVERY");
		expect(main).toContain("ConversationInputLedger");
		expect(main).toContain("WorkbenchUiStateStore");
		expect(main).not.toContain("ClaudianCompatibilityHost");
		expect(main).not.toContain("createClaudianProviderAdapters");
		expect(main).not.toContain("quyuan/claudian");
	});

	it("keeps Plan/Execute orthogonal to Ask/Scoped/Vault Full", () => {
		const service = new AgentWorkbenchService({});
		service.setWorkflowMode("execute");
		service.setPermissionMode("vault-full");
		service.setWorkflowMode("plan");
		expect(service.getPermissionMode()).toBe("vault-full");
		for (const runtimeId of ["claude", "codex", "ohmypi"] as const) {
			service.selectRuntime(runtimeId);
			expect(service.getPermissionMode()).toBe("vault-full");
		}
	});

	it("preserves the validated runtime/model/permission chrome and accessibility contracts", () => {
		for (const token of [
			"talos-agent-runtime-switcher", "talos-agent-runtime-button", "talos-agent-provider-picker",
			"talos-agent-model-control", "talos-agent-model-trigger", "talos-agent-model-menu",
			"talos-agent-workflow", "talos-agent-permission-trigger", "talos-agent-permission-menu",
			"talos-agent-runtime-status", "talos-agent-install-link", "talos-agent-handoff-marker",
		]) expect(workbench).toContain(token);
		for (const token of ["talos-agent-reasoning-control", "talos-agent-service-tier-control", "persistCurrentSelection"]) expect(workbench).toContain(token);
		expect(workbench).toContain('setAttribute("aria-live", "polite")');
		expect(workbench).toContain('setAttribute("role", "listbox")');
		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain("@container talos-main (max-width: 720px)");
	});

	it("keeps tabs and composer inside the fixed-height native conversation viewport", () => {
		expect(css).toMatch(/\.talos-agent-compatibility-body\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s);
		expect(css).toMatch(/\.talos-native-chat\s*>\s*\.claudian-tab-bar-container\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
		expect(css).toMatch(/\.talos-native-chat-main\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
		expect(css).toMatch(/\.talos-native-chat\s+\.claudian-active-input-slot\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
		expect(css).toContain(".talos-agent-reasoning-control[hidden]");
		expect(css).toContain(".talos-agent-service-tier-control[hidden]");
	});

	it("keeps tabs, history, search, attachments, images, MCP, commands, queueing and inline edit", () => {
		for (const token of [
			"claudian-tab-bar-container", "claudian-history-container", "claudian-history-list",
			"renderHistory", "renameConversation", "toggleLifecycle", "exportConversation",
			"queuedDraft", "steerConversationTurn", "confirmInlineEdit", "answerQuestion",
		]) expect(conversation).toContain(token);
		for (const token of [
			"@ 添加文件", "addImages", "LocalFilePreviewPicker", "discoverMcpServers", "enabledMcpServers",
			'"/compact"', '"/fork"', '"/new"', '"/plan"', '"/execute"', "onInlineEdit", "handleSubmitButton",
		]) expect(composer).toContain(token);
		expect(conversation).toContain("MAX_OPEN_CONVERSATIONS = 6");
		expect(conversation).toContain("pendingInteractionCancels");
		expect(conversation).toContain("newConversationRequest");
		expect(conversation).toContain("claudian-history-item-summary");
		expect(renderer).toContain("appendPendingUser");
		expect(renderer).toContain("renderVersion");
	});

	it("fences stale tab loads and keeps existing tabs in stable order", () => {
		const openStart = conversation.indexOf("private async openConversation");
		const openEnd = conversation.indexOf("private async closeTab", openStart);
		const open = conversation.slice(openStart, openEnd);
		expect(open).toContain("requestVersion !== this.openRequestVersion");
		expect(conversation).toContain("projection.manifest.selection.runtimeId");
		const trackStart = conversation.indexOf("private trackOpenConversation");
		const trackEnd = conversation.indexOf("private renderTabs", trackStart);
		const track = conversation.slice(trackStart, trackEnd);
		expect(track).toContain("this.openConversationIds.includes(id)");
		expect(track).not.toContain("filter((candidate) => candidate !== id)");
	});

	it("makes runtime selection visible before asynchronous handoff persistence", () => {
		const start = serviceSource.indexOf("async switchConversationRuntime");
		const end = serviceSource.indexOf("async persistConversationSelection", start);
		const body = serviceSource.slice(start, end);
		expect(body.indexOf("this.selectRuntime(runtimeId, model)")).toBeLessThan(body.indexOf("await coordinator.switchRuntime"));
		expect(body).toContain("const targetSelection = this.getSelection()");
		expect(body).toContain("selection: targetSelection");
		expect(body).toContain("this.restoreSelection(previous)");
	});

	it("never persists a blank conversation during passive startup recovery", () => {
		const restoreStart = conversation.indexOf("private async restoreConversations");
		const restoreEnd = conversation.indexOf("private async refreshManifests", restoreStart);
		const restore = conversation.slice(restoreStart, restoreEnd);
		expect(restore).not.toContain("service.createConversation");
		expect(restore).toContain("this.activeConversationId = null");
		const submitStart = conversation.indexOf("private async submit");
		const submitEnd = conversation.indexOf("private async stop", submitStart);
		const submit = conversation.slice(submitStart, submitEnd);
		expect(submit).toContain("await this.newConversation()");
		const createStart = conversation.indexOf("private async createOrReuseConversation");
		const createEnd = conversation.indexOf("async selectRuntime", createStart);
		expect(conversation.slice(createStart, createEnd)).toContain("!this.isRunning(currentId)");
		expect(conversation).toContain("runningConversationIds");
		expect(conversation).toContain("queuedDrafts");
		expect(conversation).not.toContain("当前回合仍在运行，请先停止后再切换会话");
		expect(conversation).toContain("pendingUserEvents");
		expect(conversation).toContain("discardEmptyConversation");
		expect(conversation).toContain("this.isRunning(evictedId)");
		expect(serviceSource).toContain("this.execution?.hasActiveTurn(conversationId)");
	});

	it("renders the complete provider-neutral event vocabulary incrementally", () => {
		for (const event of [
			"assistant.delta", "assistant.final", "thinking.delta", "plan.updated", "tool.started",
			"tool.updated", "tool.finished", "file.diff", "task.progress", "subagent.updated",
			"usage.updated", "context.compacted", "handoff.created", "approval.resolved", "user.question",
		]) expect(renderer).toContain(event);
		expect(renderer).toContain("StreamRenderScheduler");
		expect(renderer).toContain("MarkdownRenderer.render");
		expect(renderer).not.toContain("usageSummary");
		expect(renderer).toContain("intentionally not rendered");
		expect(renderer).toContain("clearTransientTurn");
		const appendStart = renderer.indexOf("async append(event");
		const appendBody = renderer.slice(appendStart, renderer.indexOf("destroy(): void", appendStart));
		expect(appendBody).toContain('event.type === "assistant.start"');
		expect(appendBody).not.toContain('event.type === "assistant.start") this.ensureAssistant');
		expect(renderer).not.toContain("displayJson(event.payload.usage ?? event.payload)");
		expect(conversation).toContain("card.dataset.conversationId");
	});

	it("renders policy-owned approval phases without persistent C or unknown approval", () => {
		expect(serviceSource).toContain("return service.authorizeTool");
		expect(serviceSource).toContain("proposalAvailable");
		expect(conversation).toContain("提案预览");
		expect(conversation).toContain("独立执行批准");
		expect(conversation).toContain("确认提案");
		expect(conversation).toContain("批准执行");
		expect(conversation).toContain("risk === \"B\" && actionKind !== \"unknown\"");
		expect(conversation).toContain("recovery: policy.recovery");
	});

	it("retains the exact visual CSS module graph under TALOS ownership", () => {
		for (const module of [
			"components/messages.css", "components/input.css", "components/tabs.css", "components/toolcalls.css",
			"features/diff.css", "features/inline-edit.css", "features/file-preview.css",
			"features/ask-user-question.css", "toolbar/model-selector.css", "toolbar/permission-toggle.css",
		]) expect(styleIndex).toContain(module);
	});

	it("restores open tabs, active tab and history panel state", async () => {
		let persisted: unknown = null;
		const store = new WorkbenchUiStateStore({
			read: async () => persisted,
			write: async (value) => { persisted = structuredClone(value); },
		});
		await store.save({ schemaVersion: 1, openConversationIds: ["a", "a", "b"], activeConversationId: "b", historyOpen: true });
		await expect(store.load()).resolves.toEqual({ schemaVersion: 1, openConversationIds: ["a", "b"], activeConversationId: "b", historyOpen: true });
	});

	it("projects retired tab ids through the read-only import manifest", () => {
		expect(migrateLegacyTabManagerState({
			openTabs: [
				{ tabId: "tab-a", conversationId: "legacy-a" },
				{ tabId: "tab-b", conversationId: "legacy-b" },
			],
			activeTabId: "tab-b",
		}, {
			imports: {
				a: { legacyConversationId: "legacy-a", conversationId: "native-a" },
				b: { legacyConversationId: "legacy-b", conversationId: "native-b" },
			},
		})).toEqual({
			schemaVersion: 1,
			openConversationIds: ["native-a", "native-b"],
			activeConversationId: "native-b",
			historyOpen: false,
		});
	});
});
