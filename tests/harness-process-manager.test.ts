import { EventEmitter } from "node:events";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
	clearTimeout as nodeClearTimeout,
	setTimeout as nodeSetTimeout,
} from "node:timers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	assertDshHealthIdentity,
	DshLoopbackGateway,
	DSH_HEALTH_PRODUCT,
	DSH_HEALTH_PROTOCOL_VERSION,
	probeDshHealth,
	type DshGateway,
	type DshHealthIdentity,
} from "../src/harness/dsh-gateway";
import {
	buildDshChildEnvironment,
	DshProcessManager,
	hasDshProductIdentity,
	parseDshVersion,
	resolveNodeBinDirectory,
	type DshGatewayInput,
	type DshProcessRuntime,
} from "../src/harness/dsh-process-manager";
import { buildDshLaunchPlan, dshBaseUrl } from "../src/harness/dsh-runtime";
import type { ChildProcess } from "node:child_process";

const WORKSPACE_A = "a".repeat(64);
const WORKSPACE_B = "b".repeat(64);

beforeAll(() => {
	vi.stubGlobal("window", {
		setTimeout: nodeSetTimeout,
		clearTimeout: nodeClearTimeout,
	});
});

afterAll(() => vi.unstubAllGlobals());

function identity(workspaceId = WORKSPACE_A): Omit<DshHealthIdentity, "ready"> {
	return {
		product: DSH_HEALTH_PRODUCT,
		protocolVersion: DSH_HEALTH_PROTOCOL_VERSION,
		harnessVersion: "0.1.0-rc.8",
		instanceNonce: "nonce-000000000001",
		workspaceId,
	};
}

async function listen(
	server: http.Server
): Promise<{ port: number; close: () => Promise<void> }> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = (server.address() as AddressInfo).port;
	return {
		port,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}

class FakeChild extends EventEmitter {
	readonly stderr = new EventEmitter();
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	killed = false;
	readonly signals: NodeJS.Signals[] = [];

	kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killed = true;
		this.signals.push(signal);
		queueMicrotask(() => {
			if (this.exitCode !== null || this.signalCode !== null) return;
			this.exitCode = 0;
			this.signalCode = signal;
			this.emit("exit", 0, signal);
		});
		return true;
	}
}

class FakeGateway implements DshGateway {
	started = false;
	ready = false;
	closed = false;

	constructor(
		readonly identity: Omit<DshHealthIdentity, "ready">,
		private readonly onClose: () => void
	) {}

	async start(): Promise<void> {
		this.started = true;
	}

	setReady(ready: boolean): void {
		this.ready = ready;
	}

	async close(): Promise<void> {
		this.closed = true;
		this.ready = false;
		this.onClose();
	}
}

describe("Harness identity and process isolation", () => {
	it("rejects an arbitrary HTTP service occupying the configured port", async () => {
		const server = http.createServer((_request, response) => {
			response.writeHead(200);
			response.end("not a harness");
		});
		const handle = await listen(server);
		const manager = new DshProcessManager({
			getConfiguredExecutable: () => process.execPath,
			getPort: () => handle.port,
			getVaultRoot: () => "/synthetic-vault",
			runtime: { workspaceIdentity: () => WORKSPACE_A },
		});
		try {
			await expect(manager.ensureStarted()).rejects.toThrow(
				/未知|不是受管|占用/
			);
			expect(manager.getState()).toBe("error");
		} finally {
			await manager.dispose();
			await handle.close();
		}
	});

	it("rejects a healthy Harness gateway bound to a different workspace", async () => {
		const reservation = http.createServer();
		const handle = await listen(reservation);
		await handle.close();
		const gateway = new DshLoopbackGateway(
			handle.port,
			handle.port + 1,
			identity(WORKSPACE_B)
		);
		await gateway.start();
		gateway.setReady(true);
		const manager = new DshProcessManager({
			getConfiguredExecutable: () => process.execPath,
			getPort: () => handle.port,
			getVaultRoot: () => "/synthetic-vault",
			runtime: { workspaceIdentity: () => WORKSPACE_A },
		});
		try {
			await expect(manager.ensureStarted()).rejects.toThrow("工作区身份不匹配");
		} finally {
			await manager.dispose();
			await gateway.close();
		}
	});

	it("serves and verifies the dedicated identity endpoint", async () => {
		const reservation = http.createServer();
		const handle = await listen(reservation);
		await handle.close();
		const expected = identity();
		const gateway = new DshLoopbackGateway(
			handle.port,
			handle.port + 1,
			expected
		);
		await gateway.start();
		try {
			const starting = await probeDshHealth(dshBaseUrl(handle.port));
			expect(() =>
				assertDshHealthIdentity(starting, expected, true)
			).toThrow("尚未就绪");
			gateway.setReady(true);
			const ready = await probeDshHealth(dshBaseUrl(handle.port));
			expect(assertDshHealthIdentity(ready, expected, true)).toMatchObject({
				...expected,
				ready: true,
			});
		} finally {
			await gateway.close();
		}
	});

	it("passes only allowlisted environment variables to Harness", () => {
		const environment = buildDshChildEnvironment(
			{
				DSH_HOME: "/synthetic-home",
				PLAN_SECRET_BAIT: "must-not-pass",
			},
			{
				PATH: "/synthetic-bin",
				LANG: "zh_CN.UTF-8",
				SECRET_BAIT: "must-not-pass",
				NODE_OPTIONS: "--require injected.js",
			},
			null
		);
		expect(environment).toEqual({
			PATH: "/synthetic-bin",
			LANG: "zh_CN.UTF-8",
			DSH_HOME: "/synthetic-home",
		});
		expect(environment).not.toHaveProperty("SECRET_BAIT");
		expect(environment).not.toHaveProperty("NODE_OPTIONS");
		expect(environment).not.toHaveProperty("PLAN_SECRET_BAIT");
	});

	it("repairs a GUI child PATH with a verified Node installation", () => {
		const inherited = {
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
			LANG: "zh_CN.UTF-8",
			NODE_OPTIONS: "--require injected.js",
		};
		const nodeBinDirectory = resolveNodeBinDirectory(
			inherited,
			"darwin",
			(candidate) => candidate === "/usr/local/bin/node"
		);
		expect(nodeBinDirectory).toBe("/usr/local/bin");

		const environment = buildDshChildEnvironment(
			{ DSH_HOME: "/synthetic-home" },
			inherited,
			nodeBinDirectory,
			"darwin"
		);
		expect(environment).toEqual({
			PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
			LANG: "zh_CN.UTF-8",
			DSH_HOME: "/synthetic-home",
		});
		expect(environment).not.toHaveProperty("NODE_OPTIONS");
	});

	it("does not duplicate a Node directory already present on PATH", () => {
		const environment = buildDshChildEnvironment(
			{},
			{ PATH: "/usr/local/bin:/usr/bin:/bin" },
			"/usr/local/bin",
			"darwin"
		);
		expect(environment.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
	});

	it("accepts the official standalone version and validates product help", () => {
		expect(parseDshVersion("0.1.0-rc.8")).toBe("0.1.0-rc.8");
		expect(parseDshVersion("dsh 0.1.0-rc.8")).toBe("0.1.0-rc.8");
		expect(parseDshVersion("DeepSeek Harness v1.2.3")).toBe("1.2.3");
		expect(parseDshVersion("unrelated 1.2.3")).toBeNull();
		expect(
			hasDshProductIdentity("dsh: boot a DeepSeek Harness profile")
		).toBe(true);
		expect(hasDshProductIdentity("unrelated harness")).toBe(false);
	});

	it("serializes consecutive restarts and ignores stale child callbacks", async () => {
		const children: FakeChild[] = [];
		const spawnEnvironments: Record<string, string>[] = [];
		let activeGateway: FakeGateway | null = null;
		let nonce = 0;
		const runtime: Partial<DshProcessRuntime> = {
			workspaceIdentity: () => WORKSPACE_A,
			resolveVersion: () => "0.1.0-rc.8",
			createNonce: () => `nonce-${String(++nonce).padStart(12, "0")}`,
			allocateBackendPort: async () => 43180 + nonce,
			prepareLaunchPlan: ({ executable, port, vaultRoot }) =>
				buildDshLaunchPlan({
					executable,
					port,
					dshHome: "/synthetic-home",
					vaultRoot,
				}),
			createGateway: (input: DshGatewayInput) => {
				const gateway = new FakeGateway(input.identity, () => {
					if (activeGateway === gateway) activeGateway = null;
				});
				activeGateway = gateway;
				return gateway;
			},
			probeHealth: async () =>
				activeGateway?.started && !activeGateway.closed
					? {
						reachable: true,
						identity: {
							...activeGateway.identity,
							ready: activeGateway.ready,
						},
						error: "",
					}
					: { reachable: false },
			probeBackend: async () => true,
			spawnProcess: (_plan, env) => {
				spawnEnvironments.push(env);
				const child = new FakeChild();
				children.push(child);
				return child as unknown as ChildProcess;
			},
			wait: async () => {},
			now: () => Date.now(),
		};
		const manager = new DshProcessManager({
			getConfiguredExecutable: () => process.execPath,
			getPort: () => 43179,
			getVaultRoot: () => "/synthetic-vault",
			readyTimeoutMs: 100,
			stopTimeoutMs: 100,
			runtime,
		});

		await manager.ensureStarted();
		const staleChild = children[0];
		if (!staleChild) throw new Error("expected first Harness child");
		await Promise.all([manager.restart(), manager.restart()]);

		expect(manager.getState()).toBe("ready");
		expect(manager.getLastError()).toBe("");
		expect(children).toHaveLength(2);
		expect(staleChild.signals).toContain("SIGTERM");
		expect(
			children.filter(
				(child) => child.exitCode === null && child.signalCode === null
			)
		).toHaveLength(1);
		expect(spawnEnvironments.every((env) => !("SECRET_BAIT" in env))).toBe(true);

		staleChild.emit("error", new Error("stale error"));
		staleChild.emit("exit", 99, null);
		expect(manager.getState()).toBe("ready");
		expect(manager.getLastError()).toBe("");

		await manager.dispose();
		expect(manager.getState()).toBe("stopped");
		expect(
			children.filter(
				(child) => child.exitCode === null && child.signalCode === null
			)
		).toHaveLength(0);
	});
});
