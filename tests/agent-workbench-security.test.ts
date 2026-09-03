import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionRequest } from "../src/agent-workbench/contracts/approval";
import { ApprovalBroker } from "../src/agent-workbench/security/approval-broker";
import { ExternalAccessGrantStore } from "../src/agent-workbench/security/external-access-grant";
import { PermissionRuleStore, type PermissionRule } from "../src/agent-workbench/security/permission-rule-store";
import { ProcessSandbox } from "../src/agent-workbench/security/process-sandbox";
import { LoopbackEgressProxy } from "../src/agent-workbench/security/loopback-egress-proxy";
import type { SecurityAuditRecord } from "../src/agent-workbench/security/security-audit";
import { VaultBoundary } from "../src/agent-workbench/security/vault-boundary";
import { codexProtectedVaultSubpaths } from "../src/agent-workbench/security/codex-permission-profile";
import { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";
import { normalizeToolAction } from "../src/agent-workbench/security/tool-action-normalizer";

const created: string[] = [];
afterEach(async () => {
	for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
	const vault = await mkdtemp(join(tmpdir(), "talos-vault-"));
	const outside = await mkdtemp(join(tmpdir(), "talos-outside-"));
	created.push(vault, outside);
	await mkdir(join(vault, ".vault-config"));
	await writeFile(join(vault, "note.md"), "synthetic");
	await writeFile(join(outside, "private.md"), "synthetic");
	await symlink(outside, join(vault, "escape"));
	return { vault, outside };
}

class RuleHost {
	value: PermissionRule[] = [];
	async read() { return structuredClone(this.value); }
	async write(value: PermissionRule[]) { this.value = structuredClone(value); }
}

function request(overrides: Partial<ActionRequest> = {}): ActionRequest {
	return {
		actionId: "action-1", runtimeId: "codex", kind: "write",
		targets: [{ raw: "note.md", role: "destination" }], destructive: false,
		...overrides,
	};
}

function broker(vault: string, host = new RuleHost(), failAudit = false) {
	const audits: SecurityAuditRecord[] = [];
	const grants = new ExternalAccessGrantStore();
	return {
		audits, grants, host,
		value: new ApprovalBroker(
			new VaultBoundary(vault),
			new PermissionRuleStore(host),
			grants,
			{ append: async (record) => { if (failAudit) throw new Error("disk full"); audits.push(record); } },
		),
	};
}

const context = {
	workflow: "execute" as const,
	permission: "ask" as const,
	conversationId: "conversation-1",
	approvalUiAttached: true,
};

describe("VaultBoundary and ApprovalBroker", () => {
	it("blocks permanent zones and detects symlink, parent traversal and absolute escapes", async () => {
		const { vault, outside } = await fixture();
		const host = new RuleHost(); const grants = new ExternalAccessGrantStore();
		const value = new ApprovalBroker(new VaultBoundary(vault, undefined, 20, ".vault-config"), new PermissionRuleStore(host), grants, { append: async () => {} });
		expect((await value.evaluate(request({ targets: [{ raw: ".vault-config/plugins/x", role: "destination" }] }), context)).decision).toBe("deny");
		expect((await value.evaluate(request({ targets: [{ raw: "escape/private.md", role: "source" }] }), context)).decision).toBe("ask");
		expect((await value.evaluate(request({ targets: [{ raw: "../outside.md", role: "destination" }] }), context)).decision).toBe("ask");
		expect((await value.evaluate(request({ targets: [{ raw: join(outside, "private.md"), role: "source" }] }), context)).decision).toBe("ask");
	});

	it("keeps Plan and Vault Full orthogonal and asks for destructive and detached actions", async () => {
		const { vault } = await fixture();
		const { value } = broker(vault);
		expect((await value.evaluate(request(), { ...context, workflow: "plan", permission: "vault-full" })).decision).toBe("deny");
		expect((await value.evaluate(request({ kind: "shell" }), { ...context, workflow: "plan" })).decision).toBe("deny");
		expect((await value.evaluate(request({ kind: "delete", destructive: true }), { ...context, workflow: "plan" })).decision).toBe("deny");
		expect((await value.evaluate(request(), { ...context, permission: "vault-full" })).decision).toBe("allow");
		expect((await value.evaluate(request({ kind: "delete", destructive: true }), { ...context, permission: "vault-full" })).decision).toBe("ask");
		expect((await value.evaluate(request(), { ...context, approvalUiAttached: false })).decision).toBe("deny");
	});

	it("persists exact scoped rules across restart and supports revocation", async () => {
		const { vault } = await fixture();
		const host = new RuleHost();
		const canonical = join(await realpath(vault), "note.md");
		const store = new PermissionRuleStore(host);
		await store.add({ id: "rule-1", runtimeId: "codex", kind: "write", target: canonical, scope: "persistent", createdAt: "2026-08-26T00:00:00.000Z" });
		let current = broker(vault, host).value;
		expect((await current.evaluate(request(), { ...context, permission: "scoped" })).ruleId).toBe("rule-1");
		await new PermissionRuleStore(host).revoke("rule-1");
		current = broker(vault, host).value;
		expect((await current.evaluate(request(), { ...context, permission: "scoped" })).decision).toBe("ask");
	});

	it("separates fixed provider egress from generic network and consumes once grants", async () => {
		const { vault, outside } = await fixture();
		const fixtureBroker = broker(vault);
		const network = request({ kind: "network", targets: [], network: { protocol: "https", host: "api.example.test" } });
		const providerContext = { ...context, providerEgressHosts: ["api.example.test"], providerEgressRequest: true };
		expect((await fixtureBroker.value.evaluate(network, providerContext)).decision).toBe("allow");
		expect((await fixtureBroker.value.evaluate(network, { ...providerContext, workflow: "plan" })).decision).toBe("allow");
		expect((await fixtureBroker.value.evaluate(network, { ...providerContext, workflow: "plan", approvalUiAttached: false })).decision).toBe("allow");
		expect((await fixtureBroker.value.evaluate(network, { ...context, workflow: "plan", providerEgressHosts: ["api.example.test"] })).decision).toBe("deny");
		expect((await fixtureBroker.value.evaluate(network, { ...context, providerEgressHosts: ["api.example.test"] })).decision).toBe("ask");
		expect((await fixtureBroker.value.evaluate(network, context)).decision).toBe("ask");
		expect(fixtureBroker.audits).toHaveLength(6);
		const external = await realpath(join(outside, "private.md"));
		fixtureBroker.grants.add({ id: "grant-1", type: "path", value: external, direction: "read", actionId: "action-1", lifetime: "once" });
		const externalRead = request({ kind: "read", targets: [{ raw: external, role: "source" }] });
		expect((await fixtureBroker.value.evaluate(externalRead, context)).decision).toBe("allow");
		expect((await fixtureBroker.value.evaluate(externalRead, context)).decision).toBe("ask");
	});

	it("never persists risk-C network approval and requires a fresh two-phase decision", async () => {
		const { vault } = await fixture();
		const host = new RuleHost();
		const first = broker(vault, host);
		const network = request({ actionId: "network-1", kind: "network", targets: [], network: { protocol: "https", host: "example.test" } });
		const ruleId = await first.value.rememberExactRule(network, context);
		expect(ruleId).toBeNull();
		const restarted = broker(vault, host);
		const reconnect = request({ ...network, actionId: "network-2" });
		expect(await restarted.value.evaluate(reconnect, { ...context, conversationId: "conversation-2" })).toMatchObject({
			decision: "ask", reasonCode: "risk-c-two-phase",
		});
		expect(await restarted.value.evaluate(request({
			...reconnect, actionId: "network-3", network: { protocol: "https", host: "example.test", port: 8443 },
		}), context)).toMatchObject({ decision: "ask", reasonCode: "risk-c-two-phase" });
		expect(await restarted.value.evaluate(request({
			...reconnect, actionId: "network-4", runtimeId: "ohmypi",
		}), context)).toMatchObject({ decision: "ask", reasonCode: "risk-c-two-phase" });
	});

	it("fails closed when audit persistence fails and stores only target digests", async () => {
		const { vault } = await fixture();
		const failed = broker(vault, new RuleHost(), true);
		expect((await failed.value.evaluate(request({ kind: "read" }), context)).decision).toBe("deny");
		const passed = broker(vault);
		await passed.value.evaluate(request({ kind: "read" }), context);
		expect(passed.audits[0]?.targetDigests[0]).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(passed.audits)).not.toContain(vault);
	});

	it("normalizes runtime tools through the service broker before showing inline approval", async () => {
		const { vault } = await fixture();
		const fixtureBroker = broker(vault);
		const service = new AgentWorkbenchService({
			approvalBroker: fixtureBroker.value,
		});
		service.setWorkflowMode("execute");
		let prompts = 0;
		const approvals: Array<Record<string, unknown>> = [];
		const decide = () => service.authorizeTool({
			runtimeId: "codex", conversationId: "conversation-1", vaultRoot: vault,
			toolName: "Write", toolInput: { file_path: "note.md" }, approvalUiAttached: true,
			prompt: async (approval) => {
				prompts += 1;
				approvals.push(approval);
				return "allow-always";
			},
		});
		expect(await decide()).toBe("allow-always");
		service.setPermissionMode("scoped");
		expect(await decide()).toBe("allow");
		expect(prompts).toBe(1);
		expect(approvals[0]).toMatchObject({
			phase: "execute",
			risk: "B",
			actionKind: "write",
			targets: [{ raw: "note.md", role: "destination" }],
		});
		expect(String(approvals[0]?.recovery)).toContain("恢复");
		expect(fixtureBroker.audits).toHaveLength(2);
	});

	it("extracts command path arguments and generic network hosts without persisting content", () => {
		const shell = normalizeToolAction({ runtimeId: "ohmypi", toolName: "bash", toolInput: { command: "rm ../outside.md", cwd: "." }, vaultRoot: "/synthetic/vault", actionId: "a" });
		expect(shell).toMatchObject({ kind: "shell", destructive: true, command: { executable: "rm", args: ["../outside.md"] } });
		const network = normalizeToolAction({ runtimeId: "codex", toolName: "WebFetch", toolInput: { url: "https://example.test/path" }, vaultRoot: "/synthetic/vault", actionId: "b" });
		expect(network.network).toEqual({ protocol: "https", host: "example.test", port: undefined });
	});

	it("fails closed for unknown tools and classifies subagents as risk C", () => {
		const unknown = normalizeToolAction({
			runtimeId: "ohmypi", toolName: "mystery_extension", toolInput: {},
			vaultRoot: "/synthetic/vault", actionId: "unknown",
		});
		expect(unknown).toMatchObject({ kind: "unknown", risk: "B", canonicalToolId: "talos.unknown" });
		const subagent = normalizeToolAction({
			runtimeId: "claude", toolName: "Task", toolInput: { description: "delegate" },
			vaultRoot: "/synthetic/vault", actionId: "subagent",
		});
		expect(subagent).toMatchObject({ kind: "subagent", risk: "C", canonicalToolId: "talos.subagent" });
		const unboundedWrite = normalizeToolAction({
			runtimeId: "codex", toolName: "Write", toolInput: { content: "no target" },
			vaultRoot: "/synthetic/vault", actionId: "unbounded-write",
		});
		expect(unboundedWrite).toMatchObject({ kind: "write", risk: "C" });
	});

	it("enforces voice, governance, and two-phase risk-C gates in the shared service", async () => {
		const { vault } = await fixture();
		const prompts = vi.fn(async () => "allow" as const);
		const service = new AgentWorkbenchService({ approvalBroker: broker(vault).value });
		service.setWorkflowMode("execute");

		await expect(service.authorizeTool({
			runtimeId: "codex", conversationId: "voice-1", vaultRoot: vault,
			toolName: "Write", toolInput: { file_path: "note.md" }, channel: "voice",
			approvalUiAttached: true, prompt: prompts,
		})).resolves.toBe("deny");
		expect(prompts).not.toHaveBeenCalled();

		const governed = new AgentWorkbenchService({
			approvalBroker: broker(vault).value,
			evaluateToolGovernance: () => ({ decision: "deny", reason: "policy-blocked" }),
		});
		governed.setWorkflowMode("execute");
		await expect(governed.authorizeTool({
			runtimeId: "codex", conversationId: "governance-1", vaultRoot: vault,
			toolName: "Read", toolInput: { file_path: "note.md" }, channel: "text",
			approvalUiAttached: true, prompt: prompts,
		})).resolves.toBe("deny");
		expect(prompts).not.toHaveBeenCalled();

		await expect(service.authorizeTool({
			runtimeId: "codex", conversationId: "voice-read-1", vaultRoot: vault,
			toolName: "Read", toolInput: { file_path: "note.md" }, channel: "voice",
			approvalUiAttached: false, prompt: prompts,
		})).resolves.toBe("allow");

		await expect(service.authorizeTool({
			runtimeId: "codex", conversationId: "permanent-alias-1", vaultRoot: vault,
			toolName: "Edit", toolInput: { payload: { file_path: ".talos/private/unsafe.json" } },
			channel: "text", approvalUiAttached: true, prompt: prompts,
		})).resolves.toBe("deny");

		await expect(service.authorizeTool({
			runtimeId: "codex", conversationId: "no-ui-1", vaultRoot: vault,
			toolName: "Write", toolInput: { file_path: "other.md" }, channel: "text",
			approvalUiAttached: false, prompt: prompts,
		})).resolves.toBe("deny");
		expect(prompts).not.toHaveBeenCalled();

		const unknownPrompt = vi.fn(async () => "allow-always" as const);
		const unknownInput = {
			runtimeId: "codex" as const,
			conversationId: "unknown-1",
			vaultRoot: vault,
			toolName: "UnmappedProviderTool",
			toolInput: {},
			channel: "text" as const,
			approvalUiAttached: true,
			prompt: unknownPrompt,
		};
		await expect(service.authorizeTool(unknownInput)).resolves.toBe("allow");
		await expect(service.authorizeTool(unknownInput)).resolves.toBe("allow");
		expect(unknownPrompt).toHaveBeenCalledTimes(2);

		const phases: string[] = [];
		const riskCApprovals: Array<Record<string, unknown>> = [];
		const missingProposalPrompt = vi.fn(async () => "allow" as const);
		await expect(service.authorizeTool({
			runtimeId: "claude", conversationId: "risk-c-no-proposal", vaultRoot: vault,
			toolName: "Task", toolInput: {}, channel: "text",
			approvalUiAttached: true, prompt: missingProposalPrompt,
		})).resolves.toBe("deny");
		expect(missingProposalPrompt).not.toHaveBeenCalled();

		await expect(service.authorizeTool({
			runtimeId: "codex", conversationId: "risk-c-1", vaultRoot: vault,
			toolName: "Bash", toolInput: { command: "pwd" }, channel: "text",
			approvalUiAttached: true,
			prompt: async (approval) => {
				phases.push(approval.phase ?? "single");
				riskCApprovals.push(approval);
				return "allow";
			},
		})).resolves.toBe("allow");
		expect(phases).toEqual(["proposal", "execute"]);
		expect(riskCApprovals).toHaveLength(2);
		expect(riskCApprovals[0]).toMatchObject({
			risk: "C",
			actionKind: "shell",
			canonicalToolId: "talos.shell",
			proposalAvailable: true,
		});

		await expect(service.authorizeTool({
			runtimeId: "codex", conversationId: "voice-web-denied", vaultRoot: vault,
			toolName: "web_search", toolInput: {},
			toolMetadata: {
				canonicalActionKind: "network",
				canonicalToolId: "talos.voice-web-search",
			},
			channel: "voice", approvalUiAttached: false, prompt: prompts,
		})).resolves.toBe("deny");
		await expect(service.authorizeTool({
			runtimeId: "codex", conversationId: "voice-web-explicit", vaultRoot: vault,
			toolName: "web_search", toolInput: {},
			toolMetadata: {
				canonicalActionKind: "network",
				canonicalToolId: "talos.voice-web-search",
			},
			channel: "voice",
			voiceExplicitNetwork: true,
			approvalUiAttached: false,
			prompt: prompts,
		})).resolves.toBe("allow");
		await expect(governed.authorizeTool({
			runtimeId: "codex", conversationId: "voice-web-governance-deny", vaultRoot: vault,
			toolName: "web_search", toolInput: {},
			toolMetadata: {
				canonicalActionKind: "network",
				canonicalToolId: "talos.voice-web-search",
			},
			channel: "voice",
			voiceExplicitNetwork: true,
			approvalUiAttached: false,
			prompt: prompts,
		})).resolves.toBe("deny");
		expect(prompts).not.toHaveBeenCalled();
	});

});

async function proxyResponse(port: number, request: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = connect(port, "127.0.0.1");
		let response = "";
		socket.setEncoding("utf8");
		socket.once("error", reject);
		socket.on("data", (chunk: string) => { response += chunk; });
		socket.once("end", () => resolve(response));
		socket.once("connect", () => socket.end(request));
	});
}

describe("LoopbackEgressProxy", () => {
	it("coalesces concurrent authorization for the same CONNECT destination", async () => {
		let release!: (allowed: boolean) => void;
		let calls = 0;
		const decision = new Promise<boolean>((resolve) => { release = resolve; });
		const proxy = new LoopbackEgressProxy(async () => { calls += 1; return decision; });
		const port = await proxy.start();
		const request = "CONNECT repeated.example:443 HTTP/1.1\r\nHost: repeated.example\r\n\r\n";
		const first = proxyResponse(port, request);
		const second = proxyResponse(port, request);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(calls).toBe(1);
		release(false);
		await expect(Promise.all([first, second])).resolves.toEqual([
			expect.stringContaining("403 Forbidden"),
			expect.stringContaining("403 Forbidden"),
		]);
		await proxy.close();
	});

	it("reuses allow-always for sequential CONNECT requests to the exact destination", async () => {
		let calls = 0;
		const proxy = new LoopbackEgressProxy(async () => {
			calls += 1;
			return "allow-always";
		});
		const port = await proxy.start();
		const request = "CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
		await expect(proxyResponse(port, request)).resolves.toContain("502 Bad Gateway");
		await expect(proxyResponse(port, request)).resolves.toContain("502 Bad Gateway");
		expect(calls).toBe(1);
		await proxy.close();
	});

	it("denies CONNECT before opening an upstream socket and rejects plaintext proxying", async () => {
		const destinations: Array<{ host: string; port: number }> = [];
		const proxy = new LoopbackEgressProxy(async (destination) => {
			destinations.push(destination);
			return false;
		});
		const port = await proxy.start();
		await expect(proxyResponse(port, "CONNECT forbidden.example:443 HTTP/1.1\r\nHost: forbidden.example\r\n\r\n")).resolves.toContain("403 Forbidden");
		await expect(proxyResponse(port, "GET http://forbidden.example/ HTTP/1.1\r\nHost: forbidden.example\r\n\r\n")).resolves.toContain("405 Method Not Allowed");
		expect(destinations).toEqual([{ host: "forbidden.example", port: 443 }]);
		await proxy.close();
	});
});

describe("ProcessSandbox", () => {
	it("validates the Codex permanent zones delegated to the outer sandbox", () => {
		const configDir = ".test-config";
		expect(codexProtectedVaultSubpaths(configDir)).toContain(configDir);
		expect(() => codexProtectedVaultSubpaths("/absolute/config")).toThrow("配置目录");
	});
	it("fails closed when the OS sandbox is unavailable", async () => {
		const sandbox = new ProcessSandbox({ available: async () => false }, "darwin");
		await expect(sandbox.prepare({ executable: "/usr/bin/agent", args: [], cwd: "/vault" }, "/vault")).rejects.toThrow("失败关闭");
	});

	it("allows only the exact TALOS loopback proxy and includes minimum startup reads", async () => {
		if (process.platform !== "darwin") return;
		const { vault } = await fixture();
		const sandbox = new ProcessSandbox({ available: async () => true }, "darwin");
		const protectedPaths = codexProtectedVaultSubpaths(".vault-config");
		const spec = await sandbox.prepare({
			executable: "/usr/bin/agent",
			args: ["--mode", "rpc"],
			cwd: vault,
			loopbackProxyPort: 45_678,
			deniedVaultSubpaths: protectedPaths,
			denyDotEnvFiles: true,
		}, vault);
		const profile = spec.args[1] ?? "";
		expect(spec.executable).toBe("/usr/bin/sandbox-exec");
		expect(spec.args.join(" ")).not.toMatch(/yolo|auto-approve|add-dir/);
		expect(profile).toContain('(allow network-outbound (remote tcp "localhost:45678"))');
		expect(profile.replace('(allow network-outbound (remote tcp "localhost:45678"))', "")).not.toContain("allow network-outbound");
		expect(profile).toContain("(allow sysctl-read)");
		expect(profile).toContain('(allow file-read* (literal "/"))');
		expect(profile).toContain('(global-name "com.apple.trustd.agent")');
		expect(profile).toContain('(global-name "com.apple.trustd")');
		expect(profile).toContain('(global-name "com.apple.SecurityServer")');
		expect(profile).toContain("/Library/Keychains");
		expect(profile).not.toContain("/Library/Preferences/");
		expect(profile).not.toContain("user-preference-read");
		for (const subpath of protectedPaths) {
			expect(profile).toContain(`(deny file-read* file-write* (literal "${join(await realpath(vault), subpath)}"))`);
		}
		expect(profile).toContain('(deny file-read* file-write* (regex #"');
		expect(profile).toContain("\\.env[^/]*");
		await expect(sandbox.prepare({ executable: "/usr/bin/agent", args: [], cwd: vault, loopbackProxyPort: 0 }, vault)).rejects.toThrow("端口无效");
	});

	it("enforces protected Vault paths and dot-env files in the real macOS sandbox", async () => {
		if (process.platform !== "darwin") return;
		const { vault } = await fixture();
		await writeFile(join(vault, ".vault-config", "secret.txt"), "blocked");
		await writeFile(join(vault, ".env.local"), "blocked");
		const sandbox = new ProcessSandbox({ available: async () => true }, "darwin");
		const launch = async (executable: string, args: string[]) => {
			const spec = await sandbox.prepare({
				executable,
				args,
				cwd: vault,
				deniedVaultSubpaths: codexProtectedVaultSubpaths(".vault-config"),
				denyDotEnvFiles: true,
			}, vault);
			return spawnSync(spec.executable, spec.args, {
				cwd: spec.cwd,
				encoding: "utf8",
				env: { ...process.env, ...spec.environment },
			});
		};
		expect((await launch("/bin/cat", [join(vault, "note.md")])).status).toBe(0);
		expect((await launch("/bin/cat", [join(vault, ".vault-config", "secret.txt")])).status).not.toBe(0);
		expect((await launch("/bin/cat", [join(vault, ".env.local")])).status).not.toBe(0);
		expect((await launch("/usr/bin/touch", [join(vault, "created.md")])).status).toBe(0);
		expect((await launch("/usr/bin/touch", [join(vault, ".vault-config", "blocked.md")])).status).not.toBe(0);
	});
});
