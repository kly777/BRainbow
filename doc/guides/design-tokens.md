# 设计令牌 — 全站视觉系统速查（Hallmark · editorial）

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 单一事实源：`web/src/shared/styles/tokens.css`（颜色 / 字体 / 阴影，随主题）·
> `web/src/app/global.css`（布局常量：圆角 / 间距 / 字号 / 页宽 / 层级 / 动效，不随主题）。
> 本页是速查与映射规则；全站全局 CSS 只有三个——这两份加 `web/src/components/ui/atoms/markdown.css`。
> 视觉语音是 **Hallmark 编辑风（`tokens.css` 头部 `genre: editorial`）**：衬线大标题、暖纸底、oklch 语义色、
> 柔半径与低透明度阴影、九个彩虹模块色。想要"瑞士／国际主义"那套（Inter 单家族、零圆角零投影、单一信号色）
> 是**另一份提案** [swiss-design-language.md](../design/swiss-design-language.md)（`design/swiss` 分支，未合入 main），
> 不是当前实现，别按它改样式。

---

## 1. 令牌来源（勿在本文件外再定义一份）

| 层 | 文件 | 内容 |
|----|------|------|
| 颜色 + 字体 | `shared/styles/tokens.css` | `--t-color-*`（主题契约 + 语义色 + 徽章/阅读标注/Toast）、`--t-font-*`、`--m-*` 模块识别色、`--shadow-*`、`--t-ring-accent`、`--t-mask-blur` |
| 布局常量 | `app/global.css` | `--radius-*`、`--space-*`、`--text-*`、`--page-*-max`、`--leading-*`、`--z-*`、`--t-transition-*`、`--ease-out-expo`、`--duration-*` |

**尺度不随主题变**：三套主题只换颜色与阴影；圆角 / 间距 / 字号 / 页宽 / 行高 / 层级完全一致。
字号档位（theme.ts 的 `fontScales`）改的是 `<html>` 根字号，所有 rem 等比缩放——它不新增第二套 `--text-*`。

## 2. 字体与字号

```css
/* 三面，都是自托管 @fontsource-variable（CSP 安全：font-src 'self'） */
font-family: var(--t-font-display); /* h1-h3 已全局应用；Fraunces Variable + Noto Serif SC Variable */
font-family: var(--t-font-body);    /* 正文；系统栈（Segoe UI / Roboto / Helvetica / Arial） */
font-family: var(--t-font-mono);    /* 代码 / kbd / 路径 / ID：JetBrains Mono Variable */
```

- **display 面是编辑风的载体**：`h1`-`h3` 在 global.css 里统一 `font-family: var(--t-font-display)` + `font-weight: 600` + `letter-spacing: -0.01em`。
- **正文栈里三平台的中文面都点名**（PingFang SC / Noto Sans SC / Microsoft YaHei）：不点名，中文会落回浏览器默认（Windows 上常是宋体），笔画被抗锯齿吃掉。拉丁面排在中文面之前是有意的——拉丁字体里没有汉字，混排时各取各的。
- **没有专用的"数字字体"令牌**：需要等宽数字时用 `font-variant-numeric: tabular-nums`（属性，不是令牌），或直接 `--t-font-mono`。
- 字号阶梯（`--text-*`，global.css）：`2xs` 0.625rem(10px) · `xs` 0.75(12) · `sm` 0.875(14) · `base` 1(16) · `lg` 1.125(18) · `xl` 1.375(22) · `2xl` 1.75(28) · `3xl` 2.125(34)。
- 行高（`--leading-*`）：`tight` 1.4（卡片/列表/徽章）· `normal` 1.6（正文默认）· `relaxed` 1.8（长文阅读）。
- 表单控件的 `line-height: 1.15` 是**控件高度的基准**（高度 = 行高 × 字号 + 内边距 + 边框，见 global.css 的表单控件块），别随手改。

## 3. 主题

三套实底主题 + `auto`，靠 `:root[data-theme]` 切换；`auto` 由 `theme.ts` 的 `resolveTheme` 解析成 paper 或 midnight
（跟随 `prefers-color-scheme`），**DOM 上只会出现具体主题名**。持久化键 `brainbow_theme`，缺省 paper。

| 主题 | 标签 | 气质 |
|------|------|------|
| `paper` | 暖纸 · 目录绿 | 默认；浅色，accent 为目录绿 `oklch(50% 0.08 165deg)` |
| `midnight` | 暗夜 · 墨绿 | 暗色；实底色转为亮色（L 68–78%）配深墨字，保证 ≥6:1 |
| `ocean` | 冷蓝 · 晴空 | 浅色；accent 走蓝（`oklch(52% 0.14 255deg)`） |
| `auto` | 跟随系统 | 不是第 4 份令牌块，只是 paper/midnight 的解析规则 |

主题契约令牌（每套主题各写一份）：`bg` / `surface` / `surface-raised` / `ink` / `ink-strong` / `ink-muted` / `ink-faint` /
`border` / `border-strong` / `accent` / `accent-strong` / `accent-soft` / `accent-ring` / `on-solid` / `overlay` / `white`，
外加语义色 `danger(-strong/-subtle)` / `success(-subtle)` / `warning(-strong/-subtle)`、
五组徽章色 `--t-color-badge-{new,learning,review,suspended,relearning}-{bg,text}`、
阅读标注色 `--t-color-mark-*`（不随主题：认识/不认识/推荐等标记）与 `--toast-*`。

无障碍与偏好适配（前两条是 tokens.css 末尾的媒体查询，后两条由 theme.ts 的显式开关驱动、且 reduced-motion 有 CSS 兜底），**都不需要组件各写一份**：

- `@media (forced-colors: active)`：全部降级为系统语义色（Canvas / CanvasText / Highlight / GrayText）。
- `@media (prefers-contrast: more)`：弱化文字加深（`ink-muted → ink-strong`，`ink-faint → ink-muted`），描边升级到 `border-strong`。
- `@media (prefers-reduced-motion: reduce)`：全局把动画/过渡压到 0.01ms（块级 `stylelint-disable` 豁免）；另有显式开关 `<html data-motion="reduced">`（theme.ts 的 `applyMotionPreference`），给"系统级没开但自己不想看动效"的人。
- 字号三档：`normal` / `large`(1.125) / `extraLarge`(1.25)，只改根字号（`applyFontScale`）。

**没有**第五个主题、`--t-color-action-*`、`--t-color-nav-*`、`--t-font-numeric`、`<html data-mode>` 这一套——
那些是历史提案（Kumo 皮肤），不在 main；Kumo 组件本身也已在 `7c0b8d54`（2026-10-18）删除。

## 4. 硬规则（stylelint 之外的设计门禁）

- **禁止内联色值**：组件/模块 CSS 里不得出现裸 `oklch()` / `hex` / `rgb()`（tokens.css 头部硬规则）。
  语义色的软底/描边/阴影一律 `color-mix(in srgb, var(--t-color-danger) 12%, transparent)` 从**实底令牌**派生，
  这样换主题时色相不泄漏。
  现存例外（都在代码里写明了理由）：① 文件/图片预览的暗色面板与缩略图色相
  （`platform/file/FileList.module.css`、`viewers/viewers.module.css`）——与主题解耦是 3DGS / 图片查看器的既定要求；
  ② `var(--token, #fallback)` 形式的兜底；③ 打印样式（`#fff`/`#000`）。另有极少数历史遗留内联值
  （如 `platform/file/components/ImageLightbox.module.css` 的 `#e8e8e8`），改到那一片时顺手收进令牌，别当范例抄。
- **颜色只从 `--t-color-*` 取**（模块识别色用 `--m-*`）；间距用 `--space-*`，圆角用 `--radius-*`。
- **模块识别色 `--m-*` 是小面积标识**：图标、徽章、左侧色条（如 `BookmarkPage` / `BookmarkDetail` 的 3px 竖条）、
  选中描边。别拿它铺整块容器底色。`--m-task` 直接绑 `--t-color-accent`，其余八个是主题无关的固定色相。
- **阴影只从 `--shadow-sm|md|lv3|lg` 取**：浅色主题是低透明度黑（5–10%），暗色主题更暗更扩散（40–60%）；
  浮层（下拉/弹窗/命令面板）用 `--shadow-lv3`（三层叠加的边界 + 落影）。不要再写一次性 `box-shadow`。
- **圆角按档位**：`--radius-2xs` 2px · `xs` 4 · `sm` 6 · `md` 8 · `lg` 12 · `xl` 16 · `2xl` 24 · `full` 999。
  控件用 `sm`/`md`（Button 是 `--radius-sm`，Input/Select/Textarea 是 `--radius-md`），卡片/面板用 `lg`/`xl`，胶囊用 `full`。
- **焦点环只有两处实现**（都在全局，组件别重复声明）：`:focus-visible { outline: 2px solid var(--t-color-accent); outline-offset: 2px }`；
  输入类 `input/textarea/select:focus { border-color: accent; box-shadow: var(--t-ring-accent) }`（3px accent 环）。
  坑：那条输入类规则特异度是 (0,1,1)，模块里的 `:hover` 规则 (0,2,0) 会压过它——**模块级 hover 必须写成 `:hover:not(:focus)`**，否则悬停会让焦点边框失效。
- **动效只用三档过渡**：`--t-transition-fast` 120ms / `normal` 200ms / `slow` 300ms，缓动 `cubic-bezier(0.2, 0, 0, 1)`；
  入场动画用 global.css 的 `fade-in` / `fade-in-up` / `fade-in-scale` / `slide-in-down` 关键帧配
  `--ease-out-expo`（`cubic-bezier(0.16, 1, 0.3, 1)`）与 `--duration-fade-in`(400ms) / `--duration-slide-up`(500ms) / `--duration-scale-in`(350ms)。
  `transition: all` 一律列明属性（全局 `button`/`[role="button"]` 的过渡已写在 tokens.css，别重复）。
- **层级用 `--z-*`，不猜数字**：sticky 10 · dropdown 100 · palette 200 · overlay 500 · modal 1000 · confirm 1100 · toast 2000。
- **断点按约定写**（`@media` 不能放 var）：480 超小屏 / 600 小屏 / 768 平板（主力） / 1024 桌面窄屏。
  **组件级自适应优先 `@container`**（宿主元素声明 `container-type: inline-size`）；页面级布局才用 `@media`。
- **控件高度同档**：Button `sm` 1.75rem(28px) / `md` 2.25rem(36px)；输入类由 global.css 给 `min-height: 2.25rem`，
  `Control` 另有 `.size-sm` / `.size-lg` 内边距档。同一行的控件取同一档——这条靠评审守，**没有** `--control-h-*` 令牌，
  也**没有**几何审计的 e2e 用例。
- **图标**统一走 `@components/ui/icons`（solid-icons 白名单，语义化导出），禁 emoji 与字形充当图标。
- **禁止 `!important`**（stylelint `declaration-no-important`）：只有打印样式与 reduced-motion 两块做了块级豁免。
- 界面上的**解释文字**收进 `InfoHint`（`@components/ui`）：状态留在界面上，解释进气泡。

## 5. 映射规则（旧 ad-hoc 值 → 令牌）

| 旧值 | 替换为 |
|------|--------|
| **padding / margin / gap** | |
| 2px | `var(--space-2xs)` |
| 3–4px | `var(--space-xs)` |
| 8px | `var(--space-sm)` |
| 12px | `var(--space-md)` |
| 16px | `var(--space-lg)` |
| 24px | `var(--space-xl)` |
| 32px | `var(--space-2xl)` |
| 40px | `var(--space-3xl)` |
| **font-size** | |
| 10px | `var(--text-2xs)` |
| 12px | `var(--text-xs)` |
| 14px | `var(--text-sm)`（工具面正文：表单控件、卡片/列表标题） |
| 16px | `var(--text-base)`（长文/对话/书写面） |
| 18px | `var(--text-lg)`（区块标题） |
| 22px | `var(--text-xl)`（页头/详情页标题） |
| 28px | `var(--text-2xl)` |
| 34px | `var(--text-3xl)` |
| **border-radius** | |
| 2px | `var(--radius-2xs)` |
| 4px | `var(--radius-xs)` |
| 6px | `var(--radius-sm)`（控件） |
| 8px | `var(--radius-md)`（输入类 / 卡片内块） |
| 12px | `var(--radius-lg)` |
| 16px | `var(--radius-xl)` |
| 24px | `var(--radius-2xl)` |
| 999px / 50% 胶囊 | `var(--radius-full)` |
| **transition 缓动** | |
| `ease` / `linear` / 自定义贝塞尔 | `var(--t-transition-fast\|normal\|slow)` |
| `transition: all` | 列明具体属性 |
| **阴影** | 一律换成 `--shadow-sm\|md\|lg\|lv3`，别写一次性值 |
| **z-index** | `--z-sticky\|dropdown\|palette\|overlay\|modal\|confirm\|toast` |
| **页面宽度** | `--page-max` 1440px（工作台）/ `--page-text-max` 900px（长文与会话）/ `--page-content-max` 760px（内容页）/ `--page-narrow-max` 680px（表单/学习卡） |

## 6. 不改的内容

- 百分比值（`width: 100%` 等）
- 特殊值（`border-radius: 50%`、`padding: 0`、`font-size: 2em` 等已有语义的）
- 响应式 `@media` 中的值
- Toast 专用令牌（`--toast-*`，由语义色 + 当前墨水派生，三主题自动成立）
- 上述三类"必须内联色值"的例外（文件预览面板 / 兜底 fallback / 打印）
- 第三方 normalize / reset CSS
