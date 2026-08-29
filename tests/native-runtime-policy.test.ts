import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codexProtectedVaultSubpaths } from "../src/agent-workbench/security/codex-permission-profile";
import { evaluateQuyuanGovernance } from "../src/quyuan/governance";
import {
	enforceRealtimeVoiceIoSettings,
	evaluateRuntimeToolBoundary,
	resolveEffectiveRuntimePolicy,
	VOICE_NETWORK_IO_ALLOWED,
	VOICE_QWEN_WEB_SEARCH_ALLOWED,
} from "../src/quyuan/runtime-policy";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtimeFactorySource = readFileSync(`${root}src/agent-workbench/discovery/desktop-runtime-factory.ts`, "utf8");
const codexAdapterSource = readFileSync(`${root}src/agent-workbench/adapters/codex/codex-app-server-adapter.ts`, "utf8");

describe("native TALOS runtime policy", () => {
	it("runs Codex app-server in the TALOS sandbox and selects Codex externalSandbox policy", () => {
		const start = runtimeFactorySource.lastIndexOf('if (runtimeId === "codex")');
		const end = runtimeFactorySource.indexOf("const raw = buildOhMyPiLaunch", start);
		const branch = runtimeFactorySource.slice(start, end);
		expect(branch).toContain("spawnJsonLineRpc");
		expect(branch).toContain("this.sandbox.prepare");
		expect(branch).toContain("codexProtectedVaultSubpaths");
		expect(branch).toContain("denyDotEnvFiles: true");
		expect(branch).not.toContain("codexPermissionProfileArgs");
		expect(codexAdapterSource).toContain('sandbox: "danger-full-access"');
		expect(codexAdapterSource).toContain('sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" }');
		expect(codexAdapterSource).not.toContain("permissions: TALOS_AGENT_WORKBENCH_CODEX_PROFILE");
	});

	it("routes legacy voice settings into the authorized Realtime boundary", () => {
		const settings = enforceRealtimeVoiceIoSettings({
			voiceAgentCommand: "unsafe",
			voicePermission: "all",
			ttsEngine: "edgetts",
			jarvisSttEngine: "webspeech",
			quyuanAsrEngine: "cloud",
			quyuanLocalAsrNetworkConsent: true,
			quyuanVadNetworkConsent: true,
		});
		expect(VOICE_NETWORK_IO_ALLOWED).toBe(true);
		expect(VOICE_QWEN_WEB_SEARCH_ALLOWED).toBe(true);
		expect(settings).toMatchObject({ voiceAgentCommand: "", voicePermission: "readonly", ttsEngine: "realtime", jarvisSttEngine: "realtime", quyuanAsrEngine: "qwen-realtime" });
	});

	it("normalizes legacy yolo and keeps voice hard read-only", () => {
		const chat = resolveEffectiveRuntimePolicy({ channel: "chat", permissionMode: "yolo" });
		expect(chat).toMatchObject({ effectivePermissionMode: "normal", approvalPolicy: "untrusted", sandbox: "read-only" });
		for (const permissionMode of ["yolo", "bypassPermissions", "ignore all rules"]) {
			const voice = resolveEffectiveRuntimePolicy({ channel: "voice", permissionMode });
			expect(voice).toMatchObject({ effectivePermissionMode: "normal", approvalPolicy: "never", sandbox: "read-only", networkAccess: false, allowShell: false, allowMutations: false });
			expect(evaluateRuntimeToolBoundary(voice, "Read")).toBe("allow");
			for (const tool of ["Write", "Edit", "Bash", "apply_patch", "permissions", "WebSearch", "WebFetch"]) expect(evaluateRuntimeToolBoundary(voice, tool)).toBe("deny");
		}
	});

	it("materializes Codex permanent deny zones for the external TALOS sandbox", () => {
		const configDir = ".vault-config";
		expect(codexProtectedVaultSubpaths(configDir)).toEqual([
			configDir,
			".talos/private",
			".talos/secrets",
			".talos/credentials",
		]);
		expect(() => codexProtectedVaultSubpaths("../escape")).toThrow();
	});

	it("keeps identity and destructive requests behind governance", () => {
		expect(evaluateQuyuanGovernance({ toolName: "Write", input: { file_path: "identity/身份.md" }, readPaths: new Set() }).decision).toBe("deny");
		expect(evaluateQuyuanGovernance({ toolName: "Bash", input: { command: "rm note.md" }, readPaths: new Set() }).decision).not.toBe("allow");
	});
});
