# WP7 Obsidian 人工视觉与交互验收

- 日期：2026-07-25（Asia/Shanghai）
- 分支：`codex/wp7-unified-ai-console`
- 源基线：`f556d01 test: add deterministic wp7 acceptance`
- 部署 Vault：`/Users/apple/Documents/obsidian/TALOS-2.0-test`
- Obsidian：1.12.7
- 结果：**FAIL（Task 16 不应开始）**

## 安全边界

- 只同步 `main.js`、`manifest.json`、`styles.css`；未读取或复制 `data.json`，因为部署插件目录中不存在该文件。
- 未读取或写入真实密钥、凭证、`.talos/private/` 内容或私人笔记正文。
- 未修改九个客户模块。真实 Vault 中没有执行会写入客户模块的 B/C 动作，也没有调用真实网络 Provider、麦克风或 TTS。
- 部署 Vault 的 canonical registry 仍为 12 条，未手工添加 `talos-ask`。
- Task 14 的纯合成 fixture 继续作为 B/C 写入、Provider 切换、全库检索、密钥零外发和恢复点的确定性证据；它不替代本次生产 UI 点击验收。

## 构建、备份与同步

- 同步前备份：`.talos/backups/wp7-task15-before-f556d01/`。
- 备份包含原安装版本的三个插件产物和 `BACKUP.md`；三个备份文件与同步前安装文件逐字节一致。
- 新构建通过 `npm run build`；许可证检查通过 108 个 production packages，TALOS + Quyuan styles 为 690 KB，结构检查通过。
- 源文件与安装文件逐文件 `cmp` 均返回 0。

| 文件 | 源与部署 SHA-256 | 结果 |
|---|---|---|
| `main.js` | `c6cf3e4f8f49df75a6270f9a5cb0a1767d2f6edf7c3eccf150ca13034286a9a4` | PASS |
| `manifest.json` | `75842859bc0f86d8b0b3bd133919413f4c0d1c762e90043e980822e81002472b` | PASS |
| `styles.css` | `ebcd2814d1d650b66e006289f56c4733ff7f72f7c300e498f972795167509308` | PASS |

## 六个一级页面

验收使用 Obsidian 原生窗口的可访问性树和人工导航；没有把页面内容发往外部服务。

| 页面/能力 | 观察证据 | 结果 |
|---|---|---|
| 工作台 | 默认路由显示行动优先态势、行动队列、九模块入口、审批与偏好卡片 | PASS |
| AI 对话 | 独立页面显示 Provider/权限区、会话与历史、输入区、语音/停止/发送和任务抽屉；未发送查询 | PASS（仅界面） |
| 语音助手 | 独立页面显示语音会话 namespace、会话/上下文/能力页签、输入区和任务抽屉 | PASS（仅界面） |
| 工作流 | 每日执行、收件箱、输出作战室、项目场景四个二级页签可见 | PASS |
| 知识资产 | 知识枢纽、身份上下文、TALOS 产品三个二级页签可见 | PASS |
| 系统中心 | 系统健康、能力中心、全库视图、设置四个二级页签可见 | PASS |
| 任务抽屉跨页 | 工作台、AI、语音、工作流、知识资产和系统中心的树中均存在同一任务抽屉 | PASS |
| Provider 中心 | 系统中心“设置”页只有引导文案，要求转到 Obsidian 设置；生产控制台内没有可验收的完整 Provider 中心 | **FAIL** |

## 点击执行验收

| 场景 | 生产 UI 证据 | 结果 |
|---|---|---|
| A 类直接执行 | `refresh-stats` / `vault-lint` 已在 action-core 注册，但生产 `view.ts` 未挂载 `ActionButton` 或 `TalosTaskRunner`，没有对应可点击入口 | **FAIL** |
| B 类一键执行与恢复点 | Task 14 合成链路通过；生产工作台没有连接 `create-note` 的动作按钮与 runner | **FAIL** |
| running/completed 状态 | `TaskDrawer` 能展示共享 store，但生产 UI 没有可启动的内建动作，无法形成真实点击状态流 | **FAIL** |
| C 类提案、diff、二次确认 | `ProposalPanel` 与 C 类 core 测试通过，但未连接到生产控制台的可点击动作 | **FAIL** |
| 未批准零写入 | Task 14 合成证据通过；本次真实 Vault 按安全边界未执行写入动作 | PASS（合成证据） |
| 部分失败 | task state 声明了 `partial`，runner 没有产生该状态的执行分支，UI 也无入口 | **FAIL** |
| 取消 | runner 有 `cancel()`，但任务抽屉没有取消控制，生产视图也没有运行中动作可取消 | **FAIL** |
| 撤销 | recovery record 可生成，但生产 runtime/任务抽屉没有 restore/revert 控制 | **FAIL** |
| 切页不中断 | 共享任务抽屉跨页存在的自动化测试通过；生产 UI 无长任务入口，无法完成人工切页不中断验收 | **FAIL** |

根因不是 Task 14 的合成执行器失效，而是生产组合层缺少连接：仓库中的 `new TalosTaskRunner(...)` 只出现在审批 runtime 和测试，`ActionButton` 没有在生产视图中挂载。为避免在 QA 阶段重新设计执行、审批或会话系统，本任务只记录缺口，没有另建执行器或审批流。

## 窗口与可访问性

| 检查 | 证据 | 结果 |
|---|---|---|
| 可访问名称与状态 | 六个一级导航均暴露按钮角色、Description 和 Help；二级页签暴露选中值；任务状态区使用 live region | PASS |
| 任务抽屉键盘折叠 | `tests/task-drawer.test.ts` 的 Escape 与持续订阅断言通过；本次 GUI 自动化焦点长期停在抽屉按钮，不能形成可信人工闭环 | **FAIL（人工证据不足）** |
| 宽窗口、窄分栏、最小宽度 | 当前窄窗口的可访问树完整，但 Obsidian 截图缓冲持续显示旧 AI 帧；最大化后仍无法取得与语义树一致的画面 | **FAIL（视觉证据不可用）** |
| 减少动态效果 | 现有样式契约保留 `prefers-reduced-motion`；本次未在 Obsidian 系统偏好中切换验证 | **FAIL（未人工执行）** |

## 语音验收

| 场景 | 观察证据 | 结果 |
|---|---|---|
| Voice 独立会话 | 页面明确显示独立语音历史，不读取文字工作台会话 | PASS |
| 持续模式失败降级 | 页面报告“持续监听未能启动”，并自动切换为“点击说话” | PASS |
| 点击说话界面 | 麦克风、打断、文字输入、ASR 模式、背景与侧栏控制可见 | PASS（未授权麦克风） |
| 打断、TTS 失败、麦克风拒绝、字幕保留 | 为避免触发真实麦克风、网络 ASR/TTS 或权限写入，本次没有执行；现有 UI/自测不能代替人工设备验收 | **FAIL（未执行）** |

## 截图证据限制

Obsidian 的可访问性树会随页面切换更新，但 Computer Use 截图缓冲在应用内重载后仍停留在旧 AI 页面，且窗口尺寸也与语义树不一致。因此截图不能证明对应页面状态，未作为 PASS 证据。尝试持久化该真实 Vault 截图被安全审查拒绝，因为截图可能携带私人 Vault 内容；本报告不绕过该保护，也不把不可信截图写入仓库。

## 新鲜确定性检查

| 命令 | 结果 |
|---|---|
| `npx vitest run tests/wp7-e2e.test.ts tests/action-button.test.ts tests/task-drawer.test.ts tests/task-runner.test.ts tests/voice-session-store.test.ts` | PASS；5 files，20 tests |
| 三个源/部署文件 `cmp -s` | PASS；全部返回 0 |
| 三个源/部署文件 `shasum -a 256` | PASS；每对摘要一致 |
| 读取部署 `runtime-command-registry.json` 的命令数 | PASS；12 |
| `git diff --check`（写文档前） | PASS；无输出 |

## 结论与进入 Task 16 的门槛

Task 15 当前为 **FAIL**。部署、六页加载、语音独立 namespace 和持续监听降级已验证，但以下 P1 缺口阻止进入真实 Provider/升级/回滚验收：

1. 将现有 action-core、`TalosTaskRunner`、共享 `MemoryTaskStore`、recovery store、`ActionButton` 与 `ProposalPanel` 接入生产工作台，不新增第二执行器或审批系统。
2. 在任务抽屉提供现有 runner 的取消与恢复/撤销入口，并定义可测试的 partial 产生路径。
3. 把 Provider 中心从占位引导变成可在统一控制台中验收的现有设置投影，仍只引用 SecretStorage，不显示密钥。
4. 修复或更换能够与 Obsidian 当前语义页一致的安全截图通道，再执行宽/窄/最小宽度和语音设备失败场景。

在这些门槛满足并取得新的 Obsidian 视觉与点击证据前，不应宣布 Task 15 完成，也不应开始 Task 16。
