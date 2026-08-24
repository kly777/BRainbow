# Design — BRainbow

BRainbow 全站锁定设计系统。所有页面/组件的视觉改动先读本文件；系统需要生长时
修订本文件，而不是在页面里局部覆盖。由 hallmark redesign（全量重建）产出。

## Genre

editorial × utilitarian —— 个人书房工具：排版有声音，工作台保持密度。

## Theme 架构

保留三主题（`data-theme` 切换）：**paper**（暖纸·目录绿，默认）/ **midnight**（暗夜）/
**ocean**（冷蓝）。令牌名 `--t-*` 是全站契约，不得改名；值见 `web/src/lib/styles/tokens.css`。

- accent 占比每屏 ≤ 5%：accent 只出现在链接、焦点环、选中态、语义徽章。
- primary 按钮用墨色（ink）填充，不用 accent。
- 语义色（danger/warning/success）的阴影、描边、软底一律用
  `color-mix(in srgb, var(--t-color-*) N%, transparent)` 从实底令牌派生，
  **禁止内联 oklch/hex**——这是硬规则，防止主题色相泄漏。

## Typography

| 角色 | 字体 | 用途 |
| --- | --- | --- |
| Display | `"Fraunces Variable", "Noto Serif SC Variable", Georgia, "Songti SC", serif` | 页面标题、区块标题、空态大字、品牌字、landing 大字；weight 560–640，roman（禁 italic） |
| Body | system 栈（PingFang SC / Noto Sans SC / Segoe UI…） | 全部 UI 与正文 |
| Mono | `"JetBrains Mono Variable", ui-monospace, …` | 数字统计、kbd、代码块、时间戳 |

- 自托管：@fontsource-variable 三包，vite 打包，无外部请求，兼容 CSP。
- 中文标题走 Noto Serif SC 可变字体的 unicode-range 子集，按需加载。
- 展示级字号锚点：landing 大字 clamp(2.5rem, 7vw, 4rem)；应用页标题 --text-2xl。

## Spacing / Radius

沿用 `global.css` 的 4pt 系（--space-* / --radius-* / --text-*）。组件只准引用
命名令牌，禁止裸值。圆角语音：**小圆角矩形**（控件 radius-sm，容器 radius-md/lg）；
pill 仅留给 chip/badge/头像。

## Macrostructure family

同族共享形状，族内只变奏构件：

- **Marketing（Landing `/`）**：Long Document —— 左偏置书信体开篇，彩虹语义 =
  一条五色细规线（禁止渐变填字），模块清单为目录式行列而非等宽卡网格。
- **App 工作台页**：Workbench —— 统一页头节奏（display 标题 + 弱化说明 + 动作区），
  主/侧不对称构图，密度优先。
- **Content 内容页**（阅读/会话/文本）：Reader —— 65ch 行长，--leading-relaxed。

## Motion · motion-cut

- 缓动只有两族：`--t-transition-fast/normal/slow`（expo-out）；入场 fade ≤ 200ms。
- **禁止** `--ease-spring`（弹跳贝塞尔已废除）、全局 `.content > *` 入场动画、
  区块阶梯延迟、hover 多信号叠加（每元素一个信号：变色或 1px 位移）。
- reduced-motion 全局兜底已有，勿在组件内再写动画覆盖它。

## Microinteractions stance

silent success（可见的保存不弹 toast）· tooltip hover 800ms / focus 0ms ·
确认框只用于不可逆操作 · 焦点环瞬时出现不动画 · toast 固定角落不推挤内容。

## CTA voice

- Primary：墨色填充矩形（radius-sm），白字/on-solid，hover 加深一档 + 阴影单信号。
- Secondary：hairline 边框矩形，surface 底。
- Danger：danger 描边 ghost，hover 染 danger-subtle。
- 文案动词开头，≤ 4 字优先。

## Icon

单一 stroke 体系：手写 SVG（Heroicons outline 风，stroke-width 1.5，round cap/join），
经 Icon 复用或直接内联。**禁止 emoji 充当功能图标**。

## Per-page allowances

- Landing 可用 Tier-A/B 装饰（CSS/SVG 手绘），仅限五色规线与排版构成。
- App 页零装饰，功能即页面。
- 内容页 typography only。

## What pages MUST share

三主题令牌、字体三角色、按钮语音、页头节奏、accent 纪律、motion 纪律。

## What pages MAY differ on

族内宏观结构变奏、主/侧构图比例、列表 vs 画布的密度。

## Exports

单仓自用，导出物即 `web/src/lib/styles/tokens.css` + `web/src/app/global.css`
（Tailwind/DTCG/shadcn 格式本项目不需要）。

---

## Hallmark 记账

- 2026-08-25 · hallmark redesign · scope: app · genre editorial · families:
  Long Document(marketing) / Workbench(app) / Reader(content) · fonts:
  Fraunces + Noto Serif SC (display) / JetBrains Mono (mono) · 基线重建：
  tokens/global/Button/Landing/Home + 语义色派生修复
