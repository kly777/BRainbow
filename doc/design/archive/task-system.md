# 任务系统 — 功能总结

> 状态：已取代（归档） · 取代者：[`task-ux/`](../task-ux/)（旧 `task_time_allocation` 模型） · 归档日期：2026-10-22
>
> 本文描述旧的 `time_window` / `task_time_allocation` 时间分配模型；这两张表都不在 main 上
> （`task_time_allocation` 在 v24 删除，`time_window` 在 v26 迁到 `task_block`），**不要当现状读**；
> 现行设计见 `doc/design/task-ux/`。

---

## 1. 数据模型

```
task
├── id, title, description
├── parent_task_id        → 自引用树形结构
├── status                → backlog / active / completed / archived
├── completed_at
├── effort_estimate_minutes
└── created_at, updated_at

task_dependency           → A 依赖 B（A 必须先完成，B 才能做）
├── task_id → task.id
└── depends_on_task_id → task.id

task_decomposition        → 父子拆分（大任务拆小任务）
├── parent_task_id → task.id
└── child_task_id → task.id

task_time_allocation      → 时间窗口分配
├── task_id
├── time_window_id
└── duration_minutes
```

## 2. API

### CRUD
| 端点 | 说明 |
|------|------|
| `GET /api/tasks` | 分页列表 |
| `GET /api/tasks/all` | 全部任务 |
| `GET /api/tasks/{id}` | 单个 |
| `POST /api/tasks` | 创建（title + desc + parent + effort） |
| `POST /api/tasks/quick` | 快速创建（仅 title） |
| `PATCH /api/tasks/{id}` | 部分更新 |
| `DELETE /api/tasks/{id}` | 删除 |
| `GET /api/tasks/search?q=` | 搜索 |

### 状态流转
```
backlog → active → completed → archived
   ↑        ↑                    |
   └────────┴─ move-to-backlog ←─┘
```

| 端点 | 流转 |
|------|------|
| `POST /api/tasks/{id}/activate` | backlog/archived → active |
| `POST /api/tasks/{id}/complete` | active → completed |
| `POST /api/tasks/{id}/archive` | completed → archived |
| `POST /api/tasks/{id}/move-to-backlog` | active/completed → backlog |
| `GET /api/tasks/status/{backlog\|active\|completed\|archived}` | 按状态过滤 |

### 关系
| 端点 | 说明 |
|------|------|
| `POST /api/tasks/{id}/dependencies` | 添加依赖 |
| `DELETE /api/tasks/{id}/dependencies/{dep_id}` | 移除依赖 |

### 视图
| 端点 | 说明 |
|------|------|
| `GET /api/tasks/tree` | 树形结构（父子层级） |
| `GET /api/tasks/dag` | 有向无环图（依赖关系） |
| `GET /api/tasks/calendar?start=&end=` | 日历事件 |
| `GET /api/tasks/stats` | 统计（各状态数量） |
| `GET /api/tasks/{id}/detail` | 任务详情（含依赖、子任务、时间窗口） |

## 3. 前端视图

| 视图 | 组件 | 功能 |
|------|------|------|
| **列表** | `TaskList` | 按状态分组，支持拖拽改状态、编辑、添加子任务 |
| **看板** | `TaskKanban` | 三栏（待办/进行中/已完成）拖拽流转 |
| **日历** | `TaskCalendar` | 时间窗口可视化 |
| **依赖图** | `TaskDag` | 依赖关系有向图 |

列表模式下右侧面板可切换「日历」/「依赖图」。

## 4. 当前缺失

- [ ] 搜索功能前端未接通（后端已有 `/search`）
- [ ] 树形视图前端未实现（后端已有 `/tree`）
- [ ] 任务详情弹窗（`/detail`）未接前端
- [ ] 时间窗口分配（`task_time_allocation`）未接前端
- [ ] 精力估算（`effort_estimate_minutes`）创建时传入但列表不显示
