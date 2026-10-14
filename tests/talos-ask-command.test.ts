import { describe, expect, it, vi } from "vitest";
import type { AskEvent } from "../src/ai/provider/types";
import type { AskInput } from "../src/ai/ask-service";
import { TalosAskCommand, type TalosAskCommandInput } from "../src/canonical/talos-ask-command";
import type { CanonicalRequestInput } from "../src/canonical/request-writer";
import type { CanonicalRegistry } from "../src/canonical/registry-reader";

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

describe("TalosAskCommand cancellation", () => {
	const input = (signal?: AbortSignal): TalosAskCommandInput => ({
		channel: "obsidian", providerId: "test-provider", query: "问题",
		writebackIntent: "display-only", approvalState: "not-required", signal,
	});
	function setup() {
		const read = vi.fn(async (): Promise<CanonicalRegistry> => ({
			schemaVersion: 1, commands: [], talosAsk: {
				id: "talos-ask", obsidianCommandId: "talos-ask", requestPath: ".talos/command-requests/talos-ask.json",
				summary: "问答", engineAsset: "engine/talos-ask.md", claudeWrapper: "wrapper/talos-ask.md",
			},
		}));
		const write = vi.fn(async (request: CanonicalRequestInput) => ({ path: ".talos/command-requests/talos-ask.json", request }));
		const asks: AskInput[] = [];
		const command = new TalosAskCommand({ registryReader: { read }, requestWriter: { write }, askService: {
			async *ask(request): AsyncIterable<AskEvent> { asks.push(request); yield { type: "text", text: "answer" }; },
		} });
		return { command, read, write, asks };
	}

	it("does no work for an already aborted command", async () => {
		const { command, read, write, asks } = setup(); const abort = new AbortController(); abort.abort();
		await expect(collect(command.execute(input(abort.signal)))).rejects.toMatchObject({ name: "AbortError" });
		expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(asks).toEqual([]);
	});

	it("does not write a request after cancellation during registry loading", async () => {
		const { command, read, write, asks } = setup(); const abort = new AbortController();
		const registry = await read(); read.mockClear();
		read.mockImplementationOnce(async () => { await Promise.resolve(); abort.abort(); return registry; });
		await expect(collect(command.execute(input(abort.signal)))).rejects.toMatchObject({ name: "AbortError" });
		expect(write).not.toHaveBeenCalled(); expect(asks).toEqual([]);
	});

	it("does not start AskService if cancellation arrives during request recording", async () => {
		const { command, write, asks } = setup(); const abort = new AbortController();
		write.mockImplementationOnce(async request => { await Promise.resolve(); abort.abort(); return { path: "record.json", request }; });
		await expect(collect(command.execute(input(abort.signal)))).rejects.toMatchObject({ name: "AbortError" });
		expect(write).toHaveBeenCalledOnce(); expect(asks).toEqual([]);
	});

	it("forwards the same signal to AskService without persisting it in the request", async () => {
		const { command, write, asks } = setup(); const abort = new AbortController();
		await collect(command.execute(input(abort.signal)));
		expect(asks[0]?.signal).toBe(abort.signal); expect(write.mock.calls[0]?.[0]).not.toHaveProperty("signal");
	});
});
