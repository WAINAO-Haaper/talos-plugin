# TALOS 控制台插件

> **一句话**：TALOS = 整个超级大脑系统。本插件是它的原生控制台——扫全库、实时统计、把每个系统模块的态势和 TALOS 发布作战室呈现在一个 Obsidian 视图里。
> 方案来源：[杰森《用 Codex 为 Obsidian 搭建 Agent Dashboard》](https://jasonai.me/blog/codex-obsidian-agent-dashboard-plugin/)。

## 这是什么

TypeScript 编写的 Obsidian community plugin，**不是知识笔记**。插件 ID `talos`，显示名「TALOS」，v0.2.0。
Agent 协作规则见同目录 `AGENTS.md`。

## 取代了什么（已完成取代）

| | 旧（已退役/备份） | 新（本插件） |
|---|---|---|
| 统计 | `refresh-dashboard.py` 手动跑，写 STATS 块 | 打开即实时算，事件驱动自动刷新 |
| 载体 | `dashboard.html` + `超级大脑仪表盘.md` iframe | 原生 ItemView |
| 操作 | 只展示 | 刷新统计 / 发布回填 / 新建 / Deep Research / 命令路由 / Lint |

> 旧方案退役进度（2026-06-28）：根目录 `超级大脑仪表盘.md` 已删除；`dashboard.html` + python 暂留为回退备份。

## 统计口径（与 refresh-dashboard.py 一致，已校验）

知识笔记 = 六大内容目录（04/03/02/05/01/00）.md，排除 `_README`、`/node_modules/`、`/客户交付物/`、`/交付包/`、`/talos-system-promo`。校验值：合计 741（项目143/素材314/洞察115/归档120/日志40/收件箱9）。
待审批读 `pending-approvals.md` 当前待审批段、偏好候选读 `candidates.md` 待确认段、健康分读 `health-log.md` EVAL_HISTORY、焦点读 `System/.../tasks.md`、发布作战室读 `04-项目/TALOS系统/tasks.md`。

## 外观

复刻 `dashboard.html` 的极光玻璃态风格：近黑深色底（--bg #03040a）+ 极淡网格、玻璃卡（backdrop-blur + 彩虹顶边 + 每卡独立强调色）、渐变 Hero/时钟文字、发光 section 圆点、shimmer 进度条、prefers-reduced-motion 降级。

设置页「视觉风格」现有七套：`Aurora 原版（默认）`、`Nebula 深色宇宙稿`、`Animal Island 小岛主题`、`Macintosh 知识工作站`、`数据流 · 动态终端`、`柔光浮雕 · Neumorphism`、`几何现代主义 · Bauhaus`。后三套参考 `NovusGFX/retro-design-system` 的 32/37/42 号 MIT 主题，将视觉语言映射到 TALOS 的真实导航、指标卡、图表、详情页和屈原面板，并为十个页面设置独立配色。数据流限制为 20 列合成层动画（移动端 10 列），且移除原参考中的电影专有文案；三套均支持 `prefers-reduced-motion`。

Animal Island 主题参考 `guokaigdg/animal-island-ui` 的温暖羊皮纸底、薄荷青主色、棕色文字、波点墙纸、胶囊按钮、圆润卡片和游戏按压反馈；因源仓库许可证为 CC BY-NC 4.0，本插件未复制其源码、字体或图片素材，只在本地 CSS 中做原创风格迁移。Macintosh 主题参考 `sakofchit/system.css` 的 Classic Mac/System 6 视觉语言（黑白窗口、条纹标题栏、凸起/按下按钮、单色桌面纹理），源仓库 MIT；本插件未引入其字体、图标或源码文件。

**多页结构**：左侧导航持续保留；TALOS 系统控制台 Hero 仅在「总览」显示，屈原保留独立语音工作台，其余业务子页使用统一模块首屏（模块图标、运行说明、关键状态、快捷动作）后进入本页内容区。点导航按钮切页，数据刷新一次缓存、切页即时渲染。

## 仪表盘模块

总览采用「缩小主判断 → 2×2 结果指标 → 二级状态小卡 → 焦点/建议下钻区」的行动层级。数据仍来自任务流、发布作战室、健康记录、审批池、收件箱与偏好候选池；首屏不再把单个模块横向拉满，而是把运行判断和第一优先级收成左侧中等宽度指挥卡，今日执行、发布闭环、系统准备度、数据新鲜度以右侧指标矩阵承接；待处理、焦点、收件箱和巡检降为小状态卡。桌面保留左侧完整导航，680px 以下改为横向导航轨道，避免导航占掉首屏。

子页继续承载 **能力中心（命令/Agents/工作流 三标签切换，读 .claude/commands+.claude/agents+.agents/skills，点击复制调用）**、知识库分布、健康趋势、13 模块地图、全库笔记热力图与 TALOS 发布作战室（G1-G3 + PUB-W）。每日执行、输出、TALOS、收件箱、健康、项目、知识、身份、能力、全库 10 个业务页顶部统一提供模块首屏，并沿用总览单模块优化方案：左侧主说明缩成纸面指挥块，标题卡用模块身份色做浅底、左侧色条、图标和英文小标题强调；右侧真实统计固定为 2×2 纸面矩阵，动作按钮统一收在下方且继续保持统一红色细节；标题卡、统计卡和动作按钮统一具备强化鼠标悬停反馈，悬停时底色明显混入强调色、边框提亮、光晕增强并轻微上浮，只有真实可点的卡片显示手型。屈原页不共用该组件，避免干扰语音工作台布局。原时钟、快捷入口、上下文健康和审批侧栏卡仅在非总览页面按既有逻辑显示；七套主题令牌与组件材质保持不变。

### 导航信息架构

导航不直接复刻目录树，而是把真实库结构压成四个工作域；每项显示来自运行时采集器的真实状态数字：

| 工作域 | 常驻入口 | 对应真实结构 |
|---|---|---|
| 现在 | 总览、每日执行、屈原 | `tasks.md`、工作记忆、Agent 交互 |
| 流转 | 收件箱、输出作战室、项目场景 | `00-收件箱/`、`输出/`、`04-项目/` |
| 资产 | 知识枢纽、身份上下文、TALOS 产品 | `02-洞察/`、`03-素材/`、`Identity/`、`灵魂/`、TALOS 七分区 |
| 系统 | 系统健康、能力中心、全库视图 | `System/`、命令/Agents/Skills、六大内容目录 |

`01-日志/`、`05-归档/`、`模板/`、`自动化/`、`配置/`、`template/`、`attachments/` 和 `Excalidraw/` 不单独占常驻入口：它们在「全库视图」「系统健康」或「能力中心」中按职责聚合，避免把低频基础设施变成一级导航噪音。

每日执行舱：原生读取 `System/working-memory/tasks.md` 焦点区与 `done_when`，呈现今日唯一胜利条件、双深度块、六段固定时间轨道、执行铁轨、抗选择瘫痪协议、周轮值与真实文件入口；“开工 / /morning / 收工 / /memory”按钮点击复制调用。原根目录 `每日操作系统.md`（2026-06-28 HTML 退役后的迁移说明）已于 2026-06-28 删除，运行时不再依赖任何外部 markdown，旧 HTML 同步退役。

## 源码

- `src/main.ts` 入口；`src/view.ts` ItemView + 全部 render；`src/settings.ts` 设置页
- `src/quyuan/` **屈原 v2 融合层**：人格启动闸、能力契约、TALOS 治理适配、Claudian 2.0.25 固定快照与上游说明；第三方实现保留 MIT 溯源，面向用户统一使用 TALOS / 屈原命名
- `src/quyuan/voice-panel.ts` + `voice-character-stage.ts` + `voice-particle-field.ts` + `voice-driver.ts` **屈原 Antigravity 球形粒子 Logo 语音工作区**：现行形态由五组圆角实体模块构成实心窄边 T-Shield，中央负形提供大眼部空间和贯通到底的嘴部开口；6247 个主体球形粒子 + 480 个圆眼粒子共 6727。所有方形像素点改为圆形核心，约每 10–11 点增加偏左上高光并保留稀疏柔光晕。休眠轨道速度、呼吸幅度、双轴流动与指针扰动提高；唤醒聚合、聆听呼吸、识别扫描、思考旋流和回答波幅同步增强。语音识别结果从全宽字幕层拆为圆环右上方独立编辑卡，42px 水平滑入，支持多行编辑与 Esc 收起；扇形菜单展开时编辑卡再上滑 64px 主动避让。AI 回复固定使用左侧阅读区，三者互不覆盖。悬浮菜单仍提供持久化“退出语音/开启语音”模式。
- `src/data/stats.ts` 全库统计；`src/data/talos.ts` 发布作战室；`src/data/navigation.ts` 高频导航页数据采集；`src/actions.ts` 动作 + 模态框
- `src/approval-actions.ts` 待审批批准/拒绝按钮的纯文本变换内核；`approval-actions.selftest.mjs` 用沙盘文本验证批准、拒绝、缺失状态和「回滚方案示例不误判」路径；控制台待审批卡片和总览「处理建议」下的「待审批按钮入口」均可直接点击「批准 / 拒绝」写回决策并刷新队列，点击后会留下本次操作回执，明确区分「审批已记录」与「实际变更已执行」
- `src/approval-executor.ts` 审批授权执行器测试内核；`approval-executor.selftest.mjs` 验证审批项里的执行器/目标文件/执行指令解析、模拟模型追加内容和执行记录写回。当前 UI 提供「批准+模型」按钮，第一版仅支持 `mock-model-file-append` 本地模拟模型，用来验证授权→读文件→处理→写回→回执的闭环
- `src/jarvis/` **屈原 v1 回滚层**：保留原自研多通道 Agent、会话、语音与权限实现；迁移期不删除，便于一键回退和逐项迁移 STT 等 TALOS 差异能力
- `src/voice.ts` **旧屈原（一期·已停用，保留不删）**：SVG 角色 + `claude -p` 一次性 spawn + `speechSynthesis`。被 B 方案取代，view 不再引用；代码留存备查。
- `LICENSE`：TALOS 自有代码的专有商业许可；不覆盖 Claudian 与其他第三方材料。客户使用、席位、期限和再分发权须由单独商业协议/EULA 授予。
- `THIRD-PARTY-NOTICES.md`：Claudian MIT、Claude Agent SDK 商业条款、BYOK 边界和直接运行时依赖摘要。
- `THIRD-PARTY-LICENSES.txt`：由 `third-party-licenses.mjs` 根据 lockfile 自动生成的生产依赖完整许可证包；当前覆盖 111 个已安装生产包。
- `MaShanZheng-Regular.ttf` + `MaShanZheng-OFL.txt`：屈原语音主标题使用的本地毛笔字体与 SIL OFL 1.1 许可证；随插件部署，离线可用。
- `TALOS-Favicon-64-v1.png`：来自 `02-品牌资产/` 的 TALOS Modular T-Shield 定稿图标，供控制台品牌识别使用。
- `TALOS-Mascot-Character-Transparent-v1.png`：TALOS 动画人物概念资产与回滚参考；现行屈原粒子 Logo 不再依赖该图片运行。
- `styles.css` 七套完整主题（scope 在 `.talos-console`），含 `.jv-agent`/`.jv-tool`/`.jv-perm` 等 Agentic 面板样式
- `theme-preview.html` 三套新增主题的本地视觉回验页；`docs/design-qa.md` 对照参考页面的验收记录
- `prototype/` 设计稿原型与视觉回验页面（详见 `docs/design-qa.md`）

## 屈原 v2 · Claudian 技术融合（#73-B）

目标不是把 TALOS 改名成 Claudian，也不是运行时依赖外部 Claudian 插件，而是把其成熟的通用 Agent 工作台内核固化进屈原。TALOS 仍是唯一主品牌，屈原是 TALOS 内的 Agent 模块。

当前融合基线为 Claudian 2.0.25（固定提交见 `src/quyuan/upstream.ts`），已接入多 Provider 工作台、多标签会话、恢复/分叉/压缩/回退、工具调用与 diff、MCP、Skills、子智能体、上下文附件和行内编辑。TALOS 在外层追加三项不可替代能力：

- **人格先于工作台**：启动必须全文加载 `灵魂/PERSONA.md`、`灵魂/persona-memory.md` 与 `Identity/CONTEXT.md`；缺失即关闭屈原 v2，不降级成无人格通用助手。
- **治理先于写入**：写操作走 TALOS 审批策略；Markdown 行内编辑会先读取目标目录 `_README.md`，`PROFILE.md`、`Identity/`、`灵魂/` 保留硬闸。
- **TALOS 差异层**：沿用现有语音总开关与三种 TTS，屈原 v2 的流式回复可边生成边朗读；旧侧栏和 STT 暂留作回滚/迁移层。

默认入口：Obsidian 左侧栏只保留一个 TALOS 图标，打开统一控制台；控制台左侧导航「屈原」、动态 Logo 和底部命令条进入语音工作区。完整 v2 工作台与旧版回滚入口保留在命令面板，不再额外占用侧栏。独立 Claudian 插件继续启用并使用自己的 `.claudian/` 会话与设置，TALOS 内嵌工作台使用 `.talos/quyuan/`，两者不混写。

## 屈原 Agentic（B 方案 · v1 回滚层）

导航第二项「屈原」。全双工 agentic：**开口/打字 → claude-agent-sdk 流式跑全库 agentic 任务（读写/命令/多步）→ 流式分句朗读**。这是先前以对齐 Claudian 为目标的自研实现，现保留为安全回滚层。

> **命名（2026-06-28）**：原显示名「贾维斯/JARVIS」已统一改为「屈原」，与库内 `灵魂/PERSONA` 人格层对应——屈原即本 agent 的灵魂身份。仅改面向用户的显示文案与导航徽标（「贾」→「屈」）；内部标识符（`jarvis` 页 key、`JarvisEngine`/`JarvisAgentPanel` 类名、`src/jarvis/` 路径、`jv-` CSS 前缀）保持不变以免编译断裂。

- **引擎**（`src/jarvis/engine.ts`）：`@anthropic-ai/claude-agent-sdk` 的 `query()`，流式输入模式（`prompt` 为自管的 `AsyncIterable<SDKUserMessage>` 队列）→ 单会话多轮、可 `interrupt()`/`setPermissionMode()`。`pathToClaudeCodeExecutable` 指向本机 claude（设置留空则登录 shell `command -v claude` 自动探测；**必传**，否则 SDK 走未随包打包的原生二进制解析会失败）。`env` 用登录 shell 捞回（GUI 启动的 Obsidian 拿不到 `~/.zshrc` 的 `ANTHROPIC_*`）。`settingSources:["user","project","local"]` → 加载库的 CLAUDE.md/.claude。事件分发：system/init、`stream_event`(text/thinking 增量)、assistant(text/tool_use)、user(tool_result)、result。`stderr` 回传以便诊断启动失败。
- **权限审批 UI**（完整 Claudian 式）：`canUseTool` 回调把每次工具调用挂起 → `panel.askPermission` 渲染审批卡片（允许 / 允许并记住[用 SDK suggestions] / 拒绝），await 用户决定。面板顶部「权限」下拉可切 `default`(每次问) / `acceptEdits` / `plan`(只读) / `bypassPermissions`(危险)，运行中切换走 `setPermissionMode`。
- **语音 I/O**（`src/jarvis/voiceio.ts`）：`StreamTts` 边收文本增量边按句（。！？;\n）切分入队朗读——首句生成完即开口，不等全文；复用三引擎 system/elevenlabs/aliyun（沿用旧设置项）。`MicStt` 用 WebSpeech（`jarvisSttEngine=webspeech` 默认，`off` 关闭），开口说完 final 结果自动发送。
- **设置**：`jarvisClaudeBin`(留空自动) / `jarvisModel`(留空 CLI 默认) / `jarvisPermissionMode` / `jarvisSttEngine` / `jarvisSttLang`。TTS 仍用既有 `ttsEngine`/嗓音/语速/音调项。
- **历史包体**：v1 曾为 851K；屈原 v2 融合完整工作台后当前生产包约 2.93MB，换取真实的会话编排、MCP、子智能体、diff 与多 Provider 能力。

## 规划 · 多通道执行链路对齐 Claudian

详细技术方案见 [`docs/multi-channel-execution.md`](docs/multi-channel-execution.md)（2026-06-28，P0–P5 全部落地）。

## 命令

`npm install` → `npm run licenses:generate`（仅依赖变化时）→ `npm run build`。构建会先执行许可证审计，清单过期或商业元数据回退时直接失败。商业交付包必须同时包含 `main.js`、`manifest.json`、`styles.css`、`LICENSE`、`THIRD-PARTY-NOTICES.md`、`THIRD-PARTY-LICENSES.txt`、`MaShanZheng-Regular.ttf`、`MaShanZheng-OFL.txt`、`TALOS-Favicon-64-v1.png`。
