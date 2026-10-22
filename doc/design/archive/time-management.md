# 时间管理 — 数据模型

> 状态：已取代（归档） · 取代者：[`task_block`](../task-ux/04-数据模型.md) / [`calendar_event`](../task-ux/10-循环与日程事件.md)（见 task-ux/04、10） · 归档日期：2026-10-22
>
> 本文描述旧的 `plan` / `time_log` / `record` 模型，这些表在 main 上都不存在，
> **不要当现状读**；现行任务时间用 `task_block`（feasible / planned），日程事件用 `calendar_event`。

> 三层：task（要做什么）→ plan（打算什么时候）→ record/time_log（实际上发生了什么）

---

## 0. 时间存储

全部 `TEXT`，ISO 8601 格式。

| 精度 | 示例 | 用在哪 |
|------|------|--------|
| DATETIME | `"2026-06-22T14:00:00+08:00"` | plan 的具体时刻 |
| TIME | `"07:00"` | time_log、plan recurrence 模板 |
| DATE | `"2026-06-22"` | — |

---

## 1. task

```sql
task
├── id
├── title           TEXT NOT NULL
├── description     TEXT
├── note            TEXT           -- "银行工作日9-17才开门" 此类约束
├── parent_task_id  → task
├── status          TEXT DEFAULT 'backlog'   -- backlog / active / completed / archived
├── started_at      TEXT                     -- ISO 8601，第一次 backlog→active 时写入
├── completed_at    TEXT                     -- ISO 8601
├── effort_estimate_minutes  INTEGER
├── user_id         → user
├── created_at, updated_at

task_dependency
├── task_id, depends_on_task_id

task_decomposition
├── parent_task_id, child_task_id
```

### 规则

- task 已有的不动。只删旧 `time_window` 关联，加 `note` 字段替代 feasible。
- 任务完成时只写 `task.status=completed` + `completed_at`，不再生成 `record`。

---

## 2. plan

```sql
plan
├── id
├── title           TEXT NOT NULL
├── description     TEXT
├── start_time      TEXT NOT NULL    -- ISO 8601（一次性：完整时刻；重复的：仅时间）
├── end_time        TEXT NOT NULL
├── task_id         → task           -- 可选
├── status          TEXT DEFAULT 'planned'  -- planned / done / cancelled
│
│   -- 重复规则（NULL = 一次性）
├── recurrence_freq           TEXT    -- daily / weekly / monthly
├── recurrence_interval       INTEGER DEFAULT 1
├── recurrence_until          TEXT    -- ISO 8601 日期
├── recurrence_by_weekdays    TEXT    -- "1,3,5"
│
├── user_id, created_at, updated_at
```

### 规则

- **一次性：** `start_time` 完整时刻，`recurrence_freq` NULL。
- **重复的：** `start_time` 仅时间（如 `"07:00"`）。应用层查询时展开。
- **取消某次：** 暂不支持。需要跳过时手动拆成独立 plan。

---

## 3. time_log

```sql
record
├── id
├── kind          TEXT NOT NULL CHECK(kind IN ('time'))  -- 只关心 time
├── title         TEXT NOT NULL
├── content       TEXT
├── tags          TEXT            -- 逗号分隔
├── occurred_at   TEXT NOT NULL    -- ISO 8601（可精确到日期或时刻）
├── user_id       → user
├── created_at, updated_at

time_log
├── record_id    → record ON DELETE CASCADE  (UNIQUE)
├── start_time   TEXT NOT NULL    -- ISO 8601
├── end_time     TEXT NOT NULL    -- ISO 8601
├── plan_id      → plan           -- 可选。有 plan 时从 done 自动填充

CHECK(start_time < end_time)
```

### 规则

- 一条 `record(kind=time)` 有且只有一条 `time_log`。
- `plan_id` 是关联到 plan 的唯一入口。非强制（无 plan 时用 title 描述）。
- 无 plan 时，`record.title` 描述做了什么。

---

## 4. 三层关联

```
task ← plan ← time_log → record(kind=time)
```

- plan 可选挂 task：「每天 7 点健身」纯计划不挂 task；「周四还书」挂 task。
- time_log 通过 `plan_id` 关联 plan：有 plan 时追溯做了什么、对应哪项计划。
- time_log 也可以无 plan，此时 `record.title` 描述实际活动。

---

## 5. 快捷操作

| 你想做 | 实际写入 |
|--------|---------|
| 安排"周四下午开会" | `plan(title, start_time, end_time)` |
| 完成计划"周四开会" | `plan.status=done` + `time_log` + `record(kind=time)` |
| 随手修好灯泡 | `task(title)` + `task.status=completed` + `completed_at` |
| 14-16 写代码（无 plan） | `time_log(start, end)` → `record.title="写代码"` |
| 给任务记时间（无 plan） | `POST /tasks/{id}/log-time { start, end }` → 自动创建 plan + plan done + time_log |
| 给任务记时间（有 plan） | `POST /plans/{id}/done { actual_start, actual_end }` → plan done + time_log |
| 创建任务"写报告" | `task(title, status=backlog)` |
