import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { desktopRuntimePath, NodeRuntimeProbeHost } from "../src/agent-workbench/discovery/node-runtime-probe-host";
import { RuntimeDiscoveryService } from "../src/agent-workbench/discovery/runtime-discovery-service";
import { cleanupRuntimeStatusFiles } from "../src/agent-workbench/discovery/desktop-runtime-factory";

async function fakeRuntime(file: string, version: string): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${version}"
fi
exit 0
`);
	await chmod(file, 0o755);
}

describe("desktop runtime discovery", () => {
	it("removes expired runtime status files without touching live or malformed records", async () => {
		const runtimeTemp = await mkdtemp(path.join(tmpdir(), "talos-runtime-status-"));
		const status = path.join(runtimeTemp, ".agent-cockpit", "status");
		await mkdir(status, { recursive: true });
		const expired = path.join(status, "expired.json");
		const live = path.join(status, "live.json");
		const malformed = path.join(status, "malformed.json");
		await writeFile(expired, JSON.stringify({ expiresAt: "2026-08-28T00:00:00.000Z" }));
		await writeFile(live, JSON.stringify({ expiresAt: "2026-08-30T00:00:00.000Z" }));
		await writeFile(malformed, "not json");
		try {
			await expect(cleanupRuntimeStatusFiles(runtimeTemp, Date.parse("2026-08-29T00:00:00.000Z"))).resolves.toBe(1);
			await expect(access(expired)).rejects.toThrow();
			await expect(access(live)).resolves.toBeUndefined();
			await expect(access(malformed)).resolves.toBeUndefined();
		} finally {
			await rm(runtimeTemp, { recursive: true, force: true });
		}
	});

	it("finds Claude, Codex and OhMyPi in user bins when the GUI PATH is restricted", async () => {
		const home = await mkdtemp(path.join(tmpdir(), "talos-runtime-home-"));
		try {
			await fakeRuntime(path.join(home, ".local/bin/codex"), "codex-cli 0.147.0");
			await fakeRuntime(path.join(home, ".local/bin/claude"), "claude 2.1.228");
			await fakeRuntime(path.join(home, ".bun/bin/omp"), "omp 0.32.1");
			const service = new RuntimeDiscoveryService(new NodeRuntimeProbeHost({
				PATH: "/usr/bin:/bin",
				HOME: home,
				TMPDIR: tmpdir(),
				LANG: "en_US.UTF-8",
			}));

			const [claude, codex, ohmypi] = await Promise.all([
				service.probe("claude"),
				service.probe("codex"),
				service.probe("ohmypi"),
			]);

			expect(claude).toMatchObject({ status: "ready", executable: path.join(home, ".local/bin/claude") });
			expect(codex).toMatchObject({ status: "ready", executable: path.join(home, ".local/bin/codex") });
			expect(ohmypi).toMatchObject({ status: "ready", executable: path.join(home, ".bun/bin/omp") });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("keeps user runtime bins available to spawned RPC processes", () => {
		const home = path.join(tmpdir(), "synthetic-runtime-home");
		const runtime = path.join(home, ".bun/bin/omp");
		const value = desktopRuntimePath(runtime, { PATH: "/usr/bin:/bin", HOME: home });
		expect(value.split(path.delimiter)).toContain(path.join(home, ".local/bin"));
		expect(value.split(path.delimiter)).toContain(path.join(home, ".bun/bin"));
		expect(value.split(path.delimiter)[0]).toBe(path.dirname(runtime));
	});
});
