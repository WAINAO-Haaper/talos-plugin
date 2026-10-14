import { NodeCanonicalPathHost, VaultBoundary } from "../agent-workbench/security/vault-boundary";
import { validateVaultRelativePath } from "./data-format";

/** Reject redirects even within the Vault: an Inbox alias must not reach Identity. */
export function createModuleBoundaryCheck(vaultRoot: string, configDir: string): (path: string) => Promise<void> {
 const paths = new NodeCanonicalPathHost();
 const boundary = new VaultBoundary(vaultRoot, paths, 20, configDir);
 let canonicalRoot: Promise<string> | undefined;
 return async (raw: string): Promise<void> => {
  const safe = validateVaultRelativePath(raw);
  const assessed = await boundary.inspect({ raw: safe, role: "source" });
  if (!assessed.insideVault || assessed.permanentlyDenied) throw new Error("目标超出允许的数据范围");
  const relative = paths.relative(await (canonicalRoot ??= paths.realpath(vaultRoot)), assessed.canonical).split(paths.separator).join("/").normalize("NFC");
  const requested = safe.normalize("NFC");
  const comparable = (value: string) => paths.caseSensitive ? value : value.toLocaleLowerCase("en-US");
  if (comparable(relative) !== comparable(requested)) throw new Error("数据路径包含重定向，请选择实际模块中的原始文件");
 };
}

/** Obsidian has no atomic compare-and-delete API. Never approximate it with read + trash. */
export async function preserveCreatedFileOnRecovery(): Promise<never> {
 throw new Error("新建文件已保留；当前宿主不支持原子条件删除，请按失败清单人工检查。");
}
