import { existsSync, readFileSync } from "node:fs";

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (path) => readFileSync(path, "utf8");

const main = read("src/main.ts");
const service = read("src/agent-workbench/core/agent-workbench-service.ts");
const execution = read("src/agent-workbench/core/agent-execution-coordinator.ts");
const view = read("src/agent-workbench/ui/native-conversation-view.ts");
const composer = read("src/agent-workbench/ui/native-composer.ts");
const renderer = read("src/agent-workbench/ui/native-event-renderer.ts");
const styleIndex = read("src/agent-workbench/ui/styles/index.css");

assert(!existsSync("src/quyuan/claudian"), "retired Claudian source directory still exists");
assert(!existsSync("src/agent-workbench/ui/file-preview/LocalFilePreviewModal.ts"), "retired preview modal was copied into the native module");
assert(!existsSync("src/agent-workbench/ui/file-preview/LocalFilePreviewPolicy.ts"), "retired preview policy was copied into the native module");
assert(existsSync("src/agent-workbench/ui/file-preview/local-preview-modal.ts"), "TALOS native preview modal is missing");
assert(existsSync("src/agent-workbench/ui/file-preview/local-preview-policy.ts"), "TALOS native preview policy is missing");
assert(!main.includes("ClaudianCompatibilityHost"), "main still owns a compatibility host");
assert(!main.includes("createClaudianProviderAdapters"), "main still registers legacy provider adapters");
assert(main.includes("TalosAgentRecoveryView"), "stable recovery view was not reimplemented");
assert(main.includes("ConversationInputLedger"), "durable staged input ledger missing");
assert(main.includes("preflightEgress"), "chat egress preflight is not wired");
assert(service.includes("AgentExecutionCoordinator"), "native execution coordinator is not composed");
for (const token of ["selectReasoning", "selectServiceTier", "restoreSelection", "persistConversationSelection"]) {
	assert(service.includes(token), `native selection capability missing: ${token}`);
}
assert(execution.indexOf("preflightEgress") < execution.indexOf("ledger.stage"), "egress preflight must precede local staging");
assert(execution.includes("ledger.accept"), "accepted-input transition missing");
assert(execution.includes("seenEventIds"), "native event deduplication missing");
assert(view.includes("WorkbenchUiState") || service.includes("WorkbenchUiState"), "tab state persistence missing");
for (const token of ["renderHistory", "renameConversation", "toggleLifecycle", "exportConversation", "confirmInlineEdit", "answerQuestion"]) {
	assert(view.includes(token), `conversation feature missing: ${token}`);
}
for (const token of ["LocalFilePreviewPicker", "addImages", "discoverMcpServers", '"/compact"', '"/fork"', '"/refine"']) {
	assert(composer.includes(token), `composer feature missing: ${token}`);
}
for (const token of ["assistant.delta", "thinking.delta", "tool.started", "file.diff", "subagent.updated", "StreamRenderScheduler"]) {
	assert(renderer.includes(token), `event rendering contract missing: ${token}`);
}
for (const path of ["components/messages.css", "components/input.css", "components/tabs.css", "features/diff.css", "features/file-preview.css", "toolbar/model-selector.css"]) {
	assert(styleIndex.includes(path), `visual style module missing: ${path}`);
}

if (failures.length) {
	for (const failure of failures) console.error(`FAIL: ${failure}`);
	process.exit(1);
}
console.log("TALOS native agent workbench self-test passed");
