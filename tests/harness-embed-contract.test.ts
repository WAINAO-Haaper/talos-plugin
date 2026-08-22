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
import { normalizeHarnessSurface } from "../src/harness/harness-switcher";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string =>
	readFileSync(`${projectRoot}${rel}`, "utf8");

// D-TLP-014：对话页内嵌 DeepSeek Harness 桌面界面的结构契约。
// 钉死三件事：loopback-only、工作区锁死 vault 根、凭证出 vault；
// 以及 view/main/settings 的接线不再回到 ClaudianView 嵌入。
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
		expect(dshHomeRoot("/Users/alice")).toBe("/Users/alice/.talos/dsh-home");
		expect(dshHomeRoot("/Users/alice/")).toBe("/Users/alice/.talos/dsh-home");
		expect(() => dshHomeRoot("   ")).toThrow();
	});

	it("locks the harness workspace to the vault root via spawn cwd", () => {
		const plan = buildDshLaunchPlan({
			executable: "/usr/local/bin/dsh",
			port: 3180,
			dshHome: "/Users/alice/.talos/dsh-home",
			vaultRoot: "/Users/alice/vault",
		});
		expect(plan.cwd).toBe("/Users/alice/vault");
		expect(plan.env.DSH_HOME).toBe("/Users/alice/.talos/dsh-home");
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
		expect(view).toContain("ClaudianCodexWorkbench");
		expect(view).toContain("getHarnessManager");
		// D-TLP-015（2026-08-23 改写）：对话页为 DeepSeek｜Codex 双通道滑动
		// 切换器；ClaudianView 嵌入接线迁入 claudian-codex-workbench 适配器，
		// 构造隔离代理不直接出现在 view.ts。
		expect(view).not.toContain("chatWorkbenchView");
		expect(view).not.toContain("createConstructorIsolatedProxy");
		expect(view).not.toContain('import type { ClaudianView }');
	});

	it("keeps the Codex channel adapter wiring intact", () => {
		const adapter = readSrc("src/harness/claudian-codex-workbench.ts");
		expect(adapter).toContain("createConstructorIsolatedProxy");
		expect(adapter).toContain("registerEmbeddedView");
		expect(adapter).toContain("unregisterEmbeddedView");
		expect(adapter).toContain("mountEmbedded");
		expect(adapter).toContain("suspendEmbedded");
	});

	it("stops the harness process on plugin unload", () => {
		const main = readSrc("src/main.ts");
		expect(main).toContain("getHarnessManager(): DshProcessManager");
		expect(main).toContain("this.harnessManager?.stop()");
		expect(main).toContain("adapter instanceof FileSystemAdapter");
	});

	it("exposes harness executable and port in settings", () => {
		const settings = readSrc("src/settings.ts");
		expect(settings).toContain("harnessExecutable: string");
		expect(settings).toContain("harnessPort: number");
		expect(settings).toContain("harnessPort: DEFAULT_DSH_PORT");
		expect(settings).toContain("AI 对话 Harness（内嵌界面）");
	});

	it("persists the selected channel with a safe fallback (D-TLP-015)", () => {
		const settings = readSrc("src/settings.ts");
		expect(settings).toContain("harnessSurface: string");
		expect(settings).toContain('harnessSurface: "dsh"');
		expect(normalizeHarnessSurface("codex")).toBe("codex");
		expect(normalizeHarnessSurface("dsh")).toBe("dsh");
		expect(normalizeHarnessSurface("nope")).toBe("dsh");
		expect(normalizeHarnessSurface(undefined)).toBe("dsh");
	});
});
