import { describe, expect, it } from "vitest";
import { describeApproval } from "../src/agent-workbench/ui/approval-presentation";

const evalCode = [
	'const ROOT = "/vault";',
	'function run(args) { return Bun.spawnSync(["git", ...args], { cwd: ROOT }); }',
	'console.log(run(["status", "--porcelain"]));',
].join("\n");

describe("approval presentation", () => {
	it("turns an OhMyPi eval request into one plain headline with folded code", () => {
		const view = describeApproval({
			runtimeId: "ohmypi",
			toolName: `Allow tool: eval\nLanguage: javascript\nCode: ${evalCode}`,
			toolInput: {},
			reason: "智能体请求执行工具",
			risk: "B",
			phase: "execute",
		});
		expect(view.headline).toBe("OhMyPi 想运行一段 javascript 代码");
		expect(view.facts).toEqual(["工具 eval", "语言 javascript", "3 行"]);
		expect(view.code).toMatchObject({ label: "javascript 代码", text: evalCode, lines: 3, firstLine: 'const ROOT = "/vault";' });
		expect(view.headline).not.toContain("Bun.spawnSync");
		expect(view.riskText).toBe("需要你确认：会在你的电脑上执行，范围受当前权限档限制");
	});

	it("handles the same request when the runtime sends it on one line", () => {
		const view = describeApproval({
			runtimeId: "ohmypi",
			toolName: "OhMyPi UI Request",
			toolInput: { title: `Allow tool: eval Language: javascript Code: ${evalCode.replace(/\n/g, " ")}` },
			reason: "智能体请求执行工具",
			risk: "B",
			phase: "execute",
		});
		expect(view.headline).toBe("OhMyPi 想运行一段 javascript 代码");
		expect(view.code?.lines).toBe(1);
		expect(view.code?.firstLine.length).toBeLessThanOrEqual(80);
	});

	it("uses the command field for other runtimes and keeps custom reasons", () => {
		const view = describeApproval({
			runtimeId: "codex",
			toolName: "Bash",
			toolInput: { command: "git status" },
			reason: "需要查看工作区状态",
			risk: "B",
			phase: "execute",
		});
		expect(view.headline).toBe("Codex 想运行一条命令");
		expect(view.code).toMatchObject({ label: "命令", text: "git status", lines: 1 });
		expect(view.riskText).toContain("需要查看工作区状态");
	});

	it("explains proposal and high-risk phases in plain words", () => {
		const base = { runtimeId: "claude", toolName: "Write", toolInput: { file_path: "a.md" }, reason: "智能体请求执行工具" };
		expect(describeApproval({ ...base, risk: "C", phase: "proposal" }).riskText).toBe("先确认提案；确认后还会再请你批准执行");
		expect(describeApproval({ ...base, risk: "C", phase: "execute" }).riskText).toBe("高风险：批准后才执行，结果可能无法自动恢复");
		expect(describeApproval({ ...base, risk: "C", phase: "execute" }).headline).toBe("Claude 想修改文件");
		expect(describeApproval({ ...base, risk: "C", phase: "execute" }).code).toBeNull();
	});

	it("never puts an unparsed long tool name into the headline", () => {
		const view = describeApproval({ runtimeId: "ohmypi", toolName: "x".repeat(200), toolInput: {}, reason: "", risk: "B", phase: "execute" });
		expect(view.headline).toBe("OhMyPi 想使用工具「工具」");
		expect(view.facts[0]?.length).toBeLessThanOrEqual(43);
	});
});
