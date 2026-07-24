# WP7 确定性 Mock 合成验收

- 日期：2026-07-25（Asia/Shanghai）
- 分支：`codex/wp7-unified-ai-console`
- Task 13 基线：`4ff988a feat: add resumable wp7 migration`
- 范围：Task 14 mock 合成验收
- 结果：PASS

## 安全边界

- 测试只读取仓库内 `fixtures/wp7-vault/` 的纯合成内容，运行时写入内存 Vault；没有写入部署 Vault 或九个真实客户模块。
- Provider 全部使用现有 `MockProvider` 经 `ProviderFacade` 调度；真实网络 Provider 调用数为 0。
- fixture 仅含不可用的假密钥标记；本文不记录其值。
- `.env` 类文件和 `.talos/private/` 均由现有 `VaultRetriever`/密钥策略拦截，Provider 请求中零出现。
- synthetic canonical registry 含 13 条命令和 `talos-ask`；部署 Vault 的十二条 registry 投影未修改。
- `.talos/command-requests/talos-ask.json` 仅作为协议与恢复证据读取，验收流程未把它当作执行器，也未改写它。

## 覆盖结果

| # | 场景 | 确定性证据 | 结果 |
|---|---|---|---|
| 1 | 打开统一工作台 | `TalosPageRouter("overview")` 解析为 `workbench`，render key 为 `overview` | PASS |
| 2 | 一键执行 B 类动作 | 复用 builtin `create-note`，风险决策为 `snapshot-and-run`，无需二次审批 | PASS |
| 3 | running/completed 状态 | 同一任务观测到 `ready → queued → running → completed` | PASS |
| 4 | C 类未经批准零写入 | `publish-backfill` 首次停留 `ready`/`approvalRequired`，内存 Vault 写入计数不变 | PASS |
| 5 | 批准后写入 | 新审批执行携带 `approvalGranted` 后完成受控本地 mock 写入 | PASS |
| 6 | AI 对话全库检索 | 九个合成模块、候选与推断上下文进入安全检索结果 | PASS |
| 7 | Voice 独立 namespace | Ask session 为 `voice:shared`；`VoiceSessionStore` envelope 固定为 `voice`，不含 chat namespace | PASS |
| 8 | Provider 切换 | 同一 chat session 记录 `mock-alpha → mock-beta` switch point | PASS |
| 9 | manual review | 人工复核轮过滤工具请求并产生 `tool-skipped: review-mode` | PASS |
| 10 | `30 洞察` / `70 输出` 写回 | 复用 `proposeAnswerWriteback` 与同一动作执行器，分别写入合成目标 | PASS |
| 11 | 密钥与 private 零外发 | 两类路径均出现在 blocked 结果，全部 Provider 请求不含对应 payload | PASS |
| 12 | 撤销或恢复证据 | B 类执行前生成 recovery record，记录任务 ID 与精确目标路径 | PASS |

## TDD 记录

1. RED：先创建 `tests/wp7-e2e.test.ts`；`npx vitest run tests/wp7-e2e.test.ts` 按预期以 `ENOENT` 失败，因为 `fixtures/wp7-vault/` 尚不存在（1 file，1 failed）。
2. GREEN：建立九模块纯合成 fixture、审批夹具、假密钥边界、13 条 synthetic registry 和 canonical request 证据后，同一命令通过（1 file，1 test）。
3. 契约固化：`quyuan-v2.selftest.mjs` 新增共享核心复用、无网络调用、fixture registry 和密钥边界文件存在性断言。
4. 未修改 `src/` 生产实现；没有新增第二执行器、审批系统或会话存储。

## 新鲜验证结果

| 命令 | 结果 |
|---|---|
| `npx vitest run tests/wp7-e2e.test.ts` | PASS；1 file，1 test |
| `npm test` | PASS；43 files，232 tests |
| `npm run test:quyuan` | PASS；`Quyuan v2 self-test: passed` |
| `npm run test:approval-actions` | PASS；`approval action selftest passed` |
| `npm run test:approval-executor` | PASS；`approval executor selftest passed` |
| `npm run typecheck` | PASS；`tsc --noEmit --skipLibCheck` |
| `npm run lint` | PASS；无 error 或 warning 输出 |
| `npm run build` | PASS；生产构建完成，TALOS + Quyuan styles 690 KB，结构自检通过 |
| build 内 `licenses:check` | PASS；108 production packages |
| `git diff --check` | PASS；无输出 |

## 修复记录

- 首次 fixture 补丁因父目录不存在而未落盘；创建计划内的明确目录树后重新应用，未产生部分 fixture 或部署 Vault 变更。
- E2E 的预期 RED 仅由 fixture 缺失触发；补齐 fixture 后无需修改生产代码即转为 GREEN。
- 验证阶段未发现功能、类型、lint、许可证或构建回归。

## 产物

- `tests/wp7-e2e.test.ts`
- `fixtures/wp7-vault/`
- `docs/qa/wp7-mock-acceptance.md`
- `quyuan-v2.selftest.mjs`
