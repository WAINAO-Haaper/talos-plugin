# Claudian upstream snapshot

> 第三方源码快照，固定自 Claudian 2.0.25 / `9496e66a3877aa9993f73432d411b7cd682f4557`。

本目录只承载屈原通用 Agent 工作台的上游技术内核。TALOS 的人格、治理、语音与品牌适配必须放在上一层 `src/quyuan/`，避免直接污染上游代码。

同步原则：

1. 上游源文件保持原目录结构，便于版本 diff。
2. 必要的兼容修改单独记录，不做无来源的大面积重写。
3. 发布时保留插件根目录 `THIRD-PARTY-NOTICES.md` 中的 MIT 声明。
4. 上游内部子目录属于同一第三方源码快照，由本文件统一索引，不作为知识库目录分别维护。

兼容修改：

- 2026-07-01：`main.ts` 增加 `shouldRegisterWorkbenchRibbon()` 与 `shouldRegisterWorkbenchSettingTab()` 差异钩子。独立 Claudian 默认仍注册自己的工作台图标和设置页；被 TALOS 主插件继承时关闭两项重复注册，由 TALOS 统一入口承载。命令、工作台视图和独立 Claudian 不受影响。
