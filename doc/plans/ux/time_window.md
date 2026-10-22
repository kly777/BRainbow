# Time Window 时间窗口模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/time-windows` | 创建 | 需登录 |
| GET | `/api/time-windows/{task_id}` | 按任务查询 | 需登录 |
| GET | `/api/time-windows/{task_id}/stats` | 时间统计 | 需登录 |
| GET | `/api/time-windows/{task_id}/conflict` | 冲突检测 | 需登录 |
| DELETE | `/api/time-windows/{id}` | 删除 | 需登录 |

## 前端 API

`web/src/apis/timeWindowApi.ts`:

- `getTimeWindowsE(taskId, windowType?)` → `TimeWindow[]`
- `createTimeWindowE(CreateTimeWindowRequest)` → `TimeWindow`
- `deleteTimeWindowE(id)` → `void`

## UX 评估

### ✅ 做得好的

1. **冲突检测** — `GET /conflict` 专门端点，避免前端自己算
2. **按任务分组** — 时间窗口天然属于任务，按 task_id 查询合理
3. **统计端点** — `/stats` 提供聚合数据

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **复用 path param 风格不统一** | 其他模块用 `/{id}` 获取单个资源，这里 `/{task_id}` 是按任务查询 |
| **前端 API 覆盖率不足** | `getTimeWindowStatsE`、`checkTimeConflictE` 在前端 API 中缺失 |
| **无更新端点** | 创建后无法修改时间窗口，只能删了重建 |
| **无全局视图** | 没有 `GET /api/time-windows?start=&end=` 看所有任务的时间窗口 |
| **冲突检测返回格式不清晰** | 需要检查返回的是布尔值还是冲突列表 |
| **创建参数在 types 中** | `CreateTimeWindowRequest` 定义在 `types/time_window.ts`，需要确认前端可访问 |
