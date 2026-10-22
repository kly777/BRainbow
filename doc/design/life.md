# 记录生活 — 数据模型

> 状态：草稿（未实现） · 最后核对：2026-10-22
>
> **未实现**：没有对应的 `plan` / `record` 模块与表，本文只是数据模型的推演，**别当现状读**。
> 配套设计方案见 [`record-design.md`](./record-design.md)。
>
> 三层：task（要做什么）→ plan（打算什么时候）→ record（发生了什么）

---

## 0. 时间存储

全部 `TEXT`，ISO 8601 格式。

| 精度 | 示例 | 用在哪 |
|------|------|--------|
| DATETIME | `"2026-06-22T14:00:00+08:00"` | plan 的具体时刻 |
| TIME | `"07:00"` | time_log、plan recurrence 模板 |
| DATE | `"2026-06-22"` | record.occurred_at |

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

task 表已有的不动。只删了旧 `time_window` 关联，加了 `note` 字段替代 feasible。

任务完成时只写 `task.status=completed` + `completed_at`，不再生成 `record(kind=task)`。

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

**一次性：** `start_time` 完整时刻，`recurrence_freq` NULL。

**重复的：** `start_time` 仅时间（如 `"07:00"`）。应用层查询时展开。

**取消某次：** 暂不支持。需要跳过时手动拆成独立 plan。

---

## 3. record

### 3.1 基表

```sql
record
├── id
├── kind          TEXT NOT NULL CHECK(kind IN ('diary','finance','time'))
├── title         TEXT NOT NULL
├── content       TEXT
├── tags          TEXT            -- 逗号分隔
├── occurred_at   TEXT NOT NULL    -- ISO 8601（可精确到日期或时刻）
├── user_id       → user
├── created_at, updated_at
```

### 3.2 日记

```sql
diary_entry
├── record_id  → record ON DELETE CASCADE  (UNIQUE)
├── mood       INTEGER          -- 1-5
├── weather    TEXT             -- 自由文本
├── energy     INTEGER          -- 1-5
└── is_pinned  INTEGER DEFAULT 0
```

### 3.3 财务

```sql
finance_transaction
├── record_id  → record ON DELETE CASCADE  (UNIQUE)
├── amount     REAL NOT NULL    -- 正=收入，负=支出
├── currency   TEXT DEFAULT 'CNY'
├── category   TEXT
└── account    TEXT
```

### 3.4 时间

```sql
time_log
├── record_id    → record ON DELETE CASCADE  (UNIQUE)
├── start_time   TEXT NOT NULL    -- ISO 8601
├── end_time     TEXT NOT NULL    -- ISO 8601
├── plan_id      → plan           -- 可选。有 plan 时从 done 自动填充

CHECK(start_time < end_time)
```

层级：`record → plan → task`，`plan_id` 是唯一关联入口。
无 plan 时记时间，用 `record.title` 描述做了什么。

## 3.5 物品（独立实体）

物品有状态变化（使用中→借出→归还），不是一次性记录。不从 `record` 继承。

```sql
possession
├── id
├── name          TEXT NOT NULL
├── description   TEXT
├── category      TEXT
├── location      TEXT
├── status        TEXT             -- 自由文本
├── price         REAL
├── acquired_at   TEXT             -- ISO 8601 日期
├── source        TEXT
├── user_id       → user
├── created_at, updated_at
```

物品的购买行为记在 `record(kind=finance)` 上，两件事互不依赖。

---

## 4. 三层的关联

```
record(kind=time)                 record(kind=diary / finance)
└── time_log                      └── 独立，不关联 plan 或 task
    ├── plan_id → plan
    │              └── task_id → task
    └── 或 plan_id = NULL，用 record.title 描述
```

- plan 可选挂 task：「每天7点健身」纯计划不挂 task；「周四还书」挂 task
- time_log 通过 plan_id 关联：有 plan 时追溯，无 plan 时用 record.title 描述
- diary / finance 独立使用，不关联 plan 或 task
- possession 独立实体，不属 record 体系

---

## 5. 快捷操作

| 你想做 | 实际写入 |
|--------|---------|
| 安排"周四下午开会" | `plan(title, start_time, end_time)` |
| 完成计划"周四开会" | `plan.status=done` + `record(kind=time)` |
| 随手修好灯泡 | `task(title)` + `task.status=completed` + `completed_at` |
| 午饭 35 元 | `record(kind=finance)` + `finance_transaction(amount=-35)` |
| 写日记 | `record(kind=diary)` + `diary_entry(mood=4)` |
| 14-16 写代码（无 plan） | `time_log(start, end)` → `record.title="写代码"` |
| 给任务记时间（无 plan） | `POST /tasks/{id}/log-time { start, end }` → 自动创建 plan + done + time_log |
| 给任务记时间（有 plan） | `POST /plans/{id}/done { actual_start, actual_end }` → plan done + time_log |
| 买了个新手机 | `record(kind=finance, amount=-6999)` + `possession(name="iPhone")` 各自独立 |
| 创建任务"写报告" | `task(title, status=backlog)` |
