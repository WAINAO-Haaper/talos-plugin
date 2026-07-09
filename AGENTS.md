# TALOS 控制台插件 — Agent 协作规则

> 本文件与 `CLAUDE.md` 内容一致。任何 Agent 进入本项目前必读。

## 这是什么

- TypeScript 编写的 **Obsidian community plugin**，不是 Obsidian Vault。
- 插件 ID `talos`，显示名 `TALOS`，版本 `0.1.0`，最低 Obsidian `1.8.0`。
- 定位：**超级大脑整个系统的原生控制台**。扫全库、实时统计、把每个系统模块的态势呈现在一个 Obsidian 视图里。
- 取代旧方案：`07-控制台/dashboard.html` + `System/scripts/refresh-dashboard.py`（python 写 STATS）+ `超级大脑仪表盘.md` 的 DataviewJS iframe。`超级大脑仪表盘.md` 已于 2026-06-28 删除；`dashboard.html` + python 暂留为回退备份。

## 常用命令

- `npm install` / `npm run dev`（watch）/ `npm run build`（生产）/ `npm run lint`

## 产物与安装

- 最终只需 `main.js`、`manifest.json`、`styles.css` → 拷到 `<vault>/.obsidian/plugins/talos/`。

## 统计口径（必须与 refresh-dashboard.py 一致）

- 知识笔记 = 六大内容目录（04-项目/03-素材/02-洞察/05-归档/01-日志/00-收件箱）下 `.md`，排除 `_README.md` 及路径含 `/node_modules/`、`/客户交付物/`、`/交付包/`、`/talos-system-promo` 的副本。
- 收件箱 = `00-收件箱` 计数；待审批 = `System/pending-approvals.md` 的「## 当前待审批」中 `**状态**：待审批` 数；偏好候选 = `System/working-memory/candidates.md`「待确认」条目数；健康分趋势 = `health-log.md` 的 `<!-- EVAL_HISTORY -->` 最近 9 点；今日焦点 = `System/working-memory/tasks.md`「## 焦点」。
- TALOS 产品发布作战室 = `04-项目/TALOS系统/tasks.md`（G1/G2/G3 闸门 + PUB-W + 发布数/冻结天数）。

## 开发约束

- 优先 Obsidian 官方公开 API（`app.vault`、`app.metadataCache`、`ItemView`、`requestUrl`）。
- 最小、可测试、可迭代；render 函数拆清楚。
- 不随意新增生产依赖。
- 涉及网络请求、删除文件、修改真实 Vault 前必须先说明并等待确认。
- UI 优先参考 `frontend-design` skill；Obsidian API/审核规则参考 `obsidian-plugin-skill` skill。

## 安全

- 不提交 API key、token、本地路径、私人数据。不建 Git remote、不 commit，除非明确要求。

## 工作流

- 大改前先说目标/涉及文件/最小方案；改完跑 build（有 lint 也跑），总结改动与验证方式。
