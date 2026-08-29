import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/agent-workbench/contracts/agent-events";
import { conversationPreview } from "../src/agent-workbench/ui/conversation-display";

function event(type: AgentEvent["type"], text: string, eventId: string): AgentEvent {
	return {
		schemaVersion: 1,
		eventId,
		conversationId: "conversation",
		turnId: "turn",
		runtimeId: "codex",
		type,
		timestamp: "2026-08-28T00:00:00.000Z",
		payload: { text },
	};
}

describe("conversation history preview", () => {
	it("uses the first user request and normalizes whitespace", () => {
		expect(conversationPreview([
			event("assistant.final", "回答", "assistant"),
			event("user.message", "  检查\n\n这段   内容  ", "user"),
		])).toBe("检查 这段 内容");
	});

	it("falls back to assistant content, truncates, and leaves empty sessions explicit", () => {
		expect(conversationPreview([event("assistant.final", "abcdefghij", "assistant")], 6)).toBe("abcde…");
		expect(conversationPreview([])).toBe("");
	});
});
