import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionRequest } from "../src/agent-workbench/contracts/approval";
import { ApprovalBroker } from "../src/agent-workbench/security/approval-broker";
import { ExternalAccessGrantStore } from "../src/agent-workbench/security/external-access-grant";
import { PermissionRuleStore, type PermissionRule } from "../src/agent-workbench/security/permission-rule-store";
import { ProcessSandbox } from "../src/agent-workbench/security/process-sandbox";
import { LoopbackEgressProxy } from "../src/agent-workbench/security/loopback-egress-proxy";
import type { SecurityAuditRecord } from "../src/agent-workbench/security/security-audit";
import { VaultBoundary } from "../src/agent-workbench/security/vault-boundary";
import { codexPermissionProfileArgs, TALOS_AGENT_WORKBENCH_CODEX_PROFILE } from "../src/agent-workbench/security/codex-permission-profile";
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

	it("remembers generic network approval for the current conversation only", async () => {
		const { vault } = await fixture();
		const fixtureBroker = broker(vault);
		const network = request({ actionId: "network-1", kind: "network", targets: [], network: { protocol: "https", host: "example.test" } });
		const ruleId = await fixtureBroker.value.rememberExactRule(network, context);
		expect(ruleId).not.toBeNull();
		const reconnect = request({ ...network, actionId: "network-2" });
		expect((await fixtureBroker.value.evaluate(reconnect, context)).ruleId).toBe(ruleId);
		expect((await fixtureBroker.value.evaluate(reconnect, { ...context, conversationId: "conversation-2" })).decision).toBe("ask");
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
			compatibility: { initialize: async () => {}, dispose: () => {} },
			approvalBroker: fixtureBroker.value,
		});
		service.setWorkflowMode("execute");
		let prompts = 0;
		const decide = () => service.authorizeTool({
			runtimeId: "codex", conversationId: "conversation-1", vaultRoot: vault,
			toolName: "Write", toolInput: { file_path: "note.md" }, approvalUiAttached: true,
			prompt: async () => { prompts += 1; return "allow-always"; },
		});
		expect(await decide()).toBe("allow-always");
		service.setPermissionMode("scoped");
		expect(await decide()).toBe("allow");
		expect(prompts).toBe(1);
		expect(fixtureBroker.audits).toHaveLength(2);
	});

	it("extracts command path arguments and generic network hosts without persisting content", () => {
		const shell = normalizeToolAction({ runtimeId: "ohmypi", toolName: "bash", toolInput: { command: "rm ../outside.md", cwd: "." }, vaultRoot: "/synthetic/vault", actionId: "a" });
		expect(shell).toMatchObject({ kind: "shell", destructive: true, command: { executable: "rm", args: ["../outside.md"] } });
		const network = normalizeToolAction({ runtimeId: "codex", toolName: "WebFetch", toolInput: { url: "https://example.test/path" }, vaultRoot: "/synthetic/vault", actionId: "b" });
		expect(network.network).toEqual({ protocol: "https", host: "example.test", port: undefined });
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
	it("activates the current Codex TOML permissions profile and protects permanent zones", () => {
		const configDir = ".test-config";
		const args = codexPermissionProfileArgs(configDir);
		const serialized = args.join(" ");
		expect(serialized).toContain(`default_permissions="${TALOS_AGENT_WORKBENCH_CODEX_PROFILE}"`);
		expect(serialized).toContain(`permissions.${TALOS_AGENT_WORKBENCH_CODEX_PROFILE}=`);
		expect(serialized).toContain('":minimal"="read"');
		expect(serialized).toContain('":workspace_roots"={"."="write"');
		expect(serialized).toContain("\"" + configDir + "\"=\"deny\"");
		expect(serialized).not.toContain('"type"="restricted"');
		expect(() => codexPermissionProfileArgs("/absolute/config")).toThrow("配置目录");
	});
	it("fails closed when the OS sandbox is unavailable", async () => {
		const sandbox = new ProcessSandbox({ available: async () => false }, "darwin");
		await expect(sandbox.prepare({ executable: "/usr/bin/agent", args: [], cwd: "/vault" }, "/vault")).rejects.toThrow("失败关闭");
	});

	it("allows only the exact TALOS loopback proxy and includes minimum startup reads", async () => {
		const { vault } = await fixture();
		const sandbox = new ProcessSandbox({ available: async () => true }, "darwin");
		const spec = await sandbox.prepare({ executable: "/usr/bin/agent", args: ["--mode", "rpc"], cwd: vault, loopbackProxyPort: 45_678 }, vault);
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
		await expect(sandbox.prepare({ executable: "/usr/bin/agent", args: [], cwd: vault, loopbackProxyPort: 0 }, vault)).rejects.toThrow("端口无效");
	});
});
