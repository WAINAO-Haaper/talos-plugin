# TALOS Overview Approval Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复总览审批区遮挡，新增可写回的偏好审批模块，并让桌面、Obsidian 窄分栏和移动宽度自动兼容。

**Architecture:** 把 Markdown 文本变换放入独立纯函数 `candidate-actions.ts`，Vault 读写留在 `actions.ts`，总览渲染与反馈留在 `view.ts`。布局使用独立审批网格和总览内容容器查询，避免以整个窗口宽度推断 Obsidian 实际分栏宽度。

**Tech Stack:** TypeScript 5.8、Obsidian API、Vitest 4、CSS Grid/Container Queries、现有 esbuild 样式构建。

## Global Constraints

- 不新增生产依赖。
- 不修改真实 Vault；只有插件运行后用户主动点击按钮才会触发 `app.vault.modify`。
- 保留待审批的“批准 / 拒绝 / 批准+模型”行为；偏好审批只提供“批准 / 拒绝”。
- 批准偏好移动到 `## 已确认`，拒绝偏好移动到 `## 已拒绝`，并记录日期和“TALOS 界面按钮”。
- 桌面两个审批模块并排，窄内容区上下堆叠；所有按钮不得越出卡片。
- 适当缩小系统健康模块，但不移除健康分、数据源、刷新时间或断链数据。
- 先保存目标文件原始副本；回滚只撤销本次文件，不使用 `git reset --hard` 或 `git checkout --`。
- 遵守项目规则：未经明确要求不创建 commit。

---

### Task 1: 建立可恢复基线

**Files:**
- Backup: `backups/overview-approval-layout-20260722-before/`
- Create: `backups/overview-approval-layout-20260722-before/ROLLBACK.md`

**Interfaces:**
- Consumes: 当前未修改的 `src/view.ts`、`src/actions.ts`、`src/data/stats.ts`、`styles.talos.css`、`docs/design-qa.md`。
- Produces: 本次修改专用原始副本和明确恢复清单。

- [ ] **Step 1: 确认目标文件没有用户未提交修改**

Run:

```bash
git diff -- src/view.ts src/actions.ts src/data/stats.ts styles.talos.css docs/design-qa.md
```

Expected: 无输出；若有输出，先保留现状并把差异纳入备份，禁止覆盖。

- [ ] **Step 2: 保存原始副本**

Run:

```bash
mkdir -p backups/overview-approval-layout-20260722-before
cp src/view.ts src/actions.ts src/data/stats.ts styles.talos.css docs/design-qa.md backups/overview-approval-layout-20260722-before/
```

Expected: 目录中存在五个原始文件，且 `cmp` 对应源文件均相同。

- [ ] **Step 3: 写入恢复清单**

`ROLLBACK.md` 必须列出：恢复五个原始文件；删除 `src/candidate-actions.ts`、`tests/candidate-actions.test.ts`、`tests/overview-layout.test.ts`；重新运行 `npm run build` 和 `npm run lint`。文档还需说明真实 Vault 中由用户点击产生的数据决策不包含在代码回滚内。

---

### Task 2: 偏好候选文本变换内核

**Files:**
- Create: `src/candidate-actions.ts`
- Create: `tests/candidate-actions.test.ts`

**Interfaces:**
- Consumes: `content: string` 与 `{ title, decision, date, operator? }`。
- Produces: `applyCandidateDecision(content, input): CandidateDecisionResult`，其中结果包含 `ok`、`content`、`message`、`removedFromPending`。

- [ ] **Step 1: 写批准、拒绝和错误路径的失败测试**

测试夹具使用以下结构：

```ts
const fixture = `# 偏好候选

## 待确认

- 喜欢结论先行，正文使用短段落
- 长标题候选：在跨平台发布时保留完整来源、日期与处理上下文，不能依赖界面的七十字截断

## 已确认

- 已有稳定偏好
`;
```

至少断言：批准移动到 `## 已确认`；拒绝创建或追加 `## 已拒绝`；决策行包含 `2026-07-22`、`TALOS` 和“界面按钮”；未找到候选、缺少待确认分区、空标题时 `ok === false` 且原文不变；长标题精确匹配。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx vitest run tests/candidate-actions.test.ts
```

Expected: FAIL，因为 `../src/candidate-actions` 尚不存在。

- [ ] **Step 3: 实现最小纯文本变换**

定义：

```ts
export type CandidateDecision = "approve" | "reject";

export interface CandidateDecisionInput {
  title: string;
  decision: CandidateDecision;
  date: string;
  operator?: string;
}

export interface CandidateDecisionResult {
  ok: boolean;
  content: string;
  message: string;
  removedFromPending: boolean;
}

export function applyCandidateDecision(
  content: string,
  input: CandidateDecisionInput
): CandidateDecisionResult;
```

实现必须仅匹配 `## 待确认` 内以 `- ` 开头、去除 Markdown 标记后与 `title` 完全相等的第一行。批准目标标题为 `## 已确认`，拒绝目标标题为 `## 已拒绝`；移动后的格式为：

```md
- 原候选文本
  - **界面操作**：2026-07-22 TALOS 点击「批准」。
```

拒绝时末尾动作改为“拒绝”。目标分区不存在时在文件末尾创建；任何错误返回原始 `content`。

- [ ] **Step 4: 运行候选测试并确认 GREEN**

Run:

```bash
npx vitest run tests/candidate-actions.test.ts
```

Expected: PASS。

---

### Task 3: 接入 Vault 写回与总览交互

**Files:**
- Modify: `src/actions.ts`
- Modify: `src/data/stats.ts:269-292`
- Modify: `src/view.ts:1-35, 120-140, 850-1020, 1330-1450`
- Test: `tests/candidate-actions.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `applyCandidateDecision` 与 `CandidateDecision`。
- Produces: `decidePreferenceCandidate(app, settings, title, decision): Promise<boolean>`，以及总览偏好审批条目的按钮交互。

- [ ] **Step 1: 增加完整标题回归测试并确认 RED**

在候选测试中增加长于 70 字的候选，并断言传入完整标题后可以精确移动。随后把 `collectCandidates` 的 `.slice(0, 70)` 视为需要移除的已定位回归点。

Run:

```bash
npx vitest run tests/candidate-actions.test.ts
```

Expected: 新增的文本内核测试 PASS；下一步通过静态布局测试约束收集层不再截断。

- [ ] **Step 2: 增加 Vault 操作函数**

在 `src/actions.ts` 导入 Task 2 的类型和函数，并新增：

```ts
export async function decidePreferenceCandidate(
  app: App,
  settings: TalosSettings,
  title: string,
  decision: CandidateDecision
): Promise<boolean>
```

函数读取 `settings.candidatesPath`，调用 `applyCandidateDecision`，失败时 Notice 且不写回；成功时调用一次 `app.vault.modify` 并返回 `true`。

- [ ] **Step 3: 保留候选完整标题**

把 `collectCandidates` 的候选构造改为：

```ts
out.push({ title: stripMd(s.slice(2)), meta: "待确认", path: file.path });
```

- [ ] **Step 4: 在总览渲染独立的两类审批卡**

在 `pageOverview` 完成原有 `overview-ops-grid` 后创建：

```ts
const approvalGrid = page.createDiv({ cls: "overview-approval-grid" });
const pendingPanel = this.panel(approvalGrid, "var(--amber)", "待审批", "批准 · 拒绝 · 模型执行");
const preferencePanel = this.panel(approvalGrid, "var(--purple)", "偏好审批", "批准 · 拒绝 · 写回候选池");
```

待审批卡始终渲染最多三项或空状态，并复用 `renderApprovalItem`。偏好审批卡始终渲染最多三项或空状态，并通过新增 `renderCandidateItem`、`createCandidateActionButton` 调用 `decidePreferenceCandidate`。

偏好反馈与审批反馈分开保存，反馈文案明确为“已批准并移入已确认”或“已拒绝并移入已拒绝”，打开记录使用 `settings.candidatesPath`。原行动队列内部的 `overview-approval-quick` 整块删除，避免重复入口。

- [ ] **Step 5: 运行类型检查与相关测试**

Run:

```bash
npx vitest run tests/candidate-actions.test.ts tests/approval-actions.test.ts
npm run typecheck
```

Expected: 全部 PASS，TypeScript 无错误。

---

### Task 4: 响应式布局与遮挡回归测试

**Files:**
- Create: `tests/overview-layout.test.ts`
- Modify: `styles.talos.css:1104-1280, 1490-1690, 1896-1930`
- Modify: `src/view.ts`

**Interfaces:**
- Consumes: Task 3 输出的 `.overview-approval-grid`、`.overview-pending-panel`、`.overview-preference-panel` 类名。
- Produces: 无横向越界的容器级响应式布局。

- [ ] **Step 1: 写静态布局失败测试**

测试读取 `styles.talos.css` 与 `src/view.ts`，断言：

```ts
expect(css).toContain(".overview-approval-grid");
expect(css).toContain("container-type: inline-size");
expect(css).toMatch(/@container\s+overview-content\s+\(max-width:/);
expect(css).not.toContain("minmax(620px,1.22fr)");
expect(view).toContain('cls: "overview-approval-grid"');
expect(view).toContain('cls: "item approval-item candidate-approval-item"');
```

- [ ] **Step 2: 运行布局测试并确认 RED**

Run:

```bash
npx vitest run tests/overview-layout.test.ts
```

Expected: FAIL，因为独立审批网格和容器查询尚未完成。

- [ ] **Step 3: 实现可收缩桌面布局**

关键规则：

```css
.talos-console[data-talos-page="overview"] .page-content {
  container: overview-content / inline-size;
}

.talos-console .overview-ops-grid {
  grid-template-columns: minmax(0, .78fr) minmax(0, 1.22fr);
}

.talos-console .overview-approval-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  min-width: 0;
}

.talos-console .overview-approval-grid .approval-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
}

.talos-console .overview-approval-grid .approval-actions {
  grid-column: 1 / -1;
  margin-left: 0;
  flex-wrap: wrap;
}
```

把健康卡圆环从 132px 缩至 104px、最小高度从 170px 缩至约 132px，并同步降低标题字号和间距。

- [ ] **Step 4: 实现容器级断点**

在总览内容容器小于约 980px 时让 `.overview-ops-grid` 变成一列；小于约 760px 时让 `.overview-approval-grid` 变成一列、健康卡在需要时变成单列。保留已有 viewport media query 作为不支持容器查询环境的后备。

- [ ] **Step 5: 运行布局测试并确认 GREEN**

Run:

```bash
npx vitest run tests/overview-layout.test.ts
```

Expected: PASS。

---

### Task 5: 完整验证、视觉 QA 与回滚证据

**Files:**
- Modify: `docs/design-qa.md`
- Create: `backups/overview-approval-layout-20260722-before/changed-files.patch`

**Interfaces:**
- Consumes: Tasks 1-4 的代码、样式和测试。
- Produces: 可重复验证记录与本次差异补丁。

- [ ] **Step 1: 运行全套验证**

Run:

```bash
npm test
npm run build
npm run lint
```

Expected: 三条命令退出码均为 0，无新增 warning/error。

- [ ] **Step 2: 生成本次差异补丁**

Run:

```bash
git diff -- src/view.ts src/actions.ts src/data/stats.ts styles.talos.css docs/design-qa.md > backups/overview-approval-layout-20260722-before/changed-files.patch
```

Expected: 补丁只包含本次五个已有文件的修改；新增文件由 `ROLLBACK.md` 明确列出。

- [ ] **Step 3: 视觉验证**

使用现有总览 QA 原型或本地静态页面检查至少三种内容宽度：桌面约 1280px、中等分栏约 900px、移动约 390px。逐项确认：待审批与偏好审批桌面并排；中窄宽度正确堆叠；审批标题可省略但完整按钮可见；健康数据完整；页面 `scrollWidth === clientWidth`。

- [ ] **Step 4: 记录 QA**

在 `docs/design-qa.md` 追加“Overview Approval Compatibility QA”，记录测试命令、宽度、无横向溢出结论和已保留的回滚目录。

- [ ] **Step 5: 最终差异审查**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；状态只包含本次预期文件、设计/计划文档、`.superpowers/` 草图目录，以及用户原有的未跟踪交接提示词文件。不得修改该用户文件。
