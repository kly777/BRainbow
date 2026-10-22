# 前端 UI 架构评估与改造计划（UI Architecture）

> 生成日期：2026-09-12 · 范围：`web/src` 全部前端（389 个非测试文件 / 49,808 行）· 状态：**待排期（本轮未改动任何代码）**
> 基线提交：`8032d35a`（main）
> 配套文档：[frontend.md](../guides/frontend.md)（结构与分层契约）、[design-tokens.md](../guides/design-tokens.md)（令牌）、[component-sizing.md](../guides/component-sizing.md)（组件尺寸）、[frontend-dao-plan.md](./frontend-dao-plan.md)（适应性/无障碍）

## 1. 结论

一句话：**外围骨架扎实，中部缺了一层。**

路径与路由、设计令牌、模块分层、API 客户端这四样"外围"的纪律好于多数同规模项目；但从**共享组件**到**页面**之间缺了一层——没有布局原语、没有表单原语、没有页面外壳，于是每个页面都自己长一遍。代价可以量化：99 个 CSS 模块里 141 组规则块完全重复、234 个冗余块；最大的页面 929 行；33 个页面只有 9 个用统一页头。

因此本计划的主题不是"重设计界面"，而是**补齐中部缺失的那一层**，再把各页面收敛上去。视觉语言、信息架构、交互契约均不在本次范围内。

## 2. 现状基线

> 下表为**评估时的原始基线**（改造前），供对照。各阶段完成后的实测值见 §6 的阶段记录。

| 指标 | 数值 |
|---|---|
| 非测试文件（TS/TSX） | 287 |
| 非测试文件（CSS，其中 CSS 模块） | 102（99） |
| 总行数（TS/TSX/CSS） | 49,808 |
| CSS 模块行数 | 16,752 |
| 页面（PATHS ↔ PAGE_LOADERS ↔ NAV_ITEMS） | 33 / 33 / 33 |
| 共享 UI：atoms / molecules / organisms | 8 / 6 / 3 |
| 测试文件 | 92（86 纯逻辑 + 6 渲染 DOM） |
| `modules/` 下 tsx（非测试） | 102 |
| `modules/` 组件测试 | 2 |
| 硬编码颜色（CSS 模块） | 0（仅 3 处令牌兜底值） |
| `@media` / `@container` | 86 / 4 |

**阶段 1 完成后的现值**：CSS 模块 16,699 行；atoms 9 个（新增 `Row` / `Stack`）；
测试 93 文件 / 702 用例（渲染 DOM 的 7 个）；手写 accent 环 0 处（令牌消费 9 处）。

## 3. 扎实之处（改造中必须保持）

1. **路径单一来源闭环**：`config/paths.ts → navigation.ts → app/routes.ts`；`PAGE_LOADERS` 类型是 `Record<PathValue, PageLoader>`，漏加 loader 直接编译失败；33 个路由全部 `lazy()`；SEO/Agent 产物（sitemap / robots / llms.txt / `_md/` / openapi.json / api-catalog）由 NAV_ITEMS 自动派生。
2. **令牌纪律**：CSS 模块内零硬编码颜色；`--space-*` / `--t-*` 引用数千次；四主题（paper / midnight / ocean / auto）+ 字号三档 + `forced-colors` + `prefers-contrast` 全覆盖。
3. **依赖方向干净**：`modules/` 之间的深层 import 仅 3 处、且集中在 1 个文件（见 P2-4）；其余全走各模块 `index.ts`。
4. **API 层有单一失效策略来源**：`shared/api/domains.ts` 用一张表（`reads` / `singles` / `invalidates`）替代散落各处的 resource 失效调用；全局 401/403 由 `shared/api/request.ts` 统一兜住。
5. **无障碍底子是真的**：`Modal` 具备焦点圈闭 / 焦点还原 / `aria-modal`；另有 skip-link、`.sr-only`、`:focus-visible` 统一焦点环、完整的打印样式。
6. **逻辑测试密度高**：92 个测试文件覆盖 `shared/utils`、`shared/api`、各模块 hook 的纯逻辑。

## 4. 问题清单（按严重度）

### P0 架构缺口（缺层，必须先补）

**P0-1 组件系统在 atom 层截断：没有表单原语，也没有布局原语**

`components/ui/atoms/` 只有 Badge、Button、Icon、Markdown、SearchInput、Skeleton、Tooltip。

- **表单侧**：无 `Input` / `Select` / `Textarea` / `Field`。全站 78 个原生 `<input>`、11 个 `<select>`、15 个 `<textarea>`、6 个 `<table>`；CSS 里 `.input {}` 定义 14 处、`.textarea {}` 10 处。
- **布局侧**：无 `Stack` / `Row` / `Grid`。于是 `display:flex; align-items:center; gap:var(--space-md)` 这类声明被手写 7 次，`flex-direction:column; gap:var(--space-xs)` 6 次，`display:flex; flex-direction:column; gap:var(--space-md)` 5 次。
- **度量**：全部 CSS 模块中，含 ≥3 条声明的规则块共 **141 组完全重复、冗余块 234 个**。

**P0-2 没有页面外壳，每个页面自己实现 chrome**

33 个页面中：统一页头 `PageHead` 仅 9 个使用，`AsyncView`（加载/错误/空/数据 四态）8 个，`Toolbar`（返回栏）6 个，`SimplePagination` 3 个。详情页的返回栏被重复引用 3 次以上（TaskDetail / FileDetail / CardDetail 各 3 处）。

后果：

- 新增一个列表页的成本是 `FileList.tsx` 929 行 + `FileList.module.css` 721 行，**没有脚手架可分忧**；
- 页头与标题层级由各页面自行决定（见 P1-1）。

**P0-3 数据获取存在两套并存范式，没有唯一答案**

| 范式 | 使用者 | 特征 |
|---|---|---|
| `createResource` + `mutate` | 35 个文件 | 乐观更新的载体，是好的那套 |
| 手写 `createSignal` 管 `data/pagination/loading/error` + 手搓 fetch | `useCardsList`、`useBookmarkPage` | loading / 分页 / 错误每次重写 |

"列表页该怎么做"目前没有唯一答案，下一个改这块的人（或 AI 会话）会随机选一套——这正是此前"文件模块有些操作没做乐观更新"那类不一致的根源。

### P1 一致性缺陷（用户可见）

**P1-1 页面结构与标题层级不统一**

- `file/FileDetail`、`db/DbViewer`、`rainbow/RainbowGenerator`、`text/TextEditor` 四个页面**既不使用 `PageHead`，模块目录内也没有任何字面 `<h1>`**——即整页没有一级标题；
- 其余页面里，标题有的来自 `PageHead`，有的手写 `<h1>`，有的塞在子组件里。

**P1-2 CSS 冗余**

- ~~焦点环 `box-shadow: 0 0 0 3px var(--t-color-accent-ring)` 出现 **32 次、散在 23 个文件**~~【已修复：收敛到 `--t-ring-accent` 令牌，手写处归零，见 P1-4】
- 按钮类（`.btn` / `.btn-primary` / `.btn-ghost` / `.btn-danger` / `.btn-cancel` …）共 **21 处定义、散在 11 个文件**；~~已收敛~~ **已归零**（21 → 1，只剩 `Button.module.css` 自身的 `.btn`；其中 9 处是迁移 `<Button>` 时留下的死代码，另有 5 个不以 `.btn` 命名的自写按钮一并删除 —— 见阶段 3d / 3e）
- `background:raised + border-color:border-strong + color:ink` 的 hover 组合重复 10 次；
- flex 组合（`display:flex` 配 `flex-direction` / `align-items` / `justify-content` /
  `flex-wrap` / `gap`）重复 **464 处**，是重复量最大的一类。~~已用 `composes` 收敛 405 处~~
  **【已回滚，理由见 §10：composes 把一个元素的样式拆到两个文件，维护成本高于省下的重复声明。
  这类重复的取值本就全部走令牌，重复的是结构而非取值，改设计时不会发散，故接受其存在】**

**P1-3 设计系统未自用**

`ConfirmModal`、`SimplePagination`、`FilterGroup` 这些**本身就是设计系统**的组件，各自重写 `.btn` 而不复用 `<Button>`。新增的 `Row` / `Stack` 是目前唯一被设计系统自己优先使用的原语（`Layout.module.css` 不与任何模块 CSS 耦合）。

> 【部分修复，见阶段 3d】`ConfirmModal`（`dangerSolid` / `warningSolid` 变体）、
> `SimplePagination`、`FilterGroup` 三处已收回 `<Button>`；设计系统内部不再有自写 `.btn`。

**P1-4 焦点环令牌取错色值，导致 30 个表单元素焦点不可见（已修复）**

评估时未发现、改造中暴露的真实缺陷：

- `--t-focus-ring`（定义在 `app/global.css`）的值是
  `0 0 0 var(--space-2xs) var(--t-color-accent-soft)`。而
  `--t-color-accent-soft: oklch(94% 0.02 165deg)` 是**表面底色**令牌，
  主题背景是 `oklch(97.2%)` / surface `oklch(99.5%)` —— 近白环贴浅底，几乎不可见；
  宽度还取成了 `--space-2xs`（0.125rem = 2px，间距令牌误当宽度用）。
- 名字里带 `ring` 的 `--t-color-accent-ring`（`oklch(52% 0.1 165deg / 25%)`）才是为此而设的，
  34 处模块级规则手写的正是它。
- 严重性来自 `tokens.css` 的全局规则：`input:focus, textarea:focus, select:focus`
  是 `outline: none` + 这个不可见的环。**30 个未自带 `:focus` 覆盖的表单元素**
  （含 `TextEditor` 主编辑区 `.editor`、`.rename-input`、`.prompt-textarea`、
  `.hex-input`、`.task-select`、rainbow 的 `.channel`/`.slider`）键盘焦点完全不可见，
  违反 WCAG 2.4.7。
- **强制颜色模式下更彻底**：`--t-color-accent-soft` 降级为 `Canvas`（即背景色本身），
  等于拿背景色画背景 —— 而该模式恰恰是为无障碍而设。

修法：环令牌迁到 `tokens.css` 的「通用视觉令牌（不随主题）」区并更名 `--t-ring-accent`，
取值改用 `--t-color-accent-ring`、宽度 3px；34 处手写环收敛到该令牌；
4 条 `:hover` 规则补 `:not(:focus)`（全局规则特异度 (0,1,1) 低于模块 `:hover` 的 (0,2,0)，
不补则悬停时 focus 边框失效 —— 原先靠源码顺序侥幸获胜）；stylelint 加门禁禁止手写该环。

**P1-5 `createResource` 的 fetcher 里抛错 → 页面永远骨架屏（已修复）**

改造中（写 CardsList 渲染测试时）发现的真实缺陷。

`createResource` 的 fetcher 抛错会中断 Solid 的响应式更新，且当时**本仓库没有
任何 `ErrorBoundary`** —— 实测结果是资源停在 `loading: true`：`AsyncView` 先判
loading，于是**永远渲染骨架屏**，错误文案与重试入口都到不了。

- 已修：`useListResource`（新增，见阶段 4）、`useFileList`、`useOntologyList`。
  修法统一为 **fetcher 内部消化异常、返回空结果，错误经独立信号暴露**。
- 回归测试：`CardsList.render.test.tsx` 与 `FileList.render.test.tsx` 各有一条
  "取数失败显示错误态而不是卡在骨架屏"，后者还断言骨架屏元素已让位。

**⚠ 这批修复曾不完整（提交 `fef60e0a` 才补齐）**：`083a8195` 只把"无效 id 的
`throw`"改成 `return undefined`，**没有处理取数失败**（`getFile` 之类 reject）
—— 放任 Promise 拒绝会让页面既到不了错误态、也拿不到数据（实测 DOM 里只剩
返回栏）。受影响的是 6 个详情取数点，已统一改为
`tryAsync` + 错误信号的模式。教训：修"抛错"时容易只盯显式的 `throw`，而
**未处理的 Promise 拒绝是同一个后果**。

**同类写法的位置已全部修完**（提交 `083a8195`）。修之前逐页核对了渲染方式，
结论与最初记录不同，据此分了轻重：

| 位置 | 渲染方式 | 实际影响 |
|---|---|---|
| `useCardDetail` / `useCardEdit`（CardDetail / CardEdit 页） | AsyncView（先判 loading） | **错误态不可达，永远骨架屏** |
| `useFileDetail` / `useBookmarkDetail` / `TaskDetail` / `OntologyDetail` / `TextPreview` | 独立 `<Show>` | 错误**能看到**，只是"加载中…"会一直多挂一个 |

（本文档早先把这 7 处一律记成"永远骨架屏"，是未经核实的推断，已按实测更正。）
改法统一为：fetcher 对无效 id / 请求失败返回 `undefined`，错误经 getter 或
独立信号暴露；详情页把"无效 id"与资源错误合并成一个 `loadError`。

`usePreviewUrl` 的 `throw` 在 `.catch()` 链内，**不是**此问题。

**顺带补上了应用级错误边界**（Layout 内，同一次提交）：本仓库此前**没有任何
`ErrorBoundary`**，任一组件渲染期抛错都会让整个应用白屏 —— 这条独立于上述
bug 类，属健壮性缺口。现在会显示可见的失败态与"重试"入口。

根因值得记：之所以会在 fetcher 里 `throw`，是因为把"错误交给 AsyncView"直接
理解成"抛出去让它接住"。但 AsyncView 接的是 `resource.error`，而抛错同时还会
中断响应式更新 —— 两件事被混为一谈。

**P1-6 `<Show>`（非 keyed）把传入值变成一次性快照（已修复）**

用户报告的两个缺陷同源于这一条（都在 `/file/:id`）：

1. **切换文件时图片不换**（当时的触发方式是工具栏的「上一个/下一个」，该功能后来整体
   移除了 —— 详情页不做跨文件导航，理由见 `file-service.md` §8.4；但**路由参数变化**
   仍是真实路径，比如浏览器前进/后退两个详情页，这条修复依然必要）：
   `PreviewMedia` 用
   `<Show when={resolved()}>{(url) => ...}</Show>` 包住 `<img>/<video>/<iframe>`，
   而 `usePreviewUrl` 对**公开文件是同步替换真值**（私密文件才会先置 `undefined` 换 blob URL）。
   非 keyed 的 `Show` **只在真假变化时重建子节点**，于是"真 → 真"的替换不重建 DOM，
   `src` 永远停在首帧 —— 文件名、元信息、页码都换了，只有画面不动。
   修法：该 `Show` 加 `keyed`（`ImageLightbox` 的翻页有同一处问题，一并修）。

2. **内容"向下沉一下"再正确渲染**：切换时 `createResource` **保留上一个文件的值**
   （`dataLoading` 为 true，但 `data()` 仍有值），而页面把 `when={m.dataLoading}` 的骨架
   与 `when={m.data()}` 的内容写成两个**独立**的 `Show` —— 骨架插在旧内容上方，把整块内容
   顶下去，数据到了再弹回来。
   修法：骨架只在"还没有任何数据"时出现（`m.dataLoading && !m.data()`），切换途中保留旧内容，
   用 `.body[aria-busy="true"]` 半透明提示，布局零位移。

**精确语义**（读的是装好的 `solid-js@1.9` 源码，并已写成可执行规格
`shared/utils/solid-show-semantics.test.tsx`，4 例）：

```js
conditionValue = createMemo(() => props.when)                  // 无 equals：值变就通知
condition      = keyed ? conditionValue
                        : createMemo(conditionValue, { equals: (a, b) => !a === !b })
子节点回调在 untrack(...) 里执行，收到 keyed ? 值 : accessor（accessor 读的是 conditionValue）
```

于是判据是**两条**，而不是"用没用 keyed"：

1. **值在"真 → 真"之间变化时，子节点不会被重建**（外层 `condition` 的 equals 吃掉了通知）；
2. 子节点回调体是 `untrack` 的，所以：
   - 在**被追踪的位置**读 accessor（`src={x()}`、`title={x()}`、`chips={x().map(...)}`、
     事件回调里读）→ 会跟着更新 ✓（读的是无 equals 的内层 memo）
   - **读一次、把值当参数交给别的函数**（`props.children(url())`、`render2(x())`）→ 一次性快照 ✗
     —— 这正是图片不换那一处

所以危险形态是 **"accessor 读成值再穿过一个函数/组件边界"**，不是"用了 `Show`"。
修法二选一：把那个边界的签名改成收 `Accessor<T>`（类型层面挡住），
或者把这段渲染收进一个组件里（`keyed` 与追踪细节只存在于一处）。
本次两处缺陷都选了后者/加 `keyed`。

相邻坑：**loading 与 content 必须互斥渲染**。resource 在重取时**保留旧值**（`loading` 为 true
但值还在），骨架与内容写成两个独立 `Show` 就会同框 —— 就是"沉一下"。
本项目其它页面走 `AsyncView`（先判 loading）天然互斥，FileDetail 是手写四态才漏出来。

测试（两个文件都是"先红后绿"验证过的）：
`FileDetail.render.test.tsx` 的路由参数 mock 改成**信号驱动**才测得出切换
（原来是个静态对象，切换根本不会触发重取，第一版断言因此假通过）；
`ImageLightbox.test.tsx` 走 `<Portal>`，断言要查 `document`，jsdom 还需给
`Element.prototype.scrollTo` 打桩。

**P1-6 三处样式引用静默失效（已修复，详见 §6 阶段 7）**

评估时未发现，由一次代码审阅暴露。三者同一根因 —— **手写字符串在引用 CSS 产物**：
`/search` 用 `styles["filter-btn"]` 索引 camelCaseOnly 的导出对象（类名全 `undefined`）；
`dag-render.ts` 读 5 个本项目不存在的 `--color-*` 变量名（Canvas 静默忽略非法颜色 → 整图黑）；
`HomePage` 在 TS 里给令牌拼十六进制 alpha（`var(--m-task)14` 为非法值）。

严重性在于**它穿过了所有既有防线**：tsc、biome、stylelint、895 个测试全绿。
原因是 vitest 默认 `css: false`，CSS Module 导入被替换成"任意键都有值"的 Proxy，
渲染测试天然测不到（见阶段 7）。防线只能是源码/产物层的契约测试。

### P2 结构与可维护性

**P2-1 列表 hook 职责过载**

`useFileList` 547 行（混了 URL 参数同步、上传队列、编辑态、选择集、批量打标签、统计、滚动位置恢复、乐观 patch）；`useDbViewer` 413、`useBookmarkPage` 379、`useMemManage` 355 结构高度相似却各写一遍。

**P2-2 页面组件过大**

`FileList.tsx` 929 行内含 8 个内联子组件（`FileCardView` / `FileCardEdit` / `UploadPanel` / `FileRow` / `BatchBar` …），其中只有少数抽到了 `components/`。

**P2-3 组件层测试几乎为零**

102 个模块 `.tsx` 只有 **2 个组件测试**（`FileList.render.test.tsx`、`components/FileMeta.test.tsx`）。此前 `missing` 标志从 handler 掉链子的 bug 正属于这一类——model 与 query 都改了，没有任何测试拦住。**这是目前唯一没有防线的层。**

**P2-4 跨模块边界泄漏（1 个文件 / 3 处 import）**

`modules/search/SearchPage.tsx` 直接 import `@modules/command-palette/api.ts` 与 `hooks/suggestions.ts`，绕过了模块 `index.ts` 契约。根因是 `command-palette/index.ts` 只导出了 `CommandPalette`，barrel 不完整——修法是把 `searchE` / `SearchHit` / suggestions 纳入该模块 barrel，而不是让消费方深入内部。

`app/routes.ts` 与 `app/routes/HomeGuard.tsx` 也大量深层 import 各模块页面，但那属于**组合层**的职责，合规。

### P3 实现级与文档漂移

- **P3-1 设计权威悬空**：`app/global.css` 头部写着 `design-system: design.md`，但**该文件不存在**（仓库根与 `doc/` 下都没有）。设计权威实际散落在 `shared/styles/tokens.css`（410 行）+ `app/global.css`（615 行）+ `doc/design-tokens.md`（68 行）三处。
- **P3-2 `@container` 约定未落地**：`frontend.md` / `AGENTS.md` 写明"新组件优先用 `@container`"，现状是 **86 个 `@media` vs 4 个 `@container`**（`container-type` 只声明了 2 处）。
- **P3-3 路由级预取未使用**：`@solidjs/router` 已是 0.16.3（自带 `query()` / `createAsync`），全站未用，因此每次跳页都要先闪一次骨架。
- **P3-4 令牌兜底值冗余**（轻微）：`BookmarkPage.module.css` 三处 `var(--t-color-warning-*, <hex>)` 的兜底值实际用不到——`tokens.css` 四个主题都定义了这三个令牌。属于无害的陈旧写法。

## 5. 目标架构原则

1. **原语优先**：能用 `<Input>` / `<Stack>` 表达的就不要手写 `<input>` 与 `display:flex`；**同样的样式重复到第 3 次就必须提升为原语**。
2. **页面外壳统一**：所有列表页 / 详情页走同一组组合件，页头、四态、分页、空态只实现一次。
3. **一套数据范式**：列出一套（保留 `createResource` + `mutate`），手写派收敛过去。
4. **设计系统自用**：共享组件内部也必须用 `Button` / `Input` 等原语，禁止自写 `.btn`。
5. **中部那层要有测试**：脚手架与关键页面必须有渲染级测试。
6. **不重设计**：不改视觉语言、不改信息架构、不改交互契约，只补结构。

## 6. 分阶段改造计划

阶段 1→2→3 有依赖关系（3 依赖 1、2 提供的原语）；阶段 4、5 可独立并行；阶段 6 需先完成 4。

### 阶段 1：焦点环修复与收敛 + 布局原语 —— **已完成**

提交：`84f04bcd`（焦点环）、`fdf07157` + `f465affa`（布局原语）。

**1a 焦点环（原计划只是"去重"，实际修掉了一个 a11y 缺陷）**

- 发现 P1-4：令牌取错色值 + 用错宽度，导致 30 个表单元素焦点不可见。
- `--t-focus-ring` → 迁入 `tokens.css` 通用视觉令牌区、更名 `--t-ring-accent`、取值改为
  `0 0 0 3px var(--t-color-accent-ring)`。
- 34 处手写环：27 条冗余 `:focus` 规则删除（改由 `tokens.css` 全局规则覆盖）、
  2 处 `:focus-within` 包装层 + 3 处强调高亮 + 2 处复合阴影改为消费令牌。
- 4 条 `:hover` 补 `:not(:focus)`，把"focus 胜过 hover"从依赖源码顺序变为显式声明。
- stylelint 新增门禁：禁止手写 3px accent 环（已自测植入违规能被拦下）。
- **实测**：手写环 32 → **0**；CSS 模块 16,752 → 16,592（−160）。

**1b 布局原语**

- 新增 `Row` / `Stack`（`components/ui/atoms/Layout.{tsx,module.css}`）+ 9 例契约测试。
- **未加 `Grid`**：`display:grid` 全站仅 17 处且每处都要自定义 `grid-template-columns`，
  原语只能省下 `display: grid` 一行，证据不支持。
- 原语设计为**正交映射**（每个类对应一个 CSS 属性），对齐默认值放在 `Row` 组件里显式表达。
  初版把 `align-items:center` 隐含进 `.row` 类名，批量套用时会让 79 处原本依赖
  `stretch` 默认值的规则静默居中 —— 已改正并记录在 `Layout.module.css` 头部注释。
- **实测**：CSS 模块 16,592 → 16,699（+107，新增原语本身的定义与注释）。

**阶段 1 结论**：CSS 行数指标**未达成**（原目标 ≤15,500）。原因见 §10 —— 那个目标建立在
"234 个冗余块每个能省 5 行"的估算上，实测每个组合点只能省 1–3 行，且删规则往往要在别处补声明。

### 阶段 2：表单原语 —— **已完成**

提交：`ecae3c4d`（原语）、`314d4ae7` / `283033f9` / `fc337492` / `f286d5f3` /
`8738dafd` / `68d8fad3` / `8822ea60`（各模块迁移）、`26a76814`（可访问名补齐）。

**原语**：`Input` / `Select` / `Textarea` / `Field`（+ `control.ts` 共享机制）。
- 取值取自改造前 66 条输入类规则的统计主流形态，不是拍脑袋定的。
- **基础类包在 `:where()` 里，特异度 (0,0,0)** —— 调用方传入的任何类必定生效，
  不依赖两个 CSS Module 在产物中的先后顺序。这正是 composes 方案栽过的地方（§10.1），
  此处从根上避开；修饰类（`.size-*` / `.tone-*` / `.mono` / `.invalid`）保持 (0,1,0)。
- **焦点态不重复声明**：由 `tokens.css` 的全局 `input/textarea/select:focus` 提供
  （P1-4 已修好该规则）。

**`Field` 的实证依据**：改造前 93 个文本控件里 **27 个（29%）没有任何可访问名**，
多数只靠 placeholder（输入后即消失、读屏器不可靠，不能替代标签）。`Field` 把 id 生成、
label 关联、`aria-describedby`、`aria-invalid` 收进原语，让正确关联成为默认行为。
迁移后**全站无可访问名的文本控件为 0**。

**两种迁移形态**（按场景区分，不是二选一）：
- 需要可见标签的表单字段 → `Field` + `Input`；
- 紧凑/内联控件（列表内筛选、工具条、弹层里）→ `Input` + `aria-label`，
  强行加可见标签会破坏设计。

**顺带修掉一条不在计划内的失效声明**：`--t-transition-*` 令牌本身已含缓动函数
（`120ms cubic-bezier(0.2,0,0,1)`），9 个文件里却写成
`… var(--t-transition-normal) ease` 或再拼一个缓动函数 —— 一条 transition 只能有
一个 timing function，多出的那段使**整条声明成为非法值被浏览器丢弃**，即这些过渡
从未生效（共修 9 文件）。同批清掉 2 处漏网的硬编码 `0.15s ease`。

**实测**：原生 `<input>` 78 → 40；待收敛的输入类基础规则 21 → 3。

**有意排除 3 条**（非遗漏）：
| 位置 | 原因 |
|---|---|
| `quick-capture` 的 `.input` | 有意做成无边框/无内边距/透明底的行内捕获框，套原语会凭空加上 padding 与圆角 —— 属视觉变更而非去重 |
| `markdown-editor` 的 `.textarea` | `MarkdownEditor` 是 `props.class ?? styles.textarea`（**替换**而非合并），4 个消费方都靠传类覆盖基础样式；要收敛须先改成合并，牵动 4 处并引入同特异度顺序竞争，值得单独一次改动 |
| `mem/MemAdd` 的 `.textarea` | 同上，它是上述 4 个消费方之一 |

### 阶段 3：页面外壳 —— **外壳完成，h1 指标达成；页面推平进行中**

提交：`ea5f69ad`（外壳 + ontology）、`0feea730`（h1 补齐）。

**外壳**：`ListPage`（页头 + 筛选槽 + 四态列表 + 页脚槽）、`DetailPage`
（返回栏 + 标题 + 动作区）。两件正确的默认行为被固定进外壳：
**页头必有唯一 h1**、**列表必接四态**。

- 外壳**只管结构、不管视觉**：容器宽度与内边距由调用方给（各页用的是
  不同令牌：`--page-max` / `--page-text-max` …）；`filters` / `footer`
  **原样渲染、不加包装层** —— ontology 的筛选区用
  `justify-content: space-between` 把视图切换推到右端，插一层统一包装会把它
  挤到搜索框旁边，属视觉变更。这两点决定了迁移已有页面不改变外观。
- `DetailPage` 提供 `titleHidden`：页面别处已显著展示同一标题时（FileDetail
  的返回栏、TextEditor 的标签页），h1 用 sr-only —— 补齐语义又不重复显示。
- 契约测试 12 例（`PageShells.test.tsx`）。

**h1 指标：33/33 达成（按渲染树审计）。**

改造前 4 个页面整页无 h1（FileDetail / DbViewer / RainbowGenerator / TextEditor），
另 2 个页面直接从 `<h3>` 起步（跳过 h1/h2）。
- FileDetail → 迁到 `DetailPage` + `titleHidden`；
- DbViewer / RainbowGenerator / TextEditor → 补 sr-only h1，命名取自
  `config/navigation.ts` 的 label 以与导航术语一致。

**一处需要记下的自纠**：上面这条最初是用"模块目录内出现 `<h1` 即可"审计的，
结果是**假阴性** —— `modules/card/` 里有 CardsList（经 `ListPage` 渲染 h1），
于是 CardDetail / CardAdd 被误判为通过；类似地组件名 `CardDetailPage` 也被
当成过 `<DetailPage>` 标签。改为**按页面自身渲染树**审计后又找出 6 个：
CardDetail / CardAdd（迁 `DetailPage`）、ChatMemPage（补 sr-only h1）、
ChatPage（补固定 sr-only h1，并把欢迎语的 `<h1>` 降为 `<h2>` —— 原先的 h1
**只在空会话的欢迎态存在**，一旦有会话页面就没有一级标题）；
ConvDetail / ConvConcept 复查后确认 `ConvTopBar` 内已有 h1，属审计脚本的
另一个假阴性（剥掉 `components/` 前缀却只查同目录）。

教训与 P2-3 同类：**审计要针对行为（是否真的渲染），而不是标识符是否存在**。

**页面推平进度**：ListPage 已承载 CardsList / ReadingList / OntologyList；
DetailPage 已承载 FileDetail / CardDetail / CardAdd。

**`FileList.tsx` 930 → 389 行**（提交 `d3362a57`，达成 DoD 的 ≤400）。拆出
4 个文件（逐字搬运、不改行为）：`components/FileCard.tsx`（网格卡片族五个
组件）、`FileRow.tsx`、`UploadPanel.tsx`、`BatchBar.tsx`，以及
`hooks/useFileDropZone.ts`（整页拖放/粘贴上传，含 dragenter/leave 的深度计数）。
一处刻意取舍：新组件仍从 `../FileList.module.css` 取样式，未一并拆 CSS ——
它们目前只被该页使用，切开 ~700 行 CSS 要面对类名归属与产物顺序问题，
待出现第二个消费方时再拆更合适。

**`BookmarkManagePage` 也已迁入**（提交 `53ddaaf7`）：原先用三个独立
`<Show>` 分别处理加载/错误/内容，现四态交给 AsyncView。一处刻意的可见变化：
加载骨架从 `LoadingSkeleton` 换成 AsyncView 自带的骨架，为与其他 5 个列表页
一致。至此**所有列表页都走 ListPage**。

顺带修掉一个真 bug：该 hook 暴露的 `error` 是**消息字符串**，而消费方用
`getErrorMessage` 取文案、它不认字符串 —— 真实错误信息一直显示成"未知错误"。
改为暴露 Error 对象。

### 阶段 3d：设计系统自用与按钮族收口 —— **完成（`.btn*` 模块侧归零）**

阶段原则第 4 条要求"共享组件内部也必须用 `Button` / `Input` 等原语"。这一条原先只做到
`ConfirmModal`（收进 `dangerSolid` / `warningSolid` 两个变体），本轮把剩下两个
**本身就是设计系统**的组件一并收口：

| 组件 | 原自写形态 | 收回后 | 差异 |
| --- | --- | --- | --- |
| `FilterGroup` | `.btn` + `.active` | `variant={选中 ? "primary" : "secondary"}` + `size="sm"` | 尺寸/圆角/描边/字重逐声明相同；未选中项 hover 多出 `color: ink` 与 `--shadow-sm`（`secondary` 的规范 hover）；选中项 hover 完全一致（`ink` → `ink-strong` + `--shadow-md`） |
| `SimplePagination` | `.btn`（高 2rem） | `variant="secondary" size="md"` | 底色/描边/文字色/圆角/禁用态相同；高度 2rem → 2.25rem、横向内边距 0.75 → 1rem（收敛到系统尺寸档） |

`SimplePagination` 的尺寸收敛是**有意的可见变更**（4px 高、每侧 4px 宽）：原值 2rem 不是系统
尺寸档，也不是任何控件的既有高度（`Control` 由内边距决定高度），为它单开一档等于把
"某个调用点的偶然取值"固化进原语。3 个调用点（file 列表 / mem 记忆管理 / bookmark 书签管理）
都没有固定高度的容器，不存在裁切风险。

`.btn*` 定义 **21 → 16 → 14 → 1**（最后剩下的 1 处就是 `Button.module.css` 自身的 `.btn`）。

**测试**：`FilterGroup.test.tsx` 原先是"断言 props 存在"的空壳（3 例，不渲染 DOM），
改为 6 例渲染契约测试；新增 `SimplePagination.test.tsx` 6 例。两处都用同一个手法：
**断言类名与参照 `<Button variant=… size=…>` 的输出逐字相等** —— CSS Module 类名带哈希不能写
字面量，但"必须与系统的某个变体完全一致"正是这次迁移要保证的契约，比"类名不相等"这类
弱断言更能挡住"少传 variant"这种最可能的回归。其余断言：`aria-pressed` 只落选中项、
`type=button`（放进表单不误提交）、点击回调取值、单页不渲染分页栏、首末页禁用边界、
容器 `class` 透传（7 个 FilterGroup 调用点依赖它做布局）。

**模块侧 13 处 `.btn*` 的真相：9 处是死代码，只有 4 处真在渲染。**

上一轮把它们按"声明内容"分成描边族 5 / accent 填充族 5 / accent 软底 1 / 独立形态 2，
并据此请你做决策。本轮落地前先做了一次**宿主核对**（这个类被哪个元素用？那个元素今天由谁渲染？），
结论推翻了那个分类：

| 类别 | 处数 | 位置 | 实情 |
| --- | --- | --- | --- |
| 死代码 | **9** | `auth` 的 `.btn-submit` `.btn-link` `.btn-cancel`、`key` 的 `.btn` `.btn-primary` `.btn-danger`、`mem/ContextBar` 的 `.btn-ghost` `.btn-primary`、`conv/ConvSearch` 的 `.btn` | 这四个组件**早已迁到 `<Button>`**（AuthDialog / KeyPage / ContextBar / ConvSearch 的 TSX 里没有任何 `styles.btn*` 引用），CSS 是当时留下的尾巴；每个类还各带一份 `@media (width <= 600px)` 窄屏覆盖，同样零引用。**直接删除，零视觉影响** |
| 真按钮 | **4** | `mem/MnemonicSettingsModal` 的 `.btn-ghost`（2 个调用点）与 `.btn-primary`、`color/ColorPage` 的 `.btn-ghost`、`file/EmptyGuide` 的 `.btn` | 只有这三个文件当时确实还在手写 `<button>` |

同一批文件里还翻出 `.gen-btn`（`key/KeyPage`）也是死代码、同样是 accent 实底 —— 它不在度量口径内
（类名不以 `.btn` 开头），只有逐个文件核对宿主才能发现。

于是原先批准的两项决策按实际情况缩小后落地：

1. **新增 `outline` 变体**（透明底 + `border-strong` + `radius-md` + 由内边距决定高度，见
   `Button.module.css` 注释），收回 `MnemonicSettingsModal/.btn-ghost` 与 `ColorPage/.btn-ghost`
   两处（原计划 5 处，其中 3 处是死代码）；`key/.btn-danger` 同为死代码，**因此不需要 `outlineDanger`**。
2. **accent 填充族收成 `variant="primary"`**：实际只剩 `MnemonicSettingsModal/.btn-primary` 与
   `EmptyGuide/.btn` 两处（原计划 6 处）。

落地后的可见变更（都是"用回原语"的必然收敛，逐处写进了提交说明）：

- outline 两处：高度 26.8px → ~29.6px（基础类把 UA 的 `line-height: 1.15` 换成 `--leading-tight` 1.4）、
  字重 400 → 500、禁用态透明度 0.35 → 0.5；窄屏压缩档保留；
- accent 两处：填充色 accent → 墨色、`radius-md` → `radius-sm`、高度 ~26.8px → 36px；
  `EmptyGuide` 那处的 accent 软底 + accent 描边 + 600 字重一并收敛到系统形态。

**实现要点（先记下来，免得下一次重新推导）**：

- 描边族的实际高度是**由内边距决定**的 ~29.6px（`padding: 4px 16px` + `line-height: 1.4 × 14px`
  + 2px 边框），而系统两个尺寸档都是固定高度：`size="sm"` 28px / `text-xs` / 12px 侧内边距，
  `size="md"` 36px / `text-sm` / 16px 侧内边距 —— 都不吻合。所以 `outline` 变体自带
  `height: auto` 与 `padding: var(--space-xs) var(--space-lg)`，与现有 `.icon` 变体同一个做法
  —— 同一文件内后定义的同特异度规则覆盖前面的尺寸档，**这是文件内确定的顺序**，
  不涉及 §10.1 那种跨 CSS Module 的产物顺序问题。
- `MnemonicSettingsModal` 在 `@media (width <= 600px)` 里把按钮横向内边距收窄到
  `--space-md`：迁移后该覆盖必须**带容器类**（`.actions .mobile-compact`，特异度 (0,2,0)）
  才不依赖跨文件顺序；原规则里的 `display` / `align-items` / `justify-content` / `box-sizing`
  不再需要，原语基类已提供。`ColorPage` 的窄屏档同理（`.footer .mobile-compact`）。

**顺带纠正一处度量错误**：原 DoD 用 `grep -P '^\.input\s*\{'` 数 `.input` / `.textarea`，
漏掉了分组选择器 —— `BookmarkDetail` / `OntologyDetail` 写的是 `.input,\n.textarea {`，
于是这两处**从未被计入**（"只有 3 处刻意排除"这个结论因此是错的）。按选择器口径重数
（脚本见 §8，口径为"每文件每类名一处"）：`.input` 15 处 / `.textarea` 7 处，按**宿主元素**
逐处分类：

- **共享原语的调用方覆盖类（合规，无需处理）10 处**：`AuthStatus`（供 `AuthDialog`）、
  `bookmark/TagInput`、`ChatPrompts`（input + textarea 各一处）、`conv/ConvSearch`、
  `file/TagInput`、`file/TagManager`、`mem/TagPicker`、`reading/ReadingList`、
  `search/SearchPage` —— 都写成 `<Input class={styles.input}>`，只覆写少量声明，
  正是 `Control.module.css` 用 `:where(.control)` 保住的那种用法；
- **原语自身 2 处**：`SearchInput.module.css` 的 `.input`、`Control.module.css` 的 `.textarea`；
- **编辑器内部 / 已记录的刻意排除 4 处**：`markdown-editor.module.css`、
  `card/CardEdit`（`MarkdownEditor` 的 `class` 是**替换**而非合并）、`mem/MemAdd`、
  `quick-capture`；
- **仍然手写原语的真重复 6 处类名实例 / 4 个文件**：`bookmark/BookmarkDetail`（input +
  textarea）、`ontology/OntologyDetail`（input + textarea）—— 两者都在裸 `<input>` /
  `<textarea>` 上重写了整套控件样式；外加 `command-palette/.input`、`rainbow/AngleEditor/.input`。

这 4 个文件是本轮新发现的欠账，列为下一轮的工作项（迁移到 `<Input>` / `<Textarea>` 需要
逐处核对取值差异，例如 `OntologyDetail` 用 `--t-color-bg` 而原语用 `--t-color-surface`）。

### 阶段 3e：零引用 CSS 类清理 —— **已完成**

由阶段 3d 的宿主核对顺出来的第二笔账：既然"CSS 里有、TSX 里没有"是这些按钮类的真实状态，
那就该把这条审计**跑遍全部 CSS Module**，而不是只跑 `.btn*`。

审计方法（脚本见 §8）：把每个 `*.module.css` 的选择器解析出来取类名，再在**全部** `.tsx` / `.ts`
（含测试）里找该类的 kebab-case 与 camelCase 两种写法；两者都找不到才算零引用。
两个已知的误报来源都排除了：`styles["kebab-name"]` 写法（字面量仍在 TS 里，能搜到）
与 `composes` 跨文件引用（§10.1 已全部回滚，仓库里 0 处）。

结果：**22 个类、散在 12 个文件，全部零引用**，已删除：

| 文件 | 删除的类 |
| --- | --- |
| `conv/ConvDetail` | `q-label`、`qa-block`、`qa-section`、`question` |
| `card/components/Card` | `card-header`、`card-category`、`card-preview`（含窄屏覆盖） |
| `mem/components/ManageTable` | `page-btn`（含 4 个状态/窄屏规则，`SimplePagination` 已接管分页）、`page-info`、`td-num` |
| `mem/components/ReviewCard` | `ghost-btn`、`primary-btn`（各含状态与窄屏规则） |
| `bookmark/BookmarkPage` | `item-desc`、`pagination-actions` |
| `conv/ConvSearch` | `clear-btn`、`input-wrap` |
| `admin/AdminPage` | `rotate-btn`（危险色描边实底按钮） |
| `key/KeyPage` | `inline-code`（另有 `.gen-btn`，见阶段 3d） |
| 其余 | `file/FileList` 的 `spacer`、`rainbow/ColorEditor` 的 `hex-base`、`task/TaskCalendar` 的 `day-number-today`、`task/TaskDag` 的 `hint-p` |

其中 5 个是**自写按钮**（`ManageTable/.page-btn`、`ReviewCard` 的两个、`AdminPage/.rotate-btn`、
`KeyPage/.gen-btn`），形态与前面收口的按钮族同源 —— 这解释了为什么"按 `.btn` 前缀计数"永远
收敛不到零：**命名不是契约，渲染它的元素才是**。

顺带清理：`card/components/Card` 里三处同断点 `@media (width <= 768px)` 合并为一处
（其中一处因删类已空）。删除过程中脚本一度把 `ReviewCard` 窄屏分组选择器 `.ghost-btn, .primary-btn`
的后半行误删成一个悬空选择器，是**逐文件读 diff 时发现的**——批量删除 CSS 必须逐文件看 diff，
不能只看测试是否通过（悬空选择器与空 `@media` 块都不会让测试失败）。

量化结果：CSS Module **16,426 → 15,836 行**（−590）；产物 CSS gzip
首屏 46,815 → 46,626 字节、全量 106,064 → 104,775 字节；首屏 JS gzip 17,940 → 17,812 字节。

### 阶段 3f：`.input` / `.textarea` 手写控件收口 —— **已完成（真重复归零）**

阶段 3d 结尾那份"宿主分类"清单里剩下的最后一笔：4 个文件仍在裸 `<input>` / `<textarea>` 上
手写整套控件样式。本轮全部改用 `<Input>` / `<Textarea>`：

| 文件 | 原形态 | 迁移方式 | 说明 |
| --- | --- | --- | --- |
| `bookmark/BookmarkDetail` | `.input, .textarea` 整组 + `.textarea{resize}` + `::placeholder` | `<Input>` / `<Textarea>`，**不再传调用方类**（只留 `:focus` 覆盖） | 原那组声明与 `Control.module.css` 的基础类逐声明相同（width 100% / padding sm md / border / radius-md / surface 底 / text-sm / transition），`resize` 与 `::placeholder` 也由原语提供；域内唯一的差异是**焦点配色**（书签模块色 `--m-bookmark`，不是全局 accent 环），保留为 `:focus` 覆盖 |
| `ontology/OntologyDetail` | 同上，但底色是 `--t-color-bg` | `<Input tone="bg">` / `<Textarea tone="bg">` | 底色差异改由原语修饰类表达；其余整组删除 |
| `command-palette/CommandPalette` | 无框输入（外框与焦点环在包裹层 `.input-row:focus-within`） | `<Input class={styles.field}>` | 覆盖类里**必须显式 `padding: 0`** —— 原语自带 sm/md 内边距，漏了输入区会内缩一圈；`:focus-visible` 关掉控件自身焦点环的规则保留（环由包裹层画） |
| `rainbow/AngleEditor` | 窄宽 + 右对齐的数值框 | `<Input tone="bg" class={styles.angleInput}>` | 只有 5 条域内差异（固定宽度 / 紧凑内边距 / 小圆角 / text-base / 右对齐）留在覆盖类里 |

**顺带修掉一处真实的 a11y 问题**：`AngleEditor` 的 label 是靠"包住输入框"隐式关联的，
`label` 里换成原语组件后静态检查（biome `lint/a11y/noLabelWithoutControl`）看不到内部 input 而报错。
改为 `createUniqueId()` 生成 id + `label[for]` **显式关联**（与 `Field.tsx` 同一手法）——
隐式关联在自动化可访问性检查里常常不算数，显式关联更稳。

可见变更（只有一处，且是"用回原语"的必然结果）：两处多行输入框的 `line-height`
从 UA 默认（~1.15）变成原语的 `--leading-normal`（1.6），`rows=3/4` 的高度各增约 17~22px；
`CommandPalette` 与 `AngleEditor` 靠覆盖类保持原尺寸，无可见变化。

**测试**（新增 18 例）：

- `components/ui/atoms/Control.test.tsx`（9 例）：逐个钉住这次四处迁移共同依赖的**透传契约** ——
  `inputmode` / `placeholder` / `value` / `aria-label` / `id` / `disabled` 落到真实元素；
  **`ref` 回调收到真实 HTMLInputElement**（命令面板的自动聚焦依赖它）；`onInput` / `onFocus` /
  `onKeyDown` 仍被调用（keydown 在 Solid 里是委托事件，派发必须带 `bubbles: true`）；
  类名组装（md 不产生额外类、sm/lg/tone/mono/invalid 各一个、调用方类拼在最后、Textarea = 同参数 Input + 一个多行修饰类）。
- `modules/ontology/OntologyDetail.render.test.tsx`（4 例）：编辑态下 `label[for]` 与控件 id 一一对应
  且指向可输入元素、控件类名与参照原语**完全相等**（证明没有自写控件类）、保存提交 trim 后的值、
  名称清空时保存禁用。
- `modules/rainbow/AngleEditor.test.tsx`（5 例）：原生 `inputmode` 与初始值、控件 = 原语 + 一个域内类、
  输入写回角度、切到弧度后按新单位重算、无法解析的输入回落 0。

度量：`.input` 15 → **11 处 / 11 文件**、`.textarea` 7 → **5 处 / 5 文件**，逐处核对宿主后
**没有一处是"手写控件原语"**——剩下的分别是：原语自身 2 处（`SearchInput` 的 `.input`、
`Control` 的 `.textarea`）、共享原语的调用方覆盖类 10 处、已记录的刻意排除 4 处
（`markdown-editor`、`card/CardEdit` 的 `MarkdownEditor` 替换式 class、`mem/MemAdd`、`quick-capture`）。
`BookmarkDetail` 现在只剩 `:focus` 状态规则，故不再计入基础定义。

### 阶段 3g：返回链接收口（阶段 3c 的剩余部分）—— **进行中**

阶段 3c 一直挂着"`ConvDetail` / `ConvConcept` / `MemManage` / `ReadingDetail` 仍在手写页面铬"。
这轮先按**用户实际看到的构件**（而不是按页面）重新盘了一遍，发现真正重复的是**返回链接**：
它出现在 6 个地方，且分成两种完全不同的形态 ——

| 形态 | 位置 | 处理 |
| --- | --- | --- |
| **A. accent 文字链接 + 悬停下划线**（`text-sm`、`<a>` 真链接、`ArrowLeft` + 文案） | `conv/ConvSearch`、`conv/components/ConvTopBar`（`ConvDetail` / `ConvConcept` 共用）、`reading/ReadingDetail`、`reading/ReadingUnknown` | **已收进共享 `<BackLink>`** |
| **B. 描边按钮式返回**（底色/描边/圆角，看着像按钮） | `mem/MemManage`、`mem/MemAdd` | 本轮不动：设计系统里没有"长得像按钮的链接"原语，`Button` 渲染的是 `<button>`。等第三个消费方出现再决定是加 `ButtonLink` 还是让这两页改成按钮语义 |

新增 `components/ui/molecules/BackLink.tsx`：真 `<a href>`（可中键新开、可复制链接）+ `ArrowLeft`
+ 文案；**不复用 `Toolbar`**，因为后者的返回是按钮（语义是"返回上一状态"，如取消编辑），
而这个原语的语义是"回到某个 URL"。两条刻意写法：① 不改成 `inline-flex + gap`，
保持图标与文字之间原有的普通空格；② 基础类包在 `:where()` 里（特异度 0），
调用方类（`ConvDetail` 的字重/外边距、`ReadingDetail` 的网格跨列、`ConvSearch` 的字重）必定生效 ——
注意 **`<A>` 会自行追加 `inactive` / `active` 状态类**，所以"调用方类排在最后"这个前提不成立，
覆盖只能靠特异度（这是写这个组件时才发现的，测试里留了注释）。

各页保留的差异一律降级为调用方类，视觉零变化：`ConvTopBar` 的 `font-weight: 500` +
`margin-top`、`ConvSearch` 的 `font-weight: 500`（共享层默认字重跟随 `Toolbar` 的返回按钮 = 400）、
`ReadingDetail` 的 `grid-column: 1 / -1`；图标尺寸仍按各页原值（conv 14 / reading 16）经 `size` 传入。

测试：`BackLink.test.tsx`（4 例，用**真实 `Router`** 渲染而非 mock —— 被测的就是链接行为）、
`ConvTopBar.test.tsx`（4 例：href 与文案、唯一 h1、类型中文映射与未知类型兜底、日期可选）。

**其余仍手写页面铬的页面与理由**（阶段 3c 收尾时的判定，避免以后重复评估）：

- `conv/ConvDetail` / `ConvConcept`：顶栏是"链接返回 + h1 + 类型标签 + 日期"的**带元信息页头**，
  共享 `DetailPage` 只表达"按钮返回 + h1 + 动作区"，收进去会改结构（属视觉变更）。
  本轮已把其中的返回链接抽出，剩下的 `.top-bar` / `.title-area` 暂留在页内。
- `mem/MemManage` / `mem/MemAdd`：见上表形态 B。
- `chat/*`、`text/TextEditor`、`db/DbViewer`、`rainbow/RainbowGenerator`、`color/ColorPage`、
  `mem/MemPage`、`search/SearchPage`、`card/CardEdit`：这些页面的"铬"是各自功能的一部分
  （全高聊天布局、标签页编辑器、表格工具条、生成器画布），不是重复的页头/返回栏 ——
  强行套外壳只会把差异塞进 props。判定依据是**同一构件是否被反复重新定义**，
  而不是"是否用了 ListPage/DetailPage"。

### 阶段 4：数据层收敛 —— **范式收敛完成**

提交：`ccf58256`（useListResource）、`ce381560`（useCardsList 迁移）。

**范式定为 createResource**（`shared/utils/useListResource.ts`）：createResource
自带竞态处理与 loading/error 状态，无需手写 `loadSeq` 守卫。

两条约定写进代码注释，都是项目里踩过的：
1. **`loading` / `error` 必须是 getter** —— 写成 `{ loading: res.loading }` 会在
   建对象那一刻取值并冻结，调用方永远看到初始的 `true`。这正是"上传成功但
   列表为空"的成因，测试里有专门断言防回潮。
2. **乐观更新失败时回滚到操作前快照**，不无条件 refetch —— AsyncView 在
   loading 时渲染骨架，整表重取会让列表闪一下。

契约测试 10 例（`useListResource.test.tsx`）。

**`useCardsList` 已迁移**，并删掉页面里重复的一份取数逻辑（`CardsList.tsx`
的 `loadInitial` 与 hook 内的 `loadCards` 做的是同一件事）—— 这是 P0-3
"同一件事多种写法"的直接例证。顺带修掉一处误用：创建卡片时内容为空会调
`setError`，而那是**列表**的错误态，会让整个列表变成"加载失败"界面。

**手写派已清零**（提交 `40d1a15a`）：`useBookmarkPage` 也迁到了 `useListResource`，
导出名保持不变故 8 处调用点零改动；`loadSeq` 竞态守卫与参数变化的 `createEffect`
一并删除（createResource 自带竞态处理）。

为保住既有语义，`useListResource` 补了两项能力：
- `reload({ silent: true })` —— 静默重拉不切 loading。原先 `load({silent:true})`
  用于批量操作/标签变更后的同步；直接换 refetch 会让 AsyncView 先闪骨架屏。
- `patch(updater, meta)` / `optimistic(updater, action, meta)` —— 允许同时调整
  分页元信息（删除后 total 减一），且回滚快照改为**整份分页对象**，
  items 与 total 一并还原（原先只回滚 items，total 会停在错值）。

全仓 `setTotalPages` / `loadSeq` 这类手写分页记号已为 0（除注释）。

**仍待做**：`useFileList`（本就是 createResource 派）的 `patchList` 与
`useListResource` 的 `optimistic` 是同一件事，尚未合并；`useDbViewer`（413 行）
与 `useMemManage`（355 行）仍是各自的手写结构。

### 阶段 5：页面级测试 —— **进行中**

- 从脚手架与原语起步（`ListPage` / `DetailPage` / `Input` / `Field`），再到 file 模块。
- 规则：**页面级 bug 修复必须带页面级回归测试**（`missing` 标志那类问题的解药）。
- **验收**：`modules/` 组件测试 2 → 目标 ≥15。

**已完成**：脚手架与原语侧 `PageShells.test.tsx`（12）、`Field.test.tsx`（13）、
`Layout.test.tsx`（9）、`useListResource.test.tsx`（10）；模块侧
`FileList.render.test.tsx`（8）、`CardsList.render.test.tsx`（7）、
`CardDetail.render.test.tsx`（2）、`OntologyList.render.test.tsx`（5）、
`ReadingList.render.test.tsx`（5）、`useBookmarkPage.test.ts`（6）、
`BookmarkManagePage.render.test.tsx`（6）、`FileDetail.render.test.tsx`（5）。

`modules/` 下的组件测试 2 → 8（另有 components/ 侧 8 个渲染级测试文件）。

一条踩过的坑：mock 要取**叶子模块** `@modules/<域>/api.ts` 而非 barrel ——
hook 是从 `../api` 导入的，mock barrel 不生效（会走真实 fetch）。

**`modules/` 组件测试 2 → 15，DoD 指标达成**（提交 `b2b18267`）。

做法上守两条准则，而不是按数字凑：
1. **改动过的地方必须有渲染级回归** —— 每个新测试都对应一处实际改动
   （换了数据源 / 换了外壳 / 迁移了表单原语 / 修了 bug）；
2. **每个被修掉的 bug 都要留下断言**。

三处反复踩到的测试写法（已在各测试文件的注释里写明）：
- **mock 要取叶子模块** `@modules/<域>/api.ts`，mock barrel 时 `importOriginal`
  展开不会替换已被解构的引用 —— 这条踩了三次；
- 夹具用 `ComponentProps<typeof X>` 而非 `as never`：后者展开会报
  "Spread types may only be created from object types"；
- 事件类型要按实现派发（如建议项用 `onMouseDown` 而非 click）。

### 阶段 6：路由级预取评估 —— **已完成（采用路由 preload，否决 query/createAsync 重写）**

原计划的问法是"要不要用 `query()` / `createAsync`"。评估时先去读了 `@solidjs/router@0.16.3`
的实现（`dist/routing.js` / `dist/data/events.js`），把三种可用机制分开看：

| 机制 | 实际行为（读源码） | 结论 |
| --- | --- | --- |
| **A. 懒加载 chunk 预取** | `A` 的 mousemove（20ms 防抖）/ 预取意图事件调用 `router.preloadRoute(url, preloadData)`，其中 `preloadData` **默认就是 true**（除非链接写 `preload="false"`）；它会先跑 `route.component.preload()` | **本来就有**：`PAGE_LOADERS` 用的 `lazy()` 暴露 `.preload()`，悬停即预取页面 chunk。无需改动 |
| **B. 路由 `preload` 数据预取** | 同一次 `preloadRoute` 还会调用路由定义的 `preload({params, location, intent})`；另外**渲染路由上下文时也会调用一次**（`intent` = navigate/initial），且**不 await、不 catch**（裸调用） | **采用**，见下 |
| **C. `query()` + `createAsync`** | 用 router 自带缓存 + Suspense 消除骨架屏 | **否决**（理由见下） |

**否决 C 的理由**（不是"麻烦"，而是与本项目已定的两处契约冲突）：

1. **缓存层重复**：`shared/api/cache.ts` 已经提供 TTL + 单一飞行 + 陈旧重验证（SWR）
   + 模式化失效。`query()` 是第二套缓存，两者语义不同（TTL 30s vs 路由查询缓存、
   失效域 vs 路由重取），必然出现"同一份数据两个来源"的 P0-3 式问题。
2. **四态契约退化**：页面统一走 `AsyncView` 的 loading / error / empty / data 四态与
   `ErrorRetry` 重试入口（阶段 4 的成果，10 个契约测试）。Suspense 会把 loading 态拿掉、
   错误交给 ErrorBoundary，页面级重试入口与"空态"文案都要重做。
3. **乐观更新范式要跟着改**：`useListResource` 的 `patch` / `optimistic` / 整页快照回滚
   建立在 `createResource.mutate` 上（file 模块的删除/重命名/批量操作全靠它）。
4. **收益已被其它两处吃掉大半**：SWR 让 30s 内的回访**立即**拿到旧值并后台刷新
   （骨架屏根本不出现），A 机制又让页面 chunk 在悬停时就位；**只有"首次进入某详情页"
   仍会看到骨架**，而这正是 B 能补的。

**B 的落地（提交 `84a06b88`）**：`app/route-preloads.ts` + `app/routes.ts` 接线，
悬停列表项时用**页面同一个取数函数、同一个参数**把数据取进 api 缓存，点击时页面的
`createResource` 命中缓存。三条约束都是踩过坑才写死的：

- **绝不抛错**：路由器对 `preload` 的返回值既不 await 也不 catch，一旦拒绝就是未处理的
  Promise 拒绝 —— 与 P1-5（fetcher 里 `throw` 让页面永远停在骨架屏）同一类故障。
  实现里统一 `try/catch` 吞掉，页面自己的错误态照旧。
- **不进首屏 chunk**：`routes.ts` 只留一份**路径清单**（几个字符串），实现走动态 import
  成为独立 chunk（悬停时才下载）。直接静态引入时首屏 JS gzip 从 17,802 → 18,378（+576），
  改成按需加载后回到 **17,534**（比改造前还小 268），代价是悬停时多一个 2,286 B（gzip 762 B）的 chunk。
- **只在预取意图取数**：`intent === "preload"` 才发请求。导航与首屏那一刻，路由上下文刚建立、
  页面组件的 `createResource` 紧接着就发同一请求（缓存键相同，单一飞行会合并），预取拿不到
  任何时间优势，反而白付一次动态 import 的往返。

覆盖 6 条详情路由（card / ontology / bookmark / task / conv detail 用数字 id，
file detail 用字符串 `stored_id`）；非数字、0、缺失的 id 一律不预取，把"无效 ID"留给页面自己的错误态。

**刻意不覆盖**：`readingDetail`（页面要文章 + 生词 + 笔记三次请求，预取等于请求翻倍）、
`convConcept`（需要复刻 `?article=` 查询参数拼装）、各列表页（分页/筛选参数多，
预取哪一页都只是猜）。判定标准是"**预取是否与页面用完全相同的参数再取一次**"。

测试 10 例（`app/route-preloads.test.ts`）：路径清单与 `PATHS` 对得上、id 解析（非法一律不发请求）、
file 的字符串 id 原样传递、**取数失败时预取自身仍 resolve**、`toRouteDefs` 的接线、
intent 门控（navigate 不取、preload 才取）。

**留下的诚实缺口**：本轮无法在浏览器里量"骨架屏少闪了几次"，机制正确性来自源码阅读 + 单元测试；
首屏体积与请求数（单一飞行）是唯一可量化的部分。若以后要做真实测量，
`PerformanceObserver` 观察详情页的 `largest-contentful-paint` 或给 `AsyncView` 加一个"骨架屏可见时长"埋点更直接。

### 阶段 7：样式引用的两条契约 —— **已完成**（分支 `fix/web-style-reference-contracts`）

起因是一次代码审阅：`/search` 页整块样式没生效、任务依赖图整张涂成黑，两者都已存在一段时间，
而 `pnpm run check`、`pnpm run test`（当时 123 文件 / 895 用例）**全都不报**。

**三处失效，同一个根因：手写的字符串在引用 CSS 产物**

| 位置 | 症状 | 原因 |
| --- | --- | --- |
| `modules/search/SearchPage.tsx` | 筛选条与全部搜索结果的类名都是 `undefined`，整块没样式 | 用 `styles["filter-btn"]` 这种 kebab 索引取值，而 vite 配的是 `localsConvention: "camelCaseOnly"`，导出对象里只有 `filterBtn` 键 |
| `modules/task/lib/dag-render.ts` | 依赖图（`/task` 的 DAG 视图）边、箭头、节点、图例取色全为空串；Canvas 对非法颜色**静默忽略**（保持上一个值）→ 全黑 | 9 处 `readCSSVar("--color-border")` 之类的名字在本项目**一个都不存在**（项目令牌统一 `--t-color-*`）；`STATUS_COLORS` 还多写一个右括号再用 `slice(4, -1)` 手工剥壳，剥完仍留着 `)` |
| `modules/home/HomePage.tsx` | 首页九个模块卡片的图标底色透明（原意是 8% 淡色底） | `background: \`${color}14\`` 展开成 `var(--m-task)14`，非法值使整条声明作废；`stroke={var(--m-*)}` 走 SVG **表现属性**，而表现属性不按 CSS 声明解析，`var()` 在其中的支持跨浏览器不一致（w3c/svgwg#1031） |

**为什么渲染测试测不出来（这条最值得记）**：vitest 默认 `css: false`，`*.module.css` 的导入被
替换成一个 Proxy，**访问任意属性都返回 `` `_<名>_<hash>` ``** —— 于是 `styles["filter-btn"]` 在
jsdom 里照样有值，任何渲染断言都发现不了。这类错误只能在**源码与产物层**抓，属于
"审计要针对真实产物，而不是标识符是否存在"（同阶段 3 的那条教训）。

**契约 A：`shared/styles/css-modules-contract.test.ts`（新增）**

静态扫描：先扫全部 `*.module.css` 收集类名，再扫 `*.tsx` 里的 `styles.X` / `styles["x"]`，断言
① 禁止 `styles[动态索引]`；② 禁止 kebab 字面量键（失败信息直接给出 camelCase 建议）；
③ 键必须在对应 CSS 里存在（抓 `styles.hitTitl` 这类错别字）。

落地时它**额外抓出 7 处**同类死引用：`CardEdit.tsx`(meta)、`ChatPageParts.tsx`(treeHeaderActions)、
`DbTable.tsx`(backrefCell)、`LandingPage.tsx`(modules)、`ManageToolbar.tsx`(tagPicker)、
`ReadingList.tsx`(textarea)、`TaskManager.tsx`(searchInput)。逐处核对后确认它们引用的类名
**在 CSS 里从未定义**、值一直是 `undefined`，视觉由父级继承或后代选择器承担 ——
处理方式是**删掉引用**（DOM 与视觉零变化），而不是凭空发明一条 CSS。

**契约 B：`shared/styles/tokens.ts`（新增）+ `tokens-contract.test.ts`**

把"JS 侧允许读取的令牌"登记成字面量联合类型 `TokenName`，配 `readToken(name: TokenName)`
（内部 `getComputedStyle` + 缓存，缓存键带 `data-theme` 以免换主题取到旧色；无 `document`
时返回空串且不写缓存）。名字写错变成**编译错误**：把旧的 `--color-border` 写回去会得到
`TS2820`，并提示 `Did you mean '--t-color-border'?`。配套测试断言联合里每个名字在 CSS 中
真实定义，防止类型与 `tokens.css` 漂移。只登记 JS 真需要读的子集（当前 9 个），不是把 41 个令牌抄一遍。

**回归测试：`modules/task/lib/dag-render.test.ts`（新增 7 例）**

用假 ctx 记录每次 `fillStyle` / `strokeStyle` / `globalAlpha` 赋值，断言取到的是真令牌值而不是空串
（jsdom 支持内联自定义属性，`readToken` 的读取路径因此被真实执行）：任一次取色非空、边与箭头用
`--t-color-border`、四个状态按各自的令牌取色、节点文字用 `--t-color-on-solid`、阴影改由
`globalAlpha` 表达且不再出现内联 `oklch(0 0 0 / …)`。这组断言对改造前的代码必红。

**顺带收掉的分歧与重复**

- `modules/task/lib/status-colors.ts`（新增）：状态 → 令牌名的单一来源。此前看板与依赖图各存一份，
  且**取值互换**（backlog / archived），依赖图那份还坏了。统一取看板那份 —— 它是四处里唯一一直
  正常显示、用户一直在看的；依赖图那份从未成功渲染过，所以不构成可见变化。另有两处 CSS 徽章
  （`TaskList` / `EditTaskModal` 的 `.status-*`）用 `--t-color-border` 表达"未激活"，是另一套视觉，
  **未纳入**，记在这里备查。
- `ErrorRetry` 补 `ErrorRetry.module.css`：此前是 `components/ui/molecules/` 里唯一用内联样式写视觉的
  组件，而它经 `AsyncView` / `AsyncSection` 服务于所有列表页与详情页的错误态（阶段 3d 的同类收口）。
- `CommandPalette` / `QuickCapture` 的遮罩 hover 由硬编码 `oklch(0% 0 0deg / 55%)` 改为
  `color-mix` 从 `--t-color-overlay` 派生（合成后 alpha ≈ 0.5×0.9 + 1×0.1 = 0.55，与原来一致，
  保留"悬停略加深"的交互反馈，同时不再为 5% 的差异新增令牌）。
- `TimeWindowsTab` 的内联 `margin-top: "1rem"` 改为 `.section-header-spaced` 修饰类（走 `--space-lg`）。
**验证（同一条通道：构建产物）**

`pnpm run check` 0 错误（37 条 warning 与基线一致）；`pnpm run test` **126 文件 / 905 用例全绿**
（新增 3 个测试文件共 10 例）。并回到当初发现问题的**产物层**确认：`dist` 里 SearchPage 的
kebab 索引归零、解引用改为 `_.hitKind` 且产物 CSS 中确有 `_hit-kind_*` 规则；
HomeGuard 产物里 `--module-accent` / `--card-accent` 经自定义属性传递、`stroke` 全部走 CSS、
硬编码 55% 遮罩出现次数为 0、`ErrorRetry` 有真实 CSS 类。

**诚实缺口**：Canvas 的实际取色与 `color-mix` 的计算结果需要浏览器才能看（本轮环境浏览器后端
不可用）。上述 DAG 测试覆盖的是"交给 Canvas 的颜色值是否正确"这一原失效面，
"像素看起来对不对"建议人工过一眼。

### 阶段 8：组件嵌套与共享件收敛（分支 `refactor/web-component-structure`，7 个提交，未 push）

**动机**：按 §5 的原则 1（"同样的样式重复到第 3 次就必须提升为原语"）与 §4 的 P2
（结构 / 可维护性）做一轮普查。三类问题的实际分布：

**① 同一构件被反复重新定义（本轮的提取对象）**

| 构件 | 重复份数 | 处理 |
| --- | --- | --- |
| 标签输入 chips + 候选下拉 | file / bookmark 逐字同构（CSS 只有新增），mem 是第三个变体 | `molecules/TagInput`（候选来源二选一：本地全量 / 远程搜索；计数与行内删除可选）；file / bookmark 退化成各自 API 的适配器 |
| 标签筛选下拉 | file / bookmark（差计数、"无标签"项、模块色调） | `molecules/TagFilter`，模块色调走 `--tag-filter-accent` 覆盖 |
| 标签判定（候选过滤 / 精确命中 / Enter 落点） | 三处各一份且行为不一致 | `shared/utils/tag-combo.ts`（纯函数）；mem 保留自己的 id 键控标记但共用判定 |
| 环形 spinner | command-palette / conv 各一份 | `atoms/Spinner`；**顺手修掉一个真 bug**：conv 那份的 `animation: spin` 引用的是别处的 `@keyframes`（CSS Modules 是文件作用域），它一直静止 |
| 空态 | 二十多处 | `molecules/EmptyState`（title / hint / icon / action + compact），先迁最同形的 6 处 |
| "是否正在输入"判定 | 5 处，范围互不相同 | `shared/utils/keyboard.ts` 的 `isTypingTarget`，按并集统一 |

**② 过大组件**

- `FileDetail.tsx` 391 → 组合层：拖拽调宽收进 `hooks/useSplitPane`，两个侧栏视图拆文件。
- `ManageTable.tsx` 347（7 组件 + 6 个嵌套接口）→ `manage-table/` 下 4 个文件；行级三个
  回调原先被复制进 4 个接口逐层转发，收成一束 `RowActions`。
- `OntologyList.tsx` 191（5 组件）→ 表格 / 网格 / 删除按钮各一个文件；页面不再无视
  `ListPage` 给的 accessor。
- `FileCard.tsx` 195（4 组件）→ 两个模式各一个文件；与 `FileRow` 逐字重复的操作区与
  标签 chips 收成 `FileItemActions` / `FileTags`。
- `TaskList.tsx` 四段各 13 行、只差 `tasks`/`title` 的调用块 → 一个 `<For>`。

**③ 页面嵌套结构**

- `CardDetail` / `CardEdit`：单实体却用**列表**原语 `AsyncView` 包成 `[card]`（判断顺序
  与 `AsyncSection` 相反）→ 换回 `AsyncSection`；两个 hook 里手抄的取数 + 错误信号换回
  `useDetailResource`（§11.2 "同一个知识只允许存在一处"的又一处漏网）。
- `BookmarkDetail`：编辑表单的 17 个 props（调用点逐个搬运 `m.*`）收成整个 hook 一束。
- `DependenciesTab`：`depTasks` 原是与 `depIds` 并存的第二份状态 → 改为派生。

**验证**（`pnpm run check` 0 错误；`pnpm run test` 168 文件 / 1347 用例全绿，新增 33 例；
`pnpm run build` 通过）：

- 产物体积（同一套口径，基线 `f17fff90`）：全部 JS 1896.4 → 1892.9 KB、CSS 428.6 → 425.3 KB。
- **首屏同步链有个坑值得记**：把合并后的标签组件从 `components/ui` 的 barrel 导出，会让
  只被懒加载页用到的它们落进入口也加载的共享 chunk —— 首屏 377.0 → 389.7 KB（gzip +3.1 KB）。
  改成消费方按路径 import 后回到 378.7 KB（gzip +0.6 KB，余量是首屏的 CommandPalette 真的
  在用的 `EmptyState` / `Spinner`）。barrel 里留了注释。教训：**新增共享件要按"谁在用"
  决定从哪导出**，不能一律补进 barrel。
- **诚实缺口**：本环境浏览器后端不可用，所以"页面上看着没坏"没有逐页目视核对；DOM 与
  类名是照搬的（改的是组合方式而非标记），并由渲染测试覆盖（FileList / FileDetail /
  BookmarkDetail / BookmarkManagePage / CardDetail / OntologyList / ManageTable / ReadingList）。
- 明确**看过并决定不做**的：`batchCopyLinks` 的裸 `navigator.clipboard`（它要报"复制了
  几条"的计数，`copyTextWithToast` 没这个语义）；`TagManager` 两份合并（除了"Modal +
  列表 + 空态"已无共同抽象，硬并会做成 `variant="file"|"bookmark"` 大组件）；三个详情页
  的 h1 提到数据分支外（会让页面出现两个 h1 或要改版式，与"不重设计"冲突）。

### 阶段 9：按阶段 8 列出的清单继续（分支同上，8 个提交，未 push）

**先补上一轮留下的验证缺口**（阶段 8 有 5 处改了 DOM 却无渲染测试）：`CardEdit`
（骨架/工作台/错误态 + `.body` 撑高链）、`FilePickerModal`、`ChatSidebar`、`DbTable`、
`ConvSearch` 各补渲染测试。**写测试立刻抓到一个真问题**：DbTable 在 loading 且无数据时
工具栏写着"加载中…"、表体又写"无数据"，把两件事混成一句 —— 已修（加载中不给空行）。

**接着做的是阶段 8 尾注里那几条**：

| 项 | 结果 |
| --- | --- |
| `BookmarkPage` 手写 4 信号 + `searchSeq` 竞态守卫 | 收进 `hooks/useBookmarkSearch`（资源驱动，竞态归 createResource）。"不闪烁"契约由 5 例 hook 测试 + 3 例页面测试钉住。**写测试时抓到第二处**：第一版让 fetcher 直接抛错，测试立刻红 —— 正是 §11.2 记的"fetcher 抛错 + 无 ErrorBoundary"坑，随后按 `useListResource` 的做法在 fetcher 内消化成错误信号 |
| `useFileList.patchList` 与 `useListResource` 同一件事两处实现 | 列表资源整体落到 `useListResource`（`patchList` 用共享 `patch`，保留"没有数据时不发明一页"），本地留 `files` / `refetch` 别名 |
| "所有列表页都走 `ListPage`" 与代码不符 | `FileList` 落进 `ListPage`（页头/筛选/四态/分页），页面只剩拖拽区与弹层；拖拽遮罩依赖 `.page` 的 relative 定位故页面根 div 保留 |
| `FileList` 页面体内 ~72 行交互逻辑 | 抽成 `hooks/useImageLightbox`（索引 `-1 = 未打开`，配 5 例测试）、`hooks/useListScroll`（记住/恢复一次 + 高亮定位）、`useFileDropZone` 补 `usePasteFiles`。页面 389 → 332 行 |
| 零碎去重 | `formatBytes` 同名不同义的第二份（改共享 `compact` 口径，两边输出不变；该函数此前无测试，补 8 例）／`fmtHm`／`useCopyFlash`（含"到期只清自己那一次"）／`/search` 不再深入 command-palette 内部 |
| conv 错误态无重试 | `ConvSearch` / `ConvConcept` 接共享 `ErrorRetry`（与同模块 `ConvDetail` 一致），hook 暴露 `refetch`；两个模块 CSS 里零引用的 `.error-msg` 删除 |

**验证**：`pnpm run check` 0 错误；`pnpm run test` **178 文件 / 1381 用例全绿**（本轮 +14）；
`pnpm run build` 通过。产物（同一口径，基线 `f17fff90`）：全部 JS 1896.4 → 1894.2 KB、
CSS 428.6 → 425.1 KB；首屏同步链 377.0 → 379.4 KB（gzip 124.7 → 125.6）。

**§11.5 第 1 条 `MediaPreview` 经核查已大半过时**：`hooks/usePreviewUrl.ts` 已经把
"私密→blob / 公开→直链 + blob 回收"收成一处，`ImageLightbox` 与 `viewers/PreviewMedia`
都在用它，且两处都已带 `keyed` 与回归测试。剩下的只是灯箱内错误/加载**文案**的展示
差异，合并它要改用户可见文案（本轮无浏览器可核对），**故不合并**，本条建议从清单里
销账，只保留"错误呈现统一"这一小项。

**仍未做（交接给下一轮）**：`ConvSearch` 整块三态换 `AsyncView`（会把 spinner 换成
骨架屏、错误态换样式，属可见变化，需目视核对）、`TaskManager` 与 `DbViewer` 的手写
四态、`useFileList` 里上传队列与批量选择两块的进一步拆分（现已不与取数混在一起）。

## 7. 完成定义（Definition of Done）

**终核（全部实测，命令见 §8；分支 `refactor/frontend-ui-architecture`，34 个提交，未 push）**：

| 判据 | 结果 |
| --- | --- |
| 首屏 JS 不回退（gzip，`index-*.js`） | **17,534 B**（阶段 1a 基线 17,955）→ 不回退，反而下降 |
| `pnpm run check` / `pnpm run test` | **0 错误 / 36 警告**（与基线同）；**118 文件 / 868 用例全绿** |
| 原语类重复定义归零 | 手写 accent 环 **0**、`.btn*` **1**（只剩原语自身）、零引用 CSS 类 **0**、`.input`/`.textarea` 手写原语 **0**、`composes` **0** |
| 33 个页面各有唯一 `<h1>` | **33/33**（按渲染树审计，缺 0） |
| 页面外壳与原语有渲染级测试 | 外壳 `PageShells`(12) + 原语 `Field`(13) / `Layout`(9) / `Control`(9) / `BackLink`(4) / `useListResource`(10)；`modules/` 组件测试 **2 → 19** |
| 每阶段独立 commit、可单独回滚 | 34 个提交，按阶段/轮次切分 |
| 样式引用的两条契约通过（阶段 7，分支 `fix/web-style-reference-contracts`） | 类名契约 + 令牌契约各 1 个测试文件；DAG 取色回归 7 例；**126 文件 / 905 用例全绿**，`check` 0 错误 |
| 未擅自 push、未擅自部署 | 满足（`main` 未推送，未执行任何部署命令） |
| CSS 模块行数 16,752 → ≤13,000 | **未达成**：15,798 行。该指标已在 §10.3 论证为不可达并降级为参考量（说明见下） |

各判据的口径与细节：

- 首屏体积以 **gzip** 后计（原始字节数受类名长度影响大、易误导，见 §10）
- `pnpm run check` 0 错误、`pnpm run test` 全绿（含新增测试）
- 原语类重复定义归零：`.btn*` / `.input` / `.textarea`、以及**手写 accent 环**（已有 stylelint 门禁）
  - 手写 accent 环：**已归零**（34 → 0；新增会被 stylelint 拦下）
  - `.btn*`：**已归零** —— 21 → 16 → 14 → **1 处**（剩下的就是 `Button.module.css` 自身的 `.btn`）。
    模块侧 13 处里有 9 处是迁移 `<Button>` 时留下的**死代码**（已删）、4 处是真按钮（2 处收进新增的
    `outline` 变体、2 处收成 `variant="primary"` 并顺带修正 accent 填充，见阶段 3d）
  - 零引用 CSS 类：**已归零** —— 22 个类 / 12 个文件，含 5 个自写按钮（见阶段 3e）
  - `.input` / `.textarea`：**手写控件原语已归零**（4 个文件 / 6 处类名实例全部迁到 `<Input>` /
    `<Textarea>`，见阶段 3f）。度量口径下仍有 11 + 5 = 16 处同名类，但逐处核对宿主后分别是
    原语自身（2）、共享原语的调用方覆盖类（10）、已记录的刻意排除（4）——**按名字数只会数出候选，
    判定必须看宿主元素**（这条在 `.btn*` 上已经踩过一次，见阶段 3d）
  - 度量口径的两条教训：① 按**选择器**解析，不能用 `^\.input\s*\{`（会漏 `.input,\n.textarea {`
    这种多行分组写法）；② **按标识符计数只能定位候选，判定必须核对宿主** —— `.gen-btn`、
    `ReviewCard/.ghost-btn` 这类不以 `.btn` 开头的自写按钮，以及 9 处"CSS 还在、渲染早已换人"
    的死代码，都是靠"这个类被哪个元素用、那个元素由谁渲染"翻出来的（见阶段 3d / 3e）
- 33 个页面各自有唯一 `<h1>`
- 页面外壳与原语具备渲染级测试
- 每阶段独立 commit、可单独回滚；未擅自 push、未擅自部署

> **CSS 行数不再是硬指标**（原定 16,752 → ≤13,000，实测不可达，详见 §10）。
> 理由：模块 CSS 的重复以"结构相同、取值走令牌"为主，收敛它需要引入间接层
> （`composes` 已试过并回滚），而重复的取值不会发散。行数保留为参考量，
> 不作为达成判据；真正要归零的是**同一视觉/交互原语被反复重新定义**的那类重复。

## 8. 度量方法（可复现）

```bash
cd web/src

# ── 规模 ──
find . \( -name '*.tsx' -o -name '*.ts' \) ! -name '*.test.*' | wc -l   # TS/TSX 287
find . -name '*.css' ! -name '*.test.*' | wc -l                          # CSS 102
find . -name '*.module.css' | wc -l                                      # CSS 模块 99
find . \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \) ! -name '*.test.*' | wc -l
find . \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \) ! -name '*.test.*' -exec cat {} + | wc -l
find . -name '*.module.css' -exec cat {} + | wc -l

# ── 路由三重一致 ──
grep -c '^\s*\[PATHS\.' app/routes.ts        # PAGE_LOADERS
grep -c 'path: PATHS\.' config/navigation.ts  # NAV_ITEMS

# ── 原生控件 vs 共享原语 ──
grep -rho '<input'    --include='*.tsx' modules | wc -l
grep -rho '<select'   --include='*.tsx' modules | wc -l
grep -rho '<textarea' --include='*.tsx' modules | wc -l
grep -rhoP '^\.(btn|button)[a-z-]*\s*\{' --include='*.module.css' . | wc -l
# ↑ 旧口径，会漏掉多行分组选择器（`.input,\n.textarea {`），仅作历史数字参考。
#   正经口径用下面这段：按选择器解析、每文件每类名一处，且排除 `:hover` 等状态规则。
python3 - <<'PY'
import pathlib, re
FAM = {"btn": r"\.(btn|button)[\w-]*$", "input": r"\.input$", "textarea": r"\.textarea$"}
def heads(p):  # 逐字符扫，避免正则跨块匹配；@media 等 at-rule 头不计
    t = re.sub(r"/\*.*?\*/", "", p.read_text(encoding="utf-8"), flags=re.S); seg = ""
    for ch in t:
        if ch == "{":
            h = seg.strip()
            if h and not h.startswith("@"): yield h
            seg = ""
        elif ch == "}": seg = ""
        else: seg += ch
for fam, pat in FAM.items():
    rx, per = re.compile(pat), {}
    for f in sorted(pathlib.Path(".").rglob("*.module.css")):
        names = {last for h in heads(f) for sel in h.split(",")
                 if (last := (sel.split() or [""])[-1]) and ":" not in last and rx.search(last)}
        if names: per[f.as_posix()] = names
    print(f".{fam}*: {sum(map(len, per.values()))} 处 / {len(per)} 个文件")
    for k, v in sorted(per.items()): print(f"   {len(v)}  {k}  {sorted(v)}")
PY

# ── 焦点环重复 ──
grep -rho 'box-shadow: 0 0 0 3px var(--t-color-accent-ring)' --include='*.module.css' . | wc -l
grep -rl  'box-shadow: 0 0 0 3px var(--t-color-accent-ring)' --include='*.module.css' . | wc -l

# ── 页面外壳使用面 ──
grep -rl 'PageHead'   --include='*.tsx' modules | grep -v test | wc -l
grep -rl 'AsyncView'  --include='*.tsx' modules | grep -v test | wc -l
grep -rl 'Toolbar'    --include='*.tsx' modules | grep -v test | wc -l

# ── 无一级标题的页面（既不 PageHead 又无字面 <h1>）──
# 只取 modules/ 下的页面；app/routes/HomeGuard.tsx 是分流器，不计
for f in $(grep -oP 'import\("@modules/\K[^"]+' app/routes.ts | sed 's|^|modules/|'); do
  d=$(dirname "$f")
  grep -rq 'PageHead' "$f" && continue
  grep -rq '<h1' "$d" --include='*.tsx' || echo "$f"
done

# ── 硬编码颜色 ──
grep -rhoP '#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)' --include='*.module.css' . | wc -l

# ── 数据范式 ──
grep -rl 'createResource' --include='*.ts' --include='*.tsx' . | grep -v test | wc -l

# ── 跨模块深层 import（排除组合层 app/ 与同模块自引用）──
grep -rn '@modules/' --include='*.tsx' --include='*.ts' modules \
  | grep -vP '@modules/[a-z-]+/index' \
  | perl -ne 'if (m{^([^:]+):\d+:.*\@modules/([a-z-]+)/}) {
      my ($f,$t)=($1,$2); my ($m) = $f =~ m{modules/([a-z-]+)/};
      print "$f -> \@modules/$t/\n" unless $m && $m eq $t; }'

# ── breakpoint 手段 ──
grep -rho '@media'     --include='*.module.css' . | wc -l
grep -rho '@container' --include='*.module.css' . | wc -l

# ── 页面一级标题（按渲染树审计，不能只看标识符）──
# 逐路由检查页面自身或其依赖组件里是否真的渲染 <h1>/<PageHead>/<ListPage>/<DetailPage>。
# 两个坑：① 同模块其它页面渲染了 h1 会被误判为本页通过；② `CardDetailPage`
# 这类组件名会被误当成 <DetailPage> 标签。
python3 - <<'PY'
import re, pathlib
RENDER = re.compile(r'<h1\b|<PageHead\b|<ListPage\b|<DetailPage\b')
def has_h1(p): return p.exists() and bool(RENDER.search(p.read_text(encoding='utf-8')))
bad = []
for r in re.findall(r'import\("@(?:modules|app)/([^"]+)',
                    pathlib.Path('app/routes.ts').read_text(encoding='utf-8')):
    f = pathlib.Path(('app/' if r.startswith('routes/') else 'modules/') + r)
    if not f.exists() or has_h1(f): continue
    txt = f.read_text(encoding='utf-8')
    ok = any(has_h1(f.parent / d) or has_h1(f.parent / 'components' / d)
             for d in re.findall(r'from "\./([^"]+\.tsx)"', txt))
    if not ok:
        ok = any(has_h1(pathlib.Path(m) / s)
                 for _, m, s in re.findall(r'import (\w+) from "@(modules|app)/([^"]+)"', txt))
    if not ok: bad.append(str(f))
print(f"缺 h1 的页面 {len(bad)} 个")
for b in bad: print("  ⚠", b)
PY

# ── 组件测试密度 ──
find modules -name '*.tsx' ! -name '*.test.tsx' | wc -l
find modules -name '*.test.tsx' | wc -l

# ── 响应式陷阱审计（§11.3）──
# ① 快照形态：<Show> 子节点回调里 `=> f(x())`（把 accessor 读成值再传出去）
#    注意这是**候选定位**：`x()` 落在 JSX 属性表达式里是安全的（那在追踪域内），
#    必须逐处读代码确认 —— 与 §7「按标识符计数只能定位候选」同一条纪律
# ② 状态组合：同一文件里既有 loading 骨架、又有独立的内容分支（应互斥渲染）
python3 - <<'PYAUDIT'
import re, pathlib
def shows(text):
    i = 0
    while True:
        i = text.find("<Show", i)
        if i == -1: return
        j, depth, quote = i + 5, 0, None
        while j < len(text):
            c = text[j]
            if quote:
                if c == quote: quote = None
            elif c in "\"'": quote = c
            elif c == "{": depth += 1
            elif c == "}": depth -= 1
            elif c == ">" and depth == 0: break
            j += 1
        header = text[i:j+1]
        m = re.match(r"\s*\{\((\w+)\)\s*=>", text[j+1:])
        if m: yield header, text[j+1:j+1+900], m.group(1)
        i = j + 1
snap = []
for f in sorted(pathlib.Path(".").rglob("*.tsx")):
    if ".test." in f.name: continue
    for header, body, var in shows(f.read_text(encoding="utf-8")):
        if "keyed" in header: continue
        if re.search(r"=>\s*[\w.$]+\s*\(\s*" + var + r"\(\)", body):
            snap.append(f.as_posix())
print("快照形态候选：", len(snap), snap)
PYAUDIT

# ── 焦点环 / 布局原语 ──
grep -rho '0 0 0 3px var(--t-color-accent-ring)' --include='*.module.css' . | wc -l  # 应为 0
grep -rho 'var(--t-ring-accent)' --include='*.css' . | wc -l                        # 令牌消费点
grep -rn '^\s*composes:' --include='*.module.css' . | wc -l                         # 应为 0（§10.1）
grep -rlE '<(Row|Stack)\b' --include='*.tsx' modules | grep -v test | wc -l          # 原语使用面

# ── 样式引用契约（阶段 7）──
# 类名与令牌名两条契约由测试承担，无需手工核；要看细节直接跑：
pnpm run test -- src/shared/styles src/modules/task/lib/dag-render.test.ts
# 产物层复核（发现 /search 那个 bug 的同一通道）：构建后 dist 里不该再有 kebab 索引
pnpm run build && grep -o '\[`filter-btn`\]\|\[`hit-kind`\]' ../dist/assets/SearchPage-*.js | wc -l  # 应为 0
grep -rlo 'oklch(0% 0 0deg / 55%)' ../dist/assets/*.css | wc -l                                    # 应为 0

# ── 零引用 CSS 类（阶段 3e；口径：类名的 kebab 与 camel 两种写法在全部 ts/tsx 里都搜不到）──
# 注意 styles["kebab-name"] 这种写法字面量仍在 TS 里、能搜到，不会误报；
# composes 跨文件引用已全部回滚（上面那行为 0），也不构成漏报来源。
python3 - <<'PY'
import pathlib, re
ts = [p.read_text(encoding="utf-8") for p in list(pathlib.Path(".").rglob("*.tsx")) + list(pathlib.Path(".").rglob("*.ts"))]
blob = "\n".join(ts)
camel = lambda n: n.split("-")[0] + "".join(w.capitalize() for w in n.split("-")[1:])
dead = {}
for css in sorted(pathlib.Path(".").rglob("*.module.css")):
    text = re.sub(r"/\*.*?\*/", "", css.read_text(encoding="utf-8"), flags=re.S)
    names, seg = set(), ""
    for ch in text:
        if ch == "{":
            head = seg.strip()
            if head and not head.startswith("@"):
                for sel in head.split(","):
                    names |= set(re.findall(r"\.([a-zA-Z][\w-]*)", sel))
            seg = ""
        elif ch == "}": seg = ""
        else: seg += ch
    miss = sorted(n for n in names if n not in blob and camel(n) not in blob)
    if miss: dead[css.as_posix()] = miss
print("零引用 CSS 类：", sum(map(len, dead.values())))
for k, v in dead.items(): print(" ", k, v)
PY

# ── 产物体积（DoD 用 gzip 口径；需先 pnpm run build）──
cd ../dist && python3 -c "
import pathlib, gzip
for pat, label in [('index-*.js','首屏 JS'), ('index-*.css','首屏 CSS'),
                   ('*.js','全部 JS'), ('*.css','全部 CSS')]:
    fs = list(pathlib.Path('assets').glob(pat))
    raw = sum(f.stat().st_size for f in fs)
    gz  = sum(len(gzip.compress(f.read_bytes(), 9)) for f in fs)
    print(f'{label:10} 原始 {raw:>9}  gzip {gz:>8}')
"
```

**CSS 重复块统计**（"141 组重复 / 234 个冗余块"的来源，两个数字都随改造下降）：

```bash
cd web/src && python3 - <<'PY'
import re, pathlib, collections
blocks = collections.defaultdict(list)
for f in pathlib.Path('.').rglob('*.module.css'):
    # 先去注释，否则纯注释片段会被当成声明参与比对
    css = re.sub(r'/\*.*?\*/', '', f.read_text(encoding='utf-8'), flags=re.S)
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel = m.group(1).strip().split('\n')[-1].strip()
        props = sorted(p for p in (' '.join(d.split()) for d in m.group(2).split(';')) if p)
        if len(props) >= 3:          # 只看含 ≥3 条声明的块，噪声更少
            blocks[tuple(props)].append(f"{f}:{sel}")
dupes = {k: v for k, v in blocks.items() if len(v) > 1}
print(f"重复块组 {len(dupes)}，冗余块 {sum(len(v) - 1 for v in dupes.values())}")
for k, v in sorted(dupes.items(), key=lambda x: -len(x[1]))[:5]:
    print(f"\n[{len(v)} 处] {'; '.join(k)[:120]}")
    for s in v[:4]:
        print("   ", s)
PY
```

## 9. 排除项（本次明确不做）

- 视觉语言重设计、配色/字体调整（属 [frontend-dao-plan.md](./frontend-dao-plan.md) 与 `design-tokens.md` 范畴）
- 信息架构与导航结构调整
- 交互契约变更（如列表 URL 参数形态、命令面板行为）
- 回收站 / 版本历史等此前已判定不实现的功能（**缩略图已改判**：列表缩略图这一轮做了，见 `file-service.md` §5 的 `/thumb` 与 `ux/file-preview-plan.md` §P3-2）

## 10. 试过并否决的方案（避免重复走）

记录目的是**防止后续会话或再次评估时重新走上同样的路**。

### 10.1 用 `composes` 跨文件收敛 flex 重复 —— 否决

做完了又整体回滚（405 处、93 个文件）。

- **做法**：`Layout.module.css` 提供 `.flex` / `.stack` / `.gap-*` / `.align-*` 等原语类，
  各模块 CSS 用 `composes: stack gap-md from "@components/ui/atoms/Layout.module.css"` 引用。
- **收益**：CSS 模块源码 16,752 → 15,925 行（−827）；按序配对核验过 405 条迁移规则的
  受控属性与原文逐属性等价。
- **否决理由**：`composes` 把一个元素的样式拆到两个文件 —— 读消费方 CSS 只看到
  `composes: stack gap-md`，必须跳到 `Layout.module.css` 才知道含义；散落到 93 个文件后
  维护成本高于它省下的重复声明。而被"重复"的声明本就全部走令牌
  （`gap: var(--space-md)` 之类），重复的是结构而非取值，改设计时不会发散。
- **附带代价（实测）**：未压缩产物 +21KB（首屏 JS +1,118B、全部 CSS +2,489B），
  gzip 后 +7.5KB（首屏 +240B）。原因：每个元素的 class 串变长约 36B/处，
  且共享 CSS 规则会被内联进 30 个 chunk。
- **踩到的坑（若将来仍要用 composes，务必注意）**：
  1. `composes: X from "..."` 必须用**原始 kebab 类名**查找。写成驼峰（`gapMd`）
     会**静默解析成字面量 `undefined`** —— `localsConvention: camelCaseOnly`
     只影响 JS 导出，不影响 composes 的查找。产物里表现为类串末尾多个 `undefined`。
  2. 一行可写多个类名：`composes: stack gap-md from "..."`。
  3. 被组合的类与消费方类特异度相同（0,1,0），因此消费方 CSS 里不能再声明
     同名属性，媒体查询里的响应式覆盖（如 `@media { .body { flex-direction: column } }`）
     也会退化成依赖打包顺序 —— 这类必须放弃迁移。

### 10.2 用 `Row` / `Stack` 组件批量迁移已有 CSS —— 否决

- **做法**：把 `<div class={styles.x}>` 换成 `<Row class={styles.x} gap="md">`。
- **否决理由**：659 个候选点里 **237 处（36%）挂在非 div 元素**上 ——
  `<button>` 106、`<span>` 41，以及 `<A>`（路由链接）、`<section>`、`<form>`、
  `<tr>`、`<dl>`、`<aside>` 等。换成 `div` 会破坏语义、导航与键盘行为。
- **结论**：组件只用于**新代码的 div 容器**；语义元素上的布局仍写在各自 CSS 里。

### 10.3 `CSS 行数 ≤13,000` 这个指标 —— 否决

原目标基于"234 个冗余块 × 每块约 5 行"的估算。实测：
- 最常见的是**两条声明的 flex 组合**（`display:flex` + `flex-direction|align-items`），
  先前"≥3 条声明且完全相等"的统计方式把这类整个漏掉了；
- 每个组合点实际只能省 1–3 行，且删掉一条规则往往要在别处补声明（原语的定义本身要占行）；
- 实测：405 处迁移仅换来 −827 行，且需引入间接层。

行数因此降级为参考量。真正要清零的是 P1-2 / P1-3 那类"同一视觉或交互原语被反复重新定义"
的重复（按钮类 21 处、`.input` 14 处、手写 accent 环 34 处），它们才是会随设计变更发散的。

## 11. 防复发：把两类缺陷钉在结构上

P1-6 的两个缺陷（媒体不换、骨架下沉）不是"手滑"，而是**结构允许它们存在**。
下面按"越靠前的层越省事"排列，都是本项目可落地的。

### 11.1 类型层：跨组件边界传 `Accessor<T>`，不传 `T`

两个缺陷的共同形状是"把一个会变的值当成快照传过边界"：

| 位置 | 曾经 | 后果 |
| --- | --- | --- |
| `PreviewMedia` 的 children | `(url: string) => JSX.Element` | 调用点只能 `props.children(url())` —— 读一次即快照 |
| `useCardsList` 等 hook 的返回 | `{ loading: res.loading }` | 建对象那刻取值并冻结，调用方永远看到初始的 `true` |
| 各详情 hook 的返回 | `{ data, loading, error }`（混用 getter 与否） | 靠注释约束，编译器不兜底 |

改法：签名里一律 `Accessor<T>`（`readonly data: Accessor<T | undefined>`），
需要值的地方必须写 `x()` —— 而写在 JSX 属性/文本里的 `x()` 天然落在追踪域内，
写错的形态（`const v = x()` 再传下去）在评审里也一眼可见。

**判据**：*一个会变的值，要么以 accessor 形式过边界，要么在同一处被消费。*

### 11.2 原语层：把易错组合收进一个组件

| 原语 | 收掉什么 | 消掉的缺陷类 |
| --- | --- | --- |
| `useDetailResource(id, fetcher)` | 7 个详情页各自手写的 `createResource` + `tryAsync` + 错误信号；并区分 **`loading`（还没有数据）** 与 **`refreshing`（有数据、正在更新）** | P1-5（fetcher 抛错卡骨架）、"沉一下"（两个状态混用） |
| `<AsyncSection resource={…} skeleton={…}>` 或 `DetailPage state={…}` | 四态渲染（骨架 / 错误+重试 / 空 / 内容）与"刷新时保留旧内容 + `aria-busy`"的互斥判定 | 骨架与旧内容同框（本次"沉一下"） |
| `<MediaPreview item={…} kind="img"\|"video"\|"audio"\|"pdf" />` | "私密→blob / 公开→直链" + 元素创建 + `keyed` + blob 回收 + alt/aria | 媒体不换（本次图片缺陷）、私密文件 401 破图 |

判据同 §5：**同一个知识只允许存在一处**。这三次修的都是"知识散在调用点"的后果。

### 11.3 验证层：可执行规格 + 行为审计

1. **框架语义写成可执行规格**：`shared/utils/solid-show-semantics.test.tsx`（4 例）
   钉住 `Show` 的真实行为（追踪域内读 accessor 会更新 / 读一次传下去会冻结 /
   `keyed` 会重建 / 真假切换会重建）。框架升级或换实现时，它会先报警。
2. **修 bug 一律先红后绿**：本次两处缺陷都验证过 —— 去掉 `keyed` 后测试立刻红
   （ImageLightbox 3 例、FileDetail 1 例），加回即绿。没有这条，"修好了"只是感觉。
3. **两条可复现审计**（脚本见 §8，口径按**行为**而非标识符）：
   - 快照形态：`<Show>` 子节点回调里出现 `=> f(x())`（读一次当参数传出去）；
   - 状态组合：同一文件里既有 loading 骨架、又有独立的内容分支（应互斥）。
   当前实测：前者 2 处候选（`FileDetail` 的 `content_hash`、`FileList` 的 `menu()`），
   逐处读过后确认安全 —— 它们的 `x()` 都落在 JSX 属性表达式（追踪域）里，
   属审计脚本的假阳性；真正的快照只存在于修前的 `FileDetail` / `ImageLightbox`。
4. **复盘口径沿用 §7**：按行为审计，不按标识符（这条在 CSS 上已经踩过两次：
   `.btn*` 前缀漏掉 `.back-btn`、`^\.input\s*\{` 漏掉分组选择器）。

### 11.4 落地进度

**已完成（提交 `b26ef872`）**：

- `useDetailResource`（`shared/utils/`）：错误消化 + 无效 id 判定 + **`loading`（首次加载）
  与 `refreshing`（有数据、后台更新）分离**，返回字段一律 `Accessor`；不变量是
  "有错误时 loading 必为假"。
- `AsyncSection`（`components/ui/molecules/`）：单实体四态渲染，互斥由原语保证；
  判断顺序刻意是 **error → loading → empty → data**（错误不被骨架挡住）。
- 已接入 `FileDetail` / `OntologyDetail` / `TaskDetail` / `BookmarkDetail` 四个详情页；
  `useFileDetail` / `useBookmarkDetail` 的取数块也换成该原语。
- 类型收紧：`ListResource` 的 `loading` / `error` 改为 `Accessor<...>`（实测只有 4 处需要改，
  `tsc` 全部指出）——"忘了调用 accessor"从此是编译错误，而不是运行时静默拿到一个函数。
- 测试 +12（`useDetailResource` 5 例、`AsyncSection` 7 例），其中两例直接钉住本次
  两个缺陷的形状：刷新时 `loading=false && refreshing=true && 旧数据仍在`、
  错误优先于骨架。

### 11.5 尚未做（按收益排序）

1. **`MediaPreview`**：合并 `FileDetail` 与 `ImageLightbox` 的媒体渲染，把"私密→blob /
   公开→直链 + 元素创建 + `keyed` + blob 回收 + alt/aria"收在一处 —— 媒体不换那类缺陷
   从此只可能出现在一个文件里。
2. **其余手写四态的页面**（审计显示约 13 个文件仍有"loading 分支与内容分支并存"）：
   按同一模式逐个换成 `AsyncSection`（列表页用既有的 `AsyncView`）。
3. **陷阱清单进 `AGENTS.md`**（跨边界传 accessor、loading/content 互斥、fetcher 不抛错），
   让后续会话/协作者在动手前就看到 —— 这是给"下一个改这块的人"的最低成本保险。
