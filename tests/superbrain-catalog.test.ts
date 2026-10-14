import { describe, expect, it } from "vitest";
import { mapSuperbrainFile, parseSuperbrainCatalog, SUPERBRAIN_WORKFLOW_SLUGS } from "../src/module-commands/superbrain-catalog";
import { schemaFromSuperbrainConfig } from "../src/data/schema";

const catalog = () => ({
  schema_version: 1,
  workflows: SUPERBRAIN_WORKFLOW_SLUGS.map((slug, index) => ({
    id: `C${String(index + 1).padStart(2, "0")}`, slug, title: slug, group: "focus", summary: "test", files: ["System/WORKFLOWS.md"], tools: ["inventory"], icon: "sun",
  })),
  mechanisms: Array.from({ length: 10 }, (_, index) => ({
    id: `M${String(index + 1).padStart(2, "0")}`, title: `mechanism ${index}`, summary: "test", files: ["System/SCHEMA.md"], tools: ["health"], icon: "check",
  })),
});

describe("superbrain catalog boundary", () => {
  it("requires every C and M id to match the shared kit order", () => {
    expect(parseSuperbrainCatalog(JSON.stringify(catalog())).workflows).toHaveLength(15);
    const broken = catalog(); broken.workflows[1].id = "C15";
    expect(() => parseSuperbrainCatalog(JSON.stringify(broken))).toThrow("C02");
  });
  it("rejects unregistered commands and paths escaping the vault", () => {
    const broken = catalog(); broken.mechanisms[0].tools = ["shell"];
    expect(() => parseSuperbrainCatalog(JSON.stringify(broken))).toThrow("未登记");
    const path = catalog(); path.workflows[0].files = ["../private.md"];
    expect(() => parseSuperbrainCatalog(JSON.stringify(path))).toThrow("无效路径");
  });
  it("uses the kit's nested identity path and user directory mapping", () => {
    const schema = schemaFromSuperbrainConfig(JSON.stringify({ module_paths: { inbox: "Notes/Inbox", identity: "System/Identity" } }));
    expect(schema.identity).toBe("System/Identity");
    expect(mapSuperbrainFile("00-收件箱/_README.md", schema)).toBe("Notes/Inbox/_README.md");
    expect(mapSuperbrainFile("System/Identity/CONTEXT.md", schema)).toBe("System/Identity/CONTEXT.md");
    expect(mapSuperbrainFile("System/自动化/jobs.json", { ...schema, automation: "Custom/Jobs" })).toBe("Custom/Jobs/jobs.json");
    expect(() => schemaFromSuperbrainConfig(JSON.stringify({ module_paths: { inbox: "../Outside" } }))).toThrow("路径无效");
  });
});
