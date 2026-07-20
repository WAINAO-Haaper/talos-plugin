# TALOS × Obsidian CSS 落地建议

> 本文档把 `MASTER.md` 的设计系统转译为 **Obsidian community plugin 可用的原生 CSS token 方案**。
> 约束：无框架、无 Tailwind、样式集中在 `styles.css` / `styles.talos.css`；必须兼容 Obsidian 明暗主题。
> 本文件仅为建议文档，不改动插件源码；落地时由开发任务自行摘取。

---

## 1. 核心原则：不发明颜色，优先映射 Obsidian 变量

TALOS 是宿主在 Obsidian 里的视图，**底色、文字、边框必须跟随用户主题**，否则明暗主题下必有一边翻车。
MASTER.md 的 Slate/Green 暗色板只用于：

1. 作为 `var()` 的 **fallback 值**（Obsidian 变量缺失时兜底）；
2. 定义 TALOS 特有的**语义状态色**（健康/警告/危险/闸门状态），这部分 Obsidian 没有现成对应。

所有 token 以 `--talos-` 为前缀，作用域限定在视图容器 `.talos-view`（或实际 ItemView 根 class）内，**不污染全局**。

---

## 2. Token 映射表（MASTER → Obsidian）

| MASTER token | 用途 | Obsidian 映射（首选） | Fallback |
|---|---|---|---|
| `--color-background` | 视图底色 | `--background-primary` | `#0F172A` |
| —（卡片底） | 卡片/面板 | `--background-secondary` | `#1B2336` |
| —（卡片悬浮底） | hover/嵌入区 | `--background-modifier-hover` | `#272F42` |
| `--color-muted` | 弱化区块 | `--background-modifier-cover` | `#272F42` |
| `--color-foreground` | 正文 | `--text-normal` | `#F8FAFC` |
| — | 次要文字（标签、单位） | `--text-muted` | `#94A3B8` |
| — | 极弱文字（时间戳、说明） | `--text-faint` | `#64748B` |
| `--color-border` | 卡片边框、分隔线 | `--background-modifier-border` | `#475569` |
| `--color-accent` | 强调/运行中/健康 | `--interactive-accent` | `#22C55E` |
| `--color-destructive` | 危险/冻结/失败 | `--color-red`（Obsidian 内置） | `#EF4444` |
| — | 警告/待审批 | `--color-yellow`（Obsidian 内置） | `#EAB308` |
| — | 成功/通过闸门 | `--color-green`（Obsidian 内置） | `#22C55E` |
| — | 信息/链接 | `--text-accent` | `#60A5FA` |
| `--color-ring` | focus 环 | `--background-modifier-border-focus` | `#1E293B` |

> 要点：`--interactive-accent` 会被用户主题覆盖（很多人改成紫色/蓝色），
> 因此**语义状态（健康绿、审批黄、冻结红）不要用 `--interactive-accent`**，
> 固定用 `--color-green/yellow/red` 或 TALOS 自定义状态色，保证语义稳定。

---

## 3. 建议的 tokens.css 骨架（可直接摘入 styles.talos.css）

```css
/* ============================================================
   TALOS Design Tokens — 作用域：.talos-view
   原则：映射 Obsidian 变量 + MASTER.md fallback；明暗主题自适应
   ============================================================ */

.talos-view {
  /* --- 表面层级（跟随 Obsidian 主题） --- */
  --talos-bg:            var(--background-primary, #0F172A);
  --talos-surface:       var(--background-secondary, #1B2336);
  --talos-surface-hover: var(--background-modifier-hover, #272F42);
  --talos-border:        var(--background-modifier-border, #475569);

  /* --- 文字层级 --- */
  --talos-text:          var(--text-normal, #F8FAFC);
  --talos-text-muted:    var(--text-muted, #94A3B8);
  --talos-text-faint:    var(--text-faint, #64748B);

  /* --- 语义状态色（双主题安全，见 §4 校验值） --- */
  --talos-status-ok:     var(--color-green, #22C55E);   /* 健康 / 闸门通过 / 运行中 */
  --talos-status-warn:   var(--color-yellow, #EAB308);  /* 待审批 / 偏好候选 */
  --talos-status-danger: var(--color-red, #EF4444);     /* 冻结 / 失败 / 超期 */
  --talos-status-info:   var(--text-accent, #60A5FA);   /* 收件箱 / 中性高亮 */

  /* --- 间距（density 8/10，高密度仪表盘刻度） --- */
  --talos-space-xs: 2px;
  --talos-space-sm: 4px;
  --talos-space-md: 8px;
  --talos-space-lg: 12px;
  --talos-space-xl: 16px;
  --talos-space-2xl: 24px;
  --talos-space-3xl: 32px;

  /* --- 字体 --- */
  --talos-font-ui:   var(--font-interface, Inter, sans-serif);
  --talos-font-mono: var(--font-monospace, "JetBrains Mono", monospace);

  /* --- 尺寸刻度（高密度） --- */
  --talos-text-xs:  var(--font-ui-smaller, 11px);  /* 标签、时间戳 */
  --talos-text-sm:  var(--font-ui-small, 12px);    /* 次要信息 */
  --talos-text-md:  var(--font-ui-medium, 14px);   /* 正文 */
  --talos-kpi-size: 22px;                          /* 大数字 KPI */

  /* --- 圆角 / 阴影 / 动效 --- */
  --talos-radius-sm: 4px;
  --talos-radius-md: 8px;
  --talos-radius-lg: 12px;
  --talos-shadow-card: 0 4px 6px rgba(0, 0, 0, 0.1);
  --talos-shadow-lift: 0 10px 15px rgba(0, 0, 0, 0.12);
  --talos-ease: cubic-bezier(0.16, 1, 0.3, 1);      /* MASTER: Expo.out */
  --talos-duration: 200ms;
}
```

---

## 4. 明暗主题校验

映射 Obsidian 变量的部分天然双主题成立（Obsidian 自己切值）。需要人工校验的只有**语义状态色**，MASTER 推荐值在两种底色上的对比度：

| 状态色 | 深色底 `#0F172A` | 浅色底 `#FFFFFF` | 结论 |
|---|---|---|---|
| 绿 `#22C55E` | 7.4:1 ✅ | 2.3:1 ⚠️ | 浅色下仅作图形/图标色，文字需加深 |
| 黄 `#EAB308` | 8.5:1 ✅ | 2.0:1 ⚠️ | 同上 |
| 红 `#EF4444` | 4.8:1 ✅ | 3.9:1 ⚠️ | 同上 |
| 蓝 `#60A5FA` | 5.9:1 ✅ | 3.0:1 ⚠️ | 同上 |

**结论与对策：**

1. 状态色用于**小圆点、图标、sparkline 线条、进度条**时，直接用 token，双主题都成立；
2. 状态色用于**文字**（如「冻结 3 天」的红色数字）时，用 `color-mix` 自动压深/提亮，或提供浅色主题覆盖：

```css
/* 状态文字：相对底色自动调和，明暗皆可达标 */
.talos-view .talos-status-text-danger {
  color: color-mix(in srgb, var(--talos-status-danger) 70%, var(--talos-text));
}
```

> `color-mix` 在 Obsidian 内嵌 Chromium 中可用（≥ v1.4）。若需兼容更老版本，退回 `.theme-dark / .theme-light` 双写覆盖。

---

## 5. 组件级落地速查

对应项目 UI 模块（统计卡片、计数、健康分趋势、今日焦点、作战室闸门）：

### 统计卡片（知识笔记 / 收件箱 / 待审批 / 偏好候选）

```css
.talos-stat-card {
  background: var(--talos-surface);
  border: 1px solid var(--talos-border);
  border-radius: var(--talos-radius-md);
  padding: var(--talos-space-lg);          /* 12px，密度 8 */
  box-shadow: var(--talos-shadow-card);
  transition: box-shadow var(--talos-duration) var(--talos-ease);
}
.talos-stat-card:hover { box-shadow: var(--talos-shadow-lift); }  /* 不用 transform，避免布局位移 */

.talos-stat-card__value {
  font-family: var(--talos-font-mono);      /* 数字用等宽，对齐跳变不抖 */
  font-size: var(--talos-kpi-size);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.talos-stat-card__label {
  font-size: var(--talos-text-xs);
  color: var(--talos-text-muted);
}
```

- 待审批 → 左侧 3px `--talos-status-warn` 边条；偏好候选 → `--talos-status-info`。**颜色 + 图标/文字双编码**（UX 规则：不得仅靠颜色传达信息）。

### 健康分趋势（最近 9 点 sparkline）

- 9 个点 < 1000，**纯内联 SVG polyline 即可，零依赖**（符合最小依赖约束）；
- 线条用 `--talos-status-ok`（语义=健康），不随用户 accent 漂移；
- 当前分以大字 KPI 文本呈现（图表 a11y 规则：当前值必须文本可见）；
- 提供 `aria-label="健康分趋势：最近9次评分为 …"`，屏幕阅读器可读数值序列。

```css
.talos-sparkline polyline {
  stroke: var(--talos-status-ok);
  stroke-width: 1.5;
  fill: none;
}
.talos-sparkline .talos-sparkline__last {
  fill: var(--talos-status-ok);  /* 末端圆点标记当前值（形状+颜色双编码） */
}
```

### 今日焦点任务列表

- 复用 Obsidian 原生交互色：hover 行 `var(--talos-surface-hover)`；
- 每行最小高度 28px（视图内密度优先；若条目可点，点击热区仍建议 ≥ 32px）；
- checkbox 直接用 Obsidian 原生样式变量，不自定义。

### 发布作战室（G1/G2/G3 闸门 + 发布数 / 冻结天数）

- 闸门进度 → **Bullet/进度条混合**：三段轨道 `--talos-surface-hover`，已过闸门段 `--talos-status-ok`，当前闸门段 `--talos-status-info`，未达段留空；每段必须有文字标签（G1/G2/G3），不靠颜色区分；
- 冻结天数 > 0 → `--talos-status-danger` + 文字；发布数 → 等宽 KPI 数字，同统计卡片。

---

## 6. 动效（motion 3/10，克制）

```css
/* 只动 opacity / box-shadow / border-color；不动 width/height/transform-scale */
.talos-view * {
  transition-property: color, background-color, border-color, box-shadow, opacity;
  transition-duration: var(--talos-duration);
  transition-timing-function: var(--talos-ease);
}

@media (prefers-reduced-motion: reduce) {
  .talos-view * { transition: none !important; }
}
```

- 数据刷新时数字变化可做 200ms opacity 淡入，**不做计数滚动动画**（控制台气质 + reduced-motion 友好）；
- GSAP 不引入：Obsidian 插件零新增依赖约束下，纯 CSS transition 足够覆盖 subtle 档位。

---

## 7. 落地检查清单（交付前）

- [ ] 所有颜色均经 `var(--talos-*)`，组件内无裸 hex
- [ ] `--talos-*` 全部有 Obsidian 变量映射 + fallback
- [ ] `.theme-dark` 与 `.theme-light` 下各截图核对一次（重点：状态色文字对比度）
- [ ] 状态信息均为「颜色 + 图标/文字」双编码
- [ ] KPI 数字 `font-variant-numeric: tabular-nums` + 等宽字体
- [ ] 可点元素 `cursor: pointer`，focus 可见（focus 环用 `--background-modifier-border-focus`）
- [ ] `prefers-reduced-motion` 下无过渡动画
- [ ] sparkline 当前值有文本形式，SVG 有 `aria-label`

---

## 8. 落地实录（2026-07-19，与本文档 §3 的偏差决策）

首次落地时发现 `styles.talos.css` 已是 8900+ 行的 Aurora Edition 成品（7 套主题、
完善的 reduced-motion / focus-visible 覆盖、`docs/design-qa.md` 治理流程），
§3 的「全新 tokens 骨架」假设不成立。经评估采取**桥接而非替换**：

1. **双 token 系统不可并存** —— 不新建独立的 `--talos-*` 值体系，而是在
   `styles.talos.css` 头部加桥接层：`--talos-*` 逐一指向 Aurora 现有 token
   （`--bg/--ink/--green/…`），fallback 链为 `Aurora token → Obsidian 变量 → MASTER hex`。
   各主题覆盖上游 token 时桥接层自动跟随，语义状态色同时挂住 Obsidian 内置
   `--color-green/yellow/red` 兜底。
2. **强制深色是产品决策，非缺陷** —— Aurora 刻意 `color-scheme: dark` + 固定深色底，
   「明暗主题都成立」的要求由多主题体系（含 Soft Relief、Geometric Modernism 等
   浅色主题）承担，不改动 Aurora 的深色身份。
3. **新组件规范** —— 今后新增的 UI 模块一律引用 `--talos-*`，不再直接使用
   `--bg/--ink` 等主题私有 token，保证设计系统是唯一入口。
4. **本次实际改动**（`styles.talos.css`，build + lint 通过）：
   - 头部新增 `--talos-*` 桥接层（表面/文字/状态色/字体/动效五组）
   - KPI 数字类（`.stat b .score .quick-value .big .bn .countdown b`）补
     `font-variant-numeric: tabular-nums`，刷新时数字不抖动
   - reduced-motion / focus-visible 经核查已有完善覆盖，未重复添加

### Module Hero 比例重构（2026-07-20，追加）

全页共用的 `.module-hero`（主卡 + 统计副卡）原呈长条状、文字层级平。
重构决策（`styles.talos.css` 尾部等 specificity 后置覆盖）：

1. **统计副卡**：2 列折行 → `repeat(auto-fit,minmax(150px,1fr))` 单行方卡，
   min-height 132px，与主卡 stretch 对齐；
2. **数字即重点**：`.module-hero-stat b` 22px → 32px / 700 / `var(--stat-ac)` 状态色，
   label 11px 克制、说明 10.5px 弱化，形成「标签 < 说明 < 数字」三级层级；
3. **主卡**：标题 24→26px，描述 13→12.5px 且 `max-width: 62ch` 收敛，不与数字抢层级；
4. **断点陷阱记录**：后置覆盖会在媒体查询之后生效，移动端（≤680px）必须在本覆盖段内
   重申小尺寸（数字 24px、单列、min-height 76px），否则大尺寸会穿透到窄屏。

### Hero 三区布局定型 + 场景批次 2（2026-07-20，追加）

1. **三区 hero**（实机反馈迭代）：主卡 `grid-row:1/3` 跨两行为绝对主角；
   操作按钮右上、统计副卡右下再缩小（88px / 数字 20px / 标签 10px）；
   小人舞台 `grid-row:3` 全宽页脚化，负 margin 抵消 panel padding 贴下边框。
   1100px / 680px 两个断点已在追加段内重申（见上方「断点陷阱」）。
2. **场景批次 2**（health / talos / output，详见 `pixel-bot-system.md`）：
   - health 心电监护：5 脉冲条依次点亮模拟 ECG；`data-scene-tone="hurt"`
     （健康分 <90）→ 创可贴 + 弹跳步频减半；`data-scene-glitch`（断链 >0）→ 纸带毛刺；
   - talos 闸门守卫：闸门按 `warRoom.gates` 状态三态（is-open 绿灯常开 /
     is-now 闪烁 / is-blocked 红灯），`--scene-progress` 语义 = 当前闸门前站位；
   - output 发射指挥：待发队列 = cap 5 排队火箭；`published` 增加时队首火箭
     一次性升空（DOM 每渲染重建，animation 天然只播一次，无需 JS 复位）；
     `stopTriggered` → `data-scene-tone="hot"` 红灯 + 停止牌 + 小人静止。
3. **新坑记录**：`--scene-progress` 语义按页不同（daily=时间进度、talos=闸门站位），
   `syncPixelScene` 必须按 `activePage` 分支写入，不能无条件统一赋值。

### 页级 panel 皮肤系统（2026-07-20，追加）

场景皮肤思路推广到面板层（详见 `panel-skins.md`）：每页一个
`section-title::before` 像素图形符 + `.panel::after` 底纹叠加层
（`z-index:-1` 隔层技法：压面板背景、让文字）+ 至多一处招牌细节。
关键决策：底纹不动 `.panel` 自身 background（主题渐变可能被页级规则
压过），一律走 ::after 叠加层；图形符画法避免 transform（与 tl-pulse
的 opacity 呼吸共存）。
