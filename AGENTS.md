# TALOS 控制台插件 — Agent 协作规则

> 任何 Agent 进入本项目前必读。

## 这是什么

- TypeScript 编写的 **Obsidian 桌面插件**，不是 Obsidian Vault。
- 插件 ID `talos`，显示名 `TALOS`，版本 `0.4.22`，最低 Obsidian `1.11.4`。
- 定位：**超级大脑的原生控制台 + 屈原 AI Agent 工作台**。统一承载首页三视图、工作台三段式、语音助手、系统总览与设置。
- 入口：`src/main.ts` 注册视图与命令 → `src/view.ts`（经典控制台与 Lens）→ `src/ui/pages/` 渲染页面；运行时装配在 `src/plugin/`。

## 常用命令

- `npm install`
- `npm run dev`（watch）
- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`（生产）

## 产物与安装

- 发布载荷：`main.js`、`claude-sdk.cjs`、`manifest.json`、`styles.css`、字体、许可证与第三方声明。
- 安装：拷到 `<vault>/.obsidian/plugins/talos/`；覆盖升级时不要删除或替换 `data.json`。
- `main.js`、`styles.css`、`claude-sdk.cjs` 被 gitignore，由 `npm run build` 重新生成，不从版本库直接分发。

## 统计与数据口径

- 统计口径以 `src/data/` 采集器与 `src/data/schema.ts` 的 `VaultPaths` 为准；目录可在设置中映射，不要硬编码某个 Vault 的绝对路径。
- 笔记统计排除 `_README.md`、`node_modules`、客户交付物与发布包副本。
- 待审批、偏好候选、健康趋势、焦点与发布闸门的解析分别由 `src/data/stats.ts`、`src/data/navigation.ts`、`src/data/talos.ts` 负责；修改解析规则必须同时补测试。

## 源码结构

- `src/main.ts`：插件生命周期、命令、视图注册与装配。
- `src/view.ts`：控制台 ItemView、经典导航与 Lens 入口。
- `src/ui/`：首页三视图、工作台、设置、Lens、图表与通用组件。
- `src/plugin/`：语音工具、诊断、Provider 运行时、页面命令等装配层。
- `src/agent-workbench/`：多智能体会话、运行时适配、审批、安全、存储与原生 UI。
- `src/quyuan/`：屈原人格、Qwen Realtime 语音、只读工具与 TALOS Ball。
- `src/harness/`：DeepSeek Harness 嵌入、进程管理与健康检查。
- `src/ai/`：Provider 门面、Direct API、隐私出库审计与上下文检索。
- `src/jarvis/`：v1 冻结回滚层，保持原样，不重构。
- `tests/`：Vitest 回归与源码契约测试。

## 开发约束

- 优先 Obsidian 官方公开 API（`app.vault`、`app.metadataCache`、`ItemView`、`requestUrl`）。
- 最小、可测试、可迭代；render 函数拆清楚。
- 不随意新增生产依赖。
- 删除代码前先做引用扫描（文件/导出/私有成员）并跑 tsc/lint；不要删除 `src/jarvis/` 的冻结回滚层。
- 涉及网络请求、删除文件、修改真实 Vault 前必须先说明并等待确认。
- UI 优先参考 `frontend-design` skill；Obsidian API/审核规则参考 `obsidian-plugin-skill` skill。

## 安全

- 不提交 API key、token、本地路径、私人数据。不建 Git remote、不 commit，除非明确要求。

## 工作流

- 大改前先说目标/涉及文件/最小方案；改完跑 `npm run typecheck`、`npm test`、`npm run lint`、`npm run build`，总结改动与验证方式。
