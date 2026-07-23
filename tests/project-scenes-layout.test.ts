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
    expect(css).toMatch(
      /data-talos-page="projects"[^}]*\.project-scene-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2\.2fr\)\s+minmax\(280px,\s*\.8fr\)/s
    );
    expect(css).toMatch(
      /\.project-entry-panel \.detail-row\s*\{[^}]*flex:\s*0 0 auto[^}]*min-height:\s*64px/s
    );
    expect(css).toMatch(
      /\.project-map-panel \.project-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1100px\)[\s\S]*\.project-map-panel \.project-grid\s*\{[^}]*repeat\(2,/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*680px\)[\s\S]*\.project-map-panel \.project-grid\s*\{[^}]*grid-template-columns:\s*1fr/s
    );
  });
});
