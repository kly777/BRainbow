# 前端错误处理与提示

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 一句话：**错误只翻译一次、只提示一次**。文案的唯一来源是 `getErrorMessage`，
> 传输层已经替你说过的（401/403/5xx）在组件层就别再说。

## 1. 三层 + 一层渲染

| 层 | 文件 | 职责 |
|----|------|------|
| 传输层（全局副作用） | `shared/api/request.ts` 的 `handleGlobalError`；`shared/api/streaming.ts` 复用同一函数 | 401 → 派发 `AUTH_REQUIRED_EVENT`（AuthDialog 弹框）+ 一条 warning 提示（3 秒去重；`SESSION_INVALID` 换文案）；403 → 「权限不足」；5xx → 「服务器错误」（8 秒）；**4xx 只打日志**（`console.error`），交给组件。另外 `request()` 自己还会在 `fetch` 失败/超时时先弹「网络连接失败」/「请求超时」再抛 `NetworkError` |
| 模型层 | `shared/errors/model.ts` | 三个错误类（`NetworkError` / `HttpError` / `ValidationError`）+ `getErrorMessage`（**错误 → 文案的唯一映射**）。零 UI 依赖 |
| 提示与动作层 | `shared/errors/notify.ts`、`shared/errors/actions.ts` | `notifyError / notifySuccess / notifyWarning / notifyInfo`；`tryAsync` / `tryOrNotify` / `confirmAndRun` / `confirmAndDelete` / `showConfirm` |
| 渲染层 | `components/ui/organisms/Toast.tsx`、`ConfirmModal.tsx`、`molecules/ErrorRetry.tsx`、`AsyncView` / `AsyncSection` 的错误槽 | 命令式 API 的渲染端。列表的 `AsyncView` 错误槽是**内联文案 +（传了 `onRetry` 才有的）重试按钮**；单实体的 `AsyncSection` 用 `ErrorRetry` 组件。页面级错误态用四态原语的槽位，别自己拼 |

**统一入口是 `@shared/errors`**（新代码从这里引）。两个旧路径保留再导出，只为不改动
50+ 处老调用点：`@shared/utils`（其 `index.ts` 直接 `export * from "../errors/index.ts"`）与
`@shared/api`（`types/index.ts` 再导出错误类与 `getErrorMessage`）。

## 2. 谁负责提示：一张判据表

| 情况 | 谁提示 | 组件该做什么 |
|------|--------|--------------|
| 401（未登录/过期） | 传输层弹登录框 + 一条提示，3 秒内并发只弹一次 | `notifyError` 会自动静默；别自己再弹 |
| 403 / 5xx | 传输层已说（「权限不足」/「服务器错误」） | `notifyError("删除失败", error)` 也会静默 —— **不传 error 才弹**（`notifyError("删除失败")`），要动作语境时这么写 |
| 4xx 业务错误（400/404/409/413…） | **组件**（传输层只打日志） | 用 `notifyError(title, error)` 或 `tryOrNotify(fn, "动作名")` |
| `NetworkError`（fetch 失败 / 超时） | `request()` 已在抛出前弹过「网络连接失败」/「请求超时」（`NetworkError.canceled` 的主动取消除外） | `alreadyReported` **不抑制** `NetworkError`，所以**别再对同一次 `request()` 失败补一条**，否则会两条。只有绕开 `request()` 的链路（见下面 XHR）才需要自己弹 |
| 列表/详情取数失败 | 四态原语：`AsyncView`（内联错误槽 + 可选重试）/ `AsyncSection`（`ErrorRetry`） | 把 `error` 交给外壳，别额外 toast（骨架与错误态的互斥已写进原语） |
| 写操作失败 | `useListResource.optimistic` 回滚快照 + 一条提示 | 乐观更新失败回滚**有**提示；成功不提示（列表已自证）或按需 `notifySuccess` |

两条容易踩的边界：

- **`notifyError` 的抑制只认 `HttpError` 的 401/403/≥500**：传 `NetworkError` 或字符串
  照样弹。判据与实现都在 `shared/errors/notify.ts` 的 `alreadyReported`。
- **绕开 `request()` 的链路没有全局兜底**：文件上传走 XHR（`platform/file/api.ts` 的
  `uploadFileWithProgress`，为了进度回调），它**不经过** `handleGlobalError` —— 401 只派发
  `AUTH_REQUIRED_EVENT`（弹框，不弹 toast），403/5xx 完全不提示。那类路径必须自己 `notifyError`。
  （真实事故：`MarkdownEditor` 粘贴/拖入上传失败时写着"全局 toast 已处理"，于是 4xx
  静默失败：不插入、也没有任何提示。）

## 3. 选择哪个入口

```ts
import {
  getErrorMessage, notifyError, notifySuccess, tryAsync, tryOrNotify, confirmAndDelete,
} from "@shared/errors";

// 只要结果、错误自己处理
const result = await tryAsync(() => deleteCardE(id));
if (!result.ok) { notifyError("删除失败", result.error); return; }

// 失败自动提示、成功拿返回值（最常用的写操作写法）
const card = await tryOrNotify(() => createCardE(req), "创建卡片");
if (!card) return;

// 危险操作：确认 → 执行 → 提示 → 回调（失败自动回滚回调）
await confirmAndDelete({
  title: "删除卡片", message: "确定？",
  deleteFn: () => deleteCardE(id),
  onError: () => refetch(),
});

// 校验类错误要用文案（表单行内提示）而不是 toast
setError(getErrorMessage(result.error));
```

**别再手写 `err instanceof Error ? err.message : String(err)`**：它拿不到 `HttpError`
的 `{code, details}`，也会漏掉"网络连接失败""服务器错误"这些既有文案。只有两类地方
例外 —— worker / 渲染器里（`platform/file/viewers/splat/worker.ts`、`ModelViewer`、`SplatViewer`）拿到的
不是 API 错误，那里的全局捕获只做兜底。

## 4. 已知边界（不是 bug，但要知道）

- **没有全局错误上报**：所有错误只 `console.error` 一次（`handleGlobalError`），没有
  上报端点。线上排查靠服务端日志。
- **提示去重只有 401**：其它错误短时间内重复触发会各弹一条（Toast 最多同屏 5 条，
  超出丢最早的）。批量操作请用一条汇总文案（见 `platform/file/model/op-notices.ts` 的范式），
  不要在循环里逐条 `notifyError`。
- **Toast 时长分两套**：`notify*` 是固定档——错误 6s / 警告 5s / 信息 4s / 成功 3s
  （`shared/errors/notify.ts`）；传输层自己弹的那几条另给时长（401 的 warning 4s、403 5s、
  5xx 8s、网络失败/超时 6s）。需要"不自动消失"的场景用 `showToast({ duration: 0 })`。
- **`canceled`（主动取消的请求）要静默**：`request()` 对 `AbortError` 且非超时的情形抛
  `NetworkError({ canceled: true })` 且**不弹任何提示**；超时与取消的区分由
  `shared/api/queryParams.ts` 的 `withTimeout` 与调用方约定。调用方见到 `canceled` 也别提示。

## 5. 测试在哪

| 覆盖 | 文件 |
|------|------|
| 错误类与文案映射 | `shared/errors/model.test.ts` |
| 提示的抑制口径（401/403/500/502/503 静默；409 弹；`NetworkError` 弹） | `shared/errors/notify.test.ts` |
| 动作封装的分支语义 | `shared/errors/actions.test.ts` |
| 传输层副作用链（401 去重、403 不弹登录框） | `shared/api/request.guards.test.ts` |
| 传输层超时/取消（不弹网络错误、弹请求超时） | `shared/api/request.timeout.test.ts` |
| 错误体解析（`{code,message,details?}`、网关 502/503/504、HTML 响应体） | `shared/api/request.test.ts` |
| 渲染端（Toast / ConfirmModal / ErrorRetry） | `components/ui/**` 的 `*.test.tsx` |
| 编辑器粘贴失败要提示 | `components/MarkdownEditor.test.tsx` |
