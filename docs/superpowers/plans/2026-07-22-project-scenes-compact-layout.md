# Project Scenes Compact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the oversized project-scene entry modules and shorten the overall projects page without removing information.

**Architecture:** Add stable project-page classes in `pageProjects`, then scope all sizing overrides to `data-talos-page="projects"`. Use a 70/30 desktop grid, content-height entry rows, three/two/one project-card columns across desktop/tablet/mobile, and leave the shared panel-grid contract untouched.

**Tech Stack:** TypeScript DOM rendering, CSS Grid/Flexbox, Vitest structural regression, Node self-test, esbuild.

## Global Constraints

- Keep the two right-side entries vertically ordered and fully clickable.
- Do not remove project name, count, priority, progress, or latest-file information.
- Do not alter generic `.panel-grid` behavior or other TALOS pages.
- At 1100px and below use one panel column; at 680px and below use one project-card column.
- Do not add dependencies, modify Vault data, or create a Git commit.

---

### Task 1: Project Layout Contract

**Files:**
- Create: `tests/project-scenes-layout.test.ts`
- Test: `tests/project-scenes-layout.test.ts`

**Interfaces:**
- Consumes: source text from `src/view.ts` and `styles.talos.css`.
- Produces: a regression contract for project-page classes, non-stretch entry rows, and responsive card columns.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const view = readFileSync(`${root}src/view.ts`, "utf8");
const css = readFileSync(`${root}styles.talos.css`, "utf8");

describe("project scenes compact layout", () => {
  it("marks the projects map and entry panel with stable scoped classes", () => {
    expect(view).toContain('cls: "panel-grid project-scene-layout"');
    expect(view).toContain('p.addClass("project-map-panel")');
    expect(view).toContain('scene.addClass("project-entry-panel")');
  });

  it("uses a compact project-only grid without stretching entry rows", () => {
    expect(css).toMatch(/data-talos-page="projects"[^}]*\.project-scene-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2\.2fr\)\s+minmax\(280px,\s*\.8fr\)/s);
    expect(css).toMatch(/\.project-entry-panel \.detail-row\s*\{[^}]*flex:\s*0 0 auto[^}]*min-height:\s*64px/s);
    expect(css).toMatch(/\.project-map-panel \.project-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*\.project-map-panel \.project-grid\s*\{[^}]*repeat\(2,/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)[\s\S]*\.project-map-panel \.project-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  });
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- tests/project-scenes-layout.test.ts`

Expected: FAIL because the project-specific classes and CSS do not yet exist.

### Task 2: Compact Projects Page

**Files:**
- Modify: `src/view.ts:2107-2144`
- Modify: `styles.talos.css`
- Test: `tests/project-scenes-layout.test.ts`

**Interfaces:**
- Consumes: existing `panel`, `project-grid`, `detail-list`, `project-card`, and `detail-row` components.
- Produces: `project-scene-layout`, `project-map-panel`, and `project-entry-panel` styling hooks.

- [ ] **Step 1: Add stable classes**

```ts
const grid = page.createDiv({ cls: "panel-grid project-scene-layout" });
const p = this.panel(grid, "#4D8DFF", "项目场景地图", `${this.paths.dir("projects")} · 高频项目优先`);
p.addClass("project-map-panel");
// existing project-card rendering remains unchanged
const scene = this.panel(grid, "#A78BFA", "场景索引", "项目入口总地图");
scene.addClass("project-entry-panel");
```

- [ ] **Step 2: Add project-only sizing**

```css
.talos-console[data-talos-page="projects"] .project-scene-layout {
  grid-template-columns: minmax(0, 2.2fr) minmax(280px, .8fr);
  align-items: start;
  gap: 12px;
}
.talos-console[data-talos-page="projects"] .project-map-panel .project-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.talos-console[data-talos-page="projects"] .project-entry-panel {
  align-self: start;
}
.talos-console[data-talos-page="projects"] .project-entry-panel .detail-list {
  flex: 0 0 auto;
  gap: 8px;
}
.talos-console[data-talos-page="projects"] .project-entry-panel .detail-row {
  flex: 0 0 auto;
  min-height: 64px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
}
```

Also scope compact project-card padding and vertical spacing to `.project-map-panel` without hiding any child content.

- [ ] **Step 3: Add responsive columns**

```css
@media (max-width: 1100px) {
  .talos-console[data-talos-page="projects"] .project-scene-layout { grid-template-columns: 1fr; }
  .talos-console[data-talos-page="projects"] .project-map-panel .project-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  .talos-console[data-talos-page="projects"] .project-map-panel .project-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/project-scenes-layout.test.ts`

Expected: 1 test file and 2 tests pass.

### Task 3: Visual QA, Build, and Deployment

**Files:**
- Modify: `docs/design-qa.md`
- Generated: `main.js`, `styles.css`
- Backup: `backups/obsidian-sync-20260722-project-scenes-before/`

**Interfaces:**
- Consumes: built plugin artifacts.
- Produces: verified and installed projects-page layout.

- [ ] **Step 1: Run full verification**

Run: `npm test && npm run test:quyuan && npm run lint && npm run build && git diff --check`

Expected: all tests and checks exit 0.

- [ ] **Step 2: Verify 1600×1000, 1024×768, and 390×844**

Confirm desktop 70/30 geometry, entry rows remain near 64px instead of matching the map height, project cards resolve to 3/2/1 columns, all text stays inside cards, and `scrollWidth === clientWidth`.

- [ ] **Step 3: Record QA evidence**

Append `Project Scenes Compact Layout QA · 2026-07-22` to `docs/design-qa.md` with measured widths, heights, column counts, overflow result, and console log result.

- [ ] **Step 4: Back up and deploy**

Back up installed `main.js`, `manifest.json`, and `styles.css`, copy the fresh artifacts into `$DEPLOYMENT_ENV/.obsidian/plugins/talos/`, then verify each pair with `cmp -s` and SHA-256.
