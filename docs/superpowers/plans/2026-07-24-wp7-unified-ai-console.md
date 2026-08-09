# TALOS WP7 Unified AI Console Implementation Plan

**Goal:** 在现有 `talos-plugin` 中融合 TALOS 主控制台、Claudian 文字工作台和屈原语音页，建立统一动作/审批/任务/Provider 核心，并完成 canonical `talos-ask`、升级回滚和正式 2.0.0 验收。

**Architecture:** 保留 `TalosPlugin extends ClaudianWorkbenchPlugin` 的现有集成方式。新增轻量的 TALOS 服务层，把页面、语音和文字工作台共同需要的 Provider、上下文、动作风险、任务执行与审计从 `view.ts` 和各自面板中抽离。文字与语音使用不同会话命名空间，但共享 Provider facade、Vault 工具、审批网关和任务记录。canonical `talos-ask` 只做适配，不创建第二套问答、身份或记忆存储。

**Tech Stack:** TypeScript 5.8、Obsidian API、SecretStorage、现有 Claudian 2.0.25、Vitest 4、Node selftest、CSS Grid/Container Queries、TALOS Python 标准库验收器。

**Design:** `docs/superpowers/specs/2026-07-24-wp7-unified-ai-console-design.md`

## Global Constraints

- 不重写 Claudian 或屈原语音模块；优先抽取可挂载表面与共享服务。
- 不新增本地守护进程，不把 Ollama 纳入 2.0 主线。
- 不修改九个客户模块的目录和客户正文；自动化测试只写隔离夹具、`.talos/` 或 `TALOS中枢/` 系统资产。
- API key、token、cookie、`.env`、敏感请求头和 SecretStorage 值不得进入模型上下文、日志、测试快照或发行物。
- 不允许普通 `data.json` 继续保存明文 key，也不允许兼容路径回退到明文存储。
- 保留当前命令 ID、设置、目录映射、主题和会话；旧入口只可作为兼容别名。
- 所有 Vault 写入都经统一动作模型；低风险按钮点击即授权，高风险操作提案后再批准。
- 当前仓库存在用户未提交改动。实施前必须先确定这些改动的归属，不得自动 stash、覆盖或提交。
- 每个任务先写失败测试，再实现最小改动，最后运行相关测试。
- 未获得明确授权前不创建实现 commit；计划中的“检查点”只表示适合提交的位置。

## Repository Boundaries

### Plugin repository

Root: `$SOURCE_REPO`

负责：

- 页面与导航；
- 动作注册表、风险网关、任务执行和任务抽屉；
- Claudian 文字页嵌入；
- 屈原语音独立页；
- Provider facade、API/CLI/mock；
- SecretStorage 迁移；
- 上下文检索、密钥过滤和回答写回；
- 插件命令、测试、构建和 Obsidian 部署产物。

### TALOS system source

部署实例：`$DEPLOYMENT_ENV`

负责：

- canonical `talos-ask` 合同源；
- 引擎命令资产；
- Claude wrapper、Codex skill、Obsidian command projection；
- registry 生成与部署验收；
- WP6 → WP7 升级和回滚证据。

当前部署实例只有 `TALOS中枢/适配器/runtime-command-registry.json` 投影，没有 README 声明的 `contracts/runtime-command-registry.json` 与 `tools/adapter_registry.py` 合同源。Task 12 开始前必须接入包含这两个文件的权威源仓库；禁止直接手改部署投影。

---

## Phase 0 — Isolate and Characterize

### Task 1: 建立隔离实施基线

**Files:**

- Inspect only: repository worktree
- Create later in isolated worktree: `docs/qa/wp7-baseline.md`

**Purpose:** 防止 WP7 覆盖当前未提交的总览、审批、候选和样式工作。

- [ ] **Step 1: 记录插件仓库状态**

Run:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
git diff -- src/actions.ts src/data/stats.ts src/view.ts styles.quyuan-shell.css styles.talos.css
```

Expected:

- 明确记录当前 SHA；
- 明确列出修改和未跟踪文件；
- 不自动清理任何内容。

- [ ] **Step 2: 由用户确认现有改动的处理方式**

只能选择以下一种：

1. 先验收并提交现有改动，再从新提交创建 WP7 worktree；
2. 保留现有工作区不动，从当前 `HEAD` 创建 WP7 worktree，并在后续人工移植已确认改动；
3. 用户明确指定另一条已包含这些改动的分支。

Expected: 获得明确基线 SHA。未确认前停止实施，不执行 stash、reset 或 checkout。

- [ ] **Step 3: 创建独立 WP7 worktree**

建议路径：

```text
$SOURCE_REPO
```

分支建议：

```text
codex/wp7-unified-ai-console
```

Expected: 新 worktree `git status --short` 为空；原工作区保持原状。

- [ ] **Step 4: 运行插件现有基线**

Run:

```bash
npm test
npm run test:quyuan
npm run test:approval-actions
npm run test:approval-executor
npm run typecheck
npm run lint
npm run build
```

Expected: 全部 PASS。若基线失败，把失败记录写入 `docs/qa/wp7-baseline.md`，先区分既有失败与 WP7 回归。

- [ ] **Step 5: 记录 TALOS 部署实例基线**

在 `$DEPLOYMENT_ENV` 运行：

```bash
python3 TALOS中枢/适配器/verify_deployment.py
python3 -m unittest discover -s TALOS中枢/适配器/tests -p 'test_*.py'
```

Expected: 当前十二条 canonical 命令和九模块实例验收通过；记录当前客户模块路径清单与内容摘要，但不读取密钥或凭证。

**Checkpoint:** 基线证据完成；尚无功能改动。

---

## Phase 1 — Shared Action and Task Core

### Task 2: 建立统一动作注册表与风险判断

**Files:**

- Create: `src/action-core/types.ts`
- Create: `src/action-core/registry.ts`
- Create: `src/action-core/risk-policy.ts`
- Create: `src/action-core/builtin-actions.ts`
- Create: `tests/action-registry.test.ts`
- Create: `tests/action-risk-policy.test.ts`
- Modify later: `src/actions.ts`

**Interfaces:**

```ts
export type TalosActionRisk = "A" | "B" | "C";

export interface TalosActionDefinition<Input = unknown, Output = unknown> {
  id: string;
  label: string;
  description: string;
  risk: TalosActionRisk;
  readScope: string[];
  writeScope: string[];
  timeoutMs: number;
  cancelable: boolean;
  reversible: boolean;
  execute(context: TalosActionContext, input: Input): Promise<Output>;
}

export interface RiskDecision {
  decision: "allow" | "snapshot-and-run" | "propose";
  reason: string;
}
```

- [ ] **Step 1: 写注册和校验失败测试**

至少覆盖：

- 重复 `id` 拒绝；
- 空 label、无 timeout、B 类不可恢复、C 类未声明 write scope 拒绝；
- 注册表能按 ID 返回动作；
- 页面获取的是只读定义，不直接获得可变 map。

Run:

```bash
npx vitest run tests/action-registry.test.ts
```

Expected: RED，因为模块尚不存在。

- [ ] **Step 2: 实现最小注册表**

注册表只管理定义，不读写 Vault，不显示 UI。

- [ ] **Step 3: 写风险判断失败测试**

覆盖：

- A 类只读直接 `allow`；
- B 类固定范围、可恢复时 `snapshot-and-run`；
- B 类请求路径超出 `writeScope` 时升级 `propose`；
- 删除、批量移动、身份、顶层结构、外部发布、shell/系统命令始终 `propose`；
- “打开笔记”属于查看动作，不冒充执行动作。

- [ ] **Step 4: 实现纯函数风险判断**

把现有 `evaluateQuyuanGovernance` 的通用风险规则迁移为共享策略。`src/quyuan/governance.ts` 暂时保留适配包装，避免一次性破坏 Claudian。

- [ ] **Step 5: 注册第一批内建动作**

仅注册已存在且边界明确的动作：

- `refresh-stats`：A；
- `vault-lint`：A；
- `deep-research`：A 或 C，取决于是否允许外部请求；默认 C；
- `create-note`：B；
- `publish-backfill`：C；
- `decide-approval`：C；
- `decide-preference`：C。

不得在本任务引入 AI 问答。

- [ ] **Step 6: 运行测试**

```bash
npx vitest run tests/action-registry.test.ts tests/action-risk-policy.test.ts
npm run typecheck
```

Expected: PASS。

**Checkpoint:** 动作定义与风险策略独立可测。

### Task 3: 建立任务状态机、幂等执行和恢复记录

**Files:**

- Create: `src/task-core/types.ts`
- Create: `src/task-core/task-store.ts`
- Create: `src/task-core/task-runner.ts`
- Create: `src/task-core/recovery-store.ts`
- Create: `src/task-core/audit-sanitizer.ts`
- Create: `tests/task-runner.test.ts`
- Create: `tests/recovery-store.test.ts`
- Create: `tests/audit-sanitizer.test.ts`

**Interfaces:**

```ts
export type TalosTaskState =
  | "ready"
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "reverted";

export interface TalosTaskRun {
  id: string;
  actionId: string;
  state: TalosTaskState;
  providerId?: string;
  approvedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  readPaths: string[];
  changes: TalosFileChange[];
  error?: string;
  recoveryId?: string;
}
```

- [ ] **Step 1: 写状态转换失败测试**

只允许设计规格中的合法转换。禁止 `completed → running`、`failed → completed` 这类无重试 ID 的隐式跳转。

- [ ] **Step 2: 写幂等失败测试**

相同 `idempotencyKey` 的动作只能执行一次；Provider 重试或换模型返回已有结果。

- [ ] **Step 3: 实现内存任务存储与 runner**

先使用接口和内存实现跑通测试，再接 Vault 持久化。

- [ ] **Step 4: 写恢复记录测试**

恢复记录保存在 `.talos/task-runs/`，只保存：

- 动作 ID；
- 变更前内容摘要或受控快照；
- 目标路径；
- 变更类型；
- 时间和审批；
- 不含 prompt、API key、token 或完整外发正文。

测试真实写入使用临时 adapter，不使用客户 Vault。

- [ ] **Step 5: 实现审计净化器**

在持久化前移除：

- Authorization/header 值；
- API key 模式；
- `.env` 内容；
- SecretStorage 值；
- 绝对用户主目录；
- 未授权的完整上下文正文。

- [ ] **Step 6: 接入现有审批执行器**

让 `approveAndExecuteApprovalWithMockModel` 通过 task runner 执行，保留旧函数签名作为兼容包装。

- [ ] **Step 7: 运行相关测试**

```bash
npx vitest run tests/task-runner.test.ts tests/recovery-store.test.ts tests/audit-sanitizer.test.ts tests/approval-executor.test.ts
npm run typecheck
```

Expected: PASS。

**Checkpoint:** 任何页面都可观察同一个任务状态。

### Task 4: 建立任务抽屉和动作按钮组件

**Files:**

- Create: `src/ui/action-button.ts`
- Create: `src/ui/task-drawer.ts`
- Create: `src/ui/proposal-panel.ts`
- Create: `tests/action-button.test.ts`
- Create: `tests/task-drawer.test.ts`
- Modify: `styles.talos.css`
- Modify: `src/view.ts`

- [ ] **Step 1: 写 DOM 结构失败测试**

断言：

- 按钮文案包含具体动作；
- `aria-live` 报告运行状态；
- “查看”与“批准并执行”是不同控件；
- B 类按钮点击后直接进入 queued/running；
- C 类按钮点击只打开提案，不调用 runner；
- 切页后 task drawer 仍订阅同一 store。

- [ ] **Step 2: 实现 `ActionButton`**

状态显示：

`可执行 → 排队 → 执行中 → 已完成 / 部分完成 / 已失败 / 已取消 / 已撤销`

按钮不自行判断风险，只消费 registry 和 task runner。

- [ ] **Step 3: 实现 `ProposalPanel`**

显示：

- Provider；
- 步骤；
- 文件数量；
- 关键差异；
- 恢复能力；
- 拒绝、查看差异、批准执行。

- [ ] **Step 4: 实现全局 `TaskDrawer`**

抽屉挂在 TALOS 视图壳层，不属于某个业务页。切页时不销毁。

- [ ] **Step 5: 加入响应式和键盘规则**

使用当前 TALOS 主题变量；窄分栏改为底部抽屉。支持 Tab、Enter、Space、Escape 和减少动态效果。

- [ ] **Step 6: 运行测试**

```bash
npx vitest run tests/action-button.test.ts tests/task-drawer.test.ts
npm run build:css
npm run typecheck
```

Expected: PASS。

**Checkpoint:** 点击执行具备完整可视状态。

---

## Phase 2 — Replan the TALOS Pages

### Task 5: 将十二个同级入口收拢为六个一级页面

**Files:**

- Create: `src/ui/navigation-model.ts`
- Create: `src/ui/page-router.ts`
- Create: `tests/navigation-model.test.ts`
- Modify: `src/view.ts`
- Modify: `styles.talos.css`
- Modify: `styles.quyuan-shell.css`

**Navigation model:**

1. 工作台；
2. AI 对话；
3. 语音助手；
4. 工作流；
5. 知识资产；
6. 系统中心。

二级页面：

- 工作流：每日执行、收件箱、输出作战室、项目场景；
- 知识资产：知识枢纽、身份上下文、TALOS 产品；
- 系统中心：系统健康、能力中心、全库视图、设置。

- [ ] **Step 1: 写导航模型失败测试**

断言恰好六个一级入口；所有现有 page key 均有兼容映射；九个模块入口仍可从工作台抵达。

- [ ] **Step 2: 实现纯导航模型**

从 `src/view.ts` 移出 `PAGES` 和 `NAV_GROUPS`。兼容旧 key：

- `overview` → 工作台；
- `jarvis` → 语音助手；
- 原业务 key → 对应二级页；
- `VIEW_TYPE_CLAUDIAN` 的旧命令 → AI 对话。

- [ ] **Step 3: 实现 page router**

一级页负责选择区域，二级页通过区域内 tabs 切换。不得为每个二级页创建新的 Obsidian leaf。

- [ ] **Step 4: 改造工作台为行动优先**

固定顺序：

1. 今日建议操作；
2. 系统概览；
3. 九个模块入口。

把当前“打开文件”的注意力卡拆成明确的“查看”和“执行”。

- [ ] **Step 5: 删除重复入口**

保留兼容命令，但 UI 不再同时出现：

- TALOS 内屈原入口；
- 独立完整工作台入口；
- 右侧栏重复对话入口。

- [ ] **Step 6: 运行导航与布局测试**

```bash
npx vitest run tests/navigation-model.test.ts tests/overview-layout.test.ts tests/project-scenes-layout.test.ts
npm run typecheck
npm run build:css
```

Expected: PASS。

**Checkpoint:** 页面规划完成，AI 功能尚未迁移。

---

## Phase 3 — Embed Chat and Preserve Voice Separation

### Task 6: 把 Claudian 工作台变成可挂载的 AI 对话页面

**Files:**

- Create: `src/quyuan/chat-surface.ts`
- Create: `tests/chat-surface.test.ts`
- Modify: `src/quyuan/claudian/features/chat/ClaudianView.ts`
- Modify: `src/quyuan/claudian/main.ts`
- Modify: `src/main.ts`
- Modify: `src/view.ts`
- Modify: `styles.quyuan-shell.css`
- Test: `quyuan-v2.selftest.mjs`

**Interfaces:**

```ts
export interface ChatSurfaceHost {
  mount(container: HTMLElement, namespace: "chat"): Promise<void>;
  unmount(): Promise<void>;
  focusComposer(): void;
}
```

- [ ] **Step 1: 写挂载生命周期失败测试**

覆盖：

- 同一 surface 只 mount 一次；
- 离开 AI 对话页时暂停 UI observer，但不取消正在执行的 task；
- 返回页面后恢复当前 tab；
- 文字历史 namespace 固定为 `chat`；
- 不读取或合并 voice namespace。

- [ ] **Step 2: 从 `ClaudianView` 抽取 mountable surface**

`ClaudianView` 保留为兼容 ItemView 包装器；真实 UI 构造进入 `chat-surface.ts`，避免把一个 ItemView DOM 粗暴搬进另一个 ItemView。

- [ ] **Step 3: 在 TALOS page router 增加 `chat` 页面**

复用现有 tab、history、provider、diff、tool、MCP、skill、subagent 能力。

- [ ] **Step 4: 改造命令入口**

- `open-quyuan-v2` 保留 ID；
- 回调改为打开 TALOS 并切到 AI 对话；
- 独立 `VIEW_TYPE_CLAUDIAN` 保留一个版本周期作为恢复入口，但不在主导航展示。

- [ ] **Step 5: 运行 Claudian 合同与回归**

```bash
npx vitest run tests/chat-surface.test.ts
npm run test:quyuan
npm run typecheck
```

Expected: PASS，Claudian 能力合同没有减少。

**Checkpoint:** 文字工作台已进入 TALOS 主界面。

### Task 7: 固化独立语音页面和持续/点击双模式

**Files:**

- Create: `src/quyuan/voice-session-store.ts`
- Create: `tests/voice-session-store.test.ts`
- Create: `tests/voice-mode-fallback.test.ts`
- Modify: `src/quyuan/voice-panel.ts`
- Modify: `src/quyuan/voice-driver.ts`
- Modify: `src/view.ts`
- Modify: `styles.quyuan-shell.css`

- [ ] **Step 1: 写语音历史隔离失败测试**

断言：

- 语音历史使用 `voice` namespace；
- 不读取文字 tab/history；
- 共享 task ID 和审计，但 task 审计正文不注入另一会话；
- 重启插件后语音会话可恢复。

- [ ] **Step 2: 写模式降级失败测试**

覆盖：

- 默认持续模式；
- 用户可切换点击说话；
- ASR 权限拒绝或持续监听失败后，保留字幕并切换点击模式；
- TTS 失败不丢失文字回复；
- 用户打断时停止 TTS，但不丢弃已完成工具结果。

- [ ] **Step 3: 接入独立语音 session store**

不再复用 `jarvisTabsJson` 作为文字/语音混合存储。旧字段只用于迁移。

- [ ] **Step 4: 保留现有宣传视觉**

复用当前：

- `QuyuanBackgroundField`；
- `QuyuanVoiceCharacterStage`；
- overlay transcript；
- 连续状态机；
- 侧边 session/context/ability。

只补任务状态和审批接线，不重做视觉系统。

- [ ] **Step 5: 把语音工具确认接到共享风险网关**

`askConfirm` 不再维护独立规则。A/B/C 决策由共享 action core 产生，语音页负责朗读和展示。

- [ ] **Step 6: 运行测试**

```bash
npx vitest run tests/voice-session-store.test.ts tests/voice-mode-fallback.test.ts
npm run test:quyuan
npm run typecheck
```

Expected: PASS。

**Checkpoint:** 文字和语音是两个页面、两套历史、一个执行核心。

---

## Phase 4 — Provider, Context, and Secrets

### Task 8: 建立 TALOS Provider facade 和确定性 mock

**Files:**

- Create: `src/ai/provider/types.ts`
- Create: `src/ai/provider/provider-facade.ts`
- Create: `src/ai/provider/mock-provider.ts`
- Create: `src/ai/provider/claudian-provider-adapter.ts`
- Create: `tests/provider-facade.test.ts`
- Create: `tests/mock-provider.test.ts`
- Modify: `src/quyuan/contract.ts`
- Modify: `src/quyuan/workbench-adapter.ts`

**Interfaces:**

```ts
export interface TalosProvider {
  id: string;
  kind: "api" | "cli" | "mock";
  capabilities(): ProviderCapabilities;
  chat(request: AskRequest): AsyncIterable<AskEvent>;
  cancel(runId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
}
```

- [ ] **Step 1: 写 facade 失败测试**

覆盖：

- 注册 API/CLI/mock；
- capability 缺失时 UI 可判定禁用；
- 会话中切换 Provider 记录切换点；
- fork 可选其他 Provider；
- 已执行工具不因切换重复；
- 人工“请其他模型复核”产生独立 review turn，不自动执行工具。

- [ ] **Step 2: 实现 facade**

内部优先代理现有 `ProviderRegistry` 和 `ProviderWorkspaceRegistry`，不复制 Claude/Codex/Opencode/Pi 注册逻辑。

- [ ] **Step 3: 实现 mock Provider**

mock 通过夹具按序返回：

- text；
- tool request；
- usage；
- error；
- done。

支持固定 seed 和预定义工具结果，CI 不访问网络。

- [ ] **Step 4: 适配现有 Claudian providers**

为现有 CLI providers 建立轻薄 adapter。保持原生 session/history 所有权，facade 只保存引用。

- [ ] **Step 5: 运行测试**

```bash
npx vitest run tests/provider-facade.test.ts tests/mock-provider.test.ts
npm run test:quyuan
npm run typecheck
```

Expected: PASS。

**Checkpoint:** 所有入口可以通过同一 Provider 接口调用 mock 和现有 CLI。

### Task 9: 增加 Claude API、OpenAI 兼容 API 与 SecretStorage

**Files:**

- Create: `src/ai/provider/api-agent-runtime.ts`
- Create: `src/ai/provider/anthropic-api-provider.ts`
- Create: `src/ai/provider/openai-compatible-provider.ts`
- Create: `src/ai/provider/provider-config-store.ts`
- Create: `src/ai/provider/provider-secret-store.ts`
- Create: `src/ai/provider/settings-migration.ts`
- Create: `tests/api-agent-runtime.test.ts`
- Create: `tests/provider-config-store.test.ts`
- Create: `tests/provider-secret-migration.test.ts`
- Modify: `src/jarvis/agent/loop.ts`
- Modify: `src/jarvis/providers/anthropic-api-engine.ts`
- Modify: `src/jarvis/providers/openai-engine.ts`
- Modify: `src/settings.ts`
- Modify: `src/main.ts`
- Modify: `manifest.json`
- Modify: `versions.json`

- [ ] **Step 1: 写 API agent loop 合同测试**

使用 HTTP mock 覆盖：

- Anthropic 流式文本和工具调用；
- OpenAI 兼容 chat/response 形态；
- 工具循环；
- cancel；
- usage；
- 401/429/5xx；
- 工具幂等；
- 不发送 SecretStorage 值到日志。

- [ ] **Step 2: 抽取可复用 API agent runtime**

复用现有 `src/jarvis/agent/loop.ts`、`tool-schema.ts` 和 `vault-tools.ts`，让 API providers 实现 Task 8 的接口。不要在每个 Provider 复制 agent loop。

- [ ] **Step 3: 写非敏感配置测试**

`.talos/provider.json` 只允许：

- provider ID/name/kind；
- endpoint；
- model；
- capability flags；
- default；
- SecretStorage 引用名称；
- Vault 授权状态。

任何 key、token 或 Authorization 值使保存失败。

- [ ] **Step 4: 实现 SecretStorage adapter**

普通 settings 只保存 secret 名称。Provider 发请求时临时从 `app.secretStorage` 获取值，不把值写回对象快照。

- [ ] **Step 5: 写旧设置迁移测试**

覆盖当前明文字段：

- `elevenLabsApiKey`；
- `aliyunApiKey`；
- `anthropicApiKey`；
- `openaiApiKey`；
- `jarvisSttApiKey`。

迁移必须：

1. 写 SecretStorage；
2. 验证引用可读；
3. 保存引用名；
4. 删除明文字段；
5. 失败时不做半迁移。

- [ ] **Step 6: 实现设置页 Provider 中心**

设置页显示：

- 添加 API/CLI；
- endpoint/model；
- SecretComponent；
- 测试连接；
- 默认 Provider；
- 当前 Vault 全库读取授权；
- 切换 Provider和人工复核开关。

- [ ] **Step 7: 处理 Obsidian 最低版本**

从当前 `obsidian` 类型声明和官方 SecretStorage 可用版本确定最低版本：

- 更新 `manifest.json:minAppVersion`；
- 更新 `versions.json`；
- 启动时 feature-detect；
- 不支持时禁用 API Provider并提示升级；
- CLI Provider仍可使用；
- 绝不回退明文 key。

- [ ] **Step 8: 运行测试**

```bash
npx vitest run tests/api-agent-runtime.test.ts tests/provider-config-store.test.ts tests/provider-secret-migration.test.ts
npm run typecheck
npm run lint
```

Expected: PASS。

**Checkpoint:** 云端 API 成为主力，CLI 继续可用，明文 key 已有安全迁移路径。

### Task 10: 建立全库检索、密钥过滤和统一 AskService

**Files:**

- Create: `src/ai/context/secret-policy.ts`
- Create: `src/ai/context/vault-retrieval.ts`
- Create: `src/ai/context/context-assembler.ts`
- Create: `src/ai/ask-service.ts`
- Create: `src/ai/writeback-policy.ts`
- Create: `tests/secret-policy.test.ts`
- Create: `tests/vault-retrieval.test.ts`
- Create: `tests/ask-service.test.ts`
- Create: `tests/writeback-policy.test.ts`
- Modify: `src/quyuan/chat-surface.ts`
- Modify: `src/quyuan/voice-driver.ts`

**Interfaces:**

```ts
export interface AskService {
  ask(input: AskInput): AsyncIterable<AskEvent>;
  review(runId: string, providerId: string): AsyncIterable<AskEvent>;
}
```

- [ ] **Step 1: 写永久禁区失败测试**

路径阻断至少覆盖：

- `.env`；
- `.obsidian/plugins/*/data.json` 中的旧 key 字段；
- `.talos/private/`；
- SecretStorage；
- credential/token/key 文件名；
- Provider 敏感 header。

内容阻断覆盖常见 API key、Bearer token、private key 和 cookie 模式。测试只使用假密钥。

- [ ] **Step 2: 实现 secret policy**

过滤发生在 Vault 读取工具和上下文 assembler 两层。任何命中返回结构化 blocked result，不把原文写日志。

- [ ] **Step 3: 写全库检索测试**

夹具包含九个模块、身份、候选、推断、项目、知识、记忆、输出和密钥文件。断言：

- 所有非密钥模块可检索；
- 候选/推断可进入上下文；
- 密钥永久排除；
- 路径和匹配理由可审计；
- 同一文件不重复；
- 大文件有确定性截断。

- [ ] **Step 4: 实现关键词与现有引擎检索组合**

不引入向量数据库。排序使用：

1. 显式附件/选区；
2. 当前笔记；
3. 引擎检索结果；
4. 关键词匹配；
5. 最近已确认上下文。

- [ ] **Step 5: 写 AskService 测试**

覆盖：

- chat 和 voice 调用同一服务；
- namespace 不同；
- Provider 可切换；
- 只问答不写 Vault；
- tool 请求进入共享风险网关；
- manual review 不自动执行；
- Provider 重试不重复 tool。

- [ ] **Step 6: 实现 AskService**

AskService 只编排：

`检索 → 过滤 → Provider → 工具/提案 → task runner → 结果`

它不直接渲染 UI，也不维护身份或记忆副本。

- [ ] **Step 7: 实现写回策略**

默认：

- 知识结论建议 `30 洞察`；
- 成品、草稿和交付物建议 `70 输出`；
- 回答只显示，不自动保存；
- 用户要求保存时产生 B/C 动作；
- 目标路径和 diff 在执行前可见。

- [ ] **Step 8: 接入 chat 和 voice**

两边移除独立上下文/工具审批分支，改为调用 AskService；保留各自 UI 和 session store。

- [ ] **Step 9: 运行测试**

```bash
npx vitest run tests/secret-policy.test.ts tests/vault-retrieval.test.ts tests/ask-service.test.ts tests/writeback-policy.test.ts
npm run test:quyuan
npm run typecheck
```

Expected: PASS。

**Checkpoint:** 文字、语音和按钮已共享 Provider、上下文与治理核心。

---

## Phase 5 — Canonical `talos-ask`

### Task 11: 在插件内注册 `talos-ask` 兼容入口

**Files:**

- Create: `src/canonical/registry-reader.ts`
- Create: `src/canonical/request-writer.ts`
- Create: `src/canonical/talos-ask-command.ts`
- Create: `tests/canonical-registry-reader.test.ts`
- Create: `tests/canonical-request-writer.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 写 registry reader 失败测试**

从 Vault 中读取投影 registry，验证：

- schema version；
- command ID 唯一；
- `talos-ask` 存在；
- request path 是 `.talos/command-requests/talos-ask.json`；
- 拒绝未知字段和路径逃逸。

- [ ] **Step 2: 写原子请求写入测试**

请求包含：

- request ID；
- command ID；
- timestamp；
- channel；
- provider ID；
- user query；
- writeback intent；
- approval state。

使用临时文件 + rename 或 Obsidian 可实现的等价原子更新。不得写入 secret。

- [ ] **Step 3: 实现插件命令**

命令面板注册稳定 ID `talos-ask`。调用同一 AskService；请求投影仅作三端协议和恢复证据，不成为第二执行器。

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/canonical-registry-reader.test.ts tests/canonical-request-writer.test.ts
npm run typecheck
```

Expected: PASS。

### Task 12: 在 TALOS 权威源增加第十三条 canonical 命令

**Precondition:** 已获得包含以下权威文件的源仓库：

- `contracts/runtime-command-registry.json`
- `tools/adapter_registry.py`

**Files in TALOS source:**

- Modify: `contracts/runtime-command-registry.json`
- Create: `vault-template/.claude/commands/talos-ask.md`
- Create: engine asset corresponding to `talos-ask`
- Create: `.agents/skills/source-command-talos-ask/SKILL.md`
- Regenerate: deployed `TALOS中枢/适配器/runtime-command-registry.json`
- Modify: `AGENTS.md` generated canonical table
- Modify: adapter contract tests
- Modify: deployment verifier expected command set
- Modify: README/count documentation

- [ ] **Step 1: 写第十三条命令失败测试**

修改测试期望：

- command set 从固定十二条变为包含 `talos-ask` 的十三条；
- registry、engine asset、Claude wrapper、Codex skill、Obsidian command ID、request path 全部一致；
- 原十二条字节内容不变。

Expected: RED。

- [ ] **Step 2: 新增引擎资产**

`talos-ask` 资产必须：

- 调用共享问答/检索/Provider 合同；
- 只问答时不写 Vault；
- 写回和工具请求进入动作审批；
- 不创建身份、记忆或偏好副本；
- 不读取 `.talos/private` 或凭证。

- [ ] **Step 3: 修改合同源**

新增：

```json
{
  "id": "talos-ask",
  "obsidian_command_id": "talos-ask",
  "request_path": ".talos/command-requests/talos-ask.json",
  "summary": "AI 全库问答与受控执行"
}
```

`engine_asset` 与 `claude_wrapper` 使用实际源路径。

- [ ] **Step 4: 使用生成工具更新投影**

只运行 `tools/adapter_registry.py` 支持的生成命令。禁止手工编辑 `TALOS中枢/适配器/runtime-command-registry.json`。

- [ ] **Step 5: 生成 Claude/Codex/Obsidian 入口**

Codex skill 只保存 command ID，通过 registry 解析真实资产。Obsidian command projection 与插件 Task 11 的 reader 对齐。

- [ ] **Step 6: 运行 TALOS 合同测试**

在 TALOS 源和部署实例分别运行权威项目已有的 registry 测试与：

```bash
python3 -m unittest discover -s TALOS中枢/适配器/tests -p 'test_*.py'
python3 TALOS中枢/适配器/verify_deployment.py
```

Expected:

- 十三条 canonical 命令全部通过；
- 原十二条无漂移；
- 九个客户模块无安装差异。

**Checkpoint:** `talos-ask` 三端共用一套事实来源。

---

## Phase 6 — Migration, QA, and Release

### Task 13: 完成设置、会话和入口迁移

**Files:**

- Create: `src/migrations/wp7-migration.ts`
- Create: `tests/wp7-migration.test.ts`
- Modify: `src/main.ts`
- Modify: `src/settings.ts`
- Modify: `README.md`

- [ ] **Step 1: 写迁移矩阵**

覆盖：

- `0.4.0` 无 AI 配置；
- Claude CLI；
- Claude API 明文 key；
- OpenAI API 明文 key；
- 现有 Claudian tabs；
- 现有 `jarvisTabsJson`；
- 语音开关和 ASR/TTS 设置；
- 自定义目录映射；
- 缺少 SecretStorage；
- 迁移中断后重启。

- [ ] **Step 2: 实现版本化迁移**

迁移记录独立 schema version。每一步幂等；成功后再提高版本。旧 key 删除必须晚于 SecretStorage 验证。

- [ ] **Step 3: 保留旧命令兼容**

- `open-quyuan-v2` → TALOS AI 对话页；
- `open-jarvis` → 回滚入口；
- 旧 Claudian view type 保留一个版本周期；
- 不再依赖外部 Claudian 插件。

- [ ] **Step 4: 运行迁移测试**

```bash
npx vitest run tests/wp7-migration.test.ts tests/provider-secret-migration.test.ts
npm run typecheck
```

Expected: PASS。

### Task 14: 完成确定性合成验收

**Files:**

- Create: `tests/wp7-e2e.test.ts`
- Create: `fixtures/wp7-vault/`
- Create: `docs/qa/wp7-mock-acceptance.md`
- Modify: `quyuan-v2.selftest.mjs`

- [ ] **Step 1: 建立不含真实客户内容的测试 Vault**

包含九个模块的最小目录、候选/推断、项目、洞察、输出、假密钥文件和审批夹具。

- [ ] **Step 2: 写 mock 端到端验收**

单次测试覆盖：

1. 打开工作台；
2. 一键执行 B 类动作；
3. 查看 running/completed；
4. C 类未经批准零写入；
5. 批准后写入；
6. AI 对话全库检索；
7. 语音独立会话；
8. Provider 切换；
9. manual review；
10. `30 洞察`/`70 输出` 写回；
11. 密钥零外发；
12. 撤销。

- [ ] **Step 3: 运行全套插件验证**

```bash
npm test
npm run test:quyuan
npm run test:approval-actions
npm run test:approval-executor
npm run typecheck
npm run lint
npm run build
```

Expected: 全部 PASS。

- [ ] **Step 4: 记录确定性结果**

`docs/qa/wp7-mock-acceptance.md` 记录命令、时间、测试数、构建摘要和失败修复，不包含私人数据。

### Task 15: Obsidian 人工视觉与交互 QA

**Files:**

- Modify: `docs/design-qa.md`
- Create: `docs/qa/wp7-obsidian-acceptance.md`

- [ ] **Step 1: 构建并备份已安装插件**

在同步前备份当前 Obsidian 插件的：

- `main.js`；
- `manifest.json`；
- `styles.css`；
- `data.json` 的非敏感结构摘要。

不得把 data.json 内容复制进仓库。

- [ ] **Step 2: 同步三个构建产物**

只同步 `main.js`、`manifest.json`、`styles.css`，随后逐文件 `cmp`。

- [ ] **Step 3: 检查六个一级页面**

验证：

- 工作台行动优先；
- AI 对话完整功能；
- 语音独立页面；
- 三组二级页；
- 任务抽屉跨页面；
- 设置 Provider 中心。

- [ ] **Step 4: 检查点击执行**

验证 A/B/C：

- A 直接执行；
- B 点击即批准并有恢复点；
- C 提案、diff、二次确认；
- 部分失败；
- 取消；
- 撤销；
- 切页不中断。

- [ ] **Step 5: 检查窗口和可访问性**

桌面宽窗口、Obsidian 窄分栏、最小支持宽度；键盘、焦点、屏幕状态文案、减少动态效果。

- [ ] **Step 6: 检查语音**

持续模式、打断、点击说话、ASR 失败降级、TTS 失败、麦克风权限拒绝、字幕保留。

Expected: QA 文档中每项有 PASS/FAIL 和证据截图。

### Task 16: 真实 Provider、升级和回滚验收

**Files:**

- Create: `docs/qa/wp7-real-provider-acceptance.md`
- Create: `docs/qa/wp7-upgrade-rollback.md`
- Update only after pass: `manifest.json`
- Update only after pass: `versions.json`
- Update only after pass: release/checksum metadata

- [ ] **Step 1: 真实云端 Provider 问答**

使用用户提供且存于 SecretStorage 的 key：

- 全库问答一次；
- 明确列出读取范围；
- 检查发送审计；
- 确认密钥零外发；
- 不把 key 写入文档。

- [ ] **Step 2: 真实低风险动作**

优先在隔离测试 Vault 执行。客户 Vault 如需验收，必须单独批准，并在验收后恢复。

- [ ] **Step 3: 真实高风险提案**

完成：

- 模型提案；
- 查看 diff；
- 批准；
- 写入；
- 撤销；
- 前后差异证据。

- [ ] **Step 4: 真实语音会话**

完成独立语音问答、打断和点击模式降级。

- [ ] **Step 5: WP6 → WP7 升级**

验证：

- 设置；
- SecretStorage 迁移；
- 文字历史；
- 语音历史；
- 目录映射；
- 命令兼容；
- 九个客户模块安装差异为零。

- [ ] **Step 6: 回滚**

恢复升级前插件三产物和配置备份，确认 WP6 可启动、旧命令可用、客户模块不变。

- [ ] **Step 7: 运行 TALOS 2.0 发布门**

必须获得证据：

- 943 项测试；
- checksums；
- 179 基线；
- accept 9/9；
- 隐私门；
- 十三条 canonical registry；
- WP6 升级/回滚；
- 九模块安装差异为零。

- [ ] **Step 8: 最后才标记 2.0.0**

只有前述全部通过后：

- 更新 `manifest.json`；
- 更新 `versions.json`；
- 更新发行说明和 checksums；
- 构建最终三个插件产物；
- 保存最终验收证据；
- 由用户决定是否创建 release commit/tag。

Expected: 任何失败都保持候选版本，不标正式 `2.0.0`。

---

## Recommended Execution Order

1. Task 1：隔离现有脏工作区；
2. Tasks 2–4：动作、任务、按钮；
3. Task 5：页面重组；
4. Tasks 6–7：文字与语音两个界面；
5. Tasks 8–10：Provider、SecretStorage、全库问答；
6. Tasks 11–12：canonical `talos-ask`；
7. Tasks 13–15：迁移、mock、视觉 QA；
8. Task 16：真实 Provider、升级、回滚和 2.0.0。

## Parallelization Boundaries

在独立 worktree 和测试夹具建立后，可并行：

- Task 5 页面导航模型与 Task 8 Provider facade；
- Task 6 文字 surface 与 Task 7 语音 session；
- Task 11 插件 canonical reader 与 Task 12 TALOS 合同源；
- 视觉 QA 文档准备与 mock fixture。

不可并行：

- Task 3 依赖 Task 2；
- Task 4 依赖 Task 3；
- Task 10 依赖 Tasks 8–9；
- Task 13 依赖 SecretStorage 和两个会话 namespace；
- Task 16 必须最后执行。

## Stop Conditions

出现以下任一情况必须停止并请求用户决定：

- 现有未提交改动无法安全归属；
- 找不到 TALOS registry 权威合同源；
- SecretStorage 迁移无法验证且唯一替代是明文存储；
- 实现要求修改九个客户模块或读取真实密钥；
- Provider 工具调用无法提供幂等 ID；
- 升级或回滚导致客户模块差异；
- 既有 Claudian 能力合同出现减少；
- 任何发布门失败但流程试图标记 2.0.0。
