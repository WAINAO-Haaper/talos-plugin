# TALOS 页级 Panel 皮肤系统（Panel Skins）

> 2026-07-20 落地。把像素小人「场景皮肤」的思路推广到面板层：
> 每个业务页的 panel 获得与页面气质一致的图形符 + 底纹 + 招牌细节，
> 与小人场景互为呼应。总览页不动（已有独立打磨）。

## 机制（三个挂载点，全部纯 CSS）

1. **图形符** — `.section-title::before` 原本是统一的呼吸圆点，逐页覆盖为
   像素图形（`clip-path` / 渐变画法，不用 transform，与 `tl-pulse` 的
   opacity 呼吸兼容）。主题级覆盖（cosmos/system-classic 等）一律被
   页级作用域压过（specificity (0,3,1) + 文件末尾位置）。
2. **底纹** — `.panel:not(.module-hero):not(.banner)::after` 叠加层，
   `z-index:-1`：压在面板自身背景之上、文字内容之下
   （panel 的 backdrop-filter 保证其留在面板层叠上下文内）。
   颜色一律 `var(--ac)`（每个 panel 自带行内 --ac）+ `color-mix` 透明度，
   跟随主题自动换色。
3. **招牌细节** — 每页至多一处（本期仅 projects P0 卡警示带）。

## 逐页设计

| 页 | 图形符 | 底纹 | 呼应的小人场景 |
|---|---|---|---|
| daily 每日执行 | 表盘（圆环+双针） | 底部时间刻度尺 | 通勤者 / 里程碑旗 |
| inbox 收件箱 | 邮戳菱形 | 左缘分拣虚线 | 搬运工 / 包裹 |
| health 系统健康 | 医疗十字 | 监护仪扫描线 | 心电脉冲 |
| talos TALOS 产品 | 闸栅三道杠 | 工程蓝图网格 | 闸门守卫 |
| output 输出作战室 | 火箭三角 | 左缘发射架警示纹 | 发射指挥 |
| projects 项目场景 | 警示斜纹块 | 工地浅斜纹 + P0 卡警示带 | 工地巡视 |
| knowledge 知识枢纽 | 四角星 | 星图散点 | 星图园丁 |
| vault 全库视图 | 雷达扇面 | 右下同心雷达环 | 雷达守夜人 |
| identity 身份上下文 | 镜像半圆 | 镜面斜光 | 镜厅 |
| capability 能力中心 | 插孔环 | 底部端口点阵 | 接线员 |

## 纪律（沿用 pixel-bot-system.md §3）

- 装饰不改布局：只加 `::before/::after` 与 background 层，无需断点重申；
- 不盖 `.panel::before` 顶部渐变线（全站统一识别元素）；
- module-hero / banner 不参与底纹（hero 已有小人舞台与主题处理）；
- reduced-motion：图形符呼吸关闭，底纹本为静态；
- 每页底纹 opacity ≤ .8 且为单色低饱和，保证「专业克制」。
