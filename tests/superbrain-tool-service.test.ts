import { describe, expect, it } from "vitest";
import { SuperbrainToolService, SuperbrainScheduleService, type SuperbrainJsonRunner } from "../src/module-commands/superbrain-tool-service";

describe("superbrain tool preview boundary", () => {
  it("previews a write and runs only the captured fixed argv once", async () => {
    const calls: string[][] = [];
    const runner: SuperbrainJsonRunner = { async run(script, args) { expect(script).toBe("vault.py"); calls.push([...args]); return { files: 2 }; } };
    const service = new SuperbrainToolService(runner);
    const plan = await service.preview("index");
    expect(calls).toEqual([["index", "build", "--check"]]);
    await service.run(plan);
    expect(calls[1]).toEqual(["index", "build"]);
    await expect(service.run(plan)).rejects.toThrow("重新预览");
  });
  it("shows a failed check result without offering a write", async () => {
    const runner: SuperbrainJsonRunner = { async run() { return { process_exit_code: 1, errors: ["broken link"] }; } };
    const plan = await new SuperbrainToolService(runner).preview("members");
    expect(plan.preview).toEqual({ process_exit_code: 1, errors: ["broken link"] });
    expect(plan.writes).toBe(false);
  });
  it("previews an isolated restore before using the captured archive and target", async () => {
    const calls: string[][] = [];
    const runner: SuperbrainJsonRunner = { async run(_script, args) { calls.push([...args]); return { eligible: true, files: 3 }; } };
    const service = new SuperbrainToolService(runner, "/tmp/my-vault");
    await expect(service.preview("snapshot", { snapshotOperation: "restore", archive: "/tmp/a.zip", destination: "/tmp/my-vault/inside" })).rejects.toThrow("之外");
    const plan = await service.preview("snapshot", { snapshotOperation: "restore", archive: "/tmp/a.zip", destination: "/tmp/recovered" });
    expect(calls[0]).toEqual(["snapshot", "restore", "/tmp/a.zip", "/tmp/recovered", "--check"]);
    await service.run(plan);
    expect(calls[1]).toEqual(["snapshot", "restore", "/tmp/a.zip", "/tmp/recovered"]);
  });
  it("keeps M07 disabled until the configured job is eligible", async () => {
    const calls: string[][] = [];
    const runner: SuperbrainJsonRunner = { async run(_script, args) { calls.push([...args]); return { status: "disabled", model_called: false }; } };
    const service = new SuperbrainScheduleService(runner);
    const plan = await service.preview("heartbeat");
    expect(plan.enabled).toBe(false);
    await expect(service.run(plan)).rejects.toThrow("重新预览");
    expect(calls).toEqual([["heartbeat"]]);
  });
  it("preserves a valid top-level search result list from the kit", async () => {
    const runner: SuperbrainJsonRunner = { async run(_script, args) {
      expect(args).toEqual(["index", "query", "灯塔活动"]);
      return { items: [{ path: "04-项目/灯塔验收项目.md", score: 6.9 }], process_exit_code: 0 };
    } };
    const plan = await new SuperbrainToolService(runner).preview("search", { query: "灯塔活动" });
    expect((plan.preview as { items: Array<{ path: string }> }).items[0]?.path).toBe("04-项目/灯塔验收项目.md");
    expect(plan.writes).toBe(false);
  });
  it("rejects path escapes before calling the local tool", async () => {
    const calls: string[][] = [];
    const runner: SuperbrainJsonRunner = { async run(_script, args) { calls.push([...args]); return {}; } };
    const service = new SuperbrainToolService(runner);
    await expect(service.preview("export", { source: "../Private", destination: "/tmp/export" })).rejects.toThrow("无效路径");
    await expect(service.preview("export", { source: "03-素材", destination: "relative/export" })).rejects.toThrow("库外");
    expect(calls).toHaveLength(0);
  });
});
