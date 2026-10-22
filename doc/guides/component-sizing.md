# 组件大小策略

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 核心原则：**对外 100% 透明，对内 100% 弹性**

组件既不能硬要多大，也不能随便塌掉。父容器想改多大就多大，组件内部自己处理溢出。
本文讲的是 **CSS 盒模型尺寸契约**，不是代码规模（代码行数/拆分判据见 [component-design.md](./component-design.md)）。

---

## 1. 根元素模板

```css
.component-root {
	/* ① 优先读取父容器变量，相对单位兜底 */
	width: var(--cmp-width, 100%);
	height: var(--cmp-height, auto);

	/* ② Flex 子项时可拉伸，由父容器传入 --cmp-flex: 1 覆盖 */
	flex: var(--cmp-flex, 0 1 auto);
	min-width: 0;
	min-height: 0;

	/* ③ 盒模型保护 */
	box-sizing: border-box;
}
```

**解读**：
- 默认 `width: 100%` — 父容器不传任何变量，组件填满
- 默认 `height: auto` — 高度由内容撑开，无内容也不塌成 0
- 默认不拉伸 — 需要拉伸时，父容器传 `--cmp-flex: 1`
- `--cmp-*` 是**组件私有的自定义属性名约定**，不是全局令牌：它不进 `tokens.css`，也不登记在 `shared/styles/tokens.ts` 的 `TOKEN_NAMES` 里（那是给 JS 读主题色用的）。全仓目前只有两个消费点：`CommandPalette.module.css` 的 `width: var(--cmp-width, 40rem)` 与 `TaskDag.module.css` 的 `height: var(--cmp-height, 25rem)`，可当写法范例。

---

## 2. 溢出保护

```css
.component-root {
	/* 宽度溢出：强制换行 */
	overflow-wrap: break-word;
	word-break: break-word;

	/* 高度溢出：滚动，不丢内容 */
	overflow-y: auto;
}
```

**绝对不用 `overflow: visible`（除非 Dropdown / Tooltip 等刻意弹出组件）。**

---

## 3. 内部布局：依赖父组件，不依赖视口

```css
/* ❌ 禁止：组件里写视口算式 */
.component-child { height: calc(100vh - 200px); }

/* ✅ 正确：依赖父组件 */
.component-root {
	display: flex;
	flex-direction: column;
	height: 100%;
}
.component-header {
	flex-shrink: 0;      /* 标题栏固定 */
}
.component-body {
	flex: 1;             /* 内容区填剩余，超出滚动 */
	min-height: 0;
	overflow-y: auto;
}
```

视口高度只在**应用级外壳**里出现一次：`app/App.module.css` 的 `.content { height: 100dvh; overflow-y: auto }` 是全站唯一滚动容器，
页面用 `height: 100%` 撑满它（百分比需要一个确定的高度来源）。**页面与组件里都别再写第二层 `100vh` 算式**——
那会让滚动容器分裂成两个，sticky 头与滚动位置恢复都会错。

---

## 4. 固有尺寸元素：锁定不压缩

```css
.component-icon {
	width: 1.5rem;
	height: 1.5rem;
	flex-shrink: 0;
}

.component-badge {
	display: inline-block;
	padding: 0 var(--space-sm);
	font-size: var(--text-xs);
	line-height: 1.25rem;   /* 高度由 line-height 决定，不写死 height */
	flex-shrink: 0;
}
```

图标与徽章的 px 是**例外**（`design-tokens.md` 第 6 节的"不改的内容"）：它们是有语义的固有尺寸，
但也要用 rem 写，跟随根字号缩放（字号档位会整体放大界面，写死 px 的图标会显小）。

---

## 5. 框架层：CSS 变量通过 style 传入

```tsx
interface ComponentProps {
	style?: JSX.CSSProperties;
	class?: string;
}

// 父容器使用
<CommandPalette style={{ "--cmp-width": "26rem" }} />
```

这条与 `frontend.md` 的样式契约是同一条：**TS 只传自定义属性**，值留在 CSS 里由 `var()` 消费。
不要在 TS 里拼出完整样式串，也不要把 `var(...)` 塞进 SVG 表现属性（`stroke=` / `fill=`）。

---

## 6. 验收标准

写完组件后在 DevTools 检查：

1. **计算值无固定 px** — 除非是图标 / 徽章这类固有尺寸（且写成 rem）
2. **强压测试** — 父容器拉到极窄，组件不溢出，内容换行或滚动
3. **塌陷测试** — 父容器设 200px 高，组件出滚动条，不截断内容
4. **换字号不破版** — 切到"特大"字号档（`theme.ts` 的 `extraLarge`，根字号 ×1.25），布局按比例放大而不是文字互相挤掉

---

## 7. 改造清单（历史记录 + 现状）

这一节原本是一张"一次性尺寸 → 弹性尺寸"的迁移单（六个文件），当时都按本策略改过。
其中 **`TaskKanban.module.css` 与 `TaskList.module.css` 已随 task 模块重写而不存在**
（task 现在只有 `TaskWorkspace` / `TaskFocusPage` / 日历与 DAG 组件）；剩下四个仍在，可当现状对照：

| 文件 | 已落地的写法 |
|------|--------------|
| `platform/command-palette/CommandPalette.module.css` | `width: var(--cmp-width, 40rem)`（调用方可覆盖宽度） |
| `domains/task/components/TaskDag.module.css` | `height: var(--cmp-height, 25rem)` + 内部 flex 列（工具栏 `flex-shrink: 0`、画布吃剩余高度、容器 `overflow: hidden`） |
| `domains/card/components/CardMasonry.module.css` | `column-width: var(--masonry-column-width, 18.75rem)`，断点里改的是**同一个变量**（16.25rem / 15rem / `min(78vw, 15rem)`），不是改 `column-width` 本身 |
| `domains/card/components/Card.module.css` | `width: 100%` + `overflow-wrap: break-word`；标题/副标题用 `overflow: hidden; text-overflow: ellipsis` 单行省略 |

**判据不是"用了变量"，而是"父容器改得动、组件自己不塌"**：新的可嵌入组件照 §1 的模板写；
页面级整块（列表卡片、DAG、命令面板）优先把尺寸收成一个变量、在断点里只改变量值。
