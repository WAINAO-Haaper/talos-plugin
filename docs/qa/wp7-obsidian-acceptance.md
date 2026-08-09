# WP7 Obsidian 人工视觉与交互验收

- 日期：2026-07-25（Asia/Shanghai）
- 分支：`codex/wp7-unified-ai-console`
- Git 基线：`d72cc1c docs: record wp7 obsidian qa blockers`
- 临时验收 Vault：由 `fixtures/wp7-vault/` 创建的本地一次性合成 Vault
- 部署 Vault：`$DEPLOYMENT_ENV`
- Obsidian：1.12.7
- 结果：**PASS（Task 15R 完成；Task 16 尚未开始）**

## 安全边界

- B/C 写入、恢复、取消和 Mock Provider 切换只在由
  `fixtures/wp7-vault/` 创建的临时合成 Vault 中执行。
- 部署 Vault 只同步 `main.js`、`manifest.json`、`styles.css`，并执行六页加载、
  只读状态和布局检查；没有在部署 Vault 点击 B/C 客户模块写入动作。
- 验收命令和证据未采集真实密钥、凭证、`.talos/private/` 内容或私人笔记正文；
  Provider 中心只调用 SecretStorage 的存在性检查，不读取密钥值。
- 未调用真实网络 Provider。临时 Mock Provider 使用仅含本地 `done` fixture
  的实现，切换验收未调用 `chat`；未授权或使用真实麦克风、TTS、网络 ASR。
- 未修改九个客户模块，也未手工修改部署 Vault 的 canonical registry。
- 部署 registry 验收后仍为 12 条。

## 生产组合层

- 插件实例只创建一套 builtin action registry、`TalosTaskRunner`、
  `MemoryTaskStore` 和 `VaultRecoveryStore`。
- 同一 runtime 注入统一控制台、TaskDrawer、审批动作和 Provider tool proposal；
  没有新增第二执行器、第二审批系统或第二会话存储。
- 工作台挂载现有 `ActionButton`：
  - A 类直接调用同一 runner；
  - B 类先由同一 runner 建立恢复点，再执行；
  - C 类先进入现有 `ProposalPanel`，只有独立“批准并执行”才调用同一 runner。
- `src/main.ts` 只创建并注入这一套 runtime；定向测试覆盖 runtime factory
  与共享对象身份，不只依赖 `wp7-e2e` fixture。

## 任务状态与控制

| 场景 | 新鲜生产证据 | 结果 |
|---|---|---|
| A 类直接执行 | 最终构建点击 `refresh-stats`，TaskDrawer 显示 `completed` | PASS |
| B 类快照执行 | 最终构建点击 `create-note`，先生成 Vault recovery record，再创建合成收件箱文件 | PASS |
| 恢复/撤销 | 点击 TaskDrawer“撤销”，任务进入 `reverted`；`00 收件箱` 最终只剩 fixture 的 `输入.md` | PASS |
| partial | 点击只读 `vault-lint`，返回版本化结构结果并进入 `partial`；错误为 13 篇缺 frontmatter | PASS |
| C 类未批准 | 打开 ProposalPanel 后，安全区哈希不变，报告文件 SHA-256 不变 | PASS |
| diff 与二次批准 | 提案展示步骤、目标、关键差异、不可恢复性；“查看差异”后仍需独立“批准并执行” | PASS |
| running/completed | A/B 的完成状态和 C 的 running 状态均在生产 TaskDrawer 可见 | PASS |
| cancel | 最终构建批准 C 后处于 10 秒可取消窗口；取消控件可见，点击后进入 `cancelled` | PASS |
| 运行中切六页 | C 保持 `running` 时依次激活 AI 对话、语音助手、工作流、知识资产、系统中心、工作台，随后取消 | PASS |
| 不支持的控制 | A 类完成任务不显示撤销；不可取消/不可恢复定义不显示错误控制 | PASS |

最终 C 取消记录：

```json
[
  {"label":"AI 对话","active":"AI 对话","task":"running"},
  {"label":"语音助手","active":"语音助手","task":"running"},
  {"label":"工作流","active":"工作流","task":"running"},
  {"label":"知识资产","active":"知识资产","task":"running"},
  {"label":"系统中心","active":"系统中心","task":"running"},
  {"label":"工作台","active":"工作台","task":"running"},
  {"cancelVisible":true,"before":"running"},
  {"after":"cancelled"}
]
```

取消前后合成报告
`System/reports/deep-research-2026-07-25.md` 的 SHA-256 均为
`4a57fde003545795df185c5974af748a2d2c39031ea6cc121f56b4fc2129bf62`。

## Provider 中心

- 系统中心“设置”已替换占位引导，生产页可查看 Provider、模型、能力、
  连接状态和当前选择。
- 页面不渲染 `secretRef` 或密钥值；组件测试使用会在 `getSecret` 时抛错的
  fake SecretStorage，确认只检查 `has()`。
- 修复 legacy `claude-cli` / `codex` 别名与注册表 Provider ID 的双向映射；
  自定义/Mock Provider ID 不再被错误回落到 `claude-cli`。
- 临时 Vault 注册纯本地 `mock-acceptance`，通过生产“切换到此 Provider”
  控件完成切换。设置值和 UI 均显示 `mock-acceptance` 为当前 Provider，
  未调用 `chat` 或网络。

## 语音与会话

| 场景 | 观察证据 | 结果 |
|---|---|---|
| 独立 namespace | 页面明确显示“本页使用独立语音历史，不读取文字工作台会话” | PASS |
| 持续监听降级 | 页面显示“持续监听未能启动”，自动切换为“点击说话” | PASS |
| 点击说话 UI | 当前模式、会话页签、文字输入和任务抽屉可见 | PASS |
| 真实麦克风/TTS/Provider | 未请求授权，也未执行 | 按安全边界跳过 |

## 六页与部署 Vault

临时 Vault 的 running 切页记录见上。最终产物同步到部署 Vault 后，使用同一
生产导航逐页只读加载：

```json
[
  {"label":"工作台","active":"工作台","loaded":true},
  {"label":"AI 对话","active":"AI 对话","loaded":true},
  {"label":"语音助手","active":"语音助手","loaded":true},
  {"label":"工作流","active":"工作流","loaded":true},
  {"label":"知识资产","active":"知识资产","loaded":true},
  {"label":"系统中心","active":"系统中心","loaded":true}
]
```

部署系统中心视觉检查显示系统健康、能力中心、全库视图、设置四个二级页签，
任务抽屉不遮断页面内容；未点击任何写入控制。

## 新鲜视觉证据

下列截图均由同一次 `get_app_state` 同时取得截图与可访问性树。保存前逐张人工
核对窗口标题、Vault、当前页面和任务/Provider 状态；未使用与语义树不一致的
旧截图缓冲。

| 证据 | SHA-256 | 覆盖 |
|---|---|---|
| `docs/qa/screenshots/wp7-task15r-action-states.jpeg` | `b09e8f6cb023cddae2351a9d207a528cae25876bae684590bb8635e2ca6b1419` | completed / partial / reverted |
| `docs/qa/screenshots/wp7-task15r-proposal-diff.jpeg` | `346a5985e302a59dc616b1f5b2bc3fd647e983fcc5f242523cc6d8b6d1dfc942` | C 提案、diff、独立批准 |
| `docs/qa/screenshots/wp7-task15r-cancelled-six-pages.jpeg` | `309a3c0f96003a5b34b85345ed0dc24a15fffa72d0db6f20ab9cf9b0688354d2` | 最终构建 running 六页记录与 cancelled |
| `docs/qa/screenshots/wp7-task15r-provider-mock.jpeg` | `de747af116c929da7d309a1748fe37d9b91f262298979c4c007ec7e060357144` | Mock Provider 当前选中、能力与模型 |
| `docs/qa/screenshots/wp7-task15r-voice-namespace.jpeg` | `9c4855e959fd61e0898d97660dcde5732e717df2ff7c2f4b679d6d62c3927199` | 独立语音历史与无密钥降级 |
| `docs/qa/screenshots/wp7-task15r-deployment-system.jpeg` | `7471984b0d9534b738367e0278363ca947612a220036d649c86c90899fc282be` | 部署 Vault 系统中心只读布局 |

## 构建与产物一致性

最终 `npm run build`：

- 108 个 production packages 的许可证审计通过；
- TALOS + Quyuan styles 为 692 KB，结构自检通过；
- 源、临时验收 Vault 和部署 Vault 三方逐文件 `cmp -s` 均返回 0。

| 文件 | 最终 SHA-256 |
|---|---|
| `main.js` | `c7b890f8aa907e5ca7de10e33c793b9ff8b414fbbe08acbb386e05c422b9c5af` |
| `manifest.json` | `75842859bc0f86d8b0b3bd133919413f4c0d1c762e90043e980822e81002472b` |
| `styles.css` | `efed98dfb082f3ad0fe3ec4c0dea1367ac28da21c03a1c7c7200e1cec9dadaf0` |

部署前备份仍保留在部署 Vault 的
`.talos/backups/wp7-task15-before-f556d01/`。

## 最终确定性检查

| 命令 | 结果 |
|---|---|
| Task 15R 新定向测试 | PASS；4 files，9 tests |
| `npx vitest run tests/wp7-e2e.test.ts tests/action-button.test.ts tests/task-drawer.test.ts tests/task-runner.test.ts tests/voice-session-store.test.ts` | PASS；5 files，25 tests |
| `npm test` | PASS；46 files，245 tests |
| `npm run test:quyuan` | PASS |
| `npm run test:approval-actions` | PASS |
| `npm run test:approval-executor` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| 三个构建产物与临时/部署 Vault `cmp -s` | PASS |
| 部署 `runtime-command-registry.json` 条目数 | PASS；12 |

## 结论

Task 15R 的生产组合、任务控制、Provider 中心和安全 Obsidian 点击/视觉验收均为
**PASS**。Task 15 可由 FAIL 更新为 PASS。Task 16 仍未开始；本报告只解除
Task 15 的验收阻塞，不包含 Task 16 的升级、回滚或真实 Provider 工作。
