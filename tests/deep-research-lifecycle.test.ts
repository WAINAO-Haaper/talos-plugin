import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notices: string[] = [];

vi.mock("obsidian", () => {
	class MockFileSystemAdapter {
		getBasePath(): string {
			return ["", "vault"].join("/");
		}
	}
	class MockTFile {
		constructor(readonly path: string) {}
	}
	class MockTFolder {}
	class MockModal {}
	class MockNotice {
		constructor(message: string) {
			notices.push(message);
		}
	}
	class MockSetting {}

	return {
		App: class {},
		FileSystemAdapter: MockFileSystemAdapter,
		Modal: MockModal,
		Notice: MockNotice,
		Setting: MockSetting,
		TFile: MockTFile,
		TFolder: MockTFolder,
		normalizePath: (path: string) => path,
	};
});

import { FileSystemAdapter, TFile } from "obsidian";
import { deepResearch } from "../src/actions";
import type { TalosSettings } from "../src/settings";

class FakeChild extends EventEmitter {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	killed = false;

	kill(): boolean {
		this.killed = true;
		return true;
	}
}

function harness(writeGate: Promise<void> = Promise.resolve()) {
	const created: Array<{ path: string; body: string }> = [];
	const app = {
		vault: {
			adapter: new FileSystemAdapter(),
			getAbstractFileByPath: () => null,
			createFolder: vi.fn().mockResolvedValue(undefined),
			create: vi.fn(async (path: string, body: string) => {
				await writeGate;
				created.push({ path, body });
				return new TFile(path);
			}),
			modify: vi.fn().mockResolvedValue(undefined),
		},
	} as never;
	const settings = {
		agentCommand: "research-agent --markdown",
		reportsFolder: "70 输出/研究",
	} as TalosSettings;
	return { app, created, settings };
}

describe("Deep Research lifecycle", () => {
	beforeEach(() => {
		notices.length = 0;
	});

	it("does not complete until the child closes and the report is written", async () => {
		const child = new FakeChild();
		const spawn = vi.fn(() => child) as never;
		let releaseWrite = () => undefined;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const { app, created, settings } = harness(writeGate);
		let completed = false;
		const execution = deepResearch(app, settings, undefined, spawn).then(() => {
			completed = true;
		});

		await Promise.resolve();
		expect(completed).toBe(false);
		expect(created).toEqual([]);
		child.stdout.emit("data", Buffer.from("research result"));
		child.emit("close", 0);
		await Promise.resolve();
		expect(completed).toBe(false);
		expect(created).toEqual([]);
		releaseWrite();
		await execution;

		expect(completed).toBe(true);
		expect(created).toHaveLength(1);
		expect(created[0]?.body).toContain("research result");
		expect(notices).toContain("Deep Research 完成（退出码 0）");
	});

	it("kills the active child and rejects when the task is cancelled", async () => {
		const child = new FakeChild();
		const spawn = vi.fn(() => child) as never;
		const { app, created, settings } = harness();
		const controller = new AbortController();
		const execution = deepResearch(
			app,
			settings,
			controller.signal,
			spawn
		);

		controller.abort();

		await expect(execution).rejects.toMatchObject({ name: "AbortError" });
		expect(child.killed).toBe(true);
		expect(created).toEqual([]);
	});

	it("rejects the task when the child emits a spawn error", async () => {
		const child = new FakeChild();
		const spawn = vi.fn(() => child) as never;
		const { app, created, settings } = harness();
		const execution = deepResearch(app, settings, undefined, spawn);

		child.emit("error", new Error("spawn failed"));

		await expect(execution).rejects.toThrow("spawn failed");
		expect(created).toEqual([]);
		expect(notices.at(-1)).toContain("spawn failed");
	});
});
