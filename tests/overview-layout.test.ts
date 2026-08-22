import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${projectRoot}src/view.ts`, "utf8");
const stats = readFileSync(`${projectRoot}src/data/stats.ts`, "utf8");
const css = readFileSync(`${projectRoot}styles.talos.css`, "utf8");

describe("overview approval compatibility layout", () => {
  it("renders separate pending and preference approval modules", () => {
    expect(view).toContain("decidePreferenceCandidate");
    expect(view).toContain('cls: "overview-approval-grid"');
    expect(view).toContain('cls: "item approval-item candidate-approval-item"');
    expect(view).toContain("overview-pending-panel");
    expect(view).toContain("overview-preference-panel");
  });

  it("keeps the full candidate title for exact write-back", () => {
    expect(stats).toContain('out.push({ title: stripMd(s.slice(2)), meta: "待确认", path: file.path });');
    expect(stats).not.toContain("stripMd(s.slice(2)).slice(0, 70)");
  });

  it("renders a task kanban section between action panel and modules", () => {
    expect(view).toContain('cls: "overview-kanban"');
    expect(view).toContain('"data-workbench-section", "task-kanban"');
    expect(view).toContain("任务进度看板");
    expect(view).toContain("fillOverviewKanban");
  });

  it("styles the kanban with thin default rules and geometric-modern overrides", () => {
    expect(css).toContain(".overview-kanban-col");
    expect(css).toContain(".talos-console.theme-geometric-modern .overview-kanban-col");
  });

  it("uses container-aware reflow without the incompatible fixed column pair", () => {
    expect(css).toContain(".overview-approval-grid");
    expect(css).toContain("container: overview-content / inline-size");
    expect(css).toMatch(/@container\s+overview-content\s+\(max-width:/);
    expect(css).not.toContain("minmax(620px,1.22fr)");
    expect(css).toContain(".overview-approval-grid .approval-actions");
    expect(css).toMatch(/\.overview-approval-grid \.approval-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
  });
});
