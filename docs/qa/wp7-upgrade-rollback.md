# WP7 升级与回滚验收

- 日期：2026-07-25（Asia/Shanghai）
- 分支：`codex/wp7-unified-ai-console`
- Task 15R 基线：`dab8ee2 docs: complete wp7 obsidian acceptance`
- 当前范围：Task 16 离线合成预验收
- 离线预验收：PASS
- 正式 WP6 回滚基线：已绑定
- Task 16 总体：未完成

## 本轮安全边界

- 只使用仓库内 `fixtures/wp6-vault/` 的合成 WP6 数据和系统临时目录副本。
- SecretStorage 使用内存 fake adapter；fixture 中的标记不可用于任何真实服务。
- 没有调用 Provider、网络、麦克风、STT、TTS 或外部命令。
- 没有读取或写入部署 Vault、真实插件 `data.json`、私人笔记正文或
  `.talos/private/`。
- 没有修改九个客户模块、部署 canonical registry、`manifest.json`、
  `versions.json` 或发行元数据。

## TDD 证据

### RED

先添加 `tests/wp7-upgrade-rollback.test.ts`，引用尚不存在的
`fixtures/wp6-vault/`。

```text
npx vitest run tests/wp7-upgrade-rollback.test.ts
Test Files 1 failed
Tests 1 failed
ENOENT: fixtures/wp6-vault/
```

失败点只证明 WP6 合成输入尚未建立；测试运行目录位于系统临时目录。

### GREEN

补充最小 WP6 fixture 后重新运行同一命令：

```text
npx vitest run tests/wp7-upgrade-rollback.test.ts
Test Files 1 passed
Tests 1 passed
```

## 离线覆盖

| 场景 | 合成证据 | 结果 |
|---|---|---|
| WP6 基线 | 插件 manifest 为 `0.4.0`，包含三个合成构建产物和配置 | PASS |
| 设置迁移 | Provider、语音开关、ASR/TTS 与目录映射保留 | PASS |
| 文字历史 | Claudian state、tab manager 和旧文字页签保留 | PASS |
| 语音历史 | 独立 voice namespace 与旧语音页签保留 | PASS |
| SecretStorage | 假明文字段经写入、读回验证后清空，仅保存引用名 | PASS |
| 旧入口 | `open-quyuan-v2`、`open-jarvis` 和旧 Claudian view type 仍存在 | PASS |
| 安装零业务差异 | 九个合成客户模块升级前后 SHA-256 聚合摘要一致 | PASS |
| 回滚 | 三个插件产物和 `data.json` 恢复为升级前精确内容 | PASS |
| 回滚零业务差异 | 九个合成客户模块回滚后摘要仍一致 | PASS |

## 正式 WP6 回滚基线

用户已确认把插件仓库 `main` 的以下状态作为 Task 16 正式 WP6 基线；TALOS
权威源码通过 `contracts/wp6-plugin-baseline.json` 固定该合同：

- Git commit：`ff871dcba6f729ed8b62cb7db9f2e18a11225c0b`
- 插件版本：`0.4.0`
- `main.js`：
  `c293ae87f2a401b6d5735b578b3d15c6dc62646dea65a9489a30de37d15b11cc`
- `manifest.json`：
  `6bea77518b87d294757cf56b2636a217ef6e482e30391a7d8835a34924c04efa`
- `styles.css`：
  `cad440a09f6ccc2002021d030c0120a7251d0c6cebe66869b4dfb8aafefd98db`
- 隔离离线构建：PASS；production license audit：108 packages；未使用网络。

该绑定只固定升级和回滚输入，不能替代真实 Obsidian 启动、真实数据迁移或真实
部署验收。

## 不能由本证据证明的事项

- 真实 Obsidian WP6 插件能够启动；
- 真实 WP6 配置和 SecretStorage 完成迁移；
- 真实文字和语音历史可在 UI 中打开；
- 真实插件三产物回滚后 WP6 能重新启动；
- 部署 Vault 九模块安装、升级和回滚差异为零；
- 真实 Provider、真实语音或 TALOS 2.0 发布门通过。

TALOS 权威源码现已纳入只读部署 verifier、对应合成测试和完整 13 条 canonical
Codex skill；部署实例尚未从该权威源升级。上述真实事项仍须按正式 Task 16
计划在获得单独授权后执行。

## 新鲜验证

| 命令 | 结果 |
|---|---|
| `npx vitest run tests/wp7-upgrade-rollback.test.ts tests/wp7-migration.test.ts tests/provider-secret-migration.test.ts` | PASS；3 files，10 tests |
| `npm test` | PASS；49 files，251 tests |
| `npm run test:quyuan` | PASS |
| `npm run test:approval-actions` | PASS |
| `npm run test:approval-executor` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS；108 个 production packages |

首次全量 lint 发现合成 fixture 硬编码 `.obsidian` 且把合成 `main.js` 当作生产
源码解析。fixture 随后改为自定义 `.wp6-config`；会匹配仓库忽略规则的合成
产物和配置统一以 `.fixture` 保存，只在系统临时目录内恢复文件名。同一升级
测试、lint 和完整回归重新运行后通过。
