import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeRuntimeProbeHost } from "../src/agent-workbench/discovery/node-runtime-probe-host";
import { RuntimeDiscoveryService } from "../src/agent-workbench/discovery/runtime-discovery-service";

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
});
