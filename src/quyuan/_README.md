# Quyuan v2

> TALOS 内部的屈原 Agent 工作台重构区。Claudian 只提供通用工作台技术来源；TALOS 品牌、人格、治理与语音由本目录持有。

## 当前边界

- `contract.ts`：不可缩水的通用 Agent 能力合同。
- `upstream.ts`：固定 Claudian 上游版本与来源。
- `persona-context.ts`：首轮对话前完整加载 PERSONA、persona-memory、CONTEXT；缺一即失败。
- `governance.ts`：写库前的 TALOS 铁律判定，不依赖具体 Provider。
- `workbench-adapter.ts`：TALOS 与 provider-neutral runtime 的稳定适配契约。
- `module.ts`：把人格、治理和工作台适配器编排为一个屈原模块。
- `styles.quyuan-shell.css`（插件根目录）：完整 Agent 工作台不再自带固定浅色宣纸变量；开启全库同步时消费 `body[data-talos-vault-theme]` 的七主题令牌，关闭同步时继承 Obsidian 当前明暗主题。主题色、文字、边框、圆角与 `color-scheme` 共用同一来源，切换无需重建视图。
- `voice-panel.ts`：控制台屈原页的语音交互舞台；状态流程放大并固定在左上，粒子核心严格居中，当前状态标题与回答流固定在右下，形成不互相遮挡的三点布局。右侧为可拖拽调宽、可折叠的 TALOS 交互面板，默认承载同源语音/文字会话，并提供上下文、能力、快捷指令和完整工作台入口。全部操作按钮统一走 `tq-btn` 语义体系（主行动 / 次行动 / 危险 / 图标 / 标签 / 列表），尺寸、聚焦、按下、禁用和七主题换肤共享一套契约；紧凑操作按钮采用 Uiverse.io `gharsh11032000` 的深色胶囊、底部上涌填色与短促摇动语言，页签和大列表保持稳定不摇动。持续监听默认处于休眠门控，说“屈原”唤醒，30 秒内可连续对话，说“退下”立即休眠；未唤醒的转写不会进入 Agent。模型生成、TTS 排队和真实播放分别记账，麦克风保护直到音频播完才解除，自动声控打断只在真实播放期开放。Canvas 粒子层或 ASR 启动失败时只降级当前子能力，不阻断屈原页打开；控制台仍保留错误日志。
- `voice-driver.ts`：文字/语音双通道驱动。两者共享 PERSONA、工具与 TALOS 治理，但拥有独立响应契约、独立运行时和独立历史；语音只产出可直接朗读的口语，文字保留结构化 Markdown。Claude 语音 runtime 使用独立设置快照（默认 Haiku + Low）并在面板挂载/唤醒时预热，不改变完整文字工作台的 Opus/思考档。
- `voice-particle-field.ts`：Canvas 粒子声云；由真实麦克风 RMS 与 idle/listen/reco/think/speak 五态共同驱动。聆听为矿蓝冷色呼吸、识别为蓝绿扫描收束、思考为蓝紫双向涡旋、回答为朱砂/矿蓝/苔绿交替外扩波阵；每颗粒子按相位独立流色，少量高能粒子带低透明光晕，脉冲和轨道也随状态渐变。浅色宣纸使用 source-over 提升矿物色可见度，深色主题保留 lighter 发光合成，并支持 reduced-motion 静态降级。
- `vad-mic.ts`：持续监听、打断检测与归一化音量回调，为粒子动画提供实时语音强度。自动断句静音窗 550ms；声控打断采用 RMS 0.09、约 600ms 连续语音与 600ms 播放保护窗，思考/网络排队阶段不再被环境声自动取消。
- `claudian/`：Claudian 2.0.25 的固定上游快照；运行时由 TALOS 主插件继承，差异钩子只用于品牌、人格、治理、语音及关闭重复侧栏/设置页注册。完整工作台设置由 TALOS「屈原 · 高级」标签承载，独立 Claudian 插件保持独立。

## 迁移纪律

1. 旧 `src/jarvis/` 在 v2 实机回归通过前不删除；回滚入口仅保留在命令面板，不再重复占用侧栏。
2. Claudian 衍生代码不得越过 `workbench-adapter.ts` 直接依赖 TALOS 页面。
3. 人格与治理必须独立于 Claude/Codex/OpenCode/Pi。
4. 所有能力以 `contract.ts` 为发布闸门；缺失能力必须显式报告，不能静默降级。

## 上游

- Claudian 2.0.25
- Commit: `9496e66a3877aa9993f73432d411b7cd682f4557`
- License: MIT，完整声明见插件根目录 `THIRD-PARTY-NOTICES.md`
