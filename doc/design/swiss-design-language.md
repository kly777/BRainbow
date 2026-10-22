# 瑞士设计语言（Swiss · 国际主义）

> 状态：提案（未合入 main） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22
>
> 本文是 `design/swiss` 分支的视觉规格，**未合入 main**；main 的当前实现仍是 Hallmark 编辑风，
> 以 `web/src/shared/styles/tokens.css` 与 `web/src/app/global.css` 为准。
> 2026-10-02 的详细落地清单归档在
> [`archive/swiss-design-language-2026-10-02.md`](./archive/swiss-design-language-2026-10-02.md)。

## 0. 出发点

从"编辑风"（衬线标题 + 暖纸底 + 圆角投影 + 九个彩虹模块色）换成**国际主义排版风格**
（International Typographic Style，1950s 苏黎世/巴塞尔）：

| 来源 | 取用的一条 |
|---|---|
| Josef Müller-Brockmann《Grid Systems in Graphic Design》 | 网格是"看不见的胶水"：秩序来自模块与沟槽，不来自装饰 |
| Emil Ruder《Typographie》 | 空白是结构，不是剩下的地方；节奏 > 公式 |
| Massimo Vignelli《The Vignelli Canon》 | 一个家族、几个字号、一种信号色；"意图清晰才有结果清晰" |
| Jan Tschichold《Die neue Typographie》 | 不对称的秩序、齐左不齐右、用字重与字距而非换字体分层 |
| Karl Gerstner《Designing Programmes》 | 设计即程序：先定规则（令牌），再由规则生成页面 |
| IBM Carbon / 瑞士风网站实践 | 12 列网格 + 8px 基线在现代界面上的落地手法 |

这不是"性冷淡"：目标是**可信、精确、冷静**。判据一句话 ——
**把装饰全剥掉之后，网格还读得出来。**

## 1. 五条原则

1. **网格先于装饰**：同一套 12 列内容网格与间距节奏；间距只走 `--space-*`，不写裸值。
2. **字即界面**：一个无衬线家族（Inter）承担标题与正文，层级靠字号/字重/字距。
   微标签大写 + 字距 +0.08em；大标题负字距 −0.02em；数字 tabular-nums。
3. **强对比、零装饰**：白纸墨黑满对比；无投影、无渐变、无圆角；分区靠 1px 细规线。
   一屏只有**一个信号色**（目录绿），面积 ≤5%。
4. **反相表达状态**：当前/选中 = 墨底纸字反相块；层级 ink → ink-muted → ink-faint。
5. **客观克制**：动效 ≤220ms 直出，无弹跳、无演出型入场；图标线稿、跟随 currentColor。

## 2. 令牌规格

### 2.1 字

| 令牌 | 值 | 用途 |
|---|---|---|
| `--t-font-display` | Inter Variable + 中文面栈 | 标题（与 body 同族，只差字重/字距） |
| `--t-font-body` | Inter Variable + 三平台中文面 + 系统栈 | 正文与全站默认 |
| `--t-font-mono` | JetBrains Mono Variable | 代码 / kbd / **路径 / ID / 哈希** |
| `--t-font-numeric` | Inter + `tabular-nums` | 计数、统计、时长、日期列 |

- 已删：Fraunces（1.7M）、Noto Serif SC（6.3M ≈100 个 subset）。
- body 全局 `font-variant-numeric: tabular-nums`（数字等宽对齐是瑞士语音的一部分）。
- 中文面必须在栈里**点名**（否则 Windows 落回宋体）；拉丁面排在中文面之前是有意的。

### 2.2 色（两主题 + auto）

| 角色 | paper | midnight |
|---|---|---|
| bg / surface | `oklch(100% 0 0)` | `oklch(15% 0 0)` / `oklch(19% 0 0)` |
| surface-raised | `oklch(96.5% 0 0)` | `oklch(23% 0 0)` |
| ink / -muted / -faint | 18% / 42% / 58% | 94% / 74% / 56% |
| border / -strong | 88% / 72% | 30% / 44% |
| accent | `oklch(48% 0.09 165°)` 目录绿 | `oklch(72% 0.1 165°)` |

- 灰阶**中性无偏色**（旧世界的 260° 冷偏已去）。
- `ocean` 主题已删；`/color` 页保留主题与字号切换（paper / midnight / auto）。
- 语义色的阴影/描边/软底一律 `color-mix` 从实底派生；组件内禁止内联 oklch/hex。
- forced-colors / prefers-contrast 降级保留（tokens.css 后半段）。

### 2.3 模块识别色（`--m-*`）

9 个模块保留色相可辨，统一明度 + 彩度 ≤0.08，只作**刻度块/图标**小面积用：

| 令牌 | 色相 | 令牌 | 色相 |
|---|---|---|---|
| `--m-task` | = accent（165°） | `--m-bookmark` | 45° |
| `--m-card` | 160° | `--m-text` | 200° |
| `--m-mem` | 80° | `--m-image` | 330° |
| `--m-onto` | 255° | `--m-search` | 25° |
| `--m-chat` | 300° | | |

（bookmark 由 80° 转到 45°：低彩度下与 mem 的 80° 会趋同。）

### 2.4 形状与尺度

| 令牌 | 值 | 说明 |
|---|---|---|
| `--radius-*` | **全部 0**，`--radius-sm` = 2px（只给控件），`--radius-full` = 999px（状态点） | 零圆角世界 |
| `--shadow-*` | **none** | 边界用 `--ring-float`（`0 0 0 1px` 细环） |
| `--control-h-sm/md/lg` | 28 / 36 / 44 px | 控件三档；**同行同档**（几何门禁 `e2e/specs/control-heights.spec.ts`） |
| `--space-*` | 2/4/8/12/16/24/32/40 px | 间距唯一来源 |
| `--text-*` | 10/12/14/16/18/22/28/34 px | 字阶 |
| `--t-transition-*` | 90 / 140 / 220 ms，`cubic-bezier(0.2,0,0,1)` | 直出、无弹跳 |
| `--z-*` | sticky 10 → toast 2000 | 层级顺序即堆叠优先级 |

沿用不动：480/600/768/1024 断点、容器查询分工、`--page-*-max`、四类 a11y 降级、打印样式。

### 2.5 外壳令牌（阶段 2）

| 令牌 | 宽屏 | 中屏 | 窄屏 |
|---|---|---|---|
| `--shell-rail-w` | 11rem | 3.25rem（图标轨） | 0（抽屉） |
| `--shell-bar-h` | 顶栏高（含品牌字标 + ⌘K + 账户） | 同左 | 同左 |
| `--shell-status-h` | 底部状态条（mono） | 同左 | 同左 |

`<html data-shell="wide|compact|narrow">` 三档；`.content` 是**唯一滚动容器**。

### 2.6 旧值 → 令牌映射（清扫对照表）

| 旧世界 | 新世界 |
|---|---|
| Fraunces / Noto Serif SC | `--t-font-display` = Inter |
| `border-radius: 6px~1.5rem` | `0`（结构）/ `--radius-sm` 2px（控件） |
| `box-shadow: 0 1px 2px rgb(…/.06)` 等 | 删声明；要边界用 `--ring-float` 或 1px `--t-color-border` |
| `#faf7f2` 暖纸底 | `--t-color-bg`（纯白） |
| `oklch(… 260deg)` 冷灰 | `oklch(… 0 0)` 中性灰 |
| 9 个彩虹模块色（C≈0.15） | `--m-*`（C≤0.08，L 统一） |
| `transform: scale(0.97)` 按下 | 删（按下只改背景/描边） |
| `fade-in-up` / `fade-in-scale` | 删；需要时 `fade-in` ≤140ms |
| `!important` 装饰性使用 | 删（只留 print / reduced-motion 块级豁免） |

## 3. 八类页面模板

1. **列表页**：页头（唯一 h1 + mono 计数 + 操作，下缘 1px 规线）+ 筛选条 + 网格/表格 + 分页。
2. **详情页**：左主栏（≤`--page-text-max`）+ 右元信息栏（sticky、mono、栏间规线）。
3. **编辑台**：贴顶工具条 + 满宽编辑区；分栏用规线不用卡片。
4. **会话**：消息规线分组，角色/时间大写微标签，思考块灰底细框。
5. **查看器**：功能不改，只换包壳；PDF/3D/EPUB 懒加载不动。
6. **数据表**（db/admin）：无竖线、行底线、tabular、大写微标签表头。
7. **首页/落地页**：编号索引（01–08），hover 反相；海报式排版。
8. **浮层**：实心白/墨底 + 1px 环 + 反相选中行；无模糊无投影。

## 4. 验收清单

- [ ] 全站无圆角（`--radius-sm` 控件 2px 除外）、无投影、无渐变
- [ ] 只出现一个信号色（目录绿），单屏面积 ≤5%
- [ ] 同一行控件等高（几何门禁绿）
- [ ] 两主题 × 字号三档 × 200% 缩放 × forced-colors / reduced-motion / 打印
- [ ] 微标签大写 + 字距；大标题负字距；数字列 tabular
- [ ] 首屏 180KB 警戒线内；字体包净减
- [ ] 33 页清单逐页按三视口截图审阅（`AUDIT=1 pnpm exec playwright test design-audit`）

## 5. 参考

**书**
- Josef Müller-Brockmann, *Grid Systems in Graphic Design*（网格/模块/沟槽）
- Emil Ruder, *Typographie*（空白、节奏、齐左不齐右）
- Massimo Vignelli, *The Vignelli Canon*（少字族、语义色、清晰意图）
- Jan Tschichold, *Die neue Typographie*（不对称秩序、字重分层）
- Karl Gerstner, *Designing Programmes*（设计即程序 → 设计令牌）
- Armin Hofmann, *Graphic Design Manual*（对比与化简）

**在线**
- IBM Carbon Design System 的 2x Grid（12 列 + 8px 基线在界面上的落地）
- LibreTexts《International Typographic Style》概述（学派分野：苏黎世 vs 巴塞尔）
- MDN `font-variant-numeric`（tabular-nums 与 lining-nums）
- On Web Typography（Jason Santa Maria，版式度量的工程化）
