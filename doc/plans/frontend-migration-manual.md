# 前端架构迁移执行手册

> 本文档是 BRainbow 前端架构债务的修复指南。
> 覆盖范围：Phase 0（编码规范）+ Phase 1（高危债务修复）。
> 执行顺序：解除跨模块耦合 → 修复 SSE 请求层 → 拆分上帝 Hook。

---

## 目录

- [第一部分：迁移标准（Phase 0）](#第一部分迁移标准phase-0)
  - [S1. Hook 拆分规则](#s1-hook-拆分规则)
  - [S2. 类型文件约定](#s2-类型文件约定)
  - [S3. 状态管理规范](#s3-状态管理规范)
  - [S4. 错误处理规范](#s4-错误处理规范)
  - [S5. API 命名规范](#s5-api-命名规范)
- [第二部分：高危债务修复（Phase 1）](#第二部分高危债务修复phase-1)
  - [T1. 解除跨模块耦合](#t1-解除跨模块耦合)
  - [T2. SSE 请求接入全局层](#t2-sse-请求接入全局层)
  - [T3. 拆分上帝 Hook](#t3-拆分上帝-hook)
- [第三部分：Reviewer Checklist](#第三部分reviewer-checklist)

---

# 第一部分：迁移标准（Phase 0）

> 以下规则是 Phase 1 迁移的验收标准。每条规则附 rationale，帮助理解意图。

## S1. Hook 拆分规则

**规则：单个自定义 Hook 不超过 100 行（不含空行和注释）。**

*Rationale：超过 100 行的 Hook 通常混合了多个职责，难以独立测试和复用。100 行是一个 Hook 能被一口气读懂的上限。*

**规则：一个 Hook 只做一件事。如果一个 Hook 需要管理 3 种以上不相关的状态，必须拆分。**

*Rationale：`useChatSession` 同时管理树列表、URL 路由、SSE 流式调用、乐观 UI——这是 4 件事，不是 1 件事。*

**规则：子 Hook 通过参数接收依赖，不直接 import 同级 Hook 的内部状态。**

*Rationale：直接 import 会导致子 Hook 与父 Hook 紧耦合，无法独立测试。通过参数注入，测试时可以传入 mock 值。*

```ts
// ✅ 正确：通过参数接收
function useTreeFocus(opts: {
  nodes: () => ChatNode[];
  focusId: () => number | null;
}) { ... }

// ❌ 错误：直接 import 同级状态
import { nodes, focusId } from "./useChatSession.ts";
```

**规则：拆分后的子 Hook 必须有独立的类型导出（`ReturnType<typeof useXxx>`）。**

*Rationale：让消费方能明确知道子 Hook 返回了什么，而不是靠猜测。*
## S2. 类型文件约定

**规则：每个模块必须有独立的类型文件（`types.ts` 或 `model.ts`），API 文件只包含函数。**

*Rationale：类型和 API 混在同一文件中，会导致循环导入风险（模块内部需要导入自己 index.ts 的类型）。独立类型文件让类型可以被安全地跨文件引用。*

**规则：类型文件中只放数据结构定义（interface/type），不放函数。**

*Rationale：类型文件是纯粹的数据契约，不应该有运行时行为。*

**规则：Request/Response 类型与 CRUD 类型分开放置。**

*Rationale：`CreateCardRequest` 是 API 协议，`Card` 是领域模型。两者变更频率不同，混在一起会让 diff 噪音变大。*

```
types.ts          — 领域模型（Card, MemItem, ChatTree）
api-types.ts      — API 协议（CreateCardRequest, PaginatedCards）
```

## S3. 状态管理规范

**规则：全局状态统一使用模块级 `createSignal` + export 模式。**

*Rationale：项目中已有 `aiSettingsStore.ts` 使用此模式，是最轻量且符合 SolidJS 习惯的做法。Context 仅用于必须跨组件树传递的场景（如 auth）。*

```ts
// ✅ 标准模式
const [open, setOpen] = createSignal(false);
export const isOpen = () => open();
export const openDialog = () => setOpen(true);
export const closeDialog = () => setOpen(false);
```

**规则：表单状态使用 `createStore` 聚合，不使用多个独立的 `createSignal`。**

*Rationale：12 个独立信号管理一个表单（如 `useBookmarkPage`）会让代码膨胀且难以重置。createStore 提供了批量操作能力。*

```ts
// ✅ 正确
const [form, setForm] = createStore({ title: "", url: "", tags: [] as string[] });

// ❌ 错误
const [formTitle, setFormTitle] = createSignal("");
const [formUrl, setFormUrl] = createSignal("");
const [formTags, setFormTags] = createSignal<string[]>([]);
```

## S4. 错误处理规范

**规则：统一使用 `tryAsync` + Result 模式，禁止混用 `tryOrNotify` 和手动 try/catch。**

*Rationale：`tryAsync` 返回 `{ ok, value } | { ok, error }`，让调用方必须显式处理成功和失败两条路径。tryOrNotify 隐藏了错误细节，手动 try/catch 容易遗漏边界情况。*

```ts
// ✅ 正确
const result = await tryAsync(() => getCardsE(p));
if (result.ok) {
  setCards(result.value.items);
} else {
  notifyError("加载失败", result.error);
}

// ❌ 错误：tryOrNotify 隐藏了错误细节
const ok = await tryOrNotify(() => getCardsE(p), "加载失败");

// ❌ 错误：手动 try/catch 容易遗漏
try {
  const data = await getCardsE(p);
  setCards(data.items);
} catch (e) {
  console.error(e);
}
```

**规则：页面层根据 `result.error` 做业务分类处理，不重复 toast（全局层已处理 401/403/5xx）。**

*Rationale：handleGlobalError 已经对 401（弹登录框）、403（toast 权限不足）、5xx（toast 服务器错误）做了统一处理。页面层只需要处理 4xx 业务错误（如 409 冲突、422 校验）。*

## S5. API 命名规范

**规则：API 函数统一使用 `E` 后缀（Endpoint），命名模式如下：**

| 操作 | 命名模式 | 示例 |
|------|---------|------|
| 获取单个 | `getXxxE` | `getCardE(id)` |
| 获取列表 | `getXxxsE` 或 `listXxxsE` | `getCardsE(page)` / `listTagsE()` |
| 搜索 | `searchXxxsE` | `searchCardsE(query)` |
| 创建 | `createXxxE` | `createCardE(req)` |
| 更新 | `updateXxxE` | `updateCardE(id, req)` |
| 删除 | `deleteXxxE` | `deleteCardE(id)` |

*Rationale：E 后缀区分 API 函数和普通工具函数（如 getCardsE vs getCardsFromStore）。统一命名让开发者一眼看出函数的 CRUD 语义。*

**规则：API 函数的返回类型必须显式标注。**

*Rationale：显式返回类型是 API 层的契约，让消费方不需要看实现就知道返回什么。*

```ts
// ✅ 正确
export const getCardsE = (page: number): Promise<PaginatedCards> =>
  cachedRequest(`/cards?page=${page}`, {});

// ❌ 错误：依赖类型推断
export const getCardsE = (page: number) =>
  cachedRequest(`/cards?page=${page}`, {});
```

---

# 第二部分：高危债务修复（Phase 1）

> 执行顺序：T1（解除耦合）→ T2（修复 SSE）→ T3（拆分 Hook）。
> 每个手术单包含：现状、目标、步骤、验证、回滚。

---

## T1. 解除跨模块耦合

### 现状

`ai-setting` 模块提供两个能力：
1. AI 设置管理（`getAiSettingsE`、`updateAiSettingsE`）—— 配置 CRUD
2. AI 调用客户端（`callAi`、`askAi`）—— 通用 AI 接口

这两个能力被多个模块依赖：
- `mem/components/MnemonicSettingsModal.tsx` → `getAiSettingsE, updateAiSettingsE`
- `mem/MemPage.tsx` → `openAiSettings`
- `mem/hooks/useMnemonic.ts` → `callAi, getAiSettingsE`
- `command-palette/hooks/usePalette.ts` → `openAiSettings`

问题：`mem` 和 `command-palette` 直接 import `@modules/ai-setting`，形成了跨域耦合。

### 目标

将 AI 通用能力提升到 `lib/` 层，切断模块间的直接依赖。

```
# Before
modules/mem/  →  @modules/ai-setting  (3 处)
modules/command-palette/  →  @modules/ai-setting  (2 处)

# After
lib/ai/client.ts     — callAi, askAi, AiMessage, AiRequest, AiResponse
lib/ai/settings.ts   — getAiSettingsE, updateAiSettingsE, AiSettingsItem, AiSettingsUpdate
lib/ai/index.ts      — re-export

modules/mem/  →  @lib/ai  (3 处，改为从 @lib/ai 导入)
modules/command-palette/  →  @lib/ai  (1 处) + @components/ui (openAiSettings 改为事件驱动)
modules/ai-setting/  →  保留 UI 组件（AiSettingsModal），API 层改为从 @lib/ai re-export
```

### 步骤

**1. 创建 `web/src/lib/ai/client.ts`**

从 `modules/ai-setting/ai.ts` 提取：
- `AiMessage`、`AiRequest`、`AiResponse` 类型
- `callAi()` 函数
- `askAi()` 函数

注意：`callAi` 内部调用 `aiChatE`，迁移时需要将 `aiChatE` 的实现也一并移入（或从 `lib/ai/settings.ts` 导入）。

**2. 创建 `web/src/lib/ai/settings.ts`**

从 `modules/ai-setting/api.ts` 提取：
- `AiSettingsItem`、`AiSettingsUpdate` 类型
- `getAiSettingsE()` 函数
- `updateAiSettingsE()` 函数
- `AiProxyMessage` 类型
- `aiChatE()` 函数

**3. 创建 `web/src/lib/ai/index.ts`**

```ts
export * from "./client.ts";
export * from "./settings.ts";
```

**4. 修改 `modules/ai-setting/api.ts`**

改为从 `@lib/ai` re-export，保持对外接口不变：

```ts
export * from "@lib/ai/settings.ts";
```

**5. 修改 `modules/ai-setting/ai.ts`**

改为从 `@lib/ai` re-export：

```ts
export * from "@lib/ai/client.ts";
```

**6. 修改 `modules/mem/` 的 3 个文件**

将 `from "@modules/ai-setting"` 改为 `from "@lib/ai"`：
- `MnemonicSettingsModal.tsx`：`import { getAiSettingsE, updateAiSettingsE } from "@lib/ai"`
- `MemPage.tsx`：`openAiSettings` 保持从 `@modules/ai-setting` 导入（它是 UI 交互，不属于 lib 层）
- `useMnemonic.ts`：`import { callAi, getAiSettingsE } from "@lib/ai"`

**7. 修改 `modules/command-palette/hooks/usePalette.ts`**

`openAiSettings` 保持从 `@modules/ai-setting` 导入（它是 UI 交互）。

### 验证

```bash
pnpm run check && pnpm run test
```

手动验证：
- 记忆页面 → AI 助记功能正常
- 命令面板 → `:ai` 打开 AI 设置弹窗
- AI 设置弹窗 → 保存配置正常

### 回滚

```bash
git checkout web/src/lib/ai/
git checkout web/src/modules/ai-setting/api.ts
git checkout web/src/modules/ai-setting/ai.ts
git checkout web/src/modules/mem/components/MnemonicSettingsModal.tsx
git checkout web/src/modules/mem/MemPage.tsx
git checkout web/src/modules/mem/hooks/useMnemonic.ts
git checkout web/src/modules/command-palette/hooks/usePalette.ts
```

---

## T2. SSE 请求接入全局层

### 现状

`chat/hooks/streamChatRequest.ts`（84 行）直接调用 `fetch()`，绕过了 `lib/api/request.ts` 的全局机制：

- 手动拼 `Authorization: Bearer ${token}` header
- 不经过 `handleGlobalError`（401 不触发登录弹窗）
- 不经过 `withTimeout`
- 错误处理使用自定义 `__ERROR__:` 协议，与全局 `HttpError`/`NetworkError` 体系割裂

### 目标

创建 `lib/api/streaming.ts` 作为 SSE 请求的统一入口，让 SSE 请求复用全局认证和错误处理。

```
# Before
chat/hooks/streamChatRequest.ts  →  直接 fetch() + 手动拼 header

# After
lib/api/streaming.ts              — SSE 请求抽象层（复用 buildHeaders + handleGlobalError）
chat/hooks/streamChatRequest.ts   — 调用 streaming.ts，只负责解析 SSE 协议
```

### 步骤

**1. 补充测试**

确认 `chat/hooks/streamChatRequest.test.ts` 覆盖以下场景：
- 正常流式响应（content + reasoning）
- 401 响应
- 网络错误
- 用户主动取消（AbortSignal）
- 服务端发送 `__ERROR__:` 前缀

如果缺少以上场景的测试，先补全再进行改造。

**2. 创建 `web/src/lib/api/streaming.ts`**

导出一个 `streamRequest` 函数，职责：
- 接收 `endpoint`、`body`、`signal`、`onChunk` 回调
- 内部使用 `buildHeaders`（从 `request.ts` 导出）构建 headers
- 响应非 ok 时，调用 `extractErrorBody` + `handleGlobalError`，然后抛出 `HttpError`
- 返回 `ReadableStream` 或调用 `onChunk` 回调

关键设计：

```ts
import {
  API_BASE_URL,
  extractErrorBody,
  handleGlobalError,
  HttpError,
  buildHeaders,
} from "./request.ts";

export interface StreamRequestOptions {
  endpoint: string;
  body?: unknown;
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
}

export async function streamRequest(
  opts: StreamRequestOptions,
): Promise<void> {
  const url = API_BASE_URL + opts.endpoint;
  const headers = buildHeaders(
    { "Content-Type": "application/json" },
    opts.body ? JSON.stringify(opts.body) : null,
  );

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (!resp.ok) {
    const errorBody = await extractErrorBody(resp);
    const httpError = new HttpError({
      status: resp.status,
      code: errorBody.code,
      message: errorBody.message,
      details: errorBody.details,
    });
    await handleGlobalError(opts.endpoint, httpError);
    throw httpError;
  }

  // 读取 SSE 流
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        opts.onChunk(trimmed.slice(5).replace(/^ /, ""));
      }
    }
  }
}
```

**3. 修改 `lib/api/request.ts`：导出 `buildHeaders`**

将 `buildHeaders` 从 `function` 改为 `export function`，让 `streaming.ts` 可以复用。

**4. 改造 `chat/hooks/streamChatRequest.ts`**

改为调用 `streamRequest`，只保留 SSE 协议解析逻辑：

```ts
import { streamRequest } from "@lib/api";
import type { StreamResult } from "./useChatSessionTypes.ts";

const REASONING_PREFIX = "__R__:";
const DONE_MARK = "__DONE__";
const ERROR_PREFIX = "__ERROR__:";

export async function streamChatRequest(
  id: number,
  parentId: number | null,
  content: string | null,
  _token: string, // 保留签名兼容，内部不再使用
  signal: AbortSignal,
  onPatch: (text: string, reasoning: string) => void,
): Promise<StreamResult> {
  try {
    let acc = "";
    let reasoning = "";

    await streamRequest({
      endpoint: "/chat/trees/" + id + "/chat",
      body: { parent_id: parentId, content },
      signal,
      onChunk: (data) => {
        if (data === DONE_MARK) return;
        if (data.startsWith(ERROR_PREFIX)) {
          acc = data.slice(10);
          throw new Error(acc || "AI 生成失败");
        }
        if (data.startsWith(REASONING_PREFIX)) {
          reasoning += data.slice(6);
        } else {
          acc += data;
        }
        onPatch(acc, reasoning);
      },
    });

    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? "AI 生成失败" };
  }
}
```

注意：`token` 参数保留但不再使用（前缀 `_`），避免改动 `useChatSession.ts` 的调用签名。后续可以清理。

### 验证

```bash
pnpm run check && pnpm run test
```

手动验证：
- AI 对话 → 正常流式输出
- AI 对话 → 思考内容（reasoning）正常显示
- AI 对话 → 服务端错误时显示错误提示
- AI 对话 → 401 时弹出登录框（**这是关键验证点**）
- AI 对话 → 用户点击"停止"按钮正常中断

### 回滚

```bash
rm web/src/lib/api/streaming.ts
git checkout web/src/lib/api/request.ts
git checkout web/src/modules/chat/hooks/streamChatRequest.ts
```

---

## T3. 拆分上帝 Hook

### 现状

5 个 Hook 超过 200 行，混合了多种职责：

| 文件 | 行数 | 职责数 |
|------|------|--------|
| `chat/hooks/useChatSession.ts` | 356 | 5（树列表 + URL 路由 + 流式调用 + 乐观 UI + rAF 节流） |
| `db/hooks/useDbViewer.ts` | 344 | 6（表格选择 + 分页 + 筛选 + 排序 + 导出 + 外键预览） |
| `command-palette/hooks/usePalette.ts` | 295 | 4（模式检测 + 搜索 + 命令 + 键盘事件） |
| `mem/hooks/useMemReview.ts` | 303 | 5（队列管理 + 撤销 + AI 助记 + 标签过滤 + 键盘） |
| `bookmark/hooks/useBookmarkPage.ts` | 273 | 4（表单状态 + CRUD + 导入 + 标签管理） |

### 目标

每个 Hook 拆分为 2-4 个子 Hook + 1 个组合入口，单个子 Hook 不超过 100 行。

---

### T3.1 拆分 `useChatSession.ts`（356 → ~50 行）

**拆分方案：**

```
# Before
hooks/
  useChatSession.ts      (356 行)

# After
hooks/
  useChatSession.ts      (~50 行，组合入口)
  useTreeList.ts         (~80 行，树列表 CRUD + 选择)
  useTreeFocus.ts        (~60 行，URL 驱动的焦点/分支导航)
  useStreamChat.ts       (~120 行，SSE 流式调用 + 乐观 UI + rAF 节流)
```

**子 Hook 接口设计：**

```ts
// useTreeList.ts
export function useTreeList(opts: {
  listTreesFn?: () => Promise<ChatTree[]>;
  createTitle: string;
  createKind?: string;
  createLabel: string;
}) {
  // 返回：trees, loadingTrees, treeId, current, setCurrent,
  //       createSession, removeSession, renameSession, aiTitleSession, selectSession
}

// useTreeFocus.ts
export function useTreeFocus(opts: {
  nodes: () => ChatNode[];
  treeId: () => number | null;
}) {
  // 返回：focusId, setFocusParam, activePath, lastNode,
  //       findNode, focusBranch, isInSubtree, childrenOf
}

// useStreamChat.ts
export function useStreamChat(opts: {
  treeId: () => number | null;
  current: () => TreeDetail | null;
  setCurrent: (updater: (prev: TreeDetail | null) => TreeDetail | null) => void;
  focusId: () => number | null;
  setFocusParam: (id: number | null) => void;
  nodes: () => ChatNode[];
  activePath: () => ChatNode[];
  loadTree: (id: number) => Promise<void>;
  aiTitleSession: (id: number, silent?: boolean) => Promise<boolean>;
  createTitle: string;
}) {
  // 返回：sending, streamingContent, streamingReasoning,
  //       input, setInput, streamChat, stopStreaming
}
```

**组合入口：**

```ts
// useChatSession.ts
export function useChatSession(opts: ChatSessionOptions) {
  const treeList = useTreeList(opts);
  const focus = useTreeFocus({
    nodes: () => treeList.current()?.nodes ?? [],
    treeId: treeList.treeId,
  });
  const stream = useStreamChat({
    ...opts,
    ...treeList,
    ...focus,
    loadTree: treeList.loadTree,
    aiTitleSession: treeList.aiTitleSession,
  });

  return { ...treeList, ...focus, ...stream, navigate: useNavigate() };
}
```

**步骤：**
1. 先确认 `chat-tree.test.ts` 覆盖了 `computeActivePath`、`findBranchLeaf`、`isNodeInSubtree`、`makeTempNode`
2. 创建 `useTreeList.ts`，从 `useChatSession.ts` 行 42-198 提取树列表相关代码
3. 创建 `useTreeFocus.ts`，从行 56-87 提取焦点/分支导航代码
4. 创建 `useStreamChat.ts`，从行 200-319 提取流式调用 + 乐观 UI 代码
5. 改造 `useChatSession.ts` 为组合入口（行 37-41 + 返回对象）
6. 运行 `pnpm run check && pnpm run test`

---

### T3.2 拆分 `useDbViewer.ts`（344 → ~80 行）

**拆分方案：**

```
# Before
hooks/
  useDbViewer.ts         (344 行)

# After
hooks/
  useDbViewer.ts         (~80 行，组合入口)
  useTableState.ts       (~100 行，表格选择 + 分页 + URL 同步)
  useTableFilters.ts     (~80 行，筛选 + 排序)
  useTableExport.ts      (~50 行，导出 CSV/JSON)
```

**子 Hook 接口设计：**

```ts
// useTableState.ts
export function useTableState() {
  // 从 useSearchParams 读取：table, page, page_size, id, ref_col
  // 返回：tables, activeTable, currentPage, currentPageSize, totalPages,
  //       filterId, filterCol, refFilter, columns, rows, total,
  //       loading, error, openTable, reloadTable, jumpToRef, previewFor, changePageSize
}

// useTableFilters.ts
export function useTableFilters(opts: {
  filters: () => ColumnFilter[];
  setSearchParams: (params: Record<string, unknown>) => void;
}) {
  // 返回：sortCol, sortDesc, hasFilters, toggleSort,
  //       setColumnFilter, removeColumnFilter, clearFilters
}

// useTableExport.ts
export function useTableExport(opts: {
  activeTable: () => string;
  getQueryParams: () => TableQueryParams;
}) {
  // 返回：exporting, exportTable
}
```

**步骤：**
1. 创建 `useTableState.ts`，提取表格选择、分页、URL 参数读写（行 50-160）
2. 创建 `useTableFilters.ts`，提取筛选和排序逻辑（行 162-224）
3. 创建 `useTableExport.ts`，提取导出功能（行 252-274）
4. 改造 `useDbViewer.ts` 为组合入口
5. 运行验证

---

### T3.3 拆分 `useMemReview.ts`（303 → ~80 行）

**拆分方案：**

```
# Before
hooks/
  useMemReview.ts        (303 行)

# After
hooks/
  useMemReview.ts        (~80 行，组合入口)
  useReviewSession.ts    (~100 行，复习会话：计时 + 评分 + 队列交互)
  useReviewActions.ts    (~80 行，操作：埋葬/暂停/编辑/撤销)
```

**子 Hook 接口设计：**

```ts
// useReviewSession.ts
export function useReviewSession(opts: {
  tagFilterIds: () => number[];
  tagMode: () => "include" | "exclude";
}) {
  // 返回：queue, counts, avgRating, avgCardTime, maxLearning,
  //       cardStart, cardDurations, loadPreview, loadCounts, tagFilter
}

// useReviewActions.ts
export function useReviewActions(opts: {
  currentMem: () => MemItem | null;
  queue: DueQueueApi;
  undoHook: ReturnType<typeof useUndo>;
  mnemonicHook: ReturnType<typeof useMnemonic>;
}) {
  // 返回：handleReview, handleBury, handleSuspend, handleEdit,
  //       handleUndo, handleMnemonic, editing, editCue, editTarget
}
```

**步骤：**
1. 创建 `useReviewSession.ts`，提取计时、评分、队列加载（行 35-93）
2. 创建 `useReviewActions.ts`，提取埋葬、暂停、编辑等操作
3. 改造 `useMemReview.ts` 为组合入口
4. 运行验证

---

### T3.4 拆分 `useBookmarkPage.ts`（273 → ~80 行）

**拆分方案：**

```
# Before
hooks/
  useBookmarkPage.ts     (273 行)

# After
hooks/
  useBookmarkPage.ts     (~80 行，组合入口)
  useBookmarkForm.ts     (~80 行，表单状态 + CRUD，改用 createStore）
  useBookmarkImport.ts   (~50 行，导入功能）
```

**子 Hook 接口设计：**

```ts
// useBookmarkForm.ts — 同步改为 createStore（符合 S3 规范）
export function useBookmarkForm(opts: {
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = createStore({
    open: false,
    editing: null as Bookmark | null,
    title: "",
    url: "",
    desc: "",
    tags: [] as string[],
    saving: false,
    error: null as string | null,
  });
  // 返回：form, setForm, openCreate, openEdit, save, close
}

// useBookmarkImport.ts
export function useBookmarkImport(opts: {
  onImported: () => Promise<void>;
}) {
  // 返回：importing, handleImport
}
```

**步骤：**
1. 补充 `useBookmarkPage` 的关键路径测试（搜索、翻页、CRUD）
2. 创建 `useBookmarkForm.ts`，提取表单状态 + CRUD（行 42-52 + modal 逻辑），改为 createStore
3. 创建 `useBookmarkImport.ts`，提取导入逻辑
4. 改造 `useBookmarkPage.ts` 为组合入口
5. 运行验证

---

### T3.5 拆分 `usePalette.ts`（295 → ~60 行）

**拆分方案：**

```
# Before
hooks/
  usePalette.ts          (295 行)

# After
hooks/
  usePalette.ts          (~60 行，组合入口)
  usePaletteSearch.ts    (~80 行，站内搜索 + 防抖 + 竞态保护）
  usePaletteCommands.ts  (~80 行，命令列表 + 导航建议 + 键盘事件）
```

**子 Hook 接口设计：**

```ts
// usePaletteSearch.ts
export function usePaletteSearch(opts: {
  mode: () => Mode;
  query: () => string;
}) {
  // 返回：hits, searching, searchItems
}

// usePaletteCommands.ts
export function usePaletteCommands(opts: {
  mode: () => Mode;
  query: () => string;
  hits: () => SearchHit[];
  searching: () => boolean;
  navigate: (path: string) => void;
  close: () => void;
}) {
  // 返回：commands, navItems, cmdItems, currentItems
}
```

**步骤：**
1. 创建 `usePaletteSearch.ts`，提取搜索逻辑（行 154-181）
2. 创建 `usePaletteCommands.ts`，提取命令和导航逻辑（行 81-138）
3. 改造 `usePalette.ts` 为组合入口
4. 运行验证

---

### 验证（通用）

每个 Hook 拆分后都必须运行：

```bash
pnpm run check && pnpm run test
```

手动验证对应页面的核心功能：
- T3.1：AI 对话 → 创建会话、发送消息、切换分支、停止生成
- T3.2：数据库查看 → 切换表格、翻页、筛选、排序、导出
- T3.3：记忆复习 → 复习卡片、评分、撤销、AI 助记
- T3.4：书签 → 搜索、翻页、创建、编辑、导入
- T3.5：命令面板 → /导航、?搜索、:命令、键盘上下选择

### 回滚（通用）

```bash
# 回滚单个 Hook 拆分
rm web/src/modules/<module>/hooks/useXxxNew.ts  # 删除新增文件
git checkout web/src/modules/<module>/hooks/useXxx.ts
```

---

# 第三部分：Reviewer Checklist

> 以下 checklist 用于日常 code review，对照检查新增/修改的代码是否符合迁移标准。

### Hook

- [ ] 单个 Hook 不超过 100 行
- [ ] 一个 Hook 只做一件事
- [ ] 子 Hook 通过参数接收依赖，不直接 import 同级 Hook 内部状态
- [ ] 拆分后的子 Hook 有独立的类型导出

### 类型

- [ ] 类型定义在独立的 `types.ts` 或 `model.ts` 中
- [ ] 类型文件中只放 interface/type，不放函数
- [ ] API 函数的返回类型显式标注

### 状态管理

- [ ] 全局状态使用模块级 `createSignal` + export 模式
- [ ] 表单状态使用 `createStore` 聚合
- [ ] Hook 不暴露 setter（如 `setCards`、`setLoading`）给外部

### 错误处理

- [ ] 使用 `tryAsync` + Result 模式
- [ ] 不重复 toast（全局层已处理 401/403/5xx）
- [ ] 页面层只处理 4xx 业务错误

### API

- [ ] API 函数使用 `E` 后缀
- [ ] 命名符合 CRUD 规范（getXxx / listXxx / searchXxx / createXxx / updateXxx / deleteXxx）
- [ ] 新增 API 函数有对应的缓存失效逻辑（`tapInvalidate`）

### 跨模块

- [ ] 不直接 import 其他业务模块（通过 `@lib/` 或 `@components/` 中转）
- [ ] 通用能力提升到 `lib/` 层，不留在业务模块中

### 测试

- [ ] 被修改的 Hook 有对应的测试文件
- [ ] 纯函数（如 `chat-tree.ts`、`mem-calcs.ts`）有完整的单元测试
- [ ] `pnpm run check` 无类型错误
- [ ] `pnpm run test` 全部通过
