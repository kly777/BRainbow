# Task 任务模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/tasks` | 分页列表 | 需登录 |
| POST | `/api/tasks` | 创建 | 需登录 |
| GET | `/api/tasks/all` | 全部任务 | 需登录 |
| POST | `/api/tasks/quick` | 快速创建 | 需登录 |
| GET | `/api/tasks/search?q=` | 搜索 | 需登录 |
| GET | `/api/tasks/stats` | 各状态计数 | 需登录 |
| GET | `/api/tasks/tree` | 任务树 | 需登录 |
| GET | `/api/tasks/calendar?start=&end=&status=` | 日历视图 | 需登录 |
| GET | `/api/tasks/dag?task_id=&depth=` | DAG 依赖图 | 需登录 |
| GET | `/api/tasks/status/{status}` | 按状态筛选 | 需登录 |
| PATCH | `/api/tasks/{id}` | 更新 | 需登录 |
| DELETE | `/api/tasks/{id}` | 删除 | 需登录 |
| GET | `/api/tasks/{id}/detail` | 详情 | 需登录 |
| POST | `/api/tasks/{id}/complete` | 完成 | 需登录 |
| POST | `/api/tasks/{id}/activate` | 激活 | 需登录 |
| POST | `/api/tasks/{id}/archive` | 归档 | 需登录 |
| POST | `/api/tasks/{id}/move-to-backlog` | 移回待办 | 需登录 |
| POST | `/api/tasks/{id}/dependencies` | 添加依赖 | 需登录 |
| DELETE | `/api/tasks/{id}/dependencies/{dep_id}` | 移除依赖 | 需登录 |

## 前端 API

`web/src/apis/taskApi.ts`:

- `getTasksE()` / `getAllTasksE()` — 列表
- `createTaskE(CreateTaskRequest)` / `quickCreateTaskE?` 
- `updateTaskE(id, UpdateTaskRequest)`
- `deleteTaskE(id)`
- `searchTasksE(query)` — 搜索
- `getTaskStatsE()` — 统计
- `getTaskTreeE()` — 树（缓存 15s）
- `getTaskDetailE(id)` — 详情（缓存 60s）
- `getDagE(taskId?, depth?)` — DAG（缓存 15s）
- `getCalendarEventsE(start?, end?, status?)` — 日历
- `getBacklogTasksE()` / `getActiveTasksE()` / `getCompletedTasksE()` / `getArchivedTasksE()` — 状态筛选
- `completeTaskE(id)` / `activateTaskE(id)` / `archiveTaskE(id)` / `moveToBacklogE(id)` — 状态操作
- `addTaskDependencyE(taskId, dependsOnTaskId)` / `removeTaskDependencyE(taskId, dependsOnTaskId)`
- `addTaskDecompositionE(parentId, childId)`
- `addTaskTimeAllocationE(taskId, timeWindowId, durationMinutes)`

## UX 评估

### ✅ 做得好的

1. **状态机完整** — backlog → active → completed/archived，有专门的状态切换端点
2. **多种视图** — 列表、树、日历、DAG，覆盖了不同使用场景
3. **依赖管理** — 添加/移除依赖支持 DAG 结构
4. **快速创建** — `POST /api/tasks/quick` 减少创建步骤
5. **统计端点** — `GET /api/tasks/stats` 侧边栏计数
6. **前端 API 组织清晰** — 按功能命名，参数明确

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **`/tasks/all` vs `/tasks` 区分不清晰** | 两者都返回 `TaskListResponse`，区别不直观。应统一为 `/tasks?scope=all` |
| **状态路径冗余** | `/tasks/status/backlog`、`/tasks/status/active` 等 4 个端点可以用 `GET /tasks?status=backlog` 替代 |
| **分解（decomposition）路径混乱** | `POST /tasks/{parentId}/decomposition/{childId}` 路径参数顺序不直观（parent/child 位置）|
| **时间分配路径用路径参数传 duration** | `POST /tasks/{taskId}/time-allocation/{timeWindowId}/{durationMinutes}` — duration 应在 body 中 |
| **DAG 路径在 tasks 下** | `GET /tasks/dag` 合理，但参数 `task_id` 可改为可选 root |
| **quick create 缺少前端 API** | `taskApi.ts` 没有导出 `quickCreateTaskE` |
| **日历事件类型不清晰** | `CalendarEvent` 类型定义在哪？前端 API 返回 `readonly CalendarEvent[]` 但类型可能丢失 |
| **更新接口用 PATCH 但 body 是整个对象** | 应为部分更新，但目前前端传完整对象 |
| **无任务耗时追踪** | 有 `effort_estimate_minutes` 但没有实际耗时记录 |
