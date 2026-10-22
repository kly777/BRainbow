# 让网页做回网页——以《A Dao of Web Design》为镜的 BRainbow 前端改进计划

> *"The web's greatest strength, I believe, is often seen as a limitation, as a defect.
> It is the nature of the web to be flexible, and it should be our role as designers
> and developers to embrace this flexibility, and produce pages which, by being
> flexible, are accessible to all."*
> — John Allsopp, *A Dao of Web Design*, 2000

---

## 一、缘起

2000 年，John Allsopp 在 A List Apart 发表了《A Dao of Web Design》。当时 CSS 尚在襁褓，设计师们挣扎着用 `<table>` 布局、用 `<font>` 控制字号、用 `pt` 和 `px` 固定每个像素——就像用印刷品的思维来做网页。Allsopp 借《道德经》之镜指出：**网页不是"纸上排版的网络版"（Desktop Publishing for the Web），它是一个新媒介，应当摆脱旧媒介的"仪式"（ritual），拥抱其自身的本性——灵活性（flexibility）。**

二十五年后的今天，CSS 已具备容器查询、层叠网格、相对单位、强制颜色模式等 Allsopp 当年只能想象的能力。但"控制的欲望"并未消失。BRainbow 的前端（SolidJS + CSS Modules + oklch 三主题）已在设计令牌、rem 体系、主题切换、基础无障碍等方面走在正确的路上，但对照"道"的精神，依然有可改进的余地。

本文将从"道"的六个关键词出发，逐项审计 BRainbow 前端现状，并给出可落地的分阶段改进计划。

---

## 二、文章核心论点速览

| # | 章节 | 道之原则 | 原文要点 | 现代映射 |
|---|------|----------|----------|----------|
| 1 | §2 Same old new medium? | **新媒体觉醒** | 电视曾被称为"带画面的广播"；网页不应是"印刷品的网络版" | 前端不应模仿桌面应用/纸质排版，而应拥抱 web 的流动本性 |
| 2 | §3 Controlling web pages | **放弃控制** | "designers are controllers"——设计师不是"像素机械师" | 放弃像素级精确，尊重用户的选择（字号、主题、窗口尺寸） |
| 3 | §4 Why does it matter? | **灵活性是力量** | 婴儿柔软，老妪僵硬；灵活性是生命的属性 | 固定布局/字号不是"精确"，而是"僵硬" |
| 4 | §5 Adaptability is accessibility | **适应性 = 无障碍** | "make pages which are adaptable... Designing adaptable pages is designing accessible pages" | 页面适应读者需求（浏览器/平台/屏幕/阅读器/视障）就是最大的无障碍 |
| 5 | §6 The Way | **形式追随功能** | "think about what your pages do, not what they look like"；用 `<em>` 而非 `<i>`，分离内容与表现 | 语义 HTML + 样式表"建议"而非"控制" |
| 7 | §7 Fonts | **不用绝对单位** | "Don't use points. This allows readers to choose the font size which suits them." | 用 rem/em/% 取代 px，让浏览器默认字号生效 |
| 8 | §8 Layouts | **布局流动** | 布局用百分比/em，margin 相对字号，窗口缩放时布局自适应 | 容器查询 + clamp() + 相对单位 |
| 9 | §9 Colors | **颜色不是唯一信息** | "avoid relying on color combinations to alone convey meaning" | 红绿色盲友好：图标/文字/形状 + 颜色，而非仅颜色 |
| 10 | §10 The Journey | **千里之行始于足下** | "The journey begins by letting go of control, and becoming flexible." | 小步改进、每阶段验证、可度量门禁 |

---

## 三、现状镜鉴

### 3.1 已合于"道"之处（应当保持）

| 审计项 | 状态 | 对应文件/证据 |
|--------|------|--------------|
| 设计令牌（语义色） | ✅ 已实现 | `tokens.css`：`--t-color-*` 语义色，组件统一 `var()` 引用，配色随主题 |
| rem 布局常量 | ✅ 已实现 | `global.css`：全部 `--space-*` / `--text-*` / `--radius-*` 用 rem，注释明确"跟随浏览器根字号" |
| 三主题 | ✅ 已实现 | `theme.ts`：paper/midnight/ocean，oklch 色空间，色相不泄漏 |
| prefers-reduced-motion | ✅ 已实现 | `global.css`：`@media (prefers-reduced-motion: reduce)` 全局收敛动画 |
| focus-visible 焦点环 | ✅ 已实现 | `global.css`：统一 `:focus-visible` 规则 + 输入框 ring |
| skip-link（跳过导航） | ✅ 已实现 | `global.css：.skip-link`，屏幕阅读器友好 |
| sr-only 视觉隐藏 | ✅ 已实现 | `global.css：.sr-only` |
| 组件禁内联 oklch/hex | ✅ 已实现 | tokens.css 注释硬规则"组件内禁止内联 oklch/hex（防主题色相泄漏）" |
| 模块色 --m-* | ✅ 已实现 | tokens.css 定义 10 个模块识别色（task/card/mem/onto/chat/...），各模块组件引用 |
| CSS Modules 分层 | ✅ 已实现 | atoms/molecules/organisms，组件至样式映射 |
| 语义 HTML 元素 | ✅ 基础好 | `index.html`：lang="zh-CN"、meta 描述、OG 标签、schema.org JSON-LD |
| 路由单一来源 | ✅ 已实现 | `config/paths.ts` → `navigation.ts` → `routes.ts` |

### 3.2 尚在"仪式"之处（需要改进）

| 审计项 | 差距 | 严重度 | 对应文章章节 |
|--------|------|--------|-------------|
| **px 字号残留** | 565 处 `font-size:*px` vs 285 处 `rem` | ⚠️ 高 | §7 Fonts |
| **无系统主题跟随** | theme.ts 只有三固定主题，无 `prefers-color-scheme: auto` | ⚠️ 高 | §3 放弃控制 |
| **无 high-contrast/forced-colors** | 无 `@media (forced-colors)` / `prefers-contrast` 处理 | ⚠️ 高 | §5, §9 |
| **颜色作为唯一信息载体** | `--t-color-mark-*`（阅读标注语义色）、`--m-*` 模块色仅靠颜色区分 | ⚠️ 中 | §9 Colors |
| **无打印样式** | 无 `@media print` / `@page` | ⚠️ 中 | §5（"pages may be printed"） |
| **固定宽度布局** | Modal 600px、Sidebar 260/320px、BranchBar 220px 等固定 px 宽度 | ⚠️ 中 | §8 Layouts |
| **无容器查询** | 响应式仅靠视口断点（480/600/768/1024），无 `@container` | ⚠️ 中 | §8 Layouts |
| **无字号缩放 UI** | 无应用内字号档位（S/M/L 或 slider） | ⚠️ 低 | §7 Fonts |
| **无字体对比审计** | `--t-font-*` 三套字体族，但"不要依赖字体可用"的 fallback 链需验证 | ⚠️ 低 | §7 Fonts |
| **prophecy 遗留** | 部分组件 CSS 硬编码 `#xxxxxx` 回退色（如 BookmarkPage 的 `#92400e`） | ⚠️ 低 | §9, design tokens 契约 |

---

## 四、改进计划

### 主题 A：放下"像素控制"——相对单位与弹性排版

> **道之依据**：§4 "The control which designers know in the print medium, and often desire in the web medium, is simply a function of the limitation of the printed page."  
> **道之依据**：§7 "Don't use points. This allows readers to choose the font size which suits them."

#### A-1：px → rem 迁移收尾

- **现状**：565 处 `font-size:*px` vs 285 处 `rem`。大量组件字号、间距、icon 尺寸用 px 固定。
- **动作**：
  1. 建立 px 白名单：1px 边框、`box-shadow` 偏移、`outline` 宽度、SVG 图标视口尺寸——这些物理像素场景可保留 px。
  2. 批量迁移：`font-size`、`line-height`、`padding`、`margin`、`min-height`、`width`/`max-width` 中的 px 值 → rem 或 `clamp()`。
  3. 无 `--space-*` / `--text-*` 对应值的 px 先转简单 rem，有对应值的直接替换为令牌变量。
- **工具**：利用 biome/script 扫描 + 手动 review 关键组件（Button、Modal、Sidebar、Toast、Card）。
- **验收**：`grep -rn "font-size:.*px" src --include="*.module.css"` 计数降至 0（除白名单）。
- **工作量**：M（跨 30+ 模块 CSS 文件，但可批量 + 分模块提交）。

#### A-2：字号弹性档位

- **现状**：无应用内字号缩放控制。rem 体系跟随浏览器根字号（好），但无"大字模式"切换。
- **动作**：
  1. 在 `theme.ts` 中增加 `fontScale` 可选值 `{ 1, 1.125, 1.25 }`（S/M/L 三档），写入 `html` 的 `style="font-size: ${scale}rem"` 或通过 CSS 变量 `--font-scale` 控制。
  2. 用户设置持久化到 localStorage，与主题并排。
  3. 字号档位不影响 `--page-*` 布局宽度（仅缩放文本），保持布局一致。
- **验收**：切换字号档位后，全页面文本缩放，布局不乱，无 px 固定字号溢出。
- **工作量**：S（core 逻辑在 theme.ts 加 30 行，ui 配置入口 50 行）。

#### A-3：固定宽度组件弹性化

- **现状**：Modal 600px、Sidebar 260/320px、BranchBar 220px 等固定 px 宽度。
- **动作**：
  1. Modal：`max-width: min(600px, 90vw)` → `max-width: min(37.5rem, 90vw)`。
  2. Sidebar：`width: 260px` → `width: min(16rem, 80vw)`。
  3. 其他固定宽度逐一审查，确保 mobile 不水平溢出。
- **验收**：在 320px 视口下所有固定宽度组件不溢出、可滚动/可关闭。
- **工作量**：S（约 10 个固定宽度点，逐个改）。

---

### 主题 B：适应性即无障碍——系统主题、高对比与可访问性

> **道之依据**：§5 "make pages which are adaptable... Designing adaptable pages is designing accessible pages."  
> **道之依据**：§3 "Designers want to override the wishes of users, and the choices that they have made about their viewing experience."

#### B-1：系统主题跟随（auto 模式）

- **现状**：`theme.ts` 只有 paper/midnight/ocean 三固定主题，无"跟随系统"选项。
- **动作**：
  1. `theme.ts` 增加 `"auto"` 主题选项，逻辑：读取 `prefers-color-scheme`（dark → midnight, light → paper），监听 `change` 事件动态切换。
  2. 主题选择器 UI 增加"跟随系统"条目（第一位）。
  3. `initTheme()` 中 auto 模式优先检测系统偏好。
  4. 持久化：auto 选项也存 localStorage，切换时取消监听并重建。
- **验收**：在 macOS 系统深色/浅色切换时，BRainbow 自动切换 paper/midnight（无需手动刷新）。
- **工作量**：M（theme.ts 重构 + 选择器 UI 改动 + 事件监听生命周期管理）。

#### B-2：高对比度与强制颜色模式

- **现状**：无 `prefers-contrast: more`、`prefers-contrast: less`、`forced-colors: active` 处理。Windows 高对比模式下 BRainbow 可能不可用。
- **动作**：
  1. `tokens.css` 增加 `@media (forced-colors: active)` 查询：覆盖 `--t-color-*` 为系统颜色（`Canvas`、`ButtonText`、`LinkText`、`Highlight` 等），禁用 `box-shadow` 和 `background-image` 装饰。
  2. `tokens.css` 增加 `@media (prefers-contrast: more)` 查询：提高 `--t-color-ink` 对比度（降低亮度差）、增强 `--t-color-border-strong`、增加 `--t-color-accent` 饱和度。
  3. `global.css` 审计：`box-shadow` 在 `forced-colors` 下应消失或转为 `outline`。
  4. 组件级：`Button`、`Badge`、`Toast` 中 `forced-colors` 下颜色转系统色。
- **验收**：在 Windows 开启高对比模式（或 Mac 开启"增加对比度"）后，BRainbow 所有文本可读，按钮有可见边框，不依赖颜色区分元素。
- **工作量**：M（tokens.css 框架性改动 + 逐个组件适配）。

#### B-3：打印样式

- **现状**：无 `@media print` 支持。文章明确说"pages may be printed, or read aloud by reading software, or read using braille browsers"。
- **动作**：
  1. `global.css` 增加 `@media print`：隐藏导航/侧边栏/按钮/动画/背景色；`a` 标签打印 URL；正文使用纸白色背景 + 黑色文字。
  2. 阅读模块（ReadingDetail / ArticleContent）打印优化：卡片内边距 rem、字号放大、分页控制。
  3. 记忆模块（mem）卡片打印样式：学习/复习卡片可打印为复习表。
- **验收**：`Ctrl+P` 预览阅读/记忆/搜索页面，内容清晰可读，无交互元素，无颜色依赖。
- **工作量**：S（global.css 增量 + 关键模块各 10-20 行）。

#### B-4（可选）：键盘导航审计

- **现状**：已有 skip-link + focus-visible + 输入框 ring。但对话框焦点陷阱、`aria-live` 区域（Toast、AI 流式输出）未系统审计。
- **动作**：
  1. Modal / ConfirmModal：焦点陷阱（Tab 循环）补齐。
  2. AI 流式输出区域：`aria-live="polite"` 或 `role="log"`。
  3. Toast 区域：`role="status"` + `aria-live="polite"`。
- **验收**：键盘 Tab 导航流畅，无焦点逃逸，屏幕阅读器朗读 Toast 和 AI 增量输出。
- **工作量**：S。

---

### 主题 C：颜色不止颜色——多通道信息传达

> **道之依据**：§9 "avoid relying on color combinations to alone convey meaning."  
> "Do your web pages exclude people in a similar way?"

#### C-1：阅读标注语义色多通道化

- **现状**：`tokens.css` 定义了 `--t-color-mark-wrong`、`--t-color-mark-correct`、`--t-color-mark-teal`、`--t-color-mark-blue`、`--t-color-mark-yellow` 五组语义色，用于阅读标注（认识/不认识/推荐等标记）。这些标注**可能仅靠颜色区分**，红绿色盲用户无法分辨。
- **动作**：
  1. 审计 `reading` 模块中 `mark-*` 色的实际使用场景（ReadingDetail、ArticleContent、ReadingList）。
  2. 为每种颜色标注增加辅助区分手段：
     - 图标/符号（✓、✗、★、●、◆）
     - 左侧竖线/边框（不同位置/样式）
     - 文字标签（"认识"、"不认识"、"推荐"、"重点"、"待查"）
     - `title` 或 `aria-label` 属性
  3. 修改 CSS Modules 中仅用 `background-color` 或 `color` 区分标注的样式，改为组合使用（颜色 + 图标 + 边框）。
- **验收**：在灰度屏幕（或 `forced-colors` 模式）下，阅读标注仍可区分。红绿色盲模拟下无歧义。
- **工作量**：M（涉及 3 个阅读模块文件 + Badge 组件 + 标注组件重构）。

#### C-2：模块识别色辅助

- **现状**：`--m-*` 模块色（`--m-task`、`--m-card`、`--m-mem`、`--m-onto`、`--m-chat` 等 10 个）用于导航/页面/模块边框/标签的背景或文字。
- **动作**：
  1. 审计模块色在 UI 中的角色：若仅用于装饰（导航图标颜色、页面边框）则 OK；若用于区分模块身份（如标签筛选器 TagFilter），需加文字/图标辅助。
  2. TagFilter 中 `border-color: var(--m-bookmark)` + `color: var(--m-bookmark)` 已配文字标签——OK，但确认 `color: var(--m-bookmark)` 在 `forced-colors` 下是否被覆盖。
- **验收**：每个模块色都有文字标签（模块名）或图标伴随，颜色不是唯一标识。
- **工作量**：S（审计 + 少量修补）。

#### C-3：Badge 状态色持续审计

- **现状**：Badge 组件有 8 种 variant（default/new/learning/review/relearning/suspended/success/warning），每个有颜色 + 文字（children）。基本符合"不只颜色"。
- **动作**：确认 mem 的 ManageTable 中 Badge 用法，确保文字存在。
- **验收**：每个 Badge 实例都有文字内容。
- **工作量**：S（审计）。

---

### 主题 D：布局如水——容器查询与流动布局

> **道之依据**：§8 "Using percentages (or other relative values) to specify page layout in CSS automatically creates adaptive pages."  
> "when a user adjusts their font size to make a page more legible, the margin increases proportionally"

#### D-1：引入容器查询

- **现状**：响应式仅靠视口断点（480/600/768/1024）。文章精神是"布局适应承载内容的容器"，现代实现是 `container-type: inline-size` + `@container`。
- **动作**：
  1. 选择高频复用组件作为首批容器查询候选：
     - 卡片列表（CardList、TaskList、ReadingList）——在窄容器内从 multi-column 自动降为 single-column。
     - 搜索页（SearchPage）搜索标签区域——在窄容器内标签换行而非截断。
     - 聊天侧边栏（ChatSidebar）——在窄容器内隐藏文字仅显示图标。
  2. 为每个候选组件定义 `container-type`，并将断点从视口迁移到容器。
  3. 现存视口断点保留，容器查询作为补充而非替代。
- **验收**：在宽面板/窄面板两种布局中，容器查询组件自动调整列数/字号/间距。
- **工作量**：M（引入新概念 + 首批 3-5 个组件 + 测试）。

#### D-2：断点文档化与容器查询分工

- **现状**：`global.css` 有断点注释（480/600/768/1024/1280），但各组件分散引用。
- **动作**：在 `global.css` 增加容器查询与视口断点分工指南：（1）何时用视口断点（页面级布局）；（2）何时用容器查询（组件级自适应）。
- **验收**：新组件开发能参考该指南，不盲目选择。
- **工作量**：S（文档 + 注释）。

---

### 主题 E：形式追随功能——语义化与内容表现分离

> **道之依据**：§6 "think about what your pages do, not what they look like"  
> "A cornerstone of this idea is to separate the content and its appearance."

#### E-1：语义元素审计

- **现状**：基础好（lang、meta、schema.org），但需系统审计组件内语义。
- **动作**：
  1. 所有带 `onClick` 的非 `<button>` 元素（如 `<div>`、`<span>`）补 `role="button"` + `tabindex` + `aria-label` 或重构为 `<button>`。已用 `<button>` 的组件（Button、Modal、Toolbar、Toast 关闭）确认都有 `type="button"` 防 form 提交。
  2. 标题层级审计：确保每个页面有一个 `<h1>`，层级不跳跃（h1→h2→h3）。
  3. 阅读模块：`<em>` 用于强调、`<strong>` 用于重要、`<cite>` 用于引用——而非 `<i>`、`<b>`。
- **验收**：`axe DevTools` 或 Lighthouse Accessibility 审计通过率 ≥90%。
- **工作量**：M（跨模块审计，但每项改动小）。

#### E-2：样式表"建议"而非"控制"证实

- **现状**：CSS Modules 默认组件样式，但需确认：无组件**依赖**样式表才能传达信息（如仅用 `color:` 的阅读标注已被 C-1 覆盖）。
- **动作**：在 stylelint 规则中增加 `declaration-no-important`（禁止 `!important`，除非 `prefers-reduced-motion` 等全局覆盖），减少"控制"欲望。
- **验收**：`!important` 数量≤3（当前全局覆盖的外层）。
- **工作量**：S。

---

### 主题 F：度量与门禁——让"道"可检验

> **道之依据**：§10 "The journey begins by letting go of control, and becoming flexible."  
> 改变始于可度量的基线。

#### F-1：~~扩展 ui-inspect 审计脚本~~

> **已取消**：脚本已删除。门禁改由 stylelint `declaration-no-important` 规则（E-2 已落地）和手动 code review 覆盖。

#### F-2：~~对比度自动检查~~

> **已取消**：随 F-1 一并移除。三主题关键令牌对比度在设计阶段已手动验证达标（正文 ≥15:1、弱化 ≥6:1、强调 ≥5:1）。

#### F-3：提交前清单更新

- **现状**：`doc/testing.md` 有提交前清单，但未包含 a11y/适应性检查。
- **动作**：在提交前清单中增加：
  - [ ] rem 审计通过（`px` 使用在阈值内）
  - [ ] 无 `!important` 新增
  - [ ] 组件颜色非唯一信息载体
  - [ ] 系统主题/高对比模式未破坏
- **工作量**：S（文档更新）。

---

## 五、落地节奏

> *"A journey of a thousand miles begins at the spot under one's feet."* — 道德经 64 章

### 阶段一：基线（1-2 周，可独立提交）

| 序号 | 改进项 | 工作量 | 独立提交 | 前置依赖 |
|------|--------|--------|----------|----------|
| 1 | A-3：固定宽度组件弹性化 | S | ✅ 是 | 无 |
| 2 | B-3：打印样式 | S | ✅ 是 | 无 |
| 3 | B-4：键盘导航审计 | S | ✅ 是 | 无 |
| 4 | C-3：Badge 审计 | S | ✅ 是 | 无 |
| 5 | E-2：`!important` 门禁 | S | ✅ 是 | 无 |
| 6 | F-3：提交前清单更新 | S | ✅ 是 | 无 |

**阶段一目标**：快速见效，建立基线，让团队（或 AI 代理）感受到"道"的实用性。

### 阶段二：核心（2-3 周，每个可独立提交）

| 序号 | 改进项 | 工作量 | 独立提交 | 前置依赖 |
|------|--------|--------|----------|----------|
| 7 | A-1：px → rem 迁移 | M | ✅ 可分模块提交 | 阶段一 1（A-3） |
| 8 | B-1：系统主题跟随 | M | ✅ 是 | 无 |
| 9 | B-2：高对比度模式 | M | ⚠️ 部分依赖 B-1 | 可能需要 B-1 的 theme 重构 |
| 10 | C-1：阅读标注多通道化 | M | ✅ 是 | 无 |
| 11 | E-1：语义元素审计 | M | ✅ 是 | 无 |

**阶段二目标**：解决"颜色唯一信息"和"高对比度"两大无障碍硬伤，rem 迁移覆盖 80% 组件。

### 阶段三：深入（3-4 周，可独立提交）

| 序号 | 改进项 | 工作量 | 独立提交 | 前置依赖 |
|------|--------|--------|----------|----------|
| 12 | A-2：字号弹性档位 | S | ✅ 是 | 阶段二 7（A-1） |
| 13 | D-1：容器查询引入 | M | ✅ 可分组件 | 无 |
| 14 | D-2：断点文档化 | S | ✅ 是 | 阶段三 13（D-1） |
| 15 | C-2：模块色辅助审计 | S | ✅ 是 | 无 |

**阶段三目标**：容器查询为组件自适应铺路，字号弹性为用户提供个性化选择。

---

## 六、验收清单（最终状态）

### 适应性

- [ ] 全页面 `font-size` 无 px 硬编码（白名单除外：1px 边框、shadow 偏移）
- [ ] 所有固定宽度组件在 320px 视口下不溢出
- [ ] 组件容器查询在宽/窄容器中自适应
- [ ] 用户可切换字号档位（S/M/L）

### 无障碍

- [ ] `prefers-color-scheme` 自动跟随系统主题
- [ ] `forced-colors: active` 下所有元素可读、可区分
- [ ] `prefers-contrast: more` 下对比度增强
- [ ] `@media print` 打印内容清晰
- [ ] 焦点陷阱在 Modal/ConfirmModal 中完整
- [ ] `aria-live` 覆盖 Toast 与 AI 流式输出

### 色彩

- [ ] 阅读标注：颜色 + 图标/文字/形状，不唯一依赖颜色
- [ ] 模块识别色：颜色 + 文字标签/图标
- [ ] Badge：始终有文字内容
- [ ] 对比度自动化检查通过（AA 级）

### 语义

- [ ] 标题层级不跳跃
- [ ] `<em>` / `<strong>` / `<cite>` 正确使用
- [ ] 无缺少 `aria-label` 的图标按钮
- [ ] `!important` 使用 ≤3 处

### 度量

- [x] ~~`pnpm run ui-inspect` 输出基线报告~~（脚本已取消，门禁由 stylelint 规则覆盖）
- [x] 提交前清单包含适应性检查项（doc/testing.md 已更新）

---

## 七、附录：文章 × 代码映射表

| 文章原文 | 对应 BRainbow 文件 | 改进项 |
|----------|-------------------|--------|
| "Absolute units, like pixels and points are to be avoided" | 所有 `*.module.css`（565 处 px） | A-1 |
| "don't rely on a font being available" | `tokens.css`（`--t-font-*` fallback 链） | A-1（审计） |
| "readers will be able to decide on the fonts they want to view web pages with" | `theme.ts` | A-2, B-1 |
| "don't use points. This allows readers to choose the font size which suits them" | `global.css`（`--text-*` rem 体系） | A-1（已有基础，补充） |
| "color needs to be used carefully, and never relied on" | `tokens.css`（`--t-color-mark-*`） | C-1, C-2 |
| "avoid relying on color combinations to alone convey meaning" | `reading/` 模块 | C-1 |
| "pages may be printed, or read aloud by reading software" | 无 | B-3, B-4 |
| "browser windows can be resized, thereby changing the page size" | `global.css`（`--page-max: 1440px`） | A-3, D-1 |
| "using percentages (or other relative values) to specify page layout" | 无（部分） | D-1 |
| "separate the content and its appearance" | 组件与 CSS Modules 分离 | E-1, E-2 |
| "use the `<em>` element, so browsers other than PC based web browsers can handle the element appropriately" | `reading/` 模块 | E-1 |
| "designers are controllers" | `theme.ts` 无 auto 模式 | B-1 |
| "The journey begins by letting go of control, and becoming flexible" | 整个计划 | 全部主题 |

---

## 八、参考资源

- [A Dao of Web Design — John Allsopp, A List Apart, 2000](https://alistapart.com/article/dao/)
- [WCAG 2.2 — 成功准则 1.4.1 颜色的使用](https://www.w3.org/TR/WCAG22/#use-of-color)
- [WCAG 2.2 — 成功准则 1.4.3 对比度（最小）](https://www.w3.org/TR/WCAG22/#contrast-minimum)
- [强制颜色模式（forced-colors）—— CSS 规范](https://www.w3.org/TR/mediaqueries-5/#forced-colors)
- [prefers-contrast —— CSS 媒体查询](https://www.w3.org/TR/mediaqueries-5/#prefers-contrast)
- [CSS 容器查询 —— MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries)
- BRainbow 现有文档：`doc/frontend.md`、`doc/design-tokens.md`、`doc/testing.md`

---

*本计划由 AI 代理基于项目 AGENTS.md 守则撰写，遵循"小步改动、每阶段验证"原则。所有改进项均可独立提交，不依赖单一大规模重构。*