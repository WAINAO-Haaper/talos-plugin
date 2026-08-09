import { describe, expect, it } from "vitest";
import type { AskEvent } from "../src/ai/provider/types";
import type { AskInput } from "../src/ai/ask-service";
import { TalosAskCommand } from "../src/canonical/talos-ask-command";
import type { CanonicalRequestInput } from "../src/canonical/request-writer";

async function collect(source: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
	const events: AskEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

describe("TalosAskCommand", () => {
	it("projects recovery evidence and delegates exactly once to the shared AskService", async () => {
		const registryReads: string[] = [];
		const requests: CanonicalRequestInput[] = [];
		const asks: AskInput[] = [];
		const command = new TalosAskCommand({
			registryReader: {
				async read() {
					registryReads.push("read");
					return {
						schemaVersion: 1,
						commands: [],
						talosAsk: {
							id: "talos-ask",
							obsidianCommandId: "talos-ask",
							requestPath:
								".talos/command-requests/talos-ask.json",
							summary: "AI 全库问答与受控执行",
							engineAsset: "engine/talos-ask.md",
							claudeWrapper: "wrapper/talos-ask.md",
						},
					};
				},
			},
			requestWriter: {
				async write(input) {
					requests.push(input);
					return {
						path: ".talos/command-requests/talos-ask.json",
						request: input,
					};
				},
			},
			askService: {
				async *ask(input) {
					asks.push(input);
					yield { type: "text", text: "共享回答" };
					yield { type: "done", sessionId: "command:canonical" };
				},
			},
			now: () => new Date("2026-07-25T04:30:00.000Z"),
			requestId: () => "request-command-001",
		});

		const events = await collect(
			command.execute({
				channel: "obsidian",
				providerId: "claude-api",
				query: "总结 WP7",
				writebackIntent: "display-only",
				approvalState: "not-required",
			})
		);

		expect(registryReads).toEqual(["read"]);
		expect(requests).toEqual([
			{
				requestId: "request-command-001",
				commandId: "talos-ask",
				timestamp: "2026-07-25T04:30:00.000Z",
				channel: "obsidian",
				providerId: "claude-api",
				query: "总结 WP7",
				writebackIntent: "display-only",
				approvalState: "not-required",
			},
		]);
		expect(asks).toEqual([
			expect.objectContaining({
				sessionId: "canonical",
				namespace: "command",
				runId: "request-command-001",
				turnId: "request-command-001:turn",
				providerId: "claude-api",
				query: "总结 WP7",
			}),
		]);
		expect(events).toEqual([
			{ type: "text", text: "共享回答" },
			{ type: "done", sessionId: "command:canonical" },
		]);
	});
});
