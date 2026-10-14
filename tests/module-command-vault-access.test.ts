import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModuleBoundaryCheck, preserveCreatedFileOnRecovery } from "../src/module-commands/vault-access";
const cleanups: string[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
 const root = await mkdtemp(join(tmpdir(), "talos-module-boundary-")); cleanups.push(root);
 await mkdir(join(root, "Inbox")); await mkdir(join(root, "Identity")); await mkdir(join(root, "System"));
 await writeFile(join(root, "Inbox", "note.md"), "note"); await writeFile(join(root, "Identity", "PROFILE.md"), "profile");
 return { root, check: createModuleBoundaryCheck(root, ".vault-config") };
}
describe("real filesystem module boundaries", () => {
 it("accepts a direct data path and a new child path", async () => {
  const { check } = await fixture(); await expect(check("Inbox/note.md")).resolves.toBeUndefined(); await expect(check("Inbox/new/sub.md")).resolves.toBeUndefined();
 });
 it("rejects an Inbox file alias into Identity", async () => {
  const { root, check } = await fixture(); await symlink(join(root, "Identity", "PROFILE.md"), join(root, "Inbox", "alias.md"));
  await expect(check("Inbox/alias.md")).rejects.toThrow("重定向");
 });
 it("rejects a directory redirect into another in-Vault module", async () => {
  const { root, check } = await fixture(); await symlink(join(root, "System"), join(root, "Inbox", "alias"));
  await expect(check("Inbox/alias/new.md")).rejects.toThrow("重定向");
 });
 it("rejects external redirects and lexical traversal", async () => {
  const { root, check } = await fixture(); await symlink(tmpdir(), join(root, "Inbox", "outside"));
  await expect(check("Inbox/outside/a.md")).rejects.toThrow(); await expect(check("Inbox/../Identity/PROFILE.md")).rejects.toThrow();
 });
 it("rejects the host configuration area", async () => {
  const { check } = await fixture(); await expect(check(".vault-config/data.json")).rejects.toThrow();
  await expect(check("System/credentials.json")).rejects.toThrow();
  await expect(check("System/.env")).rejects.toThrow();
 });
 it("fails closed before any check-then-delete approximation", async () => {
  const unsafeDelete = vi.fn();
  await expect(preserveCreatedFileOnRecovery().then(unsafeDelete)).rejects.toThrow("新建文件已保留");
  expect(unsafeDelete).not.toHaveBeenCalled();
 });
});
