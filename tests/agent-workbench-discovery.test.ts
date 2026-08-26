import { describe, expect, it } from "vitest";
import type { RuntimeId } from "../src/agent-workbench/contracts/runtime-adapter";
import { RuntimeDiscoveryService, type ProtocolHandshake, type RuntimeProbeHost } from "../src/agent-workbench/discovery/runtime-discovery-service";
import { runtimeInstallCard } from "../src/agent-workbench/ui/runtime-install-card";

class FakeProbeHost implements RuntimeProbeHost {
	executable: string | null = "/synthetic/bin/agent";
	version = "agent 1.2.3";
	exitCode = 0;
	handshakeResult: ProtocolHandshake = "ready";
	crash: Error | null = null;
	resolvedCandidates: string[] = [];
	async resolve(candidates: string[]) { this.resolvedCandidates = candidates; return this.executable; }
	async run() { if (this.crash) throw this.crash; return { exitCode: this.exitCode, stdout: this.version, stderr: "" }; }
	async handshake(_runtimeId: RuntimeId) { if (this.crash) throw this.crash; return this.handshakeResult; }
}

describe("RuntimeDiscoveryService", () => {
	it("covers ready, missing, incompatible, unauthenticated, degraded and crashed states", async () => {
		const host = new FakeProbeHost();
		const service = new RuntimeDiscoveryService(host);
		expect((await service.probe("claude")).status).toBe("ready");
		host.executable = null;
		expect((await service.probe("codex")).status).toBe("not-installed");
		host.executable = "/synthetic/bin/codex"; host.version = "codex 0.121.0";
		expect((await service.probe("codex")).status).toBe("incompatible");
		host.version = "codex-cli 0.122.0"; host.handshakeResult = "unauthenticated";
		expect((await service.probe("codex")).status).toBe("unauthenticated");
		host.handshakeResult = "degraded";
		expect((await service.probe("codex")).status).toBe("degraded");
		host.crash = new Error("synthetic crash");
		expect((await service.probe("codex")).status).toBe("crashed");
	});

	it("prioritizes an explicit executable and produces bounded install guidance", async () => {
		const host = new FakeProbeHost();
		const service = new RuntimeDiscoveryService(host);
		host.version = "omp/17.2.15";
		expect(await service.probe("ohmypi")).toMatchObject({ status: "ready", version: "17.2.15" });
		host.version = "agent 1.2.3";
		await service.probe("ohmypi", { id: "omp-local", runtimeId: "ohmypi", executablePath: "/custom/omp" });
		expect(host.resolvedCandidates[0]).toBe("/custom/omp");
		host.executable = null;
		const probe = await service.probe("ohmypi");
		const card = runtimeInstallCard(probe, service.installUrl("ohmypi"));
		expect(card.installUrl).toMatch(/^https:/);
		expect(card.canRetry).toBe(true);
	});
});
