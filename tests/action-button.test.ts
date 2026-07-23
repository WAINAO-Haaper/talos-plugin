import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { describe, expect, it, vi } from "vitest";
import { TalosActionRegistry } from "../src/action-core/registry";
import type { TalosActionDefinition } from "../src/action-core/types";
import { MemoryRecoveryStore } from "../src/task-core/recovery-store";
import { MemoryTaskStore } from "../src/task-core/task-store";
import {
	TalosTaskRunner,
	type TaskTimerHost,
} from "../src/task-core/task-runner";
import { ActionButton } from "../src/ui/action-button";
import { ProposalPanel } from "../src/ui/proposal-panel";
import { createMiniHost, type MiniElement } from "./helpers/mini-dom";

const nodeTimers: TaskTimerHost = {
	schedule: (callback, timeoutMs) => nodeSetTimeout(callback, timeoutMs),
	cancel: (handle) => nodeClearTimeout(handle as NodeJS.Timeout),
};

function definition(
	execute: TalosActionDefinition["execute"],
	risk: "B" | "C" = "B"
): TalosActionDefinition {
	return {
		id: "organize-inbox",
		label: "整理收件箱",
		description: "整理固定范围内的收件箱",
		risk,
		readScope: ["00 收件箱/**"],
		writeScope: ["00 收件箱/**", "30 洞察/**"],
		timeoutMs: 10_000,
		cancelable: true,
		reversible: true,
		execute,
	};
}

describe("ActionButton", () => {
	it("shows a concrete action and reports B-class execution state", async () => {
		const execute = vi.fn().mockResolvedValue({ moved: 1 });
		const registry = new TalosActionRegistry([definition(execute)]);
		const store = new MemoryTaskStore();
		const runner = new TalosTaskRunner(
			registry,
			store,
			new MemoryRecoveryStore(),
			nodeTimers
		);
		const { host, element } = createMiniHost();
		new ActionButton({
			parent: host,
			registry,
			runner,
			store,
			actionId: "organize-inbox",
			idempotencyKey: "button-b",
			input: undefined,
			request: {
				readPaths: ["00 收件箱/想法.md"],
				writePaths: ["00 收件箱/想法.md", "30 洞察/想法.md"],
				effects: ["write"],
			},
			onProposal: vi.fn(),
		}).mount();

		const button = element.querySelector<MiniElement>("button");
		const live = element.querySelector<MiniElement>("[aria-live='polite']");
		expect(button?.textContent).toContain("整理收件箱");
		expect(live).not.toBeNull();

		button?.click();
		await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(button?.textContent).toContain("已完成"));
	});

	it("opens a C-class proposal without calling the runner", () => {
		const registry = new TalosActionRegistry([
			definition(vi.fn(), "C"),
		]);
		const store = new MemoryTaskStore();
		const run = vi.fn();
		const onProposal = vi.fn();
		const { host, element } = createMiniHost();
		new ActionButton({
			parent: host,
			registry,
			runner: { run },
			store,
			actionId: "organize-inbox",
			idempotencyKey: "button-c",
			input: undefined,
			request: {
				readPaths: [],
				writePaths: [],
				effects: ["external-publish"],
			},
			onProposal,
		}).mount();

		element.querySelector<MiniElement>("button")?.click();

		expect(onProposal).toHaveBeenCalledOnce();
		expect(run).not.toHaveBeenCalled();
	});
});

describe("ProposalPanel", () => {
	it("keeps viewing and approving as separate controls", () => {
		const { host, element } = createMiniHost();
		new ProposalPanel({
			parent: host,
			proposal: {
				title: "发布三篇内容",
				provider: "Claude",
				steps: ["读取草稿", "发布", "写回链接"],
				fileCount: 3,
				keyDiffs: ["3 个文件将写入 publish_url"],
				reversible: true,
			},
			onReject: vi.fn(),
			onViewDiff: vi.fn(),
			onApprove: vi.fn(),
		}).mount();

		const view = element.querySelector<MiniElement>(
			"button[data-action='view']"
		);
		const approve = element.querySelector<MiniElement>(
			"button[data-action='approve']"
		);
		expect(view?.textContent).toBe("查看差异");
		expect(approve?.textContent).toBe("批准并执行");
		expect(view).not.toBe(approve);
	});
});
