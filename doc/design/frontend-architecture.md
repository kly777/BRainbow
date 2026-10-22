# 前端整体架构决策

> 状态：提案（未合入 main） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22
> 日期：2026-10-18
> 范围：`web/src` 的整体架构，不针对单个页面或组件
> 适用对象：前端开发、评审者、后续接手模块的人
>
> 说明：文中的物理分层已部分落地，各条 ADR 未全部执行；未执行的部分不能当现状读，
> 以 `web/src` 代码为准。

## 1. 背景

前端目前是一个 **SolidJS + Vite+** 的模块化单体：

- 约 21 个业务模块、5.8 万行源码（含 CSS）
- 页面按模块放在 `src/domains|capabilities|platform|tools/<name>/`
- 跨模块通过模块 `index.ts`；`@modules/<name>` 是兼容别名，物理路径由 `config/module-registry.ts` 的 `MODULE_LAYER_DIRS` 决定
- 共享层是 `components/ui`、`shared/api`、`shared/styles`、`shared/utils`
- 路由集中在 `config/paths.ts` → `app/routes.ts`
- 服务端数据通过 `shared/api` 的 request/cache/domain invalidation
- 页面布局是 command-first、chrome-less：没有落地页，没有常驻左侧导航，命令面板是主要入口

物理分层：

```text
web/src/
  app/            入口、Layout、路由、全局浮层
  capabilities/   home、search、quick-capture、chat
  domains/        bookmark、card、conv、mem、ontology、reading、task、text
  platform/       admin、ai-setting、auth、command-palette、db、file、key
  tools/          color、rainbow
  components/     共享 UI
  shared/         API、工具、样式
  config/         路径、导航、模块注册表
```

当前整体方向是合理的，但架构中有五处需要明确，否则模块数量继续增长后会靠约定而不是结构维持：

1. 物理目录已经按 domain / capability / platform / tool 分开，依赖权限由 `MODULE_KINDS` 与静态测试共同约束
2. 模块内部缺少稳定的 领域 / 数据 / 视图 分层
3. 服务端状态有多套获取与失效方式，没有统一生命周期
4. 页面布局模式是隐式的，每个页面重新决定一次页面骨架
5. 测试以纯函数和静态契约为主，缺少模块组合与核心流程验证

本文用 ADR 的形式把这些决定固定下来。

---

## 2. 现状评估

### 2.1 已经成立的基础

| 能力 | 现状 | 评价 |
|---|---|---|
| 分层依赖 | `app → capabilities → domains → platform → shared`，物理目录 + 静态扫描测试 | 强，应保留 |
| 路由 | 路径单一来源、类型穷尽检查、懒加载、预加载 | 强，应保留 |
| API 传输 | 统一 request/cache/domain invalidation/错误模型 | 强，应作为服务端状态的地基 |
| 样式 | CSS Modules + design tokens + stylelint/token 契约 | 强，应保留 |
| 测试 | 纯函数、组件、路由、样式契约覆盖较好 | 强，但偏底层 |
| 构建 | Vite+、路由级拆包、重依赖懒加载 | 强，应保留 |

### 2.2 结构性问题

| 问题 | 表现 | 影响 |
|---|---|---|
| 模块类型未区分 | task/card 与 quick-capture/command-palette/home 平级 | 谁可以依赖谁没有规则，长期可能出现环 |
| 模块内部无分层契约 | 页面、数据请求、视图状态、业务规则混在页面/provider/hooks | 同一规则容易复制到第二个页面 |
| 服务端状态各自为政 | `cachedRequest`、`useListResource`、`createResource`、各模块 Provider 并存 | 失效、去重、乐观回滚策略不一致 |
| 布局策略隐式 | 每个页面自己实现头部、工具条、全高面板、分栏 | 页面骨架漂移，新增页面成本高 |
| 页面级测试薄弱 | 单元/静态测试强，页面组合与跨模块流程少 | 模块接口变了，页面是否仍成立缺少验证 |

这些问题不是“再清理几个文件”能解决的，需要先定架构规则。

---

## 3. 目标架构

逻辑上分五层，**不要求第一阶段就改目录**：

```text
┌──────────────────────────────────────────────┐
│ App Shell                                    │
│ Router / Auth / Theme / Global overlays      │
│ Command palette / Quick capture              │
└───────────────────┬──────────────────────────┘
                    │
┌───────────────────▼──────────────────────────┐
│ Composition / Capability                     │
│ home / search / quick-capture / command-...  │
│ 可编排多个 domain，不承载领域规则              │
└───────────────────┬──────────────────────────┘
                    │
┌───────────────────▼──────────────────────────┐
│ Domain Modules                               │
│ task / card / file / mem / reading / ...     │
│ Page → view → data → model → components      │
└───────────────────┬──────────────────────────┘
                    │
┌───────────────────▼──────────────────────────┐
│ Shared Platform                              │
│ API transport / query cache / UI kit /       │
│ tokens / utils                               │
└──────────────────────────────────────────────┘

config/ 是零依赖旁路，不属于以上任何一层
```

### 3.1 模块分类

| 类型 | 职责 | 示例 | 允许依赖 |
|---|---|---|---|
| App Shell | 路由、认证、主题、全局浮层、全局命令入口 | `app/`、`auth`、`ai-setting`、`admin` | 所有层 |
| Capability | 跨域能力；组合多个 domain，但不拥有领域规则 | `home`、`search`、`quick-capture`、`chat` | domain 的公开接口、platform、shared |
| Domain | 单业务域的页面、规则、数据适配 | `task`、`card`、`mem`、`reading`、`bookmark`、`conv`、`ontology`、`text` | 自己的内部层、platform、shared |
| Platform | 通用平台能力；可被各域消费，不反向编排业务 | `auth`、`ai-setting`、`admin`、`db`、`key`、`file`、`command-palette` | platform、shared |
| Tool | 独立小工具 | `color`、`rainbow` | shared |
| Shared | 与业务无关的平台能力 | `components/ui`、`shared/api`、`shared/styles`、`shared/utils` | 不得依赖 app/modules/components |
| Config | 路径、导航、模块元数据 | `config/` | 零依赖 |

`file` 是通用文件服务、无下游业务依赖，按 platform 管理；`chat` 组合 AI 与 mem，按 capability 管理；`command-palette` 是应用级入口，按 platform 管理。这样 domain 之间不再需要直接依赖。

### 3.2 依赖规则

1. `shared` 不得依赖 `app`、`domains`、`capabilities`、`platform`、`tools`、`components`
2. `domain` 之间不得互相依赖；跨域组合上移到 capability 或 platform
3. `capability` 可以编排多个 domain，但不得把某个 domain 的规则复制进来
4. `platform` / `tool` 不得反向依赖 domain/capability
5. `app` 可以组合 capability 与 domain
6. 页面不得直接依赖 API transport；数据访问必须经过模块的 `api.ts` 或 `data/`
7. 跨模块不得深引 `components/`、`view/`、`model/`、`data/` 等子目录
8. `config` 不依赖任何业务层

模块内部统一为 `model/`（纯规则）、`view/`（页面状态/编排）、`data/`（多文件数据适配）；简单模块的根级 `api.ts` 即数据适配入口。`hooks/` 与 `lib/` 已全局移除。

现有 [layer-boundaries.test.ts](../../web/src/app/layer-boundaries.test.ts) 已覆盖依赖方向、domain 同层隔离、模块图无环、公共入口不转出内部 UI、view 不直接碰 transport。

---

## 4. ADR 决策记录

### ADR-FE-001：继续采用模块化单体

**决定**：不引入微前端、不做独立子应用、不引入全局大 Store。

**理由**：

- 当前规模（约 21 个模块）远未到微前端收益点
- 模块之间共享认证、主题、API、UI 原语，拆开只会增加协议成本
- 单体 + 纵向模块 + 明确边界足以支撑个人知识工具

**后果**：

- 模块边界靠静态规则和评审维护，而不是运行时隔离
- 构建仍是一个应用、一套依赖图

---

### ADR-FE-002：模块分为 domain / capability / app

**决定**：所有模块必须标记类型；依赖权限按类型区分。

**理由**：

- `quick-capture`、`command-palette`、`home` 天然跨域，不能和 `task`、`card` 用同一套依赖权限
- 不区分类型时，“谁能依赖谁”只能靠人记

**落地方式**：

- 第一阶段不移动目录，先在模块清单/代码注释/ESLint 规则中标记
- 当模块数量或跨域依赖继续增长时，再物理拆为 `domains/`、`capabilities/`

---

### ADR-FE-003：模块内部采用四层结构

**目标结构**：

```text
<module>/
  Page.tsx          // 只做页面组合
  view/             // URL 状态、视图状态、页面 view model
  data/             // query / mutation / adapter
  model/            // 纯领域类型与规则
  components/       // 领域 UI
```

**依赖方向**：

```text
Page → view → data → model
                 ↓
              shared/api
```

**规则**：

- `model/` 不依赖 Solid、DOM、API
- `data/` 不依赖 UI
- `view/` 不直接发请求，只调用 data 暴露的 query/mutation
- `Page.tsx` 不写业务规则，不直接调 API

**理由**：

- 领域规则可以单测
- 数据访问可以替换 adapter
- 页面只负责组合，布局和业务逻辑不再互相缠绕

**迁移策略**：

- 先选 `task` 做样板，不要求 21 个模块同时改
- 新模块按此结构创建
- 旧模块在改动时逐步迁移

---

### ADR-FE-004：状态分三类，各归其位

**决定**：

| 状态 | 归属 | 例子 |
|---|---|---|
| URL state | 路由/URL | 任务范围、视图、搜索词、分页 |
| Server state | 共享 query 层 | 任务、卡片、文件、统计 |
| Local state | 页面/组件局部 | 面板开合、输入草稿、临时选择 |

**服务端状态规则**：

- 使用统一 query key / mutation 生命周期
- mutation 成功后按 key 失效，不在页面里手动 reload
- 乐观更新与失败回滚走同一套约定
- 同一实体只保留一份缓存来源

**不采用**：

- 全局客户端 Store 保存服务端实体
- 每个模块自己维护一套缓存失效
- 页面内 `fetch + setState` 作为默认数据流

**现状说明**：

`shared/api/cache.ts` 与 `domainPolicies.ts` 已经是正确方向；下一步是补齐 query/mutation 的接口约定，而不是推翻。

---

### ADR-FE-005：command-first、页面自持布局

**决定**：

- 不恢复落地页
- 不恢复常驻左侧全局导航
- 全局壳只负责认证、主题、错误边界、命令面板、快速记录、Toast/Confirm
- 页面拥有自己的全高布局

**布局模式收敛为少量模式**：

```text
PageFrame        页面级：头部 + 工具条 + 内容
SplitWorkspace   工作台级：主内容 + 右侧上下文
ListDetail       列表 + 详情（按需）
```

**理由**：

- 当前产品的高频入口是命令和任务流，不是模块导航
- 内容优先，减少 chrome 占用
- 页面自持布局适合首页、任务、文件等工作台型页面

**边界**：

- 如果未来模块数量、跨模块跳转频率显著上升，再评估可折叠 rail
- 不为了“统一”而恢复一个低价值的左侧栏

---

### ADR-FE-006：模块公共入口必须显式

**决定**：

- 每个模块只有 `index.ts` 作为跨模块公共入口
- 公共入口只导出页面、公开 hooks、公开模型/API，不导出内部 UI 细节
- 页面文件放在模块根级；`components/`、`view/`、`model/`、`data/` 是内部实现
- 跨模块不得深引子目录

**理由**：

- barrel 是模块的 interface，不是目录索引
- 页面路由只应认识模块入口，不应认识内部目录结构
- 让模块可以内部重构而不影响调用方

**后果**：

- barrel 会变窄，部分“顺手导出”的组件需要移回内部或提升为 shared
- 需要静态规则防止回退

---

### ADR-FE-007：只保留一套 UI 体系

**决定**：

- 以 `components/ui` + design tokens 为唯一 UI 体系
- 不并行维护第二套组件库
- 共享层按 primitives → patterns → page frames 演进

**理由**：

- 双体系会让维护者同时理解两套 token、两套交互和两套可访问性
- 当前页面已经出现重复的 panel/toolbar/segmented 实现

**落地**：

- 新增页面优先使用 shared primitive/pattern
- 页面专属样式留在页面 CSS Module，不反向污染 shared
- 删除无消费者的 vendored 组件体系

---

### ADR-FE-008：测试按架构层分布

**决定**：

| 层级 | 测什么 | 工具 |
|---|---|---|
| Domain | 纯规则、解析、排序、状态转换 | Vitest |
| Module | data adapter、view model、公共接口 | Vitest + fake adapter |
| Page | 页面组合、空态/错误态/关键交互 | jsdom render |
| App | 路由、认证、跨模块主流程 | Playwright / e2e |
| Architecture | 分层、公共入口、样式/token 契约 | 静态扫描测试 |

**原则**：

- 不为覆盖率而测实现细节
- 页面级测试以“用户能完成什么”为单位
- 核心流程（登录、建任务、改状态、排日历）必须有 e2e
- 架构规则必须有自动门禁，不能只写在文档里

---

### ADR-FE-009：性能边界是架构的一部分

**决定**：

- 路由级懒加载，页面不进入首屏同步链
- 重型库（3D、PDF、Markdown 渲染器）保持独立懒 chunk
- 首屏只加载 shell、认证、命令面板等必要能力
- 构建体积预算进入 CI/评审，而不是事后优化

**理由**：

- 功能继续增加时，首屏膨胀通常来自“顺手 import”
- 架构边界如果允许页面随意引重依赖，代码分割会被绕过

---

### ADR-FE-010：渐进演进，不做大爆炸重构

**决定**：

- 先文档化规则，再选一个模块试点
- 目录调整放在规则稳定之后
- 每次迁移保持可运行、可测试、可回退

**理由**：

- 当前应用可用，架构调整不应制造长期不可合并分支
- 规则先行的迁移成本远低于先改目录再补规则

---

## 5. 非目标

以下事情**明确不做**：

- 微前端
- 全局 Redux/Zustand 式客户端 Store
- 为每个模块套完整 DDD 分层仪式
- 恢复落地页或常驻左侧导航
- 为了“统一”把所有页面改成同一种布局
- 用运行时框架解决本可由静态规则解决的边界问题
- 在没有第二个 adapter 的情况下引入抽象 seam

---

## 6. 迁移路线

### Phase 0：规则与清单

- 在模块清单中标记 `domain` / `capability` / `platform` / `app`
- 明确禁止跨模块深引
- 把本文作为评审依据

**验收**：新模块能按清单找到自己的类型和允许依赖。

### Phase 1：静态门禁

- 扩展现有分层测试：模块类型、跨模块深引、公共入口
- 对共享层反向依赖保持零容忍
- 对存量例外逐条登记，修掉即删

**验收**：违反架构规则时 CI 失败。

### Phase 2：task 试点

- task 内部落地 `model / data / view / components`
- 页面只做组合
- 服务端状态从页面/provider 中抽到 data 层
- 公共接口收窄

**验收**：task 的两个页面不直接依赖 API transport；规则有单测；页面有组合测试。

### Phase 3：统一服务端状态接口

- 定义 query key、mutation、invalidate、optimistic rollback 的最小接口
- 先在 task/card 使用
- 保留 `shared/api` 的 transport 与 domain invalidation

**验收**：同一实体只有一个缓存来源；页面不再手动 reload。

### Phase 4：布局模式

- 抽 `PageFrame` / `SplitWorkspace`
- Home、Task 先用
- 新页面默认复用

**验收**：新增一个列表型页面不需要重新实现页面骨架。

### Phase 5：测试补齐

- 模块公共 contract 测试
- 页面组合测试
- 3 条核心 e2e 流程

**验收**：核心流程回归能在 CI 中发现，而不是靠人工点。

### Phase 6：目录调整（可选）

只有当模块类型、跨域依赖或目录规模确实造成维护成本时，才物理拆为：

```text
app/
domains/
capabilities/
shared/
config/
```

**验收**：目录调整不改变公共接口，不引入新依赖方向。

---

## 7. 风险与回退

| 风险 | 表现 | 缓解 |
|---|---|---|
| 过度抽象 | 为 3 行逻辑建 model/data/view 三件套 | 只在模块确实有规则和数据时分层；简单页面可保持扁平 |
| query 层过重 | 引入复杂框架，页面更难写 | 先做最小接口，按实际重复点演进 |
| 布局标准化过度 | 所有页面被塞进同一种骨架 | 只统一页面级模式，不限制内部内容 |
| 迁移周期长 | 新旧结构长期并存 | 新代码按新规则，旧代码随改动迁移 |
| 静态规则误伤 | 合理的跨域能力被禁止 | 能力模块显式豁免；例外登记并定期清理 |

**回退原则**：任何架构调整必须保持应用可运行；无法在一个迭代内完成时，保留旧路径并让新路径可独立验证。

---

## 8. 结论

当前前端的基础是健康的：模块化单体、清晰路由、统一 API 层、设计 token 和静态契约都在。

需要补的不是“更多抽象”，而是：

1. **模块类型与依赖权限**
2. **模块内部的 domain/data/view 分层**
3. **统一的服务端状态生命周期**
4. **页面布局模式**
5. **页面级与核心流程测试**

这五项确定后，模块数量继续增长也不会靠口头约定维持。整体方向仍是：

> **模块化单体 + command-first 壳 + 页面自持布局 + 轻量服务端状态层 + 静态架构门禁。**
