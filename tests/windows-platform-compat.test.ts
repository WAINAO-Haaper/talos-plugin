import { describe, expect, it } from "vitest";
import {
	runtimeCandidateNames,
	runtimeProbeUsesShell,
	safeWindowsCommandShimPath,
} from "../src/agent-workbench/discovery/node-runtime-probe-host";
import { ProcessSandbox } from "../src/agent-workbench/security/process-sandbox";
import {
	storageSyncOpenFlags,
	supportsDirectoryFsync,
} from "../src/agent-workbench/storage/obsidian-workbench-storage";

describe("Windows platform compatibility", () => {
	it("discovers command shims without enabling a shell for native executables", () => {
		expect(runtimeCandidateNames("codex", "win32", ".EXE;.CMD;.BAT")).toEqual([
			"codex",
			"codex.exe",
			"codex.cmd",
			"codex.bat",
		]);
		expect(runtimeProbeUsesShell("C:\\tools\\codex.cmd", "win32")).toBe(true);
		expect(runtimeProbeUsesShell("C:\\tools\\codex.exe", "win32")).toBe(false);
		expect(runtimeProbeUsesShell("/usr/local/bin/codex", "darwin")).toBe(false);
		expect(safeWindowsCommandShimPath("C:\\tools\\codex.cmd")).toBe(true);
		expect(safeWindowsCommandShimPath("C:\\tools&calc\\codex.cmd")).toBe(false);
	});

	it("reports Windows native isolation as unavailable without probing macOS Seatbelt", async () => {
		let probes = 0;
		const sandbox = new ProcessSandbox({
			available: async () => {
				probes += 1;
				return true;
			},
		}, "win32");

		await expect(sandbox.availability()).resolves.toMatchObject({
			available: false,
			reason: "unsupported-platform",
			platform: "win32",
		});
		expect(probes).toBe(0);
		await expect(sandbox.prepare({
			executable: "C:\\tools\\codex.exe",
			args: [],
			cwd: "C:\\vault",
		}, "C:\\vault")).rejects.toThrow("API Provider");
	});

	it("keeps file durability through a writable handle and skips only directory fsync", () => {
		expect(storageSyncOpenFlags("win32")).toBe("r+");
		expect(storageSyncOpenFlags("darwin")).toBe("r");
		expect(supportsDirectoryFsync("win32")).toBe(false);
		expect(supportsDirectoryFsync("darwin")).toBe(true);
	});

	it("distinguishes a missing macOS backend from an unsupported platform", async () => {
		const sandbox = new ProcessSandbox({ available: async () => false }, "darwin");
		await expect(sandbox.availability()).resolves.toMatchObject({
			available: false,
			reason: "backend-missing",
			platform: "darwin",
		});
	});
});
