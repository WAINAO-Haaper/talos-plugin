import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_DSH_PORT,
	DSH_HOST,
	buildDshLaunchPlan,
	buildDshWebArgs,
	dshBaseUrl,
	dshHomeRoot,
	normalizeDshPort,
} from "../src/harness/dsh-runtime";
import { HARNESS_IFRAME_SANDBOX } from "../src/harness/harness-workbench";
import { normalizeHarnessSurface } from "../src/harness/harness-switcher";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string =>
	readFileSync(`${projectRoot}${rel}`, "utf8");

// D-TLP-014：对话页内嵌 DeepSeek Harness 桌面界面的结构契约。
// 钉死三件事：loopback-only、工作区锁死 vault 根、凭证出 vault；
// 以及 view/main/settings 的接线不再回到旧视图嵌入。
describe("harness embed contract (D-TLP-014)", () => {
	it("normalizes the loopback port with a safe fallback", () => {
		expect(DEFAULT_DSH_PORT).toBe(3180);
		expect(normalizeDshPort(4173)).toBe(4173);
		expect(normalizeDshPort("52222")).toBe(52222);
		for (const bad of [undefined, null, "", "abc", 0, 80, 1023, 65536, 3.5, -1]) {
			expect(normalizeDshPort(bad)).toBe(DEFAULT_DSH_PORT);
		}
	});

	it("launches dsh web loopback-only and never opens a browser", () => {
		const args = buildDshWebArgs(3180);
		// 实证（dsh 0.1.0-rc.8）：web 是 --profile 值；`dsh web` 会立即退出
		expect(args).toEqual([
			"--profile",
			"web",
			"--host",
			"127.0.0.1",
			"--port",
			"3180",
			"--no-open",
		]);
		expect(DSH_HOST).toBe("127.0.0.1");
		expect(dshBaseUrl(3180)).toBe("http://127.0.0.1:3180");
		// 永不监听非回环地址
		expect(args.join(" ")).not.toContain("0.0.0.0");
	});

	it("keeps DSH_HOME in the user home, outside any vault", () => {
		expect(dshHomeRoot("/synthetic-home/alice")).toBe("/synthetic-home/alice/.talos/dsh-home");
		expect(dshHomeRoot("/synthetic-home/alice/")).toBe("/synthetic-home/alice/.talos/dsh-home");
		expect(() => dshHomeRoot("   ")).toThrow();
	});

	it("locks the harness workspace to the vault root via spawn cwd", () => {
		const plan = buildDshLaunchPlan({
			executable: "/usr/local/bin/dsh",
			port: 3180,
			dshHome: "/synthetic-home/alice/.talos/dsh-home",
			vaultRoot: "/synthetic-home/alice/vault",
		});
		expect(plan.cwd).toBe("/synthetic-home/alice/vault");
		expect(plan.env.DSH_HOME).toBe("/synthetic-home/alice/.talos/dsh-home");
		expect(plan.args).toContain("--no-open");
		expect(() =>
			buildDshLaunchPlan({
				executable: " ",
				port: 3180,
				dshHome: "/h",
				vaultRoot: "/v",
			})
		).toThrow();
		expect(() =>
			buildDshLaunchPlan({
				executable: "/bin/dsh",
				port: 3180,
				dshHome: "/h",
				vaultRoot: " ",
			})
		).toThrow();
	});

	it("wires the chat page to the dual-channel harness switcher", () => {
		const view = readSrc("src/view.ts");
		expect(view).toContain("HarnessSwitcherWorkbench");
		expect(view).toContain("HarnessWorkbench");
		expect(view).toContain("TalosAgentWorkbench");
		expect(view).toContain("getHarnessManager");
		// D-TLP-034（2026-08-26 改写）：对话页为 DeepSeek Harness｜TALOS 智能体双通道，
		// 恢复地址由 TALOS 原生 renderer 接管，
		// 构造隔离代理不直接出现在 view.ts。
		expect(view).not.toContain("chatWorkbenchView");
		expect(view).not.toContain("createConstructorIsolatedProxy");
		expect(view).not.toContain('import type { ClaudianView }');
	});

	it("keeps the TALOS native channel wiring intact", () => {
		const adapter = readSrc("src/agent-workbench/ui/talos-agent-workbench.ts");
		expect(adapter).toContain("NativeConversationView");
		expect(adapter).toContain("await this.native.mount");
		expect(adapter).toContain("await this.native.suspend()");
		expect(adapter).toContain("await this.native.destroy()");
	});

	it("stops the harness process on plugin unload", () => {
		const main = readSrc("src/main.ts");
		expect(main).toContain("getHarnessManager(): DshProcessManager");
		expect(main).toContain("this.harnessManager?.dispose()");
		expect(main).toContain("adapter instanceof FileSystemAdapter");
	});

	it("sandboxes the embedded UI without clipboard capabilities", () => {
		expect(HARNESS_IFRAME_SANDBOX.split(" ").sort()).toEqual([
		"allow-downloads",
		"allow-forms",
		"allow-same-origin",
		"allow-scripts",
	]);
		const workbench = readSrc("src/harness/harness-workbench.ts");
		expect(workbench).toContain('frame.setAttribute("sandbox"');
		expect(workbench).toContain('this.frame.setAttribute("src", baseUrl)');
		expect(workbench).not.toContain("clipboard-read");
		expect(workbench).not.toContain("clipboard-write");
	});

	it("exposes harness executable and port in settings", () => {
		const settings = readSrc("src/settings.ts");
		expect(settings).toContain("harnessExecutable: string");
		expect(settings).toContain("harnessPort: number");
		expect(settings).toContain("harnessPort: DEFAULT_DSH_PORT");
		expect(settings).toContain('setName("DeepSeek Harness")');
		expect(settings).toContain("DSH 保留独立对话面");
	});

	it("persists either selected channel without replacing it (D-TLP-015)", () => {
		const settings = readSrc("src/settings.ts");
		expect(settings).toContain("harnessSurface: string");
		expect(settings).toContain('harnessSurface: "dsh"');
		expect(normalizeHarnessSurface("codex")).toBe("codex");
		expect(normalizeHarnessSurface("dsh")).toBe("dsh");
		expect(normalizeHarnessSurface("nope")).toBe("dsh");
		expect(normalizeHarnessSurface(undefined)).toBe("dsh");
		const view = readSrc("src/view.ts");
		expect(view).not.toContain("resolveInitialHarnessSurface");
		expect(view).not.toContain("已自动切换到 Codex 工作台");
	});
});
