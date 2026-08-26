import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { AgentRuntimeAdapter, RuntimeId } from "../contracts/runtime-adapter";
import type { ProviderProfile, RuntimeProfile } from "../contracts/provider-profile";
import type { PermissionMode } from "../contracts/approval";
import { CodexAppServerAdapter } from "../adapters/codex/codex-app-server-adapter";
import { ClaudeAgentSdkAdapter } from "../adapters/claude/claude-agent-sdk-adapter";
import { buildOhMyPiLaunch, OhMyPiRpcAdapter } from "../adapters/ohmypi/ohmypi-rpc-adapter";
import { ProcessSandbox } from "../security/process-sandbox";
import { ClaudeSdkQueryPort } from "../transports/claude-sdk-port";
import { CodexProcessPort } from "../transports/codex-process-port";
import { OhMyPiProcessPort } from "../transports/ohmypi-process-port";
import { spawnJsonLineRpc } from "../transports/json-line-rpc-connection";
import { spawnOmpRpc } from "../transports/omp-rpc-connection";
import { RuntimeDiscoveryService } from "./runtime-discovery-service";
import { codexPermissionProfileArgs } from "../security/codex-permission-profile";
import { LoopbackEgressProxy } from "../security/loopback-egress-proxy";

export interface RuntimeFactoryInput {
	vaultRoot: string;
	configDir?: string;
	permissionMode?: PermissionMode;
	runtimeProfile?: RuntimeProfile;
	providerProfile?: ProviderProfile;
	approve: (toolName: string, input: Record<string, unknown>, metadata?: Record<string, unknown>) => Promise<"allow" | "allow-always" | "deny">;
}

function runtimeInstallationRoot(executable: string): string {
	const normalized = executable.replace(/\\/g, "/");
	for (const marker of ["/.codex/packages/", "/.bun/", "/.local/"]) {
		const index = normalized.indexOf(marker);
		if (index >= 0) return normalized.slice(0, index + marker.length - 1);
	}
	if (normalized.startsWith("/opt/homebrew/")) return "/opt/homebrew";
	if (normalized.startsWith("/usr/local/")) return "/usr/local";
	return path.dirname(executable);
}

export class DesktopRuntimeFactory {
	constructor(private readonly discovery: RuntimeDiscoveryService, private readonly sandbox: ProcessSandbox) {}

	async create(runtimeId: RuntimeId, input: RuntimeFactoryInput): Promise<AgentRuntimeAdapter> {
		const probe = await this.discovery.probe(runtimeId, input.runtimeProfile);
		if (probe.status !== "ready" || !probe.executable) throw new Error(probe.reason ?? `${runtimeId} 运行时不可用`);
		const probeRuntime = (signal?: AbortSignal) => this.discovery.probe(runtimeId, input.runtimeProfile);
		if (runtimeId === "claude") {
			const port = new ClaudeSdkQueryPort(input.vaultRoot, probeRuntime, {
				decide: async (toolName, toolInput, metadata) => {
					const decision = await input.approve(toolName, toolInput, metadata);
					return { allow: decision === "allow" || decision === "allow-always", message: decision === "deny" ? "TALOS 权限策略拒绝" : undefined };
				},
			}, [], probe.executable);
			return new ClaudeAgentSdkAdapter(port, () => true);
		}
		const home = process.env.HOME ?? "";
		const runtimeExecutable = await realpath(probe.executable);
		const packageRoot = runtimeInstallationRoot(runtimeExecutable);
		const sessionRoot = home ? path.join(home, runtimeId === "codex" ? ".codex" : ".omp") : input.vaultRoot;
		if (runtimeId === "codex" && !input.configDir) throw new Error("缺少 Vault configDir，Codex 已失败关闭");
		const runtimeTemp = path.join(input.vaultRoot, ".talos", "agent-workbench", "v1", "runtime-tmp", runtimeId);
		await Promise.all([mkdir(runtimeTemp, { recursive: true }), mkdir(sessionRoot, { recursive: true })]);
		const proxy = new LoopbackEgressProxy(async ({ host, port }) => {
			const decision = await input.approve("NetworkRequest", { url: "https://" + host + ":" + port }, { reason: "provider-egress-proxy", host, port });
			return decision === "allow" || decision === "allow-always";
		});
		const proxyPort = await proxy.start();
		const proxyUrl = "http://localhost:" + proxyPort;
		const environment = {
			PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CFFIXED_USER_HOME: runtimeTemp, TMPDIR: runtimeTemp, LANG: process.env.LANG ?? "",
			__CFPREFERENCES_AVOID_DAEMON: "1",
			HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl,
			http_proxy: proxyUrl, https_proxy: proxyUrl, all_proxy: proxyUrl, NO_PROXY: "", no_proxy: "",
		};
		try {
		if (runtimeId === "codex") {
			const launch = await this.sandbox.prepare({ executable: runtimeExecutable, args: ["app-server", ...codexPermissionProfileArgs(input.configDir!)], cwd: input.vaultRoot, environment, readOnlyRoots: [packageRoot], readWriteRoots: [sessionRoot, runtimeTemp], loopbackProxyPort: proxyPort }, input.vaultRoot);
			const connection = spawnJsonLineRpc(launch);
			try {
				await connection.request("initialize", { clientInfo: { name: "talos-agent-workbench", version: "1.0.0" }, capabilities: { experimentalApi: true } });
				await connection.notify("initialized");
			} catch (error) { await connection.close(); throw error; }
			return new CodexAppServerAdapter(new CodexProcessPort(connection, probeRuntime), () => proxy.close());
		}
		const raw = buildOhMyPiLaunch(runtimeExecutable, input.vaultRoot, input.permissionMode ?? "ask");
		const launch = await this.sandbox.prepare({ ...raw, environment, readOnlyRoots: [packageRoot], readWriteRoots: [sessionRoot, runtimeTemp], loopbackProxyPort: proxyPort }, input.vaultRoot);
		const connection = spawnOmpRpc(launch);
		try {
			await connection.ready();
			const negotiated = await connection.request<{ protocolVersion: number }>("negotiate_protocol", { protocolVersion: 2 });
			if (negotiated.protocolVersion !== 2) throw new Error("OhMyPi RPC v2 协商失败");
		} catch (error) { await connection.close(); throw error; }
		return new OhMyPiRpcAdapter(new OhMyPiProcessPort(connection, probeRuntime), () => true, () => proxy.close());
		} catch (error) {
			await proxy.close();
			throw error;
		}
	}
}
