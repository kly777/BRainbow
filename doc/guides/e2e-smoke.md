# 页面级 e2e 冒烟（`just e2e`）

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

真浏览器（Playwright）跑几条"这个页面还能不能干活"的断言。**10 条 / 6 个 spec 文件**，
所以它可以经常跑。

## 形态与取舍

**只起前端 dev server + 在浏览器层造假接口 + 注入假 token。**

| 选择 | 为什么 |
|---|---|
| 不起后端 | 用例确定：不依赖编译产物、不依赖库里的数据、不往 dev 库写东西 |
| 接口在 `page.route` 造假 | 同上；且漏配会**响亮地红**（`e2e 未配桩：/api/xxx`），不会静默走真后端 |
| 登录态直接写 localStorage（假 token） | AuthGuard 只做本地判断，接口又是造假的 —— 不需要真账号 |
| 视口钉死 1440×900（**项目这一层**） | 瀑布流的列数与"要不要继续加载"都跟着宽度走；`devices` 预设自带的 viewport 会盖掉上层 `use` 的设置（踩过） |
| 不重试（`retries: 0`） | 冒烟的价值是"红就是红"，重试只会掩盖不稳 |

**测不到什么**：后端契约变化（字段改名、分页语义、鉴权）。那些归 Rust 侧测试与
`just health`。这里只回答"页面自己有没有坏"。

## 它挡住过什么（都验证过会红）

| 事故 | 用例 | 退回旧代码时的表现 |
|---|---|---|
| `/card` 列表只剩最后一页（加载更多改了数据源分页键） | `card-list.spec.ts` 累积那条 | `Expected: 5, Received: 2` |
| 上传按钮静默失效（ListPage 迁移删掉隐藏 input） | `file-upload.spec.ts` 两条 | `waitForEvent("filechooser")` 超时 |
| 缩略图把截断的 `<style>` 当正文（4KB 窗口切在 Emotion 注入的样式块中间，卡片上显示 `@keyframes …`） | `file-html-snippet.spec.ts` 截断那条 | `getByText(/@keyframes/)` 从 0 变成 1 |

## 怎么加一条

列表页最便宜：接口给 N 条 → 断言 N 条的标题都在（见 `reading-list.spec.ts`，
不需要 testid）。需要精确计数或版式断言时，才在组件上加 `data-testid`
（`Card` / `CardMasonry` / `UploadPanel` 已加）——**别用类名**：CSS Modules 的
类名在 dev（`Card-module__card`）与构建产物（哈希）里不一样。

接口桩统一走 `mockApi(page, stubs)`（`web/e2e/fixtures/api.ts`）：它只放行显式
配桩的 `/api/**`，其余一律 404 并带上 `e2e 未配桩：<path>`，不会静默打到真后端。

## 页面能力清单（补一条勾一条）

| 页面 | 已覆盖 | 待补 |
|---|---|---|
| `/file` | 上传按钮与空态 CTA 都能打开选择框；文件真的 POST 出去；HTML 卡片的元信息缩略（不出现标记/CSS） | 列表渲染条数、删除的乐观更新、改名 |
| `/card` | 两页累积；卡片多时能横向滚动 | 搜索/排序走接口、点击进详情 |
| `/reading` | 接口返回的文章都渲染出来 | 上传弹窗、生词标记 |
| `/admin` | 服务器卡片把内存/CPU/磁盘/上传/备份显示出来；读不到的项显示"—" | 设置开关、密钥轮换 |
| `/task` | 任务工作台骨架、录入区与任务行 | 创建、改期、树/看板交互 |
| `/mem` | — | 复习流程（Again/Hard 的重现） |
| `/bookmark` | — | 列表、导入 HTML |
| `/` `/search` `/chat` | — | 按需 |

## 跑法

```bash
just e2e                      # 全部
just e2e -g 累积               # 只跑匹配的
just e2e --ui                 # 交互式调试（本机用，别在无人值守环境开）
pnpm --dir web exec playwright install chromium   # 浏览器没装时先装
```

失败时 Playwright 会把 trace 落在 `web/test-results/`（已 gitignore），
可以 `pnpm --dir web exec playwright show-trace <zip>` 回放现场。

生成物（`test-results/`、`e2e/.auth/`、`playwright-report/`）已写进 `web/.gitignore`；
`web/vite.config.ts` 的 `fmt.ignorePatterns` 也排除了它们（格式化不会碰生成物），
`lint.ignorePatterns` 目前只显式排除 `dist/**`。跑过 e2e 后若 `pnpm run check` 仍报
这些目录，按同样方式补 ignore，别去改生成物。
