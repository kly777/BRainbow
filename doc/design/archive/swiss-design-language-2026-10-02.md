# 瑞士风格设计语言（BRainbow 前端视觉规格）

> 状态：已取代（归档） · 取代者：[`swiss-design-language.md`](../swiss-design-language.md)（提案，未合入 main） · 归档日期：2026-10-22
>
> 归档快照（2026-10-02，来自 WSL `~/BRainbow`）：`design/swiss` 分支的详细规格与落地清单，
> 保留当时的页面清单与门禁；本文件不再维护，**不要当现状读**。
>
> 当时的定位：视觉语言的权威规格（`design/swiss` 分支）；令牌速查与映射规则见
> `doc/guides/design-tokens.md`，外壳结构契约见 `doc/guides/frontend.md`。它取代
> Hallmark「编辑风」，并作废 `design/kumo-skin` 路线。

## 0. 一句话

**国际主义/瑞士风格**：白纸墨黑的强对比、一个无衬线家族、裸网格与细规线、零装饰
（无投影、无渐变、无圆角）、一个信号色（目录绿）、反相表达状态。

## 1. 五条原则

1. **网格先于装饰**：所有页面落在同一套 12 列内容网格与间距节奏上；间距只走
   `--space-*` 档位，不写裸值。分区靠规线，不靠卡片、底色或留白猜。
2. **字即界面**：一个无衬线家族（Inter）承担全部层级 —— 字号、字重、字距是唯一的
   层级手段。大标题负字距（−0.02em）、重字重（600/700）；微标签小字号 + 大写字距
   （+0.08em，中文无大小写、靠字距与颜色区分）；数字一律 tabular。
3. **强对比、零装饰**：白纸墨黑满对比；**无投影**（`--shadow-*` 全为 `none`）、
   **无渐变**、**无圆角**（结构直角；控件 2px 倒角；圆只给状态点/胶囊）。浮层边界
   用 1px 环（`--ring-float`）。一屏一个信号色，面积 ≤5%。
4. **反相表达状态**：「当前 / 选中」= 墨底纸字（浅色主题）/ 纸底墨字（暗色主题）的
   反相块，不用彩色描边、不用投影抬升。层级靠 ink → ink-muted → ink-faint 三阶。
5. **客观克制**：动效 ≤220ms 直出（90/140/220），无弹跳、无演出型入场；图标是线稿
   （`@components/ui/icons`，currentColor），克制使用 —— 有字就别加图标。

## 2. 令牌规格（单一事实源：`shared/styles/tokens.css` + `app/global.css`）

### 2.1 字体（三档角色）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--t-font-display` | `"Inter Variable", <中文系统栈>` | 标题（h1–h3 全局应用）。**等于 body**：强调靠字重与字距，不靠换字体 |
| `--t-font-body` | 同上 | 正文、界面文字 |
| `--t-font-mono` | `"JetBrains Mono Variable", ui-monospace, …` | 代码、kbd、路径、ID、结构标签 |
| `--t-font-numeric` | `"Inter Variable", …` + `font-variant-numeric: tabular-nums` | 数字读数（计数、统计、时长、日期列） |

- 自托管两款：`@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono`
  （CSP `font-src 'self'`，无外部 CDN）。Fraunces / Noto Serif SC 已删。
- 中文面：拉丁 Inter 在前、中文系统面（PingFang SC / Noto Sans SC / Microsoft YaHei）
  在后，混排各取各的（理由见 tokens.css 原注释，不改）。
- 全局在 `html` 上开 `font-variant-numeric: tabular-nums`：数字等宽对齐是瑞士语音的
  一部分（列表、表格、计数立刻对齐）。
- **等宽不做戏服**：mono 只出现在上面四类用途，散文一律 sans。

### 2.2 颜色

浅色主题 `paper`（白纸 · 目录绿）与暗色主题 `midnight`（墨黑 · 目录绿），
`auto` 跟随系统解析为其中之一（`resolveTheme`）。

| 令牌 | paper（白纸） | midnight（墨黑） |
|---|---|---|
| `--t-color-bg` | `oklch(100% 0 0)` 纯白 | `oklch(15% 0 0)` |
| `--t-color-surface` | `oklch(100% 0 0)` | `oklch(19% 0 0)` |
| `--t-color-surface-raised` | `oklch(96.5% 0 0)` 中性灰（hover 底 / 表头） | `oklch(23% 0 0)` |
| `--t-color-ink` | `oklch(18% 0 0)` | `oklch(94% 0 0)` |
| `--t-color-ink-strong` | `oklch(12% 0 0)` | `oklch(99% 0 0)` |
| `--t-color-ink-muted` | `oklch(42% 0 0)` | `oklch(72% 0 0)` |
| `--t-color-ink-faint` | `oklch(58% 0 0)` | `oklch(55% 0 0)` |
| `--t-color-border` | `oklch(88% 0 0)` 细规线 | `oklch(30% 0 0)` |
| `--t-color-border-strong` | `oklch(72% 0 0)` | `oklch(42% 0 0)` |
| `--t-color-accent` | `oklch(48% 0.09 165deg)` 目录绿 | `oklch(72% 0.1 165deg)` |
| `--t-color-accent-strong` | `oklch(40% 0.1 165deg)` | `oklch(80% 0.1 165deg)` |
| `--t-color-accent-soft` | `oklch(95% 0.03 165deg)` | `oklch(28% 0.03 165deg)` |
| `--t-color-on-solid` | `oklch(100% 0 0)` | `oklch(16% 0.02 165deg)` |

- 灰阶**中性无偏色**（旧 paper 的暖偏、midnight 的 260° 冷偏都去掉）。
- **信号绿（accent）的使用面**：链接、焦点环（`--t-ring-accent` / `:focus-visible`）、
  「当前」刻度、选中态、信息条。面积 ≤5%；「当前」优先用反相块而不是绿色块。
- `accent` 在白底上的对比度需 ≥4.5:1（实现时用浏览器工具核对，不足则压暗明度）。
- 徽章/语义色（danger/success/warning 与 5 个记忆状态徽章）保留语义，但**降彩度**：
  背景走 `color-mix` 软底或中性灰底，文字走实色，不再用大彩底。
- 阅读标注色（`--t-color-mark-*`）按同一口径降彩度，保持可辨。
- `--toast-*` 家族：白/墨底 + 1px 环 + 语义色刻度块（见 §4 浮层）。

### 2.3 模块识别色（收敛）

9 个 `--m-*` 保留色相可辨，但：**统一明度（浅底 48% / 暗底 68%）、彩度 ≤0.08**，
且只允许出现在**刻度块、图标、编号**这类小面积（≤1.5rem 见方）；不允许做卡片底色、
边框、大面积背景。相邻色相（mem 80° 与 bookmark 45°）在低彩度下趋同，按此微调保持可辨。

### 2.4 尺度（不随主题变）

| 类别 | 规格 |
|---|---|
| 圆角 | 结构 `0`；控件 `--radius-sm: 0.125rem`（2px）；`--radius-full` 只给状态点/胶囊。其余 `--radius-*` 名值暂设 `0`（过渡期），清扫后删除名字 |
| 阴影 | `--shadow-sm/md/lg/lv3` 全为 `none`；**浮层边界 = `--ring-float: 0 0 0 1px var(--t-color-border-strong)`**（强调用 `--ring-float-strong` 2px） |
| 控件高度 | `--control-h-sm: 1.75rem`(28) / `--control-h-md: 2.25rem`(36) / `--control-h-lg: 2.75rem`(44)。**同一行的控件必须同档**，由 `e2e/specs/control-heights.spec.ts` 几何审计钉住（同行高度差 >2px 即红） |
| 间距 | 只用 `--space-*`（2xs 2px → 3xl 40px）。网格沟槽 `--grid-gap: var(--space-xl)`（24px），窄屏 `--space-lg` |
| 页面容器 | `--page-max: 1440px`（工作台）/ `--page-text-max: 900px`（长文、会话）/ `--page-content-max: 760px` / `--page-narrow-max: 680px` |
| 内容网格 | 12 列（`repeat(12, 1fr)` + `--grid-gap`）；卡片网格/表格列数从容器查询派生 |
| 字阶 | `--text-2xs` 10px → `--text-3xl` 34px（沿用现值）；大标题（≥xl）字距 −0.02em、h3 起 −0.01em；微标签 uppercase + 字距 +0.08em + 500 字重 + `ink-muted` |
| 动效 | `--t-transition-fast: 90ms` / `normal: 140ms` / `slow: 220ms`，缓动统一 `cubic-bezier(0.2, 0, 0, 1)`；入场动画收敛到 ≤220ms；删「上浮」「缩放弹入」类演出（`fade-in-up` / `fade-in-scale`）；保留 `fade-in`、`slide-in-down`（微）、`skeleton-pulse`（功能性） |
| 层级 | `--z-*` 阶梯不动（sticky 10 / dropdown 100 / palette 200 / overlay 500 / modal 1000 / confirm 1100 / toast 2000） |
| 断点 | 480 / 600 / 768 / 1024，写法 `@media (width <= Npx)`；页面级用 `@media`、组件级用 `@container`（沿用现约定） |

### 2.5 外壳令牌

| 令牌 | 值 | 说明 |
|---|---|---|
| `--shell-rail-w` | `0`（默认）/ `11rem`（桌面）/ `3.25rem`（≤1024）/ `0`（≤768，抽屉） | 轨道宽，绑 `<html data-shell="on">` |
| `--shell-bar-h` | `2.75rem`（44px） | 顶栏高；与 `--control-h-lg` 同档 |
| `--shell-status-h` | `1.625rem`（26px） | 底部状态条（mono 小字）；≤768px 不显示 |

## 3. 共享组件规格（`components/ui`，阶段 1 落地）

| 组件 | 瑞士化要点 |
|---|---|
| `Button` | 三档高度；`primary` = 墨底纸字（hover 换 `ink-strong`，**无投影、无 scale**）；`secondary`/`outline` 视觉同源（surface 底 + 1px `border`，hover 底色 `surface-raised`）；`ghost` 无边框、hover 才出底色；`danger*`/`warning-solid` 降彩度实底；`icon` 方形 2px 倒角 |
| `Control`（Input/Select/Textarea） | 高度三档；1px `border` 直角 2px 倒角；focus = `--t-ring-accent`（沿用）；错误态 `danger` 边 + 文案 |
| `Badge` | 直角；细线边 + 文字色（软底 token 由 `color-mix` 派生），不用大彩底 |
| `Tooltip` / `InfoHint` | 反相小浮层（墨底纸字 / 暗底亮字）+ `--ring-float`；信息性不变 |
| `Modal` / `ConfirmModal` | 白/墨底 + `--ring-float` + 直角；遮罩 `--t-color-overlay`；关闭按钮沿用 Modal 自带 |
| `Toast` | 白/墨底 + 1px 环 + **语义色刻度块**（8×8px 方形色标）+ mono 错误码；不用左侧厚色边 |
| 表格（含 `db` 模块） | 无竖线；`thead` 微标签 + 下缘 1px `border-strong`；行底线 `border`；数字 tabular、右对齐 |
| `PageHead` | **可见大标题（唯一 h1）+ 计数（mono/`--t-font-numeric`）+ 右侧动作区**，下缘 1px 规线。页名只在正文出现一次；顶栏不复述页名 |
| `EmptyState` / `ErrorRetry` | 排版为主（标题 + 一句说明 + 一个动作），无插画、无彩底 |
| `Markdown`（`markdown.css`） | 正文 16px / 行高 1.7；标题无衬线重字重；引用块 = 1px 规线 + 灰底（不用厚色边）；代码块灰底直角；表格走表格规格 |

## 4. 八类页面模板

1. **列表页**（task / card / file / bookmark / memory-manage / reading / db…）：
   PageHead（大标题 + mono 计数 + 动作）→ 1px 规线 → 筛选/工具条（规线夹层，控件同档）
   → 内容网格（卡片）或表格 → 分页（mono 页码）。空态用排版 + 一个 CTA。
2. **详情页**（task/:id、file/:id、card/:id…）：左主栏（≤`--page-text-max`）+ 右元信息栏
   （sticky、mono 小字、栏间 1px 规线）；返回链接在最上方（BackLink）。
3. **编辑台**（card/edit、text、card/add、mem/add、reading/:id）：贴顶工具条（规线下缘）
   + 满宽编辑区；编辑/预览分栏用 1px 规线分隔，**不用卡片包**。
4. **会话**（chat / chat/mem / conversation）：消息以规线分组；角色/时间 = 大写微标签；
   正文走 `--page-text-max`；思考块 = 灰底细框；Composer 贴底、1px 上规线。
5. **查看器**（file viewers）：**功能与解析器不改**，只换包壳（工具条、边框、底色变量）；
   PDF / EPUB / 3D 懒加载约定不动（含 three 的 `await import`）。
6. **数据表**（db / admin）：§3 表格规格的样板间；筛选头行、排序箭头线稿化。
7. **首页 / 落地页**：编号索引 —— `01 任务`、`02 卡片`…（序号 mono + 名称 + 一句话），
   hover 反相；落地页按海报式排版（大字号标题 + 网格目录 + 规线）。
8. **浮层**（CommandPalette / QuickCapture / AuthDialog / AiSettingsModal）：实心白/墨底
   + 1px 环 + 直角；选中行 = 反相块；命令面板页脚 = 状态条（mono 快捷键）。

## 5. 验收清单

### 5.1 全局（每阶段收尾核对）

- [ ] `pnpm run check`（tsc + biome + stylelint）通过
- [ ] `pnpm run test` 通过（全量）
- [ ] `just e2e` 通过（含 `control-heights`）
- [ ] `AUDIT=1 pnpm exec playwright test design-audit` 生成三视口截图并逐页目检
- [ ] 双主题（paper / midnight）× 字号三档 × 200% 缩放无破版
- [ ] `forced-colors` / `prefers-contrast: more` / `prefers-reduced-motion` / 打印样式仍生效
- [ ] 键盘走查：Tab 顺序、`:focus-visible` 可见、Esc 关浮层、⌘K 开命令面板
- [ ] 无裸色值（`oklch()/hex/rgb()`）新增；无 `!important`；无投影/圆角新增

### 5.2 页面清单（33 条，随阶段勾选）

状态：`未动` → `已重做`（视觉落地）→ `已复核`（截图目检 + 键盘走查通过）

| # | 页面 | 路径 | 状态 |
|---|---|---|---|
| 1 | 主页（含落地页/首页两态） | `/` | 未动 |
| 2 | 搜索 | `/search` | 未动 |
| 3 | 任务 | `/task` | 未动 |
| 4 | 任务详情 | `/task/:id` | 未动 |
| 5 | 本体 | `/ontology` | 未动 |
| 6 | 本体详情 | `/ontology/:id` | 未动 |
| 7 | 卡片 | `/card` | 未动 |
| 8 | 配色 | `/color` | 未动 |
| 9 | 新建卡片 | `/card/add` | 未动 |
| 10 | 编辑卡片 | `/card/edit/:id` | 未动 |
| 11 | 卡片详情 | `/card/:id` | 未动 |
| 12 | 文件 | `/file` | 未动 |
| 13 | 文件详情 | `/file/:id` | 未动 |
| 14 | 数据库 | `/db` | 未动 |
| 15 | 彩虹生成器 | `/rainbow` | 未动 |
| 16 | 文本编辑 | `/text` | 未动 |
| 17 | 英语阅读 | `/reading` | 未动 |
| 18 | 不认识词表 | `/reading/unknown` | 未动 |
| 19 | 书签 | `/bookmark` | 未动 |
| 20 | 书签详情 | `/bookmark/:id` | 未动 |
| 21 | 书签管理 | `/bookmark/manage` | 未动 |
| 22 | 阅读文章 | `/reading/:id` | 未动 |
| 23 | 记忆 | `/memory` | 未动 |
| 24 | 添加记忆 | `/memory/add` | 未动 |
| 25 | 记忆管理 | `/memory/manage` | 未动 |
| 26 | 知识搜索 | `/conversation` | 未动 |
| 27 | 知识详情 | `/conversation/detail/:id` | 未动 |
| 28 | 概念详情 | `/conversation/concept/:id` | 未动 |
| 29 | AI 对话 | `/chat` | 未动 |
| 30 | 提示词预设 | `/chat/prompts` | 未动 |
| 31 | 记忆卡片生成 | `/chat/mem` | 未动 |
| 32 | 管理员设置 | `/admin` | 未动 |
| 33 | API Key | `/key` | 未动 |

## 6. 门禁与工作方式

- **逐文件手改（禁脚本）**：批量替换一律不许；项目格式化/lint（`pnpm run lint`）例外。
- 三条既有契约继续生效：stylelint（kebab 类名、禁 `!important`、强调环走
  `--t-ring-accent`）、`css-modules-contract.test.ts`（类名引用同步）、
  `tokens-contract.test.ts` ↔ `tokens.ts` 的 `TOKEN_NAMES`（Canvas 读数）。
- 新增几何门禁 `e2e/specs/control-heights.spec.ts`；审阅材料
  `e2e/specs/design-audit.spec.ts`（`AUDIT=1` 生成，默认跳过）。
- 阶段推进：0 规格与裁决 → 1 令牌与词表（合入 main）→ 2 外壳与全局浮层（合入 main）
  → 3 模块清扫 7 批（main 上小步提交）→ 4 收尾验收。**提交与部署一律等用户许可**。

## 7. 明确不做

- 不动路由 / API / 后端 / 数据库 / 部署；不引入 CSS 框架或 Tailwind。
- 不做像素级视觉回归测试（本仓库无此设施；交付截图为人工审阅材料）。
- 不改文案语义（仅与克制语气冲突的欢迎语一类收敛为中性表述）。
- 不动断点体系与四类 a11y 降级（forced-colors / prefers-contrast / reduced-motion / print）。
- 不删既有功能：主题切换（paper/midnight/auto）、字号三档、命令面板快捷键全部保留。
