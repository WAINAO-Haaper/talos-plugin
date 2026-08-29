# Quyuan

> TALOS 内部的屈原人格、治理与语音层；通用文字对话由 `src/agent-workbench/` 原生实现。

## 当前边界

- `contract.ts`：不可缩水的通用 Agent 能力合同。
- `persona-context.ts`：首轮对话前完整加载 PERSONA、persona-memory、CONTEXT；缺一即失败。
- `governance.ts`：写库前的 TALOS 铁律判定，不依赖具体 Provider。
- `workbench-adapter.ts`：TALOS 与 provider-neutral runtime 的稳定适配契约。
- `module.ts`：把人格、治理和工作台适配器编排为一个屈原模块。
- `styles.quyuan-shell.css`（插件根目录）：完整 Agent 工作台不再自带固定浅色宣纸变量；开启全库同步时消费 `body[data-talos-vault-theme]` 的七主题令牌，关闭同步时继承 Obsidian 当前明暗主题。主题色、文字、边框、圆角与 `color-scheme` 共用同一来源，切换无需重建视图。
- `voice-panel.ts`：控制台屈原页的语音交互舞台与六态总调度。右侧为可拖拽调宽、可折叠的 TALOS 交互面板，默认承载同源语音/文字会话，并提供上下文、能力、快捷指令和完整工作台入口。语音识别结果不再进入全宽字幕流，改为圆环右上方独立编辑卡：卡片从右侧 42px 滑入，textarea 支持多行编辑、内部滚动和 Esc 收起；扇形菜单展开时卡片联动上滑 64px（窄屏 58px）为按钮与气泡让位。仅语音通道更新该卡，文字输入仍留在会话区。AI 回复区固定收窄到左侧阅读栏，编辑卡与回复、圆环、扇形按钮分别占用独立区域。悬浮标签只保留组件自己的圆角气泡；按钮通过隐藏文本和 `aria-labelledby` 保持无障碍名称。持续监听默认处于休眠门控，说“屈原”唤醒，30 秒内可连续对话，说“退下”立即休眠；显式“退出语音”才停止 ASR、唤醒词监听并释放麦克风，文字输入始终可用。
- `voice-character-stage.ts`：控制台与粒子 Logo 渲染器之间的稳定适配层，只暴露六态、唤醒状态、麦克风输入量、TTS 输出量和销毁契约。内部创建双层 Canvas；若 Canvas 初始化失败，只降级为静态 TALOS 图标，不阻断屈原页打开。
- `native-voice-driver.ts`：语音专用原生驱动。文字/语音共享 PERSONA 与 TALOS 治理，但拥有独立响应契约、运行时和历史；语音只产出可直接朗读的口语。
- `voice-particle-field.ts`：现行 Antigravity 风格 TALOS Logo 粒子磁场，不读取人物 PNG，也不引入 React/Three.js。`src/talos-mark.ts` 用五组圆角矩形并集减去圆角眼舱/嘴部负形，生成 6247 个主体球形粒子；另有 480 个圆形眼睛粒子，总计 6727。主体与眼睛均用 Canvas 圆弧绘制，稀疏附加偏左上高光和柔光晕，在不为每点创建昂贵渐变的前提下形成发光球体。休眠轨道速度、呼吸幅度和流动扰动增强；唤醒磁吸由 0.18 提升到 0.22，聆听呼吸、识别扫描、思考旋流、回答波幅和指针磁场同步加强。六段霓虹调色板与状态色体系保留。活动态约 38fps、休眠约 24fps；DPR 1.25、非可见页停算与 reduced-motion 低频重绘继续控制性能。
- `vad-mic.ts`：持续监听、打断检测与归一化音量回调，为人物倾听反馈提供实时语音强度。自动断句静音窗 550ms；声控打断采用 RMS 0.09、约 600ms 连续语音与 600ms 播放保护窗，思考/网络排队阶段不再被环境声自动取消。
- `../agent-workbench/`：TALOS 自有结构化执行、三运行时适配、会话存储和原生 UI；不含 Claudian 旧版源码。

## 迁移纪律

1. 旧 `src/jarvis/` 在 v2 实机回归通过前不删除；回滚入口仅保留在命令面板，不再重复占用侧栏。
2. Agent Workbench 行为代码不得依赖 Claudian 旧版目录或类型。
3. 人格与治理必须独立于 Claude/Codex/OpenCode/Pi。
4. 所有能力以 `contract.ts` 为发布闸门；缺失能力必须显式报告，不能静默降级。

## 架构研究基线

- Claudian 最新源码参考提交：`d190786d11cc0b067475dcffbf8c334ee565d208`
- 仅借鉴 provider-neutral 执行协议与会话协调思路；行为实现归属 TALOS
- UI 视觉资产许可边界见插件根目录 `THIRD-PARTY-NOTICES.md`
