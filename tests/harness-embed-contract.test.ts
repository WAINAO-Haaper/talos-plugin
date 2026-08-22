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
		expect(args).toEqual([
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

	it("wires the chat page to HarnessWorkbench instead of ClaudianView", () => {
		const view = readSrc("src/view.ts");
		expect(view).toContain("HarnessWorkbench");
		expect(view).toContain("getHarnessManager");
		// D-TLP-014：ClaudianView 嵌入与构造隔离代理随 C-2 之后退役，
		// claudian 工作台仅保留为独立恢复视图（命令 open-quyuan-v2-recovery）。
		expect(view).not.toContain("chatWorkbenchView");
		expect(view).not.toContain("createConstructorIsolatedProxy");
		expect(view).not.toContain("EmbeddedClaudianView");
		expect(view).not.toContain('import type { ClaudianView }');
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
});
