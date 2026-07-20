# TALOS 标准化方案

> 目标：把「外脑玩家 Haaper 的超级大脑」从**一个人的笔记本**，抽象成**任何人都能装、都能用的产品**。
> 本轮只做标准化，不动定价、不做新插件。
> 生成日期：2026-07-14

---

## 一、一句话诊断

现在的 TALOS 不是「产品 + 你的数据」，而是「产品和你的数据焊死在一起」。
插件的渲染、统计、导航、人格四条链路里，都直接写死了**你个人的库结构**（超级大脑六目录 + TALOS 七分区 + 灵魂/Identity 身份层）。

最致命的一点：**没有可交付的空白库。**
`src/quyuan/persona-context.ts` 里 `QUYUAN_REQUIRED_CONTEXT` 强制要求这三个文件存在，否则屈原直接抛 `QuyuanSoulBootstrapError` 启动失败：

```
灵魂/PERSONA.md
灵魂/persona-memory.md
Identity/CONTEXT.md
```

客户装了插件 → 打开 → 没有这些文件 → 系统跑不起来。
所以标准化不是「删掉你的名字」这么简单，而是要**造出一个客户能直接落地的空白标准库**。

---

## 二、标准化的核心原则：一刀切成两层

把当前仓库里的一切，强制归到两个互不重叠的层。这条边界是整个标准化的地基。

| | 产品层（交付给客户） | 个人层（你私有，永不进交付包） |
|---|---|---|
| 是什么 | TALOS 引擎：插件代码 + 库的**规范** + 空白模板 + 初始化向导 | 你的超级大脑：真实的项目、洞察、素材、你的人格记忆 |
| 举例 | 「库里应该有一个收件箱目录」这条**规则** | 你收件箱里那 9 条真实笔记 |
| 举例 | 「屈原需要读一份人格文件」这条**约定** | 你 `灵魂/PERSONA.md` 里写的你自己 |
| 判断标准 | 换个人用，这东西**不用改** | 换个人用，这东西**必须换掉** |

**标准化 = 把产品层从个人层里剥出来，个人层的一切要么删除、要么替换成空占位。**

---

## 三、四类 footprint 与逐类处理决策

扫描全库后，个人化痕迹分成四类。处理方式完全不同，别一把梭。

### A 类 · 架构骨架（保留，但要「提纯」）

六目录体系、TALOS 七分区、身份层三件套——这些**结构本身**是你的产品价值，不是个人数据。问题是它们现在以**裸字面量**散落在代码各处。

- 现状：`view.ts` 85 处、`navigation.ts` 20 处、`stats.ts` 9 处直接写死中文目录名。
- 决策：**保留结构，但收敛到唯一真源。** 新建一个 `src/data/schema.ts`（或 `talos.schema.json`），把「标准库长什么样」定义成一份 Schema；render/nav/stats 全部从 Schema 取，不再各写各的。
- 收益：以后改结构只改一个文件；也是给客户的「标准库规范说明书」。

### B 类 · 可配置路径（默认值中性化）

`settings.ts` 的 `DEFAULT_SETTINGS` 里这 8 项路径其实**已经是配置项**，用户能在设置页改。问题只是默认值是你的私人结构。

```
inboxFolder: "00-收件箱"
dailyFolder: "01-日志"
tasksPath: "System/working-memory/tasks.md"
talosTasksPath: "04-项目/TALOS系统/tasks.md"   ← 这条是纯个人的，见 D 类
pendingApprovalsPath / candidatesPath / healthLogPath / reportsFolder
```

- 决策：默认值保持与**标准库模板**（见第四节）一致即可，配置项全部保留。
- 唯一要处理的：`talosTasksPath` 指向「你的 TALOS 产品项目」，这是个人数据，改成中性示例或留空。

### C 类 · 硬编码字面量（全部收编进 A 的 Schema）

这是工作量最大的一块，也是「个人标签太明显」的主因。散落在渲染层的具体文件路径：

```
"04-项目/TALOS系统/_README.md"
"输出/统一出口.md"
"输出/运营/运营候选池.md"
"Identity/CONTEXT.md"
"灵魂/PERSONA.md"
"02-洞察/MOC/_README.md"
...（view.ts 内 ~85 处）
```

- 决策：不允许再出现裸路径字面量。全部改成引用 A 类 Schema / B 类 settings 里的键。
- 做法：一处一处替换 `"04-项目/TALOS系统"` → `schema.product.root` 这种取值。
- 风险控制：这块动 render 层，容易改坏。**建议最后做，且做完跑一遍现有 selftest / vitest。**

### D 类 · 纯个人残留（删除或换占位）

这些是「你」本身，产品层完全不该有：

| 位置 | 内容 | 处理 |
|---|---|---|
| `persona.ts` `DEFAULT_PERSONA` | "你是屈原，外脑玩家 Haaper 的知识伙伴…" | 改成中性："你是屈原，用户的知识伙伴与战略参谋…"，名字由用户库里的 PERSONA.md 提供 |
| `settings.ts` `freezeStartDate` | `"2026-06-19"` | 改成空串或安装当天 |
| `settings.ts` `eyebrow` | `"超级大脑 · CONTEXT OS"` | 保留（这是产品名，非个人）或让用户可改 |
| `README.md` 第 23 行 | 校验值 `合计 741（项目143/素材314…）` | 删掉具体数字，改成「统计口径说明」 |
| `CHANGELOG.md` / 测试夹具 / `approval-actions.selftest.mjs` | 出现 Haaper / 个人库真实内容 | 测试夹具换成通用假数据；CHANGELOG 是历史记录，可保留但新版本起用中性措辞 |
| `manifest.json` `author` | "外脑玩家 Haaper" | 这是作者署名，**保留**（这是你的身份，不是客户数据） |
| `prototype/` 内含个人内容的 QA 图/HTML | 私人调试产物 | 不进交付包（`.gitignore` 或单独目录） |

---

## 四、必须新建：TALOS 标准库模板（补上致命缺口）

这是本次标准化的**头号交付物**，没有它插件就是空壳。

新建一个可随插件分发的空白骨架 `TALOS-Vault-Template/`，客户拿到后直接作为 Obsidian 库打开，或用初始化向导生成。它包含：

```
TALOS-Vault-Template/
├── 00-收件箱/_README.md          # 说明这个目录干什么，0 条真实笔记
├── 01-日志/_README.md
├── 02-洞察/_README.md
│   └── MOC/_README.md
├── 03-素材/_README.md
├── 04-项目/_README.md
├── 05-归档/_README.md
├── 输出/统一出口.md（空模板）
│   └── 运营/运营候选池.md（空模板）
├── System/
│   ├── working-memory/
│   │   ├── tasks.md              # 只有空的焦点区骨架
│   │   ├── candidates.md
│   │   └── health-log.md         # 空 EVAL_HISTORY
│   ├── pending-approvals.md
│   └── reports/
├── Identity/
│   └── CONTEXT.md                # 占位：「（在这里写你是谁、你的目标）」
└── 灵魂/
    ├── PERSONA.md                # 占位：屈原默认人格 + 「（补充你希望它怎么了解你）」
    └── persona-memory.md         # 空
```

原则：**结构齐全、内容全空。** 每个 `_README.md` 讲清楚「这个目录放什么、怎么用」，但不含任何你的真实数据。身份层三件套给占位模板，保证屈原能启动、又不泄露你。

---

## 五、初始化向导（让空库跑起来）

有了模板还不够，得让不懂技术的客户能一键落地。在插件里加一个首次启动流程：

1. 检测当前库是否符合 Schema（缺哪些目录/文件）。
2. 缺失时，提供「一键生成标准骨架」按钮，把第四节的模板写进当前库。
3. 引导用户填最小信息：昵称、一句话自我介绍 → 写进 `Identity/CONTEXT.md` 和 `灵魂/PERSONA.md` 占位。
4. 校验通过 → 屈原可启动 → 进控制台。

这一步把「客户必须懂你的目录约定」变成「跟着向导点几下」，是产品化的分水岭。

---

## 六、执行路径（分四期，按风险从低到高）

| 期 | 做什么 | 涉及文件 | 风险 |
|---|---|---|---|
| **P0** | 抽 Schema：新建 `schema.ts`，把标准库结构定义成唯一真源 | 新增 1 文件 | 低（纯新增） |
| **P1** | 造空白模板库 `TALOS-Vault-Template/` + 各 `_README` + 身份层占位 | 新增目录 | 低（不碰代码） |
| **P2** | D 类清残留：`DEFAULT_PERSONA`、`freezeStartDate`、README 数字、测试夹具去个人化 | persona.ts / settings.ts / README / tests | 中 |
| **P3** | C 类大重构：view.ts/navigation.ts/stats.ts 裸路径全部改引用 Schema；加初始化向导 | view.ts 等 render 层 | 高（改完必须跑 selftest + vitest） |

建议顺序 P0 → P1 → P2 → P3。P0/P1 能立刻拿到「可交付的空库 + 规范」，先解决产品缺口；P3 最脏最险，放最后并用测试兜底。

---

## 七、验收标准（怎么算「标准化完成」）

1. 把仓库 clone 到一个**全新的空 Obsidian 库**，跟着初始化向导走，屈原能正常启动、控制台能渲染。
2. 全库 grep 不到 `Haaper`、`2026-06-19`、`741` 等个人字面量（`manifest.json` 作者署名与 CHANGELOG 历史除外）。
3. 所有目录路径只来自 `schema.ts` 或 `settings.ts`，`view.ts` 里没有裸中文路径字面量。
4. 你自己的超级大脑真实数据，一条都不在交付包里。

---

## 附：本方案未覆盖（下一轮再做）

- 统一定价（你已选择本轮不做）
- 基于 Obsidian 的新智能体 / 新操作面板插件
- 这两项都应在标准化完成、产品边界清晰**之后**再启动——否则会在移动靶上定价、在没标准化的地基上盖新楼。
