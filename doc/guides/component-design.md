# 组件设计与拆分判据

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 一个组件 = 一个职责 + 一条数据流；跨组件边界**会变的值**一律以 `Accessor` 形式传递。

这份文档回答三个问题：**什么时候该拆**、**拆出来的东西放哪一层**、**什么样的拆分是干净的**。
它只写判据与现状，不重述别处已有的内容。

## 0. 与其它文档的分工

| 文档 | 管什么 | 与本文的边界 |
|------|--------|--------------|
| [frontend.md](./frontend.md) | 技术栈、目录、路由单一来源、页面外壳与数据范式 | 本文只引用，不重述 |
| [design-tokens.md](./design-tokens.md) | 颜色 / 间距 / 圆角 / 动效的取值 | 组件"长什么样"不归本文管 |
| [component-sizing.md](./component-sizing.md) | CSS 盒模型尺寸契约（`--cmp-*`、溢出、不依赖视口） | 名字像，但它讲的是**尺寸**而非代码规模 |
| [frontend-ui-architecture.md](../plans/frontend-ui-architecture.md) | 历史评估与改造计划（原语 / 外壳 / 数据范式的由来） | **冻结快照**：本文引它的结论与已否决项 |
| [frontend-migration-manual.md](../plans/frontend-migration-manual.md) | 迁移手术单（S1–S5 / T1–T3） | **冻结快照**：Hook 行数阈值出自这里，本文把它提升为正式条款 |
| **本文** | 组件边界判据、分层归属、拆分时机、存量债的记录 | —— |

## 1. 本仓的"组件"有四类

| 类别 | 位置 | 一句话判据 |
|------|------|-----------|
| 页面 | `domains/ capabilities/ platform/ tools/` 下模块根的 `*.tsx` | 只组合，不写业务规则 |
| 模块组件 | `<模块>/components/` | 只被本模块用 |
| 共享 UI | `components/ui/{atoms,molecules,organisms}` | 第 2 个使用方出现后上移 |
| 外壳原语 | `ListPage` / `DetailPage` / `AsyncView` / `AsyncSection` | 只管结构、不管视觉 |

依赖方向是单向的：`app → modules → components → shared`（`config` 是零依赖的旁路，谁都能引）；
其中 "modules" 是四个物理层的统称（`domains/ capabilities/ platform/ tools/`），层内的模块分类登记在
`config/module-registry.ts`。**当前全仓零越界**——唯一一处（`MarkdownEditor` 曾硬引 `@modules/file` 的上传与挑选器）已改成
由使用方注入能力；跨模块引用另有两条细则：只走 barrel，或引对方的**根级文件**（页面 / `api.ts` /
root 支撑件），子目录（`components/ view/ model/ data/ viewers/`）属内部实现。两条都由
`web/src/app/layer-boundaries.test.ts` 守着，且它还额外钉住：模块 barrel 不转出 `components/` / `view/` 实现、
`view/` 与 `components/` 不直接 import 传输层、模块类型之间的依赖方向、模块图无环。

模块内部统一四件：`model/`（纯规则）、`view/`（页面状态）、`data/`（多文件数据适配）、`components/`。
**`hooks/` 与 `lib/` 已经取消**——`layer-boundaries.test.ts` 直接断言这两个目录不存在（旧代码迁到 `view/` / `model/`）。

### 容器 / 展示在本仓的对应物

经典模式里那两个名字在这里是：

- **容器** = 模块页面 + 该模块的 `view/`（`useXxx` 返回一束 accessor，页面只负责把它接给子组件）
- **展示** = `<模块>/components/` 与 `components/ui/`（收 props、抛回调，自己不取数）

实测（2026-10-22 口径，`domains + capabilities + platform + tools` 的 `components/` 下、不含测试）：
**99 个文件里 63 个（64%）零响应式原语**——分离度是成体系的。
判断的落点看 `platform/file/FileList.tsx`：状态、拖放、灯箱、滚动恢复全在页面与 `view/` 侧，行级渲染交给
`FileRow` / `FileCard`，而 `FileCard` 再按下钻出 `FileCardView` / `FileCardEdit` 两个纯展示件。

### 原子设计在本仓是四层，不是三层

`atoms → molecules → organisms` 已在用（外加 `components/` 根下的 `MarkdownEditor`）。要补一条本仓判据：

**`AsyncView` / `AsyncSection` / `ListPage` / `DetailPage` 不属于视觉粒度上的 atoms/molecules**，
它们是"结构原语"：判据是**它们自己不含视觉**——容器宽度与内边距由调用方给（各页用 `--page-max` /
`--page-text-max` 等不同令牌），`filters` / `footer` 原样渲染不加包装层。所以把一件东西放进 `organisms/`
的标准不是"它看起来大"，而是"它固定了一套结构契约"（唯一 h1、四态互斥、返回栏位置）。

## 2. FIRST 逐条落到本仓

| 原则 | 本仓判据（可检验） | 违反信号 |
|------|-------------------|----------|
| **Focused** 专注 | 一个文件只做一件事。"第二件事"指：映射表、数学、配置对象、图标 path 常量、纯字符串算法 | 一个文件里出现 `TYPE_CLASS` 之类的表 + 组件 + 副作用三段 |
| **Independent** 独立 | `components/**` 不引模块层（`@domains` / `@capabilities` / `@platform` / `@tools` / `@modules`）；`shared/**` 不引 `@components/**`；能在测试里单独 mount，不需要真后端 | 组件必须靠全局 store 才能渲染，或共享工具反向引 UI |
| **Reusable** 可复用 | 第 2 个使用方出现才上移到 `components/ui/`；同一模块专用就留在模块里 | 出现"复制一份改两行"的第二个页面版本 |
| **Small** 小巧 | 见 §3 阈值 | —— |
| **Testable** 可测试 | 纯逻辑进 `model/` 配直测；组件用 `solid-js/web` 的 `render` + 手写 DOM 断言 | 逻辑只能靠"起浏览器点一遍"验证 |

### 功能内聚优于逻辑内聚

**别因为"都是处理 X"就放一起**。本仓的正反例：

- 正例：`TagInput` 的 `filterTagOptions` / `hasExactTagMatch` / `tagEnterTarget` / `blurClose` 全在
  `shared/utils/tag-combo.ts`（纯函数、有测试），组件只消费；`SearchInput` 用共享 `debounce`；
  四态组件用共享 `getErrorMessage`。
- 反例一：`MarkdownCore.tsx` 一个文件叠了四件事——highlight.js 语言注册、DOMPurify 全局 hook、
  marked 全局配置、三段 DOM 后处理（图片兜底 / 标题锚点 / 代码块复制按钮）。管线已外移到
  `shared/markdown/pipeline.ts`，剩下的 DOM 后处理仍在一个组件里（属"渲染器的三件事"，暂不再拆）。
- 反例二（已收敛，留作教训）：`atoms/Icon.tsx`（10 条内联 path）与 `ui/icons/index.ts`
  （solid-icons 白名单）曾是**两套图标来源**，用量 47 个文件 : 3 个文件，而
  `design-tokens.md` 的图标条款原先指向的是少数派那一套——文档照"当初的意图"写、
  代码照"后来长出来的样子"走，这类漂移只能靠实测比对发现。现已按用量收敛到白名单，
  `Icon.tsx` 删除（10 处图标随之换了字形，是可见变化）。
- 反例三（已修）：`joinClass`（`atoms/control.ts`）与 `join`（`atoms/Layout.tsx`）函数体完全相同，
  两份拷贝。现在只有 `shared/utils/class-name.ts` 的 `joinClass`。

### 90/10 法则：只服务少数页面的件不进 barrel

`ui/index.ts` 是唯一的扁平 barrel，但 `TagInput` / `TagFilter` **刻意不在里面**，注释写着原因：
它们只被懒加载页面（file / bookmark）用到，而从 barrel 导出会把它们塞进入口也加载的共享 chunk——
实测首屏同步链 **+12.7 KB（gzip +3.1 KB）**，改成按路径导入后回到 +1.7 KB。
`components/MarkdownEditor.tsx` 同理：它住在 `components/` 根、根本不进 ui barrel。
判据因此是：**"谁在用"决定从哪导出**，而不是"是不是共享组件"。

## 3. 量化阈值（按本仓分布校准）

外部经验值（"90 行就该拆"、"200–300 行考虑拆分"）**不能照抄**。共享 UI 层的中位数在 50 行上下，
一条 90 行红线会点名职责单一的 `Tooltip`（定位数学 + 视口夹取 + Portal）与 `Layout`（正交映射一个 CSS 属性）。
阈值必须**按层给**，且分"软阈值"与"硬信号"两档。下表的锚点按 **2026-10-22 当前规模复测**
（唯一例外是标注"2026-09 审计口径"的两行——那次审计之后目录重排，Props 与响应式原语两项没有逐文件复测）。

| 对象 | 软阈值（开始考察） | 硬信号（拆，或写明为什么不拆） | 本仓现状锚点 |
|------|------------------|----------------------------|-------------|
| 展示组件 `.tsx` | 150 行 | 250 行 | 全仓非测试 `.tsx` **213 个**，≥300 行 **8 个**（最大 `CalendarTimeGrid.tsx` 707、`SplatViewer.tsx` 609） |
| 页面 `.tsx` | 200 行 | 300 行 | 越线 2 个：`TaskFocusPage.tsx` 445、`FileList.tsx` 389；另有 3 个落在 250–300（`CommandPalette` 282、`MemAdd` 272、`HomePage` 268） |
| Hook（`view/` 里的 `useXxx`） | 100 行（既有契约） | 200 行 | `view/` 下 ≥200 行的 5 个：`usePalette.ts` 364、`useQuickCapture.ts` 255、`suggestions.ts` 250、`useFileDetail.ts` 241、`useDbViewer.ts` 232 |
| Props 字段数 | 10 | 15 | 2026-09 审计口径：曾 4 个 ≥15（`ManageTable` 17、`ManageDetail` 17、`ChatSidebar` 16、`FileCard` 15），已按刀法 ② 收束成 10 / 5 / 7 / 7 |
| 每文件响应式原语（signal / effect / memo / resource / store） | 7 | 10 | ≥10 的 8 个：`usePalette` 16、`ColorEditor` / `SplatViewer` / `TaskDag` / `useCardsList` 各 14…（2026-09 审计口径） |
| 圈复杂度 | 50 | —— | 只作人评审用：Oxlint 的 `complexity` 规则组**没有开启**（`vite.config.ts` 的 `lint.rules` 只覆盖少量规则） |

三条配套判据：

- **提取边界的清晰度**：干净 = 父组件留住状态、副作用与处理器，子组件只收 props 与回调。
  若子组件还需要反向读父组件的状态，说明**拆分点选错了**（该拆的是状态，不是 DOM）。
- **回调束**：穿过两层以上（表格 → 行）的回调不要逐个展开，收成一个对象传。
  本仓范例是 `ManageTable` 的 `RowActions`——17 个 props 的收敛方向就是它。
- **同一机制不得两层各写一遍**：骨架屏曾有两套来源（`AsyncView` 内联的两种形态与
  `atoms/Skeleton.tsx` 的通用横条）。同类物出现两个来源时，"小"已经不重要了，先合并
  ——现在三种形态都在 `atoms/Skeleton.tsx`，样式集中在它的 CSS Module 里。

## 4. 六种拆分刀法（附本仓范例）

| 刀法 | 怎么切 | 本仓范例 |
|------|--------|----------|
| ① 容器 / 展示 | 状态与副作用留在页面 + `view/`，渲染下钻成展示件 | `FileList` → `FileRow` / `FileCard` → `FileCardView` / `FileCardEdit` |
| ② 回调束 | 穿过两层的回调收成一个对象 | `ManageTable` 的 `RowActions`；表格拆在 `domains/mem/components/manage-table/` 子目录 |
| ③ 映射表与控制常量外移 | 表、图标 path、变体类名映射移出组件文件 | `Toast` 的 `TYPE_CLASS` / `IconForType`；`AdminPage` 的内联 SVG 已下钻到 `platform/admin/components/` |
| ④ 纯函数下沉 `model/` | 阈值判断、格式化、分组、解析一律进 `model/` 并配单测 | `platform/file/model/` 25 个纯模块配 23 个直测；反例见体检表 |
| ⑤ 注册表替代分支 | 用注册表 + 一次调度代替"再写一个 if" | `platform/file/viewers/registry.ts`：加一个文件类型 = 写组件 + 注册表加一行 |
| ⑥ 外壳原语吸收易错组合 | 把"每个页面都要重写一遍"的正确组合收进原语 | 四态互斥、唯一 h1、乐观更新（`useListResource` 的 `optimistic`） |

**已否决、别重提**（出处 [frontend-ui-architecture.md](../plans/frontend-ui-architecture.md) §10，冻结快照）：

- `composes` 跨文件收敛 CSS —— 405 处 / 93 个文件的迁移做过并整体回滚，现仓库 0 处；
- 把已有 `div` 批量迁到 `Row` / `Stack` —— 只用于新代码；
- 以 CSS 行数作为达成判据 —— 行数保留为参考量，真正要归零的是"同一视觉原语被反复重新定义"。

## 5. 存量债与已修项（2026-09 审计记录）

> 这一节是 **2026-09 那次改造审计**的结论，用来说明每一类债的**形状与修法**；
> 目录在那之后重排过（`modules/` → 四层、`hooks/` → `view/`、`lib/` → `model/`、`notify.ts` → `shared/errors/`），
> 路径已按**当前结构**改写。它不是当前体检——要体检请重跑实测，别把"当时已修"当成"现在没问题"。

判定口径：✅ 已达标或已修（"修法"列写了落地方式）；⚠️ 有漂移或存量债；❌ 违反已有契约。

| 维度 | 当时的现状与证据 | 判定 | 修法 |
|------|-----------------|------|------|
| 分层方向 | `components/MarkdownEditor.tsx` 曾硬引 `@modules/file/api` 与 `FilePickerModal.tsx`（全仓唯一越界） | ✅ 已修 | "上传 + 挑文件"改成注入的 props（`onUploadFile` / `filePicker`），file 模块在**根级**提供 `markdown-editor-support.tsx` 供注入（不进 barrel，免得把 `FileList`/`FileDetail` 拖进调用方 chunk） |
| 反向依赖 | `shared/api/request.ts`、`shared/utils/notify.ts`、`shared/utils/safe-action.ts`、`shared/api/types/errors.ts` 曾引 `@components/ui` 的两个 store（`request.ts` 还用动态 import 绕圈） | ✅ 已修 | `toastStore.ts` / `confirmStore.ts` 下沉到 `shared/utils/`，四处改静态导入，`request.ts` 的惰性引用与多余 `await` 一并删掉；barrel 按原样再导出，消费者不受影响。后续 `notify` / `tryOrNotify` / 错误类进一步收进 `shared/errors/`（`model` / `notify` / `actions` 三层） |
| 单一来源 | Markdown 渲染管线曾在 `MarkdownCore.tsx` 与 `Markdown.test.ts` 里各写一份，且**已经漂移**：`ALLOWED_ATTR` 测试版含 `"id"`、实现版明确不放行；白名单两处各抄一遍 | ✅ 已修 | 管线（hljs 注册 / DOMPurify 两个 hook / marked 配置 / 白名单 / `renderMarkdown`）抽到 `shared/markdown/pipeline.ts`，组件与测试都 import 它；测试补了三条断言（`id` 被剥离、非 KaTeX 子树 style 被剥离、KaTeX 子树 style 保留） |
| 功能内聚 | `MarkdownCore`（四职责 + import 期副作用） | ⚠️ 部分 | 管线已外移（见上）；剩下的 DOM 后处理三段仍在一个组件里，属"渲染器的三件事"，暂不再拆 |
| 重复实现 | `joinClass` / `join` 双份；两套图标源（`ui/icons` 白名单 47 个文件 vs `atoms/Icon.tsx` 3 个文件 / 11 处）；两个骨架来源（`AsyncView` 内联 vs `atoms/Skeleton.tsx`） | ✅ 已修 | 类名工具进 `shared/utils/class-name.ts`；图标按用量收敛到 `@components/ui/icons` 并删除 `Icon.tsx`（10 处图标换了字形，是可见变化）；骨架三种形态都进 `atoms/Skeleton.tsx` |
| 纯展示比例 | 当时 77 个模块组件文件里 47 个（61%）零响应式原语 | ✅ | 保持；2026-10 复测为 99 个里 63 个（64%）。新组件先问"它需要状态吗" |
| 内联展示组件 | 曾散在页内：`ReadingList.ArticleCard`、`BookmarkPage` 的 `BookmarkLink` + `TagGroupCard`、`TaskManager` 的 `TaskToolbar` / `TaskPanel`、`DbTable` 的 6 个子件、`AdminPage` 全篇（401 行单文件，含 9 条内联 SVG path） | ✅ 已修 | 全部下钻：`platform/db/components/db-table/`（6 件）、`domains/reading` / `domains/task` / `domains/bookmark` 各自的 `components/`、`platform/admin/components/`。行数变化：DbTable 371 → 128、TaskManager 165 → 48、AdminPage 401 → 137（2026-10 实测）；AdminPage 另配 4 条渲染测试 |
| 统一原语采用率 | 曾 29 个文件裸 `createResource`，其中 `KeyPage` 还是"resource + 本地数组"双轨 | ✅ 主体已修 | ① 原语补齐**数组端点**（`page` 可选、返回数组即归一成"一页装下"），于是"端点不分页"不再是绕开原语的理由；② 迁移 8 处；③ `KeyPage` 去掉双轨、乐观更新改 `mutate`。**有意不迁的 4 处**：`AdminPage`（设置对象 + 系统信息对象，既非列表也非按 id 取详情）、`BookmarkPage`（分组视图响应，非分页/数组）、`useMemPage`（复习会话状态机）、模块侧包装件自己取"选项"再注入共享组件（`file/components/TagInput.tsx` 那类，是对的模式） |
| Hook 规模 | 曾 4 个 ≥300 行：`useFileList` 602、`useDbViewer` 413、`useBookmarkPage` 377、`useMemManage` 355（既有契约 ≤100） | ✅ 已拆 | 按 T3 手法各拆 2–4 个子 hook + 1 个组合入口（`view/<域>-list` / `view/db-viewer` / `view/bookmark-page` / `view/mem-manage/`），依赖由入口显式传入；**对外 API 一字未改**，页面与既有测试都不用动。2026-10 复测最大 `usePalette.ts` 364（命令面板的状态机，仍是单文件） |
| Props 超载 | 曾 4 个组件 ≥15 个字段（`ManageTable` 17、`ManageDetail` 17、`ChatSidebar` 16、`FileCard` 15） | ✅ 已修 | 按刀法 ② 收束成"数据 + 两束操作"：`TableActions` 17 → 10、`DetailActions` + `DetailDraft` 17 → 5、`copy`/`slots`/`actions` 16 → 7、`FileCardActions` 15 → 7。顺带删掉 `ManageTable` 一个**从未被使用**的 `page` prop |
| 页面里的业务规则 | `ReadingList` 的 `known_ratio` 阈值曾写两遍；`highlightKeywords` 内联在 `SearchPage`；`extractDomain` 在 `BookmarkPage` 与 `BookmarkItem` 各一份（字面相同）；`TaskList` 的父子映射与分组两个内联 `createMemo` | ✅ 已修 | 四处进各模块 `model/`（`reading-stats` / `highlight` / `bookmark/url` / `task-group`）并配 23 条直测；`reading` 与 `search` 从此有了 `model/` |
| 测试缺口 | 曾：`TagFilter`（126 行、两模块在用）零覆盖、`ErrorRetry` / `Skeleton` 无测试、5 个测试只断言 `typeof X === "function"` 或数组长度（`Button` / `Badge` / `SearchInput` / `PageHead` / `Toast`） | ✅ 已修 | 5 个自我满足测试改成契约测试（含顺手把 `Button` 的 props 补上 `JSX.ButtonHTMLAttributes`，兑现它自己注释里"原生属性透传"的说法）；`TagFilter` 补 12 条、`ErrorRetry` 4 条、`Skeleton` 5 条。共享 UI 层现在没有零覆盖组件 |
| 测试环境 | ① `components/` 的 jsdom 环境曾由 `vite-plugin-solid` 隐式补齐；② 挂载了懒加载 Markdown 的渲染测试，用例结束时 chunk 可能还在飞 | ✅ 已修 | ① `vite.config.ts` 现在显式写 `environment: "node"` 并按扩展名拆成 `node` / `jsdom` 两个 project；② 结束时 `await vi.dynamicImportSettled()`（否则全量并行跑会以 `EnvironmentTeardownError` 让整轮 exit=1，用例却全绿）——已写进 [testing.md](./testing.md) |
| 模块自引 barrel | 曾约 98 条自引，其中**值导入约 42 条**是循环导入的形状（`useMemReview` → barrel → `MemPage` → `ReviewCard` → 回到 `useMemReview`） | ✅ 已修 | 模块内部改引自己的叶子（`api.ts` / `model.ts` / `timeWindowApi.ts`，组件类引具体文件）；**测试的 mock 目标同步改成叶子** —— 迁移手册早就要求"mock 叶子而不是 barrel"，源码引 barrel 时这条没被逼出来 |
| 尾部模块 | 曾：`search` 无 `api.ts` / `index.ts`（页面直连 `@modules/command-palette`），`quick-capture` 的 hook 平铺在模块根 | ✅ 已修 | `capabilities/search` 补 `api.ts`（薄门面：检索能力仍归 command-palette，页面不再直接引另一个模块）与 `index.ts`；`quick-capture` 的 hook 归位 `capabilities/quick-capture/view/useQuickCapture.ts` |
| 文档漂移 | 本次比对修掉 4 处：`architecture.md` 的 `web/src/lib/api`、`design-tokens.md` 的 `web/src/lib/styles/tokens.css` 与"单一事实源 `design.md`"（该文件不存在）、`design-tokens.md` 的主题数与实际不符、图标条款（指向少数派那套）、`frontend.md` 的组件清单缺项与 `icons/` 目录无说明 | ✅ 已修 | 判据是"文档说的"与"代码实测的"对不上时以代码为准；此类漂移只能靠实测比对发现，所以本文的每个数字都标了口径（哪个目录、含不含测试） |
| 潜伏 bug（新发现） | `shared/markdown/pipeline.ts` 的 `isKaTeXContext` 里 `/…\\s…/` 是**字面反斜杠 + s**（正则里等于匹配文本 `\s`），空白分隔的 class 那一支永远不生效 | ✅ 已修 | 现为 `/(^\|\s)katex(-\|\s\|$)/`，补了 3 条测试（含一条"已知局限"：内容自带 `class="katex"` 仍能保留内联 style —— **不新增能力**，要收紧得换判据，不是改回正则） |

## 6. 门禁：只有依赖方向进红线

行数与 Props 数是**启发式**（同一份文件在 A 层合理、在 B 层就超标），靠人评审；
依赖方向是**可机器判定的硬契约**，由 `web/src/app/layer-boundaries.test.ts` 静态扫描守住：

| 规则 | 例外 |
|------|------|
| `components/**` 不得引模块层（`@domains` / `@capabilities` / `@platform` / `@tools` / `@modules`） | 无 |
| `shared/**` 不得引 `@components/**` 与模块层 | 无 |
| `modules/A/**` 不得深引 `modules/B/**` 的**子目录**（`components/ view/ model/ data/ viewers/` …，B ≠ A） | 无（根级文件按公开入口放行） |
| `config/**` 零依赖（不得引其余层） | 无 |
| `components/**` 与 `shared/**` 不得引 `@app/**` | 无 |
| 模块 barrel 不转出 `components/` 与 `view/` | 无 |
| `view/` 与 `components/` 不直接 import `@shared/api/request.ts` / `cache.ts` / `streaming.ts` | 无（经 `api.ts` 或 `data/`） |
| 模块类型依赖方向：domain ✗ capability；platform / tool ✗ 业务编排 | 无 |
| 模块图无环；domain → domain 只允许登记契约 | 无 |

白名单机制保留但**当前为空**：任何新增越界都会让测试变红；将来真要放行某处，条目必须逐文件
逐 import 登记并附理由，且越界一旦修掉不删条目测试就会失败——不会烂成永久豁免。

两条容易误解的边界：模块引 `@app/context/auth.tsx` 是**刻意允许**的（auth 上下文是环境，
`platform/auth` 的注释写明"新代码直接引它"）；模块引另一个模块的**根级文件**
（页面、`api.ts`、`markdown-editor-support.tsx` 这类 root 支撑件）也算公开入口——路由表就是这么
引页面的，迁移手册也要求测试 mock 叶子 `api.ts` 而不是 barrel。另：`*.test.ts(x)` 全规则豁免
（`vi.mock` 不是真实依赖），`app/**` 可深引模块（它是组合层）。

## 7. 新建组件的决策路径

1. **放哪一层**：两个以上模块要用 → `components/ui/`（再按视觉粒度进 atoms / molecules / organisms）；
   只一个模块用 → `<模块>/components/`；没有视觉、只是算 → `model/`；是跨页状态 → `view/`
   或 `shared/utils/`。
2. **进不进 barrel**：`components/ui/index.ts` 只收首屏共享链要用的件；懒加载页面专用的按路径 import
   （90/10 法则）。
3. **Props 形状**：会变的值过边界一律 `Accessor<T>` 而不是 `T`（判据：**一个会变的值，要么以 accessor
   形式过边界，要么在同一处被消费**）；回调统一 `onXxx`；槽位用 `JSX.Element`；继承
   `JSX.HTMLAttributes` 只在真正的表单/布局原语里用，其余用 `splitProps` 显式白名单。
4. **状态归属**：状态与副作用留在页面或 `view/`；展示组件自己不取数（`components/` 里零 `fetch`）。
5. **测试放哪**：纯逻辑 → 与 `model/` 文件同目录的 `*.test.ts`；组件契约 → 与组件同目录的
   `*.test.tsx`（`render` + 手写 DOM）。
6. **命名**：组件文件 `PascalCase.tsx`，样式与它同名 `X.module.css` 同目录；`interface XxxProps`
   （泛型组件用 `Props<T>`）。

## 8. 复核清单（评审 / PR 用）

- [ ] 新组件放对了层（§7.1），第 2 个使用方出现时才上移
- [ ] 没有新增跨层引用（`components` ✗ 模块层、`shared` ✗ `@components`、跨模块只走 barrel 或根级入口）
- [ ] 模块内部没有新建 `hooks/` 或 `lib/`（`view/` / `model/`），也没给模块 barrel 转出内部实现
- [ ] 会变的值以 `Accessor` 过边界，没有写值快照
- [ ] 展示组件零取数、零 `fetch`，状态在页面 / `view/` 侧
- [ ] 超过软阈值的文件，拆了或写明为什么不拆（§3）
- [ ] 没有新增第二份"同一机制"（骨架、类名工具、图标、管线配置）
- [ ] 纯逻辑在 `model/` 且配了单测；改了逻辑就补测试
- [ ] `pnpm run check && pnpm run test` 通过
