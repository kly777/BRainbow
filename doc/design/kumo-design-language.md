# Kumo 设计语言研究（dash.cloudflare 风）

> 状态：调研（未承诺落地） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22
> 落地状态：Kumo Solid 组件曾收编进 main（`31ffdb3d`，2026-09-29），已在 `7c0b8d54`（2026-10-18）移除；
> 文中 §6 记录的是 `design/kumo-skin` 分支（`627b19da`）的探索，该分支/提交在本仓不存在，也未合入 main；
> 当前 main 是 Hallmark 编辑风。本文是外部组件库研究，**不能当实现依据**。

> 来源：[`cloudflare/kumo`](https://github.com/cloudflare/kumo) 浅克隆在 `~/kumo`（`c3b0294`，2026-09-25），
> 9.8 MB。取数方式：**只读三个权威文件** —— `packages/kumo/scripts/theme-generator/config.ts`
> （语义色 token 的唯一源，`theme-kumo.css` 是它生成的）、`skills/kumo-design/SKILL.md`（14 条设计硬规则）、
> `packages/kumo/src/components/**`（变体表与类名）。本页记录**数值与判据**，不复制代码。

---

## 1. Kumo 是什么

Cloudflare 把 dash.cloudflare 的产品语音抽成的组件库：React + Base UI（无头交互）+ Tailwind v4，
55 个组件 + 40 个 primitive，ESM 按组件可摇树。设计系统本体只有两样东西 ——
**一表语义色 token** 和 **一份 14 条规则**，其余都是 Tailwind 默认（圆角 4/6/8/12px、间距 4px 栅格、
阴影 shadow-xs）。

与我们最大的结构性差别：它**用 `light-dark()` 一个 token 承载明暗两态**（`color-scheme` 驱动），
没有 `dark:` 前缀、没有第二份主题块；我们是 `:root[data-theme]` 多主题各自一份。故只借数值，不借机制。

## 2. Token 数值（`config.ts` 原值 → 我们的令牌）

### 2.1 表面与描边（Kumo 的分层几乎全靠描边，不靠投影）

| Kumo token | 浅色值 | BRainbow `--t-color-*` |
|---|---|---|
| `kumo-canvas` | `oklch(98.75% 0 0)` | `bg` |
| `kumo-base` | `#fff` | `surface` |
| `kumo-elevated` | `oklch(98% 0 0)` | `surface-raised` |
| `kumo-tint` | `oklch(97% 0 0)` | （列表行 hover 复用 `surface-raised`） |
| `kumo-line` | `oklch(14.5% 0 0 / 10%)` ← **签名** | `border` |
| `kumo-hairline` | `oklch(93.5% 0 0)` | （内部分隔线，取 `border` 亦可） |
| `kumo-focus` | `oklch(15% 0 0)`（暗色下 `93.5%`） | 我们仍用品牌蓝做焦点环，见 §5 |

### 2.2 文字与语义色

| Kumo token | 浅色值 | 我们 |
|---|---|---|
| `text-kumo-default` | `oklch(21% 0.006 285.885)` | `ink` |
| `text-kumo-strong` | `oklch(14.5% 0 0)` | `ink-strong` |
| `text-kumo-subtle` | `oklch(55.6% 0 0)` | `ink-muted` |
| `text-kumo-inactive` | `oklch(87% 0 0)` | `ink-faint`（我们取 70.8%，更易读） |
| `color-kumo-brand`（实底） | `oklch(0.5772 0.2324 260)` 品牌蓝 | `accent` + `action`（主按钮） |
| `kumo-brand-hover` | `oklch(48.8% 0.243 264.376)`（blue-700） | `accent-strong` / `action-strong` |
| `text-kumo-brand` | `#f6821f` CF 橙（只在文档/品牌处用） | 未采纳（我们的 accent 是蓝） |
| `text-kumo-danger` | red-700 `oklch(50.5% 0.213 27.518)` | `danger` |
| `text-kumo-success` | emerald-800 / `kumo-success`=emerald-600 | `success`（取 700 折中） |
| `kumo-warning` | `oklch(59.7% 0.144 57.5)` | `warning` |
| `*-tint`（info/warning/danger/success） | 半透明 oklch，如 `oklch(93.2% 0.032 255.6 / 45%)` | `accent-soft` / `*-subtle` |

### 2.3 排版（Kumo 的排版 token 只有四档，与主题无关）

| 档 | 字号 | 行高 | 用途（硬规则） |
|---|---|---|---|
| `xs` | 12px | 1.333 | 徽章、角标 |
| `sm` | 13px | 1.176 | 元信息 |
| **`base`** | **14px** | 1.5 | **所有内容文字**（正文/按钮/数据/可交互物） |
| `lg` | 16px | 1.5 | 卡片标题、副标题 |

标题（`Text` 变体）：`heading`=16px/600，`heading3`=16、`heading2`=24、`heading1`=30，一律 `font-semibold`
（**规则：不许 `font-bold`**）。字体：Inter + 系统栈，**标题与正文同族**（不换衬线）。
我们映射：`--text-xs/sm/base/lg` 四档 + `--text-2xl` 当页面 h1（30px），`--t-font-display` 在 kumo 主题里等于正文面。

### 2.4 控件与几何（硬编码在变体表里的值）

| 项 | Kumo 值 | 我们的对应 |
|---|---|---|
| 按钮高度 | xs 20 / sm 26 / **base 36** / lg 40 | `Button` sm 28 / md 36 ✓ |
| 按钮圆角 | sm→`rounded-md` 6px，base→`rounded-lg` 8px | `--radius-sm/md` |
| 按钮字重 | `font-medium` | ✓ |
| 卡片 | `rounded-lg`(8px) + `ring-1 kumo-line` + `shadow-xs` | `--radius-lg`(kumo 主题改成 8px) + `border` + `--shadow-sm` |
| 图标块 | 32px 方块、8px 圆角、10% 品牌色底 | AdminPage `.stat-icon`（已改 8px 圆角） |
| 表格 | `th` 14px/600 + `border-b`；行斑马 `even:bg-elevated`；hover `bg-tint` | 列表行：发丝线 + hover 底色 |
| 页面容器 | `max-w-[1400px]` + `p-6 → md:p-8 → lg:px-10 py-9` | `--page-max` + 断点内边距（kumo 主题之外也生效） |

## 3. 布局方法（可直接照搬的骨架）

1. **ResourceListPage**（`blocks/resource-list`）：外层 canvas 底色 → 居中 1400px 容器 → 内边距随断点放大
   （24/32/40px）→ 页头（图标 + h1 30px + 描述 16px 弱化）→ 主体 `flex` 主列 + 右侧 **380px sticky 侧栏**
   （`top: 5.5rem`），窄屏时侧栏折到主体下方。我们还没有右侧栏，但页头 + 内边距节奏已照搬。
2. **LayerCard**：单层卡片 = `bg-base + ring-line + shadow-xs`；**分层卡片** = 外层 `bg-elevated` 桶 +
   一个 `Secondary`（灰底标题条） + 若干个 `Primary`（白底内容块）。规则：**不许卡片套卡片**（LayerCard 叠 LayerCard）。
3. **表格化列表**：一行行的"小盒子"不是 Kumo 语法；Kumo 是**一整块容器 + 发丝线分隔的行**，
   悬停只换底色（`bg-tint`），选中用底色而不是外描边（容器会裁切）。
4. **sticky 必须有边框**：吸顶元素与内容之间要有 `border-b`，否则滚动时两层内容糊在一起。
5. **光学间距**：文字块的垂直内边距略小于水平（`px-5 py-4`）；**相关文字之间的间距要小于它所属内容的间距**
   （标题与描述 6px，标题组与正文 24px）。

## 3.1 dash.cloudflare 的真身（从用户存档页反推，**这才是权威**）

用户存了一份自己账号首页的 HTML（`~/down/…Cloudflare….html`，1.1 MB，含全部内联 CSS）。
它是 React + Tailwind v4 + **Kumo 组件**（`data-kumo-component="Sidebar|Tabs|Button|Switch|Link"`）
渲染后的静态快照，因此可以直接读到**真实数值**（而不是我从组件源码推测的）：

| 项 | 真实值 | 出处 |
|---|---|---|
| 字体 | `"Inter Variable", ui-sans-serif, system-ui, sans-serif` | `--font-sans` |
| 等宽 | `"Paper Mono", ui-monospace, …` | `--font-mono` |
| 顶栏 | `--header-height: 58px`，`bg-kumo-canvas` + `border-b border-kumo-line` + `px-4`，**全尺寸都在**，sticky | `<header>` |
| 顶栏左簇 | 云 logo + 账号名（`text-base font-medium truncate max-w-62.5` = 250px）+ caret | 同上 |
| 顶栏中段 | 产品/zone 切换器：★ + 名称 + 计划徽章 + caret（在侧栏宽度之后，与内容列对齐） | 同上 |
| 顶栏右簇 | `Ask AI` / 支持 / 头像（`ml-auto flex shrink-0 gap-1`） | 同上 |
| 侧栏 | `--sidebar-width: 16.25rem`、折叠 `--sidebar-width-icon: 57px`；`--sidebar-bg: var(--color-kumo-base)`（**白**）；`--sidebar-active-bg: var(--color-kumo-tint)`（97% 灰） | 内联变量 |
| 侧栏内部 | header 58px + `border-b`；`menu` `gap-y-px`（1px）；项 `min-h-8.5`(34px) / `px-3` / `gap-2.5` / `rounded-lg` / `text-sm font-medium text-kumo-default`；分组标签 `mt-4 mb-2 px-3 text-sm font-medium text-kumo-subtle`；徽章 = **虚线边胶囊** `rounded-full border border-dashed border-kumo-line px-1.5 py-0.5 text-[11px]`；footer `h-12` + `border-t` | `data-sidebar=*` 元素 |
| 侧栏顶部 | **"快速搜索…" 框 + `Ctrl K`**（点开命令面板） | 截图 + DOM |
| 内容容器 | `width: 90%; max-width: 79em`（1264px）居中；`<main>` 上下 `padding: 32px` | `.c_by/.c_bz/.c_br/.c_bs` |
| 卡片 | `bg-kumo-base shadow-xs ring ring-kumo-line rounded-lg px-5 py-3`（可点击时 `hover:bg-kumo-tint`） | 账号页指标卡 |
| 指标行 | label 宽 15%（`text-xs font-medium text-kumo-subtle`）+ 值宽 85%（`text-xl font-semibold text-kumo-default`） | 同上 |
| 分段控件 | 轨道 `rounded-lg bg-kumo-recessed h-9 px-0.5`；项 `text-base my-0.5 px-2.5 rounded-md text-kumo-subtle`，选中 `text-kumo-default`；**白色滑块**指示器（`--active-tab-*`，32px 高） | Tabs |
| 页脚 | `border-t border-kumo-line px-4 py-2.5 min-h-12`（48px） | `#site-footer` |
| 品牌蓝 | `--cf-blue-4: #0051c3`；`--color-kumo-brand: oklch(57.72% .2324 260)`；浅蓝 `--cf-blue-9: #ecf4ff` | `--cf-*` 调色板 |
| 灰阶 | `--cf-gray-0…9`：`#0a0a0a #313131 #3d3d3d #4a4a4a #595959 #797979 #999999 #b6b6b6 #d9d9d9 #f2f2f2` | 同上 |

**两条被推翻的推测**（记下来免得再错）：
1. 侧栏**不是深色**（我先前按印象做了深色导航）—— 真值是白底 + 灰激活块，只有 Zero Trust 的
   某个旧区是深蓝字浅蓝块的变体。
2. 顶栏**不是移动端才有** —— 58px 顶栏在所有尺寸都在，左簇宽度与侧栏同宽（账号切换器压在侧栏上方）。

## 4. 组件设计范式

- **变体表即契约**：每个组件导出 `KUMO_{NAME}_VARIANTS`（`{variant|size|shape: {classes, description}}`）
  + `KUMO_{NAME}_DEFAULT_VARIANTS`，类型从表里派生（`keyof typeof`）。Lint 强制存在，Figma 插件也读它。
  好处：变体是**数据**，能生成文档/插件/测试；坏处：类名是字符串，只能靠 lint 守。
- **尺寸档只有四档**（xs/sm/base/lg），且 `shape: square|circle` 会改用 `compactSize`（20/26/36/40 方块）。
- **合成组件用 `Object.assign(Root, {Sub, Sub2})`**，`displayName` 写点号；13 个组件用 context 传尺寸/角色。
- **组合优先于配置**：`Dialog`/`CommandPalette`/`Select` 都是 14 个以内的子组件拼出来的，没有巨型 props。
- **无障碍内建**：icon-only 按钮用判别联合类型**强制**给 `aria-label`（类型层面的可访问性）。
- **`cn(base, className)` 一律透传**：调用方永远能覆盖样式。我们有 CSS Modules，对应做法是"组件暴露 class 钩子"。
- **状态类可提取**：`bg-x hover:bg-y focus:ring-z disabled:opacity-50` 这种写法能被工具解析成状态表 —— 值得借鉴的是
  "把状态写在变体数据里"，而不是散落在组件逻辑里。

## 5. 与 BRainbow 规则的冲突点（本次如何取舍）

| 冲突 | Kumo | BRainbow 原文 | 取舍 |
|---|---|---|---|
| 主按钮颜色 | 品牌蓝实底 | "accent 不进按钮，primary 用墨色" | **加令牌分层**：`--t-color-action` 默认=墨色、kumo 主题=品牌蓝。两个语音各自成立 |
| 数字字体 | sans + tabular-nums | mono 是"数字统计"的语义面 | 加 `--t-font-numeric`（默认 mono，kumo 主题=sans） |
| 圆角 | 卡片 8px、模态 8-12px | 容器 `md/lg`、模态 1.5rem | kumo 主题内收紧 `--radius-lg/2xl`（唯一"主题覆盖布局常量"的例外，已注释说明） |
| hover 动效 | **颜色不做过渡**、卡片不抬升 | 有 120ms 过渡 + `translateY(-2px)` 抬升 | 文件列表按 Kumo 改（描边加深/底色变化，即时）；其他页面暂不动 |
| 焦点环 | 近黑 `kumo-focus` | accent 环（品牌蓝 25%） | 保留蓝色环：可访问性与"accent 纪律"都更稳 |
| 大写标签 | 禁止大写/加字距 | 管理员页信息标签 UPPERCASE | 按 Kumo 去掉（AdminPage 已改） |

## 6. 落地清单（本次实际改了哪些）

> **历史记录（2026-10-22 核对）**：下面 1–7 项是当时 **`design/kumo-skin` 分支**（提交 `627b19da`）的探索，
> 该分支/提交在本仓不存在，也未合入 main —— main 上页面样式始终保持原样。曾合进 main 的
> `web/src/components/kumo/`（从 [photon-hq/kumo-solidjs] 搬进来的 SolidJS 版 Kumo 组件，
> 17 个族 + 预编译 `kumo.css`，依赖 `@photon-ai/base-ui-solid` / `cnfast`）已在
> `7c0b8d54`（2026-10-18，"clean up task architecture and remove Kumo"）**移除**；
> 当前 main 是 Hallmark 编辑风，既没有这些组件，也没有 kumo 主题与 `--t-color-nav-*` 令牌。
> §3.1 的实测数值与 §1–§4 的判据不受影响，仍然有效。

1. **kumo 主题**（`shared/styles/tokens.css` + `theme.ts`）：冷灰表面 + 10% 黑描边 + 品牌蓝 accent +
   平整阴影 + 正文 14px + 卡片/模态 8-12px 圆角 + 标题 30px；字体面切成无衬线（不自托管 Inter，
   回退系统栈）。主题名"冷灰 · 品牌蓝"，在 /color 页可切换对比。
2. **两个新语义令牌**：`--t-font-numeric`、`--t-color-action(-strong/-ink)` —— 让"数字面"与"主按钮底色"
   能按语音切换，而不必改组件。
3. **AdminPage 重排**（`modules/admin/`）：容器 680→760px + Kumo 内边距节奏；卡片去掉 hover 抬升；
   信息标签去大写、值改数字面；统计块改成"标签在上、数值在下"；卡片标题统一 `cardTitle`（原先两处裸 `h2` 漂移）。
4. **FileList 重排**（`modules/file/FileList.module.css`）：页面内边距节奏；列表视图改成
   **一整块卡片 + 发丝线分隔行**（原来是"每行一个小盒子"）；行选中改内嵌描边（容器裁切外描边会缺角）；
   卡片视图去掉抬升与颜色过渡；顺手修了"排序"标签在窄屏竖排的换行 bug。
5. **应用外壳**（`app/Layout.tsx` + `AppSidebar.tsx` + `AccountMenu.tsx` + `App.module.css`）——
   第三轮按 §3.1 的真实数值重做：
   · **58px 顶栏横跨全宽**（左簇 = 品牌标记 + 账号菜单 + 折叠/抽屉按钮，宽度与侧栏同宽所以账号
     切换器正好压在侧栏上方；中段 = 当前模块 + "本地"徽章；右簇 = 搜索触发 + `Ctrl K`）
   · **白色侧栏** 16.25rem / 折叠 57px，顶部"快速搜索… Ctrl K"框（开命令面板）、分组标签、
     34px 高的条目（hover/激活换底色）、底部 48px 状态条
   · **内容列底部 48px 状态条**；`.shell` 改为定高（`height: 100dvh`），内容列是唯一滚动容器
   · <1024px 侧栏变覆盖式抽屉（顶栏保留，折叠按钮换成汉堡）；折叠态持久化在
     `localStorage: brainbow_shell_collapsed`
   · 外壳状态写到 `<html data-shell="expanded|collapsed">`：fixed 居中浮层用
     `--shell-nav-w-active` 对齐内容列、页面高度用 `--shell-chrome-h-active`（顶栏 + 状态条）
     扣掉外壳；`--page-max` 由 1440px 改为真实的 **79em**
6. **Inter Variable**：新增依赖 `@fontsource-variable/inter`（自托管、CSP 安全），kumo 主题的
   标题面/正文面/数字面全部改用它 —— 这正是 dash 的观感支柱之一。
7. **组件模式落到页面**：AdminPage 改成**主列 + 右栏**两栏（真实账号页的结构），数据统计从
   "九宫格统计块"改成**卡片内的指标行**（标签在左、20px 数值在右、行间发丝线），开放注册的
   胶囊按钮改成**真正的 Switch**；FileList 的视图切换改成**分段控件**（recessed 轨道 + 白色滑块）。

**仍然没对齐真实界面的地方**（下次可做）：登录后的"账号首页"那种仪表盘内容（我们首页仍是模块入口
网格）、卡片内嵌折线图、侧栏可折叠分组（真实有 `最近访问` 这类 chevron 分组与两行式条目）、
顶栏的 `Ask AI`/支持入口（我们没有对应功能）。

## 7. 刻意不做

- **不引入 React/Base UI/Tailwind**：我们是 SolidJS + CSS Modules，照搬组件库没有意义，照搬的是**数值与判据**。
- **不自托管 Inter**：CSP 与首屏体积都不划算，系统无衬线栈已经够近（本机装了 Inter 会自然取到）。
- **不照抄 1400px 容器给单列设置页**：Kumo 那个宽度是给列表页/仪表盘的，设置页仍取标准内容页档。
- **不改成 `light-dark()` 单表**：我们的四主题（现五个）机制比它更灵活，改过去是降级。
- **不动其他页面**：link/button 等共享原子只在"令牌层面"变化（`--t-color-action`），
  其余页面的几何与动效保持原状，避免一次改一大片。

## 8. 怎么验证效果

```bash
just dev                      # 后端 + 前端
# 浏览器打开 http://localhost:3001/color → 选"冷灰 · 品牌蓝"，再对比 /admin 与 /file?view=list
pnpm run check && pnpm run test   # 前端门禁
```

回退：`data-theme` 换回 paper 即恢复原语音；页面级改动都在各自模块的 CSS 里，逐个 `git diff` 可辨。
