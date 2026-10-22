# 前端开发指南

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

## 技术栈

- SolidJS 1.9 + @solidjs/router
- Vite+（Vite 8 / Rolldown / Vitest 5 / Oxlint / Oxfmt）；格式与静态检查都走 `vp check` / `vp lint` / `vp fmt`，配置内嵌在 `web/vite.config.ts` 的 `fmt` / `lint` 段
- CSS Modules（`localsConvention: "camelCaseOnly"`）+ stylelint 17（`stylelint-config-standard`）
- 测试：Vitest 5（按扩展名分 node / jsdom 两个 project）；页面级 e2e：Playwright（`just e2e`）

## 目录结构

```
web/src/
├── app/            # 入口 index.tsx、Layout、路由定义、路由预取、auth 上下文、global.css
├── capabilities/   # 跨域能力：chat / home / quick-capture / search
├── domains/        # 业务域：task / card / mem / ontology / reading / bookmark / text / conv
├── platform/       # 平台能力：auth / admin / file / db / key / ai-setting / command-palette
├── tools/          # 独立小工具：color / rainbow
├── components/     # 共享 UI
│   ├── MarkdownEditor.tsx      # 编辑器（不在 ui barrel 里）
│   └── ui/
│       ├── atoms/      # Badge Button InfoHint Input Layout(Row/Stack)
│       │               #   Markdown(+MarkdownCore) SearchInput Select Skeleton
│       │               #   Spinner Textarea Tooltip（+ control.ts：表单控件的共享机制）
│       ├── molecules/  # AsyncSection AsyncView BackLink EmptyState ErrorRetry
│       │               #   Field FilterGroup PageHead Panel SegmentedControl
│       │               #   SimplePagination Toolbar（TagInput / TagFilter 见下）
│       ├── organisms/  # ConfirmModal DetailPage ListPage Modal PageFrame
│       │               #   SplitWorkspace Toast
│       └── icons/      # 图标统一入口（solid-icons 白名单，语义化导出）
├── config/         # paths / navigation / module-registry / module-cards 单一来源
└── shared/         # ai / api(+query, types) / errors / markdown / styles / utils(+format)
```

`components/ui/index.ts` 是唯一扁平 barrel，但 **`TagInput` / `TagFilter` 刻意不在里面**：
它们只被懒加载页面（file / bookmark）用到，从 barrel 导出会把它们塞进入口也加载的共享 chunk
（实测首屏同步链 +12.7 KB，改成按路径 import 后回到 +1.7 KB）。`MarkdownEditor` 同理——
它住在 `components/` 根、不经过 ui barrel。组件该放哪层、何时该拆 → [component-design.md](./component-design.md)。

## 路由单一来源

1. `config/paths.ts` 定义所有路径常量（`PATHS`，父子路径由父常量拼接派生）；`fillPath()` 替换 `:id`，`isConcretePath()` 判定"可直接跳转的实路径"（模板路径 `/file/:id` 不算）
2. `config/navigation.ts` 定义导航元数据（`NAV_ITEMS`：`path` / `label` / `title` / `desc` / `nav`）
3. `app/routes.ts` 根据 `PATHS` 穷尽加载懒路由组件（`PAGE_LOADERS` 是 `Record<PathValue, PageLoader>`，漏加直接编译失败）

新增页面必须三步：`paths` → `navigation` → `routes`。调用点一律使用 `PATHS.xxx`。
详情页的数据预取在 `app/route-preloads.ts`（只登记"与页面用同一参数再取一次"的路由，
且只对 `intent === "preload"` 生效——导航/首屏时不预取）。

## 模块自包含

模块按**物理层**分目录（`domains/`、`capabilities/`、`platform/`、`tools/`），模块名 = 层目录下一级；
分类登记在 `config/module-registry.ts`（`MODULE_KINDS`），新增模块不登记会直接挂测试。

- 每个模块目录有 `index.ts` 导出对外 API/页面
- 跨模块只通过 `index.ts` 导入；**根级文件也算公开入口**（页面、`api.ts`、root 级支撑件），
  可以按路径引（如 `@modules/file/FileList.tsx`、`@modules/file/markdown-editor-support.tsx`）——路由表就是这么引页面的。
  `components/`、`view/`、`model/`、`data/`、`viewers/` 属内部实现，只能走 barrel
- 模块内部统一四件：`model/`（纯规则）、`view/`（页面状态）、`data/`（多文件数据适配）、`components/`。
  **不再有 `hooks/` 与 `lib/`**（`app/layer-boundaries.test.ts` 断言这两个目录不存在，旧代码应迁到 `view/` / `model/`）
- 模块类型有依赖方向：domain 不依赖 capability；platform / tool 不编排业务；domain 之间只允许登记契约。
  另有两条：barrel 不转出 `components/` / `view/` 实现；`view/` 与 `components/` 不直接 import 传输层
  （`@shared/api/request.ts` / `cache.ts` / `streaming.ts`，一律经 `api.ts` 或 `data/`）
- 需要给别的模块用、但引 barrel 又会把整个模块（连同页面与其 CSS）拖进调用方 chunk 的
  支撑件，放**模块根**并只牵它真正需要的子件。范例：`platform/file/markdown-editor-support.tsx`
  给 `MarkdownEditor` 注入上传与"从文件库挑选"能力（共享组件不得反向依赖模块）
- 模块可以有自己的**扩展点目录**：如 `platform/file/viewers/` 是文件预览的查看器注册表
  （加一个文件类型的预览 = 写一个组件 + 注册表加一条，见 `doc/design/file-service.md` §8.4）
- alias：`@app` `@domains` `@capabilities` `@platform` `@tools` `@components` `@shared` `@config`；
  `@modules/<name>` 是**兼容别名**，由 `config/module-registry.ts` 映射到对应物理层（新代码优先用层别名或模块公共入口）

## 应用外壳：main 上**没有**（探索在 `design/swiss` 分支）

**两级外壳别混淆**：`ListPage` / `DetailPage` 是**页面外壳**（页头 + 四态，见下一节），它们是真的；
"左侧模块轨道 + 顶栏 + 状态行"的**应用外壳不在 main 上**。

现状（改外壳前先读这段）：

- `app/Layout.tsx` 只做四件事：`<RouteTitle />`、`<main class={styles.content}>` 里的 `AuthGuard` + `ErrorBoundary`、
  以及常驻浮层（`AuthDialog` / `CommandPalette` / `QuickCapture` / `ToastContainer` / `ConfirmModalContainer` / `AiSettingsModal`）。
  **没有侧栏、没有顶栏、没有状态行**，内容占满视口。
- `app/App.module.css` 只有三条规则：`.shell`（flex column，`min-height: 100vh`）、
  `.content`（`height: 100dvh` + `overflow-y: auto`，全站唯一滚动容器）、`.crash`（错误边界的可见失败态 + 重试入口）。
  没有 `--shell-*` 令牌。

**分支探索（未合入 main，别写成现状）**：`app/AppShell.tsx`、`app/AccountMenu.tsx`、`app/shell.ts`、
`app/shell-nav.ts`、58px 顶栏与状态条、`--shell-*` / `--t-color-nav-*` 令牌、AdminPage 与 FileList 的重排，
都在 **`design/swiss` 分支**（`git ls-tree design/swiss -- web/src/app` 可核实，未合入 main）；
它的视觉规格是 [swiss-design-language.md](../design/swiss-design-language.md)（提案，main 的视觉仍是 Hallmark 编辑风，见本文「设计令牌」）。
三条别记错：
- `AGENTS.md` 旧说的 `design/kumo-skin` 分支与提交 `627b19da` **在本仓不存在**（`git cat-file -t 627b19da` 报 `Not a valid object name`）；
- Kumo 组件曾由 `31ffdb3d` 收编、又被 `7c0b8d54`（2026-10-18，`refactor(web): clean up task architecture and remove Kumo`）删除，`web/src/components/kumo/` 与 `@photon-ai/base-ui-solid` / `cnfast` 依赖都不在 main；
- [kumo-design-language.md](../design/kumo-design-language.md) 是**调研**（dash.cloudflare 的实测数值与判据），可当参考、不能当实现依据。
真要重做外壳，四条硬约束仍然成立（`.shell` 定高 / `.content` 唯一滚动容器 / fixed 浮层对齐内容列而非整个视口 / 页面别写裸 `100vh`）。

## 页面外壳与数据范式

列表页与详情页各有一套外壳，**新页面直接用，不要重写页头/四态**：

| 场景 | 外壳 | 数据源 |
|------|------|--------|
| 列表页 | `ListPage`（页头 + 筛选槽 + 四态列表 + 页脚槽） | `useListResource` |
| 详情页 | `DetailPage`（返回栏 + 唯一 h1 + 动作区） | `useDetailResource` |
| 单实体异步区 | `AsyncSection`（error → loading → empty → data） | 收 accessor |
| 列表异步区 | `AsyncView`（loading → error → empty → data） | 收 accessor |

三个数据源原语都在 `shared/api/query/`（`useListResource` / `useDetailResource` / `useMutation`）。

- **外壳只组合结构、不管视觉**：容器宽度与内边距由调用方给（各页用 `--page-max` /
  `--page-text-max` 等不同令牌）；`filters` / `footer` 原样渲染、不加包装层。
- 两件默认行为被写进外壳：**页头必有唯一 h1**、**列表必接四态**。`DetailPage` 的
  `titleHidden` 用于"标题已在内容里显著展示"的页面（h1 走 sr-only）。
- `loading` / `error` 一律用 **getter** 暴露，不要写值快照（会在建对象那一刻冻结成初始值）。
- **resource 的 fetcher 不要抛错**：应用虽有错误边界，但抛错会中断响应式更新、资源卡在
  `loading`，页面就只剩骨架屏（P1-5 的成因）。统一在 fetcher 内消化异常、经独立信号暴露错误。
- 列表写操作走**乐观更新**：`useListResource` 的 `optimistic` 先改本地、再发请求、成功不 refetch、
  失败回滚快照（`AsyncView` 在 loading 时渲染骨架，整表重取会闪一下）。

## 共享 UI

统一从 `@components/ui` 导入：

| 组件 | 用途 |
|------|------|
| `Button` | primary / secondary（默认）/ outline / ghost / danger / dangerSolid / warningSolid / icon；`size` 两档（sm 28px / md 36px） |
| `Input` / `Select` / `Textarea` | 表单控件原语（`Field` 负责 label 关联、`aria-describedby`、`aria-invalid`） |
| `Field` | 表单字段：id 生成 + label 关联 + 错误提示。**需要可见标签的表单一律用它** |
| `Row` / `Stack` | 布局原语（正交映射，只映射一个 CSS 属性）。只用于新代码的 `div` 容器 |
| `InfoHint` | 界面上的解释文字收进 `ⓘ` 气泡（状态留在界面上，解释收进气泡） |
| `SearchInput` | 统一防抖搜索框 |
| `FilterGroup` / `SegmentedControl` | 分段筛选 / 分段控件 |
| `AsyncView` / `AsyncSection` | 四态（列表 / 单实体） |
| `ListPage` / `DetailPage` / `PageFrame` / `SplitWorkspace` | 页面外壳与版式 |
| `PageHead` / `Toolbar` / `BackLink` / `Panel` | 页头 / 工具条 / 返回链接（`<a>`） / 面板 |
| `SimplePagination` | 分页 |
| `Modal` / `ConfirmModal` + `showConfirm` | 弹层 / 危险操作确认 |
| `Toast` + `notify*` | 全局提示（错误与提示的完整口径见 [error-handling.md](./error-handling.md)） |
| `Spinner` / `Skeleton` / `Tooltip` / `Markdown` | 加载态 / 骨架 / 气泡 / Markdown 渲染 |

优先复用共享组件；**共享组件内部也必须用原语**（不得自写 `.btn` / `.input`）。

## 样式引用的两条契约（有测试与类型门禁，务必遵守）

CSS 产物是构建期生成的，TS 里手写字符串引用它时**编译器看不见**——这两条都由门禁兜住：

1. **类名**：`styles.someKey` 属性访问；**禁止** `styles["kebab-name"]` 与 `styles[动态索引]`。
   vite 配的是 `localsConvention: "camelCaseOnly"`，kebab 键根本不在导出对象里（取值为
   `undefined`，渲染时静默丢失样式）。由 `shared/styles/css-modules-contract.test.ts` 拦下。
2. **令牌名**：Canvas 等拿不到 CSS 的地方读令牌，必须走 `readToken(name: TokenName)`
   （`shared/styles/tokens.ts`）。写错名字是编译错误；新增令牌的顺序是
   **① `tokens.css` 定义 → ② 加进 `TOKEN_NAMES`**（`tokens-contract.test.ts` 校验同步）。

样式值一律留在 CSS 里：TS 只传自定义属性（如 `style={{ "--card-accent": m.color }}`），
由 CSS 用 `var()` + `color-mix` 消费。不要在 TS 里拼 ``${color}14`` 这类值，
也不要把 `var(...)` 塞进 SVG 表现属性（`stroke=` / `fill=`）——表现属性不按 CSS 声明解析，
`var()` 在其中的支持跨浏览器不一致。软底/描边一律 `color-mix` 从实底令牌派生。

## 设计令牌

- `web/src/shared/styles/tokens.css`：`--t-color-*` / `--t-font-*`（随主题）+ `--m-*` 模块识别色 + `--shadow-*` + `--toast-*`
- `web/src/app/global.css`：`--space-*` / `--radius-*` / `--text-*` / `--page-*-max` / `--z-*` / `--leading-*` / `--t-transition-*`（布局常量，不随主题）

规则：

- 颜色用 `var(--t-color-*)`，间距用 `var(--space-*)`，圆角用 `var(--radius-*)`
- 禁止在模块 CSS 里硬编码 hex / rgb / oklch（`tokens.css` 头部硬规则：语义色的阴影/描边/软底一律 `color-mix` 从实底令牌派生）
- 三个实底主题 + auto：`paper`（暖纸 · 目录绿，默认）/ `midnight`（暗夜 · 墨绿）/ `ocean`（冷蓝 · 晴空）—— auto 跟随系统，经 `resolveTheme` 落成 paper/midnight
- 字体三面：`--t-font-display`（Fraunces Variable + Noto Serif SC Variable，`h1`-`h3` 全局应用）/ `--t-font-body`（系统栈 + 中文面点名）/ `--t-font-mono`（JetBrains Mono Variable）；均为自托管 `@fontsource-variable`
- 字号三档在 `shared/styles/theme.ts`（只改根字号，所有 rem 等比缩放）
- 兼容 `@media (forced-colors)` 与 `@media (prefers-contrast: more)`
- 完整速查与映射见 [design-tokens.md](./design-tokens.md)

## 时间显示

- 后端返回 UTC 字符串，前端展示用 `fmtLocal` / `fmtFull`（`shared/utils/format/time.ts`）
- 排序/比较用 `parseUtc`
- 不要直接 `new Date()` 裸解析缺 `Z` 的 UTC 串

## 命令

```bash
cd web
pnpm install
pnpm run dev        # vp dev --mode dev（代理 /api → :3000，读 config/app.dev.toml）
pnpm run check      # vp check + stylelint（format/lint/typecheck，提交前必过）
pnpm run lint       # vp lint --fix + stylelint --fix
pnpm run test       # vp test run（Vitest 5；test:watch 常驻）
pnpm run build      # vp build --mode prod（读 config/app.prod.toml）
pnpm run e2e        # playwright test（等价于 just e2e）
```

web 改动提交前跑 `pnpm run check && pnpm run test`；页面级冒烟用 `just e2e`（见 [e2e-smoke.md](./e2e-smoke.md)）。
