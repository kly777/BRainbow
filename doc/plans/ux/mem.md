# Mem 间隔重复模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/mem/due?limit=` | 获取到期卡 | 公开 |
| GET | `/api/mem/all?page_size=` | 全部卡（管理用） | 公开 |
| GET | `/api/mem/counts` | 各状态计数 | 公开 |
| GET | `/api/mem/session-estimate` | 预估学习次数 | 公开 |
| POST | `/api/mem` | 创建记忆卡 | 公开 |
| PUT | `/api/mem/{id}/edit` | 编辑线索/答案 | 公开 |
| POST | `/api/mem/{id}/review` | 评分 | 公开 |
| POST | `/api/mem/{id}/undo` | 撤销评分 | 公开 |
| GET | `/api/mem/{id}/preview` | 预览评分间隔 | 公开 |
| POST | `/api/mem/{id}/bury` | 埋葬（明天恢复） | 公开 |
| POST | `/api/mem/{id}/unbury` | 取消埋葬 | 公开 |
| POST | `/api/mem/{id}/suspend` | 挂起（永久暂停） | 公开 |
| POST | `/api/mem/{id}/unsuspend` | 恢复（重置为 new） | 公开 |
| POST | `/api/mem/{id}/reset` | 重置记忆数据 | 公开 |
| DELETE | `/api/mem/{id}` | 删除 | 公开 |
| POST | `/api/mem/optimize` | FSRS 参数优化 | 公开 |

## 前端 API

`web/src/apis/memApi.ts`：

- `getMemCountsE()` / `getSessionEstimateE()` — 统计与预估
- `getAllMemsE(pageSize)` → `DueResponse`（缓存 10s）
- `getDueE(limit)` → `DueResponse`（不缓存）
- `createMemE(cueMd, targetMd, prerequisites)` → `{ id }`
- `reviewMemE(id, rating)` → `{ ok }`
- `previewMemE(id)` → `{ intervals }`
- `deleteMemE(id)` / `resetMemE(id)`
- `buryMemE(id)` / `unburyMemE(id)`
- `suspendMemE(id)` / `unsuspendMemE(id)`
- `editMemE(id, cue, target)`
- `uploadImage(file)` → `url | null`（委托给 mediaApi）

## 前端页面

- `MemPage.tsx` — 复习页（主界面）
- `MemManage.tsx` — 管理页（表格 + 详情）
- `MemAdd.tsx` — 添加页

## UX 评估

### ✅ 做得好的

1. **完整的复习流程** — due → review → preview → advanceQueue → session 管理
2. **动态队列大小** — 基于近期评分调整每次拉取数量
3. **进度条** — 显示「≈ N 次学习」预估
4. **多状态管理** — new → learning → review → relearning + suspended
5. **批量操作** — 多选、批量删除/重置/埋葬
6. **排序/搜索/筛选** — 管理页支持按多列排序、内容搜索、状态筛选
7. **Leeched 可视化** — 显示 ⚠️ 标记和遗忘次数
8. **撤销操作** — undo 端点支持撤销最近一次评分
9. **FSRS 参数优化** — 自动/手动触发，运行时更新
10. **副作用聚合** — 所有 API 模块统一用 `request.ts` 的错误处理和缓存失效
11. **「今天已复习」筛选** — 管理页可筛选今天已完成复习的卡

### ⚠️ 可改进

| 问题 | 严重程度 | 建议 |
|---|---|---|
| **所有 mem 路由公开** | 🔴 | `/api/mem/*` 全部无认证，任何知道路径的人可读写记忆数据 |
| **createMem 无返回完整对象** | 🟡 | 只返回 `{ id }`，前端需额外请求拿详情 |
| **undo 请求体复杂** | 🟡 | 需要传整个 `state_before` 对象，前端需自己保存旧状态 |
| `/mem/all` 无搜索/过滤参数 | 🟡 | 目前前端在客户端过滤，数据量大时效率低，应加 `?q=&state=` 服务端过滤 |
| **preview 不返回状态信息** | 🟡 | 只返回 4 个间隔数字，不知道当前学习步进位置 |
| **无 session 持久化** | 🟡 | 刷新页面后学习 session 重置（已简化显示「≈ N 次」缓解） |
| **批量操作无事务** | 🟡 | 批量删除/重置循环逐个调用 API，中途失败部分已执行 |
| **optimize 端点无权限控制** | 🟡 | 任何人都可以触发 FSRS 参数优化 |
| **无统计数据持久化** | 🟡 | 复习量、保持率等统计只在内存中计算，无历史趋势 |
| **mem 路由结构不一致** | 🟢 | `/mem/optimize` 是 POST 无路径参数，但 `/mem/{id}/xxx` 是资源操作，风格混合 |
| **前端 MemItem 和 DueResponse 共用** | 🟢 | `DueResponse.items` 返回 `MemItem[]`，但 `getAllMemsE` 也返回 `DueResponse`（字段 `due_count` 实际是总数）|

### 关键 UX 建议

1. **添加认证** — mem 模块应至少要求登录（与 task/card 一致）
2. **批量操作事务端点** — 新增 `POST /api/mem/batch-delete` / `POST /api/mem/batch-reset` 在服务端一次性执行
3. **管理页服务端搜索** — `GET /api/mem/all?q=&state=&sort=&order=` 避免前端全量拉取
4. **session 持久化** — 将 `sessionReviewed` 存入 localStorage，刷新不丢失
